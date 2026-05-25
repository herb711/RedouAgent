'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createDefaultArtifact } = require('../core/models/artifact.cjs');
const { ensureDir, safeJoin } = require('../platform/filesystem/paths.cjs');

const CHANNELS = Object.freeze([
  'redou:artifacts:list',
  'redou:artifacts:get',
  'redou:artifacts:create-text',
  'redou:artifacts:generate-image',
  'redou:artifacts:capture-screenshot',
  'redou:artifacts:open',
  'redou:artifacts:reveal',
]);

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.csv',
  '.diff',
  '.html',
  '.js',
  '.json',
  '.log',
  '.md',
  '.patch',
  '.py',
  '.sh',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

const MIME_BY_EXTENSION = new Map([
  ['.avif', 'image/avif'],
  ['.bmp', 'image/bmp'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.json', 'application/json'],
  ['.md', 'text/markdown'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain'],
  ['.webp', 'image/webp'],
]);

function ok(data, warnings = []) {
  return { ok: true, data, error: null, warnings };
}

function fail(error) {
  return {
    ok: false,
    data: null,
    error: {
      code: error && error.code ? error.code : 'IPC_ERROR',
      message: error && error.message ? error.message : String(error),
      details: error && error.details ? error.details : null,
    },
    warnings: [],
  };
}

function handle(ipcMain, channel, handler) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      return ok(await handler(payload || {}, event));
    } catch (error) {
      return fail(error);
    }
  });
}

function fileExtension(filePath = '') {
  return path.extname(String(filePath || '')).toLowerCase();
}

function mimeTypeFor(filePath = '', fallback = 'application/octet-stream') {
  return MIME_BY_EXTENSION.get(fileExtension(filePath)) || fallback;
}

function artifactTypeFor(filePath = '', fallback = 'file') {
  const mimeType = mimeTypeFor(filePath, '');
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'text/html') return 'html';
  if (TEXT_EXTENSIONS.has(fileExtension(filePath))) return 'document';
  return fallback;
}

function sanitizeFileName(value, fallback = 'artifact') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '');
  return cleaned || fallback;
}

function escapeXml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  }[char]));
}

function artifactFilesRoot(dependencies = {}) {
  return safeJoin(path.resolve(dependencies.dataRoot || '.redou'), 'artifact-files');
}

async function uniqueArtifactPath(root, preferredName) {
  await ensureDir(root);
  const parsed = path.parse(sanitizeFileName(preferredName, 'artifact'));
  const base = parsed.name || 'artifact';
  const extension = parsed.ext || '.txt';
  for (let index = 0; index < 100; index += 1) {
    const name = index === 0 ? `${base}${extension}` : `${base}-${index + 1}${extension}`;
    const candidate = safeJoin(root, name);
    try {
      await fs.writeFile(candidate, '', { flag: 'wx' });
      return candidate;
    } catch (error) {
      if (error && error.code === 'EEXIST') continue;
      throw error;
    }
  }
  throw new Error('Unable to create a unique artifact file.');
}

function eventArtifacts(events = []) {
  const artifacts = [];
  for (const event of events) {
    const payload = event.payload || {};
    const explicit = [
      payload.artifact,
      ...(Array.isArray(payload.artifacts) ? payload.artifacts : []),
    ].filter(Boolean);
    explicit.forEach((artifact, index) => {
      artifacts.push(createDefaultArtifact({
        ...artifact,
        id: artifact.id || `${event.id}:artifact:${index}`,
        taskId: artifact.taskId || event.taskId || event.metadata?.taskId || null,
        projectId: artifact.projectId || event.projectId || event.metadata?.projectId || null,
        status: artifact.status || 'ready',
        createdAt: artifact.createdAt || event.timestamp,
        metadata: {
          ...(artifact.metadata || {}),
          sourceEventId: event.id,
        },
      }));
    });

    if (event.type === 'file_change') {
      const item = payload.item || {};
      const changes = payload.changes || item.changes || [];
      changes.forEach((change, index) => {
        if (!change.path && !change.diff) return;
        artifacts.push(createDefaultArtifact({
          id: `${event.id}:file-change:${index}`,
          taskId: event.taskId || event.metadata?.taskId || null,
          projectId: event.projectId || event.metadata?.projectId || null,
          type: 'diff',
          name: change.path ? path.basename(change.path) : `File change ${index + 1}`,
          path: change.path || null,
          mimeType: 'text/x-diff',
          status: item.status || payload.lifecycle || 'updated',
          content: change.diff || payload.delta || '',
          createdAt: event.timestamp,
          metadata: {
            kind: change.kind || item.type || 'file_change',
            sourceEventId: event.id,
          },
        }));
      });
    }
  }
  return artifacts;
}

