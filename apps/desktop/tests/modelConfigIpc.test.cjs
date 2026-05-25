const assert = require('node:assert/strict');
const test = require('node:test');

const { registerModelConfigIpc } = require('../src/ipc/modelConfigIpc.cjs');

test('model config IPC redacts API keys from error messages', async () => {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
  };

  registerModelConfigIpc(ipcMain, {
    modelConfigStore: {
      async snapshot() {
        return {};
      },
      async probeModels() {
        throw new Error('Headers.append: "Bearer sk-secret123456789" is an invalid header value.');
      },
      async saveProvider() {
        return {};
      },
      async selectModel() {
        return {};
      },
      async removeProvider() {
        return {};
      },
    },
  });

  const result = await handlers.get('redou:model-config:probe')({}, {});

  assert.equal(result.ok, false);
  assert.match(result.error.message, /Bearer \[REDACTED_API_KEY\]/);
  assert.doesNotMatch(result.error.message, /sk-secret123456789/);
});
