'use strict';

const path = require('node:path');
const { readJsonFile, writeJsonFile } = require('../platform/filesystem/jsonFile.cjs');
const { runCommand } = require('./gitIpc.cjs');

const CHANNELS = Object.freeze([
  'redou:mcp:list',
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

function storePath(dependencies = {}) {
  return path.join(dependencies.dataRoot || process.cwd(), 'mcp-servers.json');
}

function normalizeServer(input = {}) {
  return {
    name: String(input.name || '').trim(),
    command: String(input.command || '').trim(),
    args: Array.isArray(input.args) ? input.args.map(String) : String(input.args || '').split(/\s+/).filter(Boolean),
    env: input.env && typeof input.env === 'object' ? input.env : {},
    enabled: input.enabled === undefined ? true : Boolean(input.enabled),
    installedAt: input.installedAt || new Date().toISOString(),
    lastTest: input.lastTest || null,
  };
}

async function readServers(dependencies = {}) {
  const value = await readJsonFile(storePath(dependencies), []);
  return Array.isArray(value) ? value.map(normalizeServer).filter((server) => server.name) : [];
}

async function writeServers(dependencies = {}, servers = []) {
  await writeJsonFile(storePath(dependencies), servers);
  return servers;
}

async function listMcpServers(_payload = {}, dependencies = {}) {
  return { servers: await readServers(dependencies) };
}

async function installMcpServer(payload = {}, dependencies = {}) {
  const server = normalizeServer(payload);
  if (!server.name || !server.command) {
    const error = new Error('MCP server name and command are required.');
    error.code = 'MCP_SERVER_INVALID';
    throw error;
  }
  const servers = await readServers(dependencies);
  const next = [server, ...servers.filter((item) => item.name !== server.name)];
  await writeServers(dependencies, next);
  return { servers: next, server };
}

async function removeMcpServer(payload = {}, dependencies = {}) {
  const name = String(payload.name || '').trim();
  if (!name) {
    const error = new Error('MCP server name is required.');
    error.code = 'MCP_SERVER_NAME_REQUIRED';
    throw error;
  }
  const servers = await readServers(dependencies);
  const next = servers.filter((server) => server.name !== name);
  await writeServers(dependencies, next);
  return { servers: next, removed: name };
}

async function testMcpServer(payload = {}, dependencies = {}) {
  const name = String(payload.name || '').trim();
  const servers = await readServers(dependencies);
  const server = servers.find((item) => item.name === name);
  if (!server) {
    const error = new Error(`MCP server not found: ${name}`);
    error.code = 'MCP_SERVER_NOT_FOUND';
    throw error;
  }
  const checker = process.platform === 'win32'
    ? { command: 'where.exe', args: [server.command] }
    : { command: 'sh', args: ['-lc', `command -v ${JSON.stringify(server.command)}`] };
  const result = await runCommand(checker.command, checker.args, dependencies.workspaceRoot || process.cwd(), { allowFailure: true });
  const lastTest = {
    ok: result.code === 0,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    testedAt: new Date().toISOString(),
  };
  const next = servers.map((item) => item.name === name ? { ...item, lastTest } : item);
  await writeServers(dependencies, next);
  return { servers: next, server: next.find((item) => item.name === name), lastTest };
}

function registerMcpIpc(ipcMain, dependencies = {}) {
  if (!ipcMain) return CHANNELS;
  handle(ipcMain, 'redou:mcp:list', async (payload) => listMcpServers(payload, dependencies));
  handle(ipcMain, 'redou:mcp:install', async (payload) => installMcpServer(payload, dependencies));
  handle(ipcMain, 'redou:mcp:remove', async (payload) => removeMcpServer(payload, dependencies));
  handle(ipcMain, 'redou:mcp:test', async (payload) => testMcpServer(payload, dependencies));
  return CHANNELS;
}

module.exports = {
  CHANNELS,
  installMcpServer,
  listMcpServers,
  normalizeServer,
  registerMcpIpc,
  removeMcpServer,
  testMcpServer,
};