function mergeArtifacts(artifacts = []) {
  const byId = new Map();
  for (const artifact of artifacts) {
    if (!artifact || !artifact.id) continue;
    byId.set(artifact.id, artifact);
  }
  return Array.from(byId.values())
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
}

async function derivedArtifacts(payload, dependencies = {}) {
  if (!dependencies.eventStore || typeof dependencies.eventStore.list !== 'function') return [];
  const taskId = payload.taskId || null;
  if (!taskId && !payload.includeGlobal) return [];
  const events = await dependencies.eventStore.list(taskId ? { taskId } : {});
  return eventArtifacts(events);
}

async function listArtifacts(payload, dependencies = {}) {
  const persisted = dependencies.artifactStore && typeof dependencies.artifactStore.list === 'function'
    ? await dependencies.artifactStore.list({
        taskId: payload.taskId || null,
        projectId: payload.projectId || null,
      })
    : [];
  return mergeArtifacts([...persisted, ...await derivedArtifacts(payload, dependencies)]);
}

async function findArtifact(payload, dependencies = {}) {
  const artifactId = payload.id || payload.artifactId;
  if (!artifactId) throw new Error('artifact id is required');
  const persisted = dependencies.artifactStore && typeof dependencies.artifactStore.get === 'function'
    ? await dependencies.artifactStore.get(artifactId)
    : null;
  if (persisted) return persisted;
  return (await derivedArtifacts(payload, dependencies)).find((artifact) => artifact.id === artifactId) || null;
}

async function previewArtifact(artifact) {
  if (!artifact) return null;
  if (artifact.content) {
    return {
      ...artifact,
      preview: {
        kind: artifact.type === 'diff' ? 'diff' : 'text',
        content: String(artifact.content),
        mimeType: artifact.mimeType || 'text/plain',
      },
    };
  }
  if (!artifact.path) return { ...artifact, preview: { kind: 'empty' } };

  const filePath = path.resolve(artifact.path);
  const stats = await fs.stat(filePath);
  if (stats.isDirectory()) {
    const children = await fs.readdir(filePath);
    return {
      ...artifact,
      size: stats.size,
      preview: {
        kind: 'directory',
        entries: children.slice(0, 200),
        truncated: children.length > 200,
      },
    };
  }

  const mimeType = artifact.mimeType || mimeTypeFor(filePath);
  const extension = fileExtension(filePath);
  if (mimeType.startsWith('image/')) {
    const buffer = await fs.readFile(filePath);
    return {
      ...artifact,
      size: buffer.length,
      mimeType,
      preview: {
        kind: 'image',
        dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
      },
    };
  }

  if (TEXT_EXTENSIONS.has(extension) || mimeType.startsWith('text/') || stats.size < 1024 * 1024) {
    const text = await fs.readFile(filePath, 'utf8');
    return {
      ...artifact,
      size: stats.size,
      mimeType,
      preview: {
        kind: mimeType === 'text/html' ? 'html' : 'text',
        content: text.slice(0, 1024 * 1024),
        truncated: text.length > 1024 * 1024,
        mimeType,
      },
    };
  }

  return {
    ...artifact,
    size: stats.size,
    mimeType,
    preview: {
      kind: 'binary',
      message: 'Binary artifact preview is not available.',
    },
  };
}

async function writeArtifactFile(payload, dependencies = {}, content, preferredName) {
  const root = artifactFilesRoot(dependencies);
  const filePath = await uniqueArtifactPath(root, preferredName);
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content || ''), 'utf8');
  await fs.writeFile(filePath, buffer);
  const name = path.basename(filePath);
  const artifact = createDefaultArtifact({
    taskId: payload.taskId || null,
    projectId: payload.projectId || null,
    type: payload.type || artifactTypeFor(filePath),
    name: payload.name || name,
    path: filePath,
    mimeType: payload.mimeType || mimeTypeFor(filePath),
    size: buffer.length,
    status: payload.status || 'ready',
    metadata: payload.metadata || {},
  });
  return dependencies.artifactStore.save(artifact);
}

