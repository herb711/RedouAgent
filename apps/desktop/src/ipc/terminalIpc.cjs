'use strict';

const { resolveProjectRoot, runCommand } = require('./gitIpc.cjs');

const CHANNELS = Object.freeze([
  'redou:terminal:run',
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

function shellInvocation(command) {
  if (process.platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
    };
  }
  return {
    command: process.env.SHELL || 'bash',
    args: ['-lc', command],
  };
}

async function runTerminalCommand(payload = {}, dependencies = {}) {
  const commandText = String(payload.command || '').trim();
  if (!commandText) {
    const error = new Error('Terminal command is required.');
    error.code = 'TERMINAL_COMMAND_REQUIRED';
    throw error;
  }
  const cwd = await resolveProjectRoot(payload, dependencies);
  const startedAt = new Date().toISOString();
  const shell = shellInvocation(commandText);
  const result = await runCommand(shell.command, shell.args, cwd, {
    allowFailure: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  return {
    id: `terminal:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    command: commandText,
    cwd,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

function registerTerminalIpc(ipcMain, dependencies = {}) {
  if (!ipcMain) return CHANNELS;
  handle(ipcMain, 'redou:terminal:run', async (payload) => runTerminalCommand(payload, dependencies));
  return CHANNELS;
}

module.exports = {
  CHANNELS,
  registerTerminalIpc,
  runTerminalCommand,
  shellInvocation,
};
