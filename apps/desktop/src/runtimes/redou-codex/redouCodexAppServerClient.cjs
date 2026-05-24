'use strict';

const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const {
  REDOU_CODEX_RUNTIME_NOT_FOUND,
  REDOU_CODEX_START_FAILED,
  defaultRedouCodexHome,
  resolveRedouCodexLaunch,
  sanitizeRedouCodexChildEnv,
} = require('./redouCodexRuntimeConfig.cjs');

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_ARGS = ['app-server'];

function createClientError(message, details = {}) {
  const error = new Error(message);
  error.code = details.code || 'REDOU_CODEX_APP_SERVER_ERROR';
  error.details = details;
  return error;
}

function classifySpawnError(error) {
  const code = error && error.code ? error.code : 'SPAWN_FAILED';
  const message = error && error.message ? error.message : 'Failed to spawn redou-codex app-server';
  const lower = message.toLowerCase();
  if (code === 'ENOENT') {
    return { code: REDOU_CODEX_RUNTIME_NOT_FOUND, message: 'Project redou-codex runtime was not found.', cause: message };
  }
  if (code === 'EACCES' || code === 'EPERM' || lower.includes('access is denied') || lower.includes('permission denied')) {
    return { code: REDOU_CODEX_START_FAILED, message: 'redou-codex could not be launched.', cause: message };
  }
  return { code: REDOU_CODEX_START_FAILED, message, cause: message, originalCode: code };
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({ error: 'Failed to serialize JSON-RPC message', details: String(error && error.message || error) });
  }
}

function quoteCmdArg(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function spawnTargetFor(command, args) {
  if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(command)) {
    return { command, args };
  }
  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', ['call', quoteCmdArg(command), ...args.map(quoteCmdArg)].join(' ')],
    windowsVerbatimArguments: true,
  };
}

