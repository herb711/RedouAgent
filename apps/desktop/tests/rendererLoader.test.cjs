const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { resolveRendererEntry } = require('../src/platform/electron/rendererLoader.cjs');

test('explicit renderer dev server takes precedence over built dist', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redou-renderer-'));
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html>', 'utf8');

  assert.deepEqual(resolveRendererEntry({
    rendererRoot: root,
    devServerUrl: 'http://127.0.0.1:5173',
  }), {
    kind: 'url',
    target: 'http://127.0.0.1:5173',
  });
});

test('built dist is used when no dev server is configured', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redou-renderer-'));
  const index = path.join(root, 'dist', 'index.html');
  fs.mkdirSync(path.dirname(index), { recursive: true });
  fs.writeFileSync(index, '<!doctype html>', 'utf8');

  assert.deepEqual(resolveRendererEntry({ rendererRoot: root }), {
    kind: 'file',
    target: index,
  });
});
