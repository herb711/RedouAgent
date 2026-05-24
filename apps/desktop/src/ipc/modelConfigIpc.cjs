'use strict';

const CHANNELS = Object.freeze([
  'redou:model-config:list',
  'redou:model-config:probe',
  'redou:model-config:save-provider',
  'redou:model-config:select-model',
  'redou:model-config:remove-provider',
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

function requireModelConfigStore(dependencies) {
  const store = dependencies.modelConfigStore;
  if (!store) throw new Error('modelConfigStore is required');
  return store;
}

function registerModelConfigIpc(ipcMain, dependencies = {}) {
  if (!ipcMain) return CHANNELS;

  handle(ipcMain, 'redou:model-config:list', async () => requireModelConfigStore(dependencies).snapshot());
  handle(ipcMain, 'redou:model-config:probe', async (payload) => requireModelConfigStore(dependencies).probeModels(payload));
  handle(ipcMain, 'redou:model-config:save-provider', async (payload) => requireModelConfigStore(dependencies).saveProvider(payload));
  handle(ipcMain, 'redou:model-config:select-model', async (payload) => requireModelConfigStore(dependencies).selectModel(payload));
  handle(ipcMain, 'redou:model-config:remove-provider', async (payload) => requireModelConfigStore(dependencies).removeProvider(payload));

  return CHANNELS;
}

module.exports = { CHANNELS, registerModelConfigIpc };