function generatedImageSvg(prompt) {
  const text = String(prompt || 'Generated image').trim() || 'Generated image';
  let hash = 0;
  for (const char of text) hash = ((hash << 5) - hash + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  const hueB = (hue + 38) % 360;
  const hueC = (hue + 205) % 360;
  const lines = text.match(/.{1,34}/g) || [text];
  const escapedLines = lines.slice(0, 5).map((line, index) => (
    `<text x="80" y="${245 + index * 44}" fill="rgba(255,255,255,0.92)" font-family="Inter, Segoe UI, Arial" font-size="${index === 0 ? 34 : 27}" font-weight="${index === 0 ? 700 : 500}">${escapeXml(line)}</text>`
  )).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" role="img" aria-label="${escapeXml(text)}">
  <defs>
    <linearGradient id="redou-generated-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="hsl(${hue}, 76%, 42%)"/>
      <stop offset="55%" stop-color="hsl(${hueB}, 64%, 38%)"/>
      <stop offset="100%" stop-color="hsl(${hueC}, 50%, 28%)"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#redou-generated-gradient)"/>
  <rect x="52" y="52" width="1176" height="616" rx="28" fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.26)" stroke-width="2"/>
  <circle cx="1040" cy="168" r="94" fill="rgba(255,255,255,0.18)"/>
  <circle cx="1116" cy="560" r="148" fill="rgba(0,0,0,0.12)"/>
  <text x="80" y="122" fill="rgba(255,255,255,0.72)" font-family="Inter, Segoe UI, Arial" font-size="22" font-weight="700">Redou generated image</text>
  ${escapedLines}
</svg>`;
}

async function createTextArtifact(payload, dependencies = {}) {
  if (!dependencies.artifactStore || typeof dependencies.artifactStore.save !== 'function') {
    throw new Error('Artifact store is not available.');
  }
  const content = String(payload.content || '');
  const preferredName = payload.name || 'artifact.txt';
  return writeArtifactFile({
    ...payload,
    type: payload.type || artifactTypeFor(preferredName, 'document'),
    mimeType: payload.mimeType || mimeTypeFor(preferredName, 'text/plain'),
  }, dependencies, content, preferredName);
}

async function generateImageArtifact(payload, dependencies = {}) {
  const prompt = String(payload.prompt || payload.content || '').trim();
  if (!prompt) throw new Error('image prompt is required');
  return writeArtifactFile({
    ...payload,
    type: 'image',
    mimeType: 'image/svg+xml',
    name: payload.name || `generated-${Date.now()}.svg`,
    metadata: {
      ...(payload.metadata || {}),
      prompt,
      generator: 'redou-local-svg',
    },
  }, dependencies, generatedImageSvg(prompt), payload.name || `generated-${Date.now()}.svg`);
}

async function captureScreenshotArtifact(payload, event, dependencies = {}) {
  if (!event || !event.sender || typeof event.sender.capturePage !== 'function') {
    const error = new Error('Renderer screenshot capture is not available.');
    error.code = 'SCREENSHOT_UNAVAILABLE';
    throw error;
  }
  const image = await event.sender.capturePage();
  const buffer = image.toPNG();
  return writeArtifactFile({
    ...payload,
    type: 'screenshot',
    mimeType: 'image/png',
    name: payload.name || `screenshot-${Date.now()}.png`,
    metadata: {
      ...(payload.metadata || {}),
      comment: payload.comment || '',
      capturedAt: new Date().toISOString(),
    },
  }, dependencies, buffer, payload.name || `screenshot-${Date.now()}.png`);
}

async function openArtifact(payload, dependencies = {}, reveal = false) {
  const artifact = await findArtifact(payload, dependencies);
  if (!artifact) throw new Error(`Artifact not found: ${payload.id || payload.artifactId}`);
  const hostShell = dependencies.shell;
  if (!hostShell) throw new Error('Host shell is not available.');
  if (artifact.uri && !artifact.path && typeof hostShell.openExternal === 'function') {
    await hostShell.openExternal(artifact.uri);
    return { opened: true, uri: artifact.uri };
  }
  if (!artifact.path) throw new Error('Artifact has no file path.');
  if (reveal && typeof hostShell.showItemInFolder === 'function') {
    hostShell.showItemInFolder(path.resolve(artifact.path));
    return { revealed: true, path: artifact.path };
  }
  const result = await hostShell.openPath(path.resolve(artifact.path));
  if (result) throw new Error(result);
  return { opened: true, path: artifact.path };
}

function registerArtifactIpc(ipcMain, dependencies = {}) {
  if (!ipcMain) return CHANNELS;
  handle(ipcMain, 'redou:artifacts:list', async (payload) => listArtifacts(payload, dependencies));
  handle(ipcMain, 'redou:artifacts:get', async (payload) => {
    const artifact = await findArtifact(payload, dependencies);
    if (!artifact) return null;
    return previewArtifact(artifact);
  });
  handle(ipcMain, 'redou:artifacts:create-text', async (payload) => createTextArtifact(payload, dependencies));
  handle(ipcMain, 'redou:artifacts:generate-image', async (payload) => generateImageArtifact(payload, dependencies));
  handle(ipcMain, 'redou:artifacts:capture-screenshot', async (payload, event) => captureScreenshotArtifact(payload, event, dependencies));
  handle(ipcMain, 'redou:artifacts:open', async (payload) => openArtifact(payload, dependencies, false));
  handle(ipcMain, 'redou:artifacts:reveal', async (payload) => openArtifact(payload, dependencies, true));
  return CHANNELS;
}

module.exports = {
  CHANNELS,
  eventArtifacts,
  generatedImageSvg,
  listArtifacts,
  previewArtifact,
  registerArtifactIpc,
};
