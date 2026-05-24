'use strict';

const { assembleContextPackage } = require('../orchestrator/contextAssembler.cjs');

const CHANNELS = Object.freeze([
  'redou:context:preview',
]);

function ok(data, warnings = []) {
  return { ok: true, data, error: null, warnings };
}

function fail(error) {
  return { ok: false, data: null, error: { code: error.code || 'IPC_ERROR', message: error.message || String(error), details: error.details || null }, warnings: [] };
}

function registerContextIpc(ipcMain, dependencies = {}) {
  if (!ipcMain) return CHANNELS;
  ipcMain.handle('redou:context:preview', async (_event, payload = {}) => {
    try {
      return ok(await assembleContextPackage(payload, dependencies));
    } catch (error) {
      return fail(error);
    }
  });
  return CHANNELS;
}

module.exports = { CHANNELS, registerContextIpc };
