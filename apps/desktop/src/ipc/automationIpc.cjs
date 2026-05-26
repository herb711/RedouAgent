'use strict';

const automationService = require('../services/local-service/automationService.cjs');

const CHANNELS = Object.freeze([
  'redou:automations:list',
  'redou:automations:get',
  'redou:automations:create',
  'redou:automations:update',
  'redou:automations:delete',
  'redou:automations:run',
  'redou:automations:runs',
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

function registerAutomationIpc(ipcMain, dependencies = {}) {
  if (!ipcMain) return CHANNELS;
  handle(ipcMain, 'redou:automations:list', async (payload) => automationService.listAutomations(payload, dependencies));
  handle(ipcMain, 'redou:automations:get', async (payload) => automationService.getAutomation(payload, dependencies));
  handle(ipcMain, 'redou:automations:create', async (payload) => automationService.createAutomation(payload, dependencies));
  handle(ipcMain, 'redou:automations:update', async (payload) => automationService.updateAutomation(payload, dependencies));
  handle(ipcMain, 'redou:automations:delete', async (payload) => automationService.deleteAutomation(payload, dependencies));
  handle(ipcMain, 'redou:automations:run', async (payload) => automationService.runAutomation(payload, dependencies));
  handle(ipcMain, 'redou:automations:runs', async (payload) => automationService.listAutomationRuns(payload, dependencies));
  return CHANNELS;
}

module.exports = {
  CHANNELS,
  createAutomation: automationService.createAutomation,
  createAutomationFromTool: automationService.createAutomationFromTool,
  deleteAutomation: automationService.deleteAutomation,
  dynamicAutomationTools: automationService.dynamicAutomationTools,
  getAutomation: automationService.getAutomation,
  isAutomationDue: automationService.isAutomationDue,
  listAutomationRuns: automationService.listAutomationRuns,
  listAutomations: automationService.listAutomations,
  normalizeAutomation: automationService.normalizeAutomation,
  registerAutomationIpc,
  runAutomation: automationService.runAutomation,
  scanDueAutomations: automationService.scanDueAutomations,
  startAutomationScheduler: automationService.startAutomationScheduler,
  updateAutomation: automationService.updateAutomation,
};