function createRedouCodexAppServerClient(options = {}) {
  const emitter = new EventEmitter();
  const pending = new Map();
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  let child = null;
  let nextId = Number.isInteger(options.initialRequestId) ? options.initialRequestId : 1;
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let initialized = false;
  let disposed = false;

  function appendLog(level, message, metadata = {}) {
    if (!options.logPath) return;
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...metadata,
    };
    try {
      fs.mkdirSync(path.dirname(options.logPath), { recursive: true });
      fs.appendFileSync(options.logPath, JSON.stringify(entry) + '\n', 'utf8');
    } catch {
      // Runtime logs are diagnostic-only; app-server transport must keep running.
    }
  }

  function emitLog(level, message, metadata = {}) {
    appendLog(level, message, metadata);
    emitter.emit('notification', {
      method: level === 'error' ? 'protocol_error' : 'raw_log',
      params: {
        level,
        message,
        ...metadata,
      },
    });
  }

  function rejectAllPending(reason) {
    for (const [id, entry] of pending.entries()) {
      clearTimeout(entry.timer);
      entry.reject(reason);
      pending.delete(id);
    }
  }

  function writeMessage(message) {
    if (!child || !child.stdin || child.stdin.destroyed) {
      throw createClientError('redou-codex app-server stdin is not available.', { code: 'STDIN_CLOSED' });
    }
    child.stdin.write(safeJson(message) + '\n');
  }

  function sendResponse(id, result, error) {
    const message = error
      ? { id, error }
      : { id, result: result === undefined ? {} : result };
    writeMessage(message);
  }

  function handleResponse(message) {
    const entry = pending.get(message.id);
    if (!entry) {
      emitLog('warn', 'Received response for unknown redou-codex request id.', { id: message.id });
      return;
    }
    clearTimeout(entry.timer);
    pending.delete(message.id);
    if (message.error) {
      entry.reject(createClientError(message.error.message || 'redou-codex app-server request failed.', {
        code: message.error.code || 'JSON_RPC_ERROR',
        rpcError: message.error,
        method: entry.method,
      }));
      return;
    }
    entry.resolve(message.result);
  }

  function handleLine(line, stream) {
    const trimmed = line.trim();
    if (!trimmed) return;

    let message;
    try {
      message = JSON.parse(trimmed);
    } catch (error) {
      emitLog('error', 'Failed to parse redou-codex app-server JSONL message.', {
        stream,
        raw: trimmed,
        error: String(error && error.message || error),
      });
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, 'id') && !message.method) {
      handleResponse(message);
      return;
    }

    if (message.method && Object.prototype.hasOwnProperty.call(message, 'id')) {
      emitter.emit('serverRequest', message);
      return;
    }

    if (message.method) {
      emitter.emit('notification', message);
      return;
    }

    emitLog('error', 'Received unknown redou-codex app-server protocol message.', { stream, raw: trimmed });
  }

  function consumeChunk(chunk, stream) {
    const text = chunk.toString('utf8');
    if (stream === 'stderr') {
      stderrBuffer += text;
      let index = stderrBuffer.indexOf('\n');
      while (index !== -1) {
        const line = stderrBuffer.slice(0, index);
        stderrBuffer = stderrBuffer.slice(index + 1);
        if (line.trim()) emitLog('info', line, { stream: 'stderr' });
        index = stderrBuffer.indexOf('\n');
      }
      return;
    }

    stdoutBuffer += text;
    let index = stdoutBuffer.indexOf('\n');
    while (index !== -1) {
      const line = stdoutBuffer.slice(0, index);
      stdoutBuffer = stdoutBuffer.slice(index + 1);
      handleLine(line, 'stdout');
      index = stdoutBuffer.indexOf('\n');
    }
  }

  function ensureStarted() {
    if (child) return Promise.resolve();
    if (disposed) {
      return Promise.reject(createClientError('redou-codex app-server client has been disposed.', { code: 'CLIENT_DISPOSED' }));
    }

    let launch;
    try {
      launch = options.launch || resolveRedouCodexLaunch(options);
    } catch (error) {
      return Promise.reject(error);
    }
    const command = launch.command;
    const args = launch.args || DEFAULT_ARGS;
    const redouCodexHome = options.redouCodexHome
      || (options.env && options.env.REDOU_CODEX_HOME)
      || defaultRedouCodexHome(options);
    const spawnOptions = {
      cwd: options.cwd,
      env: sanitizeRedouCodexChildEnv({ ...process.env, ...(options.env || {}) }, redouCodexHome, options),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    };

    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        const spawnTarget = spawnTargetFor(command, args);
        const effectiveSpawnOptions = spawnTarget.windowsVerbatimArguments
          ? { ...spawnOptions, windowsVerbatimArguments: true }
          : spawnOptions;
        appendLog('info', 'Starting redou-codex app-server.', {
          command,
          args,
          actualExecutablePath: launch.actualExecutablePath || null,
          intendedExecutablePath: launch.intendedExecutablePath || null,
          launchMode: launch.mode || null,
          spawnCommand: spawnTarget.command,
          spawnArgs: spawnTarget.args,
          windowsVerbatimArguments: Boolean(spawnTarget.windowsVerbatimArguments),
        });
        child = spawn(spawnTarget.command, spawnTarget.args, effectiveSpawnOptions);
      } catch (error) {
        child = null;
        const details = classifySpawnError(error);
        reject(createClientError(details.message, details));
        return;
      }

      child.once('spawn', () => {
        settled = true;
        resolve();
      });

      child.once('error', (error) => {
        const details = classifySpawnError(error);
        const wrapped = createClientError(details.message, details);
        child = null;
        if (!settled) {
          settled = true;
          reject(wrapped);
        }
        rejectAllPending(wrapped);
      });

      child.once('exit', (code, signal) => {
        const wrapped = createClientError('redou-codex app-server exited.', {
          code: 'PROCESS_EXITED',
          exitCode: code,
          signal,
        });
        child = null;
        initialized = false;
        rejectAllPending(wrapped);
        emitter.emit('notification', {
          method: 'raw_log',
          params: { level: 'warn', message: 'redou-codex app-server exited.', code, signal },
        });
      });

      child.stdout.on('data', (chunk) => consumeChunk(chunk, 'stdout'));
      child.stderr.on('data', (chunk) => consumeChunk(chunk, 'stderr'));
    });
  }

  return {
    options,
    async initialize(params = options.initializeParams || {}) {
      if (initialized) return { alreadyInitialized: true };
      await ensureStarted();
      try {
        const result = await this.request('initialize', params, { timeoutMs: options.initializeTimeoutMs || timeoutMs });
        writeMessage({ method: 'initialized' });
        initialized = true;
        return result;
      } catch (error) {
        throw createClientError('redou-codex app-server initialize failed.', {
          code: REDOU_CODEX_START_FAILED,
          cause: error && error.message ? error.message : String(error),
          originalCode: error && error.code,
        });
      }
    },
    async request(method, params, requestOptions = {}) {
      await ensureStarted();
      const id = nextId++;
      const requestTimeoutMs = requestOptions.timeoutMs || timeoutMs;
      const message = params === undefined ? { id, method } : { id, method, params };

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(createClientError('redou-codex app-server request timed out.', {
            code: 'REQUEST_TIMEOUT',
            method,
            id,
            timeoutMs: requestTimeoutMs,
          }));
        }, requestTimeoutMs);
        pending.set(id, { method, resolve, reject, timer });

        try {
          writeMessage(message);
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      });
    },
    respondToServerRequest(id, result) {
      sendResponse(id, result);
    },
    rejectServerRequest(id, error) {
      sendResponse(id, undefined, error || { code: -32603, message: 'Request rejected by Redou.' });
    },
    onNotification(handler) {
      emitter.on('notification', handler);
      return () => emitter.off('notification', handler);
    },
    onServerRequest(handler) {
      emitter.on('serverRequest', handler);
      return () => emitter.off('serverRequest', handler);
    },
    onRequest(handler) {
      emitter.on('serverRequest', handler);
      return () => emitter.off('serverRequest', handler);
    },
    isInitialized() {
      return initialized;
    },
    getProcess() {
      return child;
    },
    getPendingRequestCount() {
      return pending.size;
    },
    async dispose() {
      disposed = true;
      const error = createClientError('redou-codex app-server client disposed.', { code: 'CLIENT_DISPOSED' });
      rejectAllPending(error);
      if (!child) return;
      const processToClose = child;
      child = null;
      initialized = false;
      if (processToClose.stdin && !processToClose.stdin.destroyed) {
        processToClose.stdin.end();
      }
      if (!processToClose.killed) {
        processToClose.kill();
      }
    },
  };
}

module.exports = {
  createRedouCodexAppServerClient,
  createClientError,
  classifySpawnError,
  spawnTargetFor,
};
