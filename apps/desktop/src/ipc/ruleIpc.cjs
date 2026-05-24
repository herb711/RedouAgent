'use strict';

const { createDefaultRulePack } = require('../core/models/rules.cjs');

const CHANNELS = Object.freeze([
  'redou:rules:get',
  'redou:rules:update',
]);

function ok(data, warnings = []) {
  return { ok: true, data, error: null, warnings };
}

function fail(error) {
  return { ok: false, data: null, error: { code: error.code || 'IPC_ERROR', message: error.message || String(error), details: error.details || null }, warnings: [] };
}

function registerRuleIpc(ipcMain, dependencies = {}) {
  if (!ipcMain) return CHANNELS;
  let rulePack = createDefaultRulePack(dependencies.initialRules || {});
  ipcMain.handle('redou:rules:get', async () => {
    try {
      return ok(rulePack);
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle('redou:rules:update', async (_event, payload = {}) => {
    try {
      rulePack = createDefaultRulePack({ ...rulePack, ...payload });
      return ok(rulePack);
    } catch (error) {
      return fail(error);
    }
  });
  return CHANNELS;
}

module.exports = { CHANNELS, registerRuleIpc };
