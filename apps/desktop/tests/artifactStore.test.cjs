const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createArtifactStore } = require('../src/core/store/artifactStore.cjs');
const { eventArtifacts, previewArtifact } = require('../src/ipc/artifactIpc.cjs');

test('artifact store persists, filters, and reloads artifacts', async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'redou-artifacts-'));
  const store = createArtifactStore({ dataRoot });
  const artifact = await store.save({
    taskId: 'task-1',
    projectId: 'project-1',
    type: 'document',
    name: 'report.md',
    status: 'ready',
  });

  assert.equal((await store.list({ taskId: 'task-1' })).length, 1);
  assert.equal((await store.list({ taskId: 'task-2' })).length, 0);

  const reloaded = createArtifactStore({ dataRoot });
  assert.equal((await reloaded.get(artifact.id)).name, 'report.md');
});

test('artifact preview reads text files and exposes image data URLs', async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'redou-artifact-preview-'));
  const textPath = path.join(dataRoot, 'note.txt');
  const imagePath = path.join(dataRoot, 'image.png');
  await fs.writeFile(textPath, 'hello artifact', 'utf8');
  await fs.writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const textPreview = await previewArtifact({
    id: 'text',
    type: 'document',
    name: 'note.txt',
    status: 'ready',
    path: textPath,
    mimeType: 'text/plain',
  });
  assert.equal(textPreview.preview.kind, 'text');
  assert.equal(textPreview.preview.content, 'hello artifact');

  const imagePreview = await previewArtifact({
    id: 'image',
    type: 'image',
    name: 'image.png',
    status: 'ready',
    path: imagePath,
    mimeType: 'image/png',
  });
  assert.equal(imagePreview.preview.kind, 'image');
  assert.match(imagePreview.preview.dataUrl, /^data:image\/png;base64,/);
});

test('file change events project diff artifacts', () => {
  const artifacts = eventArtifacts([{
    id: 'event-1',
    type: 'file_change',
    timestamp: '2026-05-25T10:00:00.000Z',
    payload: {
      item: { status: 'completed' },
      changes: [{ path: 'apps/desktop/src/main.cjs', diff: '+hello' }],
    },
    metadata: { taskId: 'task-1', projectId: 'project-1' },
  }]);

  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].type, 'diff');
  assert.equal(artifacts[0].content, '+hello');
  assert.equal(artifacts[0].taskId, 'task-1');
});
