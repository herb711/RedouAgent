'use strict';

const extensionService = require('../services/local-service/extensions/extensionService.cjs');

const CHANNELS = Object.freeze([
  'redou:extensions:list',
  'redou:extensions:catalog',
  'redou:extensions:refresh',
  'redou:extensions:enable',
  'redou:extensions:disable',
  'redou:extensions:remove',
  'redou:extensions:get',
  'minimax:getConfig',
  'minimax:saveConfig',
  'minimax:testConnection',
  'minimax:textToAudio',
  'minimax:textToImage',
  'minimax:openOutputDir',
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

function registerExtensionsIpc(ipcMain, dependencies = {}) {
  if (!ipcMain) return CHANNELS;
  handle(ipcMain, 'redou:extensions:list', (payload) => extensionService.listExtensions(dependencies, payload));
  handle(ipcMain, 'redou:extensions:catalog', (payload) => extensionService.listExtensionCatalog(dependencies, payload));
  handle(ipcMain, 'redou:extensions:refresh', (payload) => extensionService.refreshExtensions(dependencies, payload));
  handle(ipcMain, 'redou:extensions:enable', (payload) => extensionService.enableExtension(dependencies, payload.id));
  handle(ipcMain, 'redou:extensions:disable', (payload) => extensionService.disableExtension(dependencies, payload.id));
  handle(ipcMain, 'redou:extensions:remove', (payload) => extensionService.removeExtension(dependencies, payload.id));
  handle(ipcMain, 'redou:extensions:get', (payload) => extensionService.getExtension(dependencies, payload.id));
  handle(ipcMain, 'minimax:getConfig', () => extensionService.getMiniMaxConfig(dependencies));
  handle(ipcMain, 'minimax:saveConfig', (payload) => extensionService.saveMiniMaxConfig(dependencies, payload));
  handle(ipcMain, 'minimax:testConnection', (payload) => extensionService.testMiniMaxConnection(dependencies, payload));
  handle(ipcMain, 'minimax:textToAudio', (payload) => extensionService.runMiniMaxTextToAudio(dependencies, payload));
  handle(ipcMain, 'minimax:textToImage', (payload) => extensionService.runMiniMaxTextToImage(dependencies, payload));
  handle(ipcMain, 'minimax:openOutputDir', (payload) => extensionService.openMiniMaxOutputTarget(dependencies, payload));
  return CHANNELS;
}

module.exports = { CHANNELS, registerExtensionsIpc };
