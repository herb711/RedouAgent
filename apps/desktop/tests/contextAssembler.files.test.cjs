const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { assembleContextPackage } = require('../src/orchestrator/contextAssembler.cjs');

test('context assembler includes selected text file contents', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redou-context-files-'));
  const filePath = path.join(root, 'notes.txt');
  fs.writeFileSync(filePath, 'hello from selected file\nsecond line', 'utf8');

  const context = await assembleContextPackage({
    userInput: 'what is in this file?',
    selectedFiles: [filePath],
    metadata: {
      contextItems: [{ path: filePath, name: 'notes.txt', kind: 'file' }],
    },
  });

  assert.equal(context.metadata.contextItems[0].path, filePath);
  assert.equal(context.selectedFiles.length, 1);
  assert.match(context.selectedFiles[0], /File:/);
  assert.match(context.selectedFiles[0], /hello from selected file/);
});
