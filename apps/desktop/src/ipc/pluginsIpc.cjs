'use strict';

const extensionService = require('../services/local-service/extensions/extensionService.cjs');

const CHANNELS = Object.freeze([
  'redou:plugins:list',
  'redou:plugins:enable',
  'redou:plugins:disable',
  'redou:plugins:create',
  'redou:plugins:remove',
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

function pluginExtensionId(id) {
  const value = String(id || '');
  return value.startsWith('plugin:') ? value : `plugin:${value}`;
}

function registerPluginsIpc(ipcMain, dependencies = {}) {
  if (!ipcMain) return CHANNELS;
  handle(ipcMain, 'redou:plugins:list', () => extensionService.listPlugins(dependencies));
  handle(ipcMain, 'redou:plugins:enable', (payload) => extensionService.enableExtension(dependencies, pluginExtensionId(payload.id || payload.name)));
  handle(ipcMain, 'redou:plugins:disable', (payload) => extensionService.disableExtension(dependencies, pluginExtensionId(payload.id || payload.name)));
  handle(ipcMain, 'redou:plugins:create', async (payload) => {
    const created = await extensionService.createPlugin(dependencies, payload || {});
    return { ...created, ...(await extensionService.listPlugins(dependencies)) };
  });
  handle(ipcMain, 'redou:plugins:remove', (payload) => extensionService.removeExtension(dependencies, pluginExtensionId(payload.id || payload.name)));
  return CHANNELS;
}

module.exports = { CHANNELS, registerPluginsIpc };
