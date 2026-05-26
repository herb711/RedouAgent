'use strict';

const {
  addMcpServer: addMcpServerService,
  listMcpServers: listMcpServersService,
  normalizeMcpServer,
  removeMcpServer: removeMcpServerService,
  testMcpServer: testMcpServerService,
  toggleMcpServer: toggleMcpServerService,
  updateMcpServer: updateMcpServerService,
} = require('../services/local-service/extensions/extensionService.cjs');

const CHANNELS = Object.freeze([
  'redou:mcp:list',
  'redou:mcp:add',
  'redou:mcp:update',
  'redou:mcp:toggle',
  'redou:mcp:install',
  'redou:mcp:remove',
  'redou:mcp:test',
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

function normalizeServer(input = {}) {
  return normalizeMcpServer(input.name, input);
}

async function listMcpServers(payload = {}, dependencies = {}) {
  return listMcpServersService(dependencies, payload);
}

async function addMcpServer(payload = {}, dependencies = {}) {
  return addMcpServerService(dependencies, payload);
}

async function installMcpServer(payload = {}, dependencies = {}) {
  return addMcpServer(payload, dependencies);
}

async function updateMcpServer(payload = {}, dependencies = {}) {
  return updateMcpServerService(dependencies, payload.id || payload.name, payload.config || payload);
}

async function toggleMcpServer(payload = {}, dependencies = {}) {
  return toggleMcpServerService(dependencies, payload.id || payload.name, payload.enabled);
}

async function removeMcpServer(payload = {}, dependencies = {}) {
  return removeMcpServerService(dependencies, payload.id || payload.name || payload);
}

async function testMcpServer(payload = {}, dependencies = {}) {
  return testMcpServerService(dependencies, payload);
}

function registerMcpIpc(ipcMain, dependencies = {}) {
  if (!ipcMain) return CHANNELS;
  handle(ipcMain, 'redou:mcp:list', async (payload) => listMcpServers(payload, dependencies));
  handle(ipcMain, 'redou:mcp:add', async (payload) => addMcpServer(payload, dependencies));
  handle(ipcMain, 'redou:mcp:update', async (payload) => updateMcpServer(payload, dependencies));
  handle(ipcMain, 'redou:mcp:toggle', async (payload) => toggleMcpServer(payload, dependencies));
  handle(ipcMain, 'redou:mcp:install', async (payload) => installMcpServer(payload, dependencies));
  handle(ipcMain, 'redou:mcp:remove', async (payload) => removeMcpServer(payload, dependencies));
  handle(ipcMain, 'redou:mcp:test', async (payload) => testMcpServer(payload, dependencies));
  return CHANNELS;
}

module.exports = {
  CHANNELS,
  addMcpServer,
  installMcpServer,
  listMcpServers,
  normalizeServer,
  registerMcpIpc,
  removeMcpServer,
  testMcpServer,
  toggleMcpServer,
  updateMcpServer,
};
