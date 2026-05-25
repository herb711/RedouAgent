'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readJsonFile, writeJsonFile } = require('../platform/filesystem/jsonFile.cjs');

const CHANNELS = Object.freeze([
  'redou:skills:list',
  'redou:skills:toggle',
  'redou:skills:rescan',
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
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return ok(await handler(payload || {}));
    } catch (error) {
      return fail(error);
    }
  });
}

function settingsPath(dependencies = {}) {
  return path.join(dependencies.dataRoot || process.cwd(), 'skill-settings.json');
}

function candidateSkillRoots(dependencies = {}) {
  const home = os.homedir();
  return Array.from(new Set([
    process.env.CODEX_HOME ? path.join(process.env.CODEX_HOME, 'skills') : null,
    home ? path.join(home, '.codex', 'skills') : null,
    dependencies.workspaceRoot ? path.join(dependencies.workspaceRoot, '.codex', 'skills') : null,
    dependencies.dataRoot ? path.join(dependencies.dataRoot, 'skills') : null,
  ].filter(Boolean).map((entry) => path.resolve(entry))));
}

async function findSkillFiles(root) {
  const results = [];
  async function walk(dir, depth = 0) {
    if (depth > 4) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === 'SKILL.md') {
        results.push(full);
      } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
        await walk(full, depth + 1);
      }
    }
  }
  await walk(root);
  return results;
}

function parseFrontmatter(text = '') {
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end === -1) return {};
  const block = text.slice(3, end).split(/\r?\n/);
  const data = {};
  for (const line of block) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) data[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return data;
}

function firstMarkdownParagraph(text = '') {
  return String(text || '')
    .replace(/^---[\s\S]*?\n---/, '')
    .split(/\r?\n\r?\n/)
    .map((part) => part.replace(/^#+\s*/, '').trim())
    .find(Boolean) || '';
}

async function readSkill(skillPath, root, settings) {
  const text = await fs.readFile(skillPath, 'utf8').catch(() => '');
  const frontmatter = parseFrontmatter(text);
  const dir = path.dirname(skillPath);
  const rel = path.relative(root, dir).replace(/\\/g, '/');
  const name = frontmatter.name || rel.split('/').filter(Boolean).join(':') || path.basename(dir);
  const id = `${root}:${rel || name}`;
  return {
    id,
    name,
    title: frontmatter.title || name,
    description: frontmatter.description || firstMarkdownParagraph(text).slice(0, 240),
    path: skillPath,
    root,
    enabled: !settings.disabled.includes(id) && !settings.disabled.includes(name),
  };
}

async function readSettings(dependencies = {}) {
  const value = await readJsonFile(settingsPath(dependencies), { disabled: [] });
  return {
    disabled: Array.isArray(value.disabled) ? value.disabled.map(String) : [],
  };
}

async function writeSettings(dependencies = {}, settings) {
  return writeJsonFile(settingsPath(dependencies), settings);
}

async function listSkills(_payload = {}, dependencies = {}) {
  const settings = await readSettings(dependencies);
  const roots = candidateSkillRoots(dependencies);
  const skills = [];
  for (const root of roots) {
    const files = await findSkillFiles(root);
    for (const file of files) {
      skills.push(await readSkill(file, root, settings));
    }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return { roots, skills, disabled: settings.disabled };
}

async function toggleSkill(payload = {}, dependencies = {}) {
  const id = String(payload.id || payload.name || '');
  if (!id) {
    const error = new Error('Skill id is required.');
    error.code = 'SKILL_ID_REQUIRED';
    throw error;
  }
  const enabled = Boolean(payload.enabled);
  const settings = await readSettings(dependencies);
  const disabled = new Set(settings.disabled);
  if (enabled) disabled.delete(id);
  else disabled.add(id);
  await writeSettings(dependencies, { disabled: Array.from(disabled).sort() });
  return listSkills(payload, dependencies);
}

function registerSkillsIpc(ipcMain, dependencies = {}) {
  if (!ipcMain) return CHANNELS;
  handle(ipcMain, 'redou:skills:list', async (payload) => listSkills(payload, dependencies));
  handle(ipcMain, 'redou:skills:rescan', async (payload) => listSkills(payload, dependencies));
  handle(ipcMain, 'redou:skills:toggle', async (payload) => toggleSkill(payload, dependencies));
  return CHANNELS;
}

module.exports = {
  CHANNELS,
  candidateSkillRoots,
  listSkills,
  parseFrontmatter,
  registerSkillsIpc,
  toggleSkill,
};
