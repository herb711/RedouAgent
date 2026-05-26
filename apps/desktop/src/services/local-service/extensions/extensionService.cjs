'use strict';

const fsSync = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');

const { spawnTargetFor } = require('../../../runtimes/redou-codex/redouCodexAppServerClient.cjs');
const {
  createPlugin,
  createSkill,
  listPluginCatalog,
  listSkills,
  normalizeMcpServer,
  readMcpServers,
  readPluginConfigs,
  writeMcpServers,
  writePluginConfigs,
  readSkillSettings,
  writeSkillSettings,
} = require('./extensionCatalog.cjs');
const { extensionId, extensionKindFromId, rawIdFromExtensionId } = require('./extensionTypes.cjs');
const minimaxProvider = require('./providers/minimax/index.cjs');

const mcpLastTests = new Map();

function mcpLastTestKey(dependencies = {}, name) {
  return `${path.resolve(dependencies.redouCodexHome || dependencies.dataRoot || dependencies.workspaceRoot || process.cwd())}:${name}`;
}

function mcpStatus(server) {
  if (!server.enabled) return 'disabled';
  if (server.transport === 'stdio' && !server.command) return 'missing-config';
  if (server.transport !== 'stdio' && !server.url) return 'missing-config';
  return 'ready';
}

function mcpItem(server, dependencies = {}) {
  const title = server.displayName || server.name || 'MCP Server';
  const detail = server.transport === 'stdio'
    ? [server.command, ...(server.args || [])].filter(Boolean).join(' ')
    : server.url;
  const status = mcpStatus(server);
  const lastTest = mcpLastTests.get(mcpLastTestKey(dependencies, server.name)) || null;
  return {
    id: extensionId('mcp', server.name),
    kind: 'mcp',
    name: server.name,
    title,
    description: detail || 'MCP server',
    source: 'user',
    installed: true,
    enabled: server.enabled,
    category: server.transport === 'stdio' ? 'STDIO' : 'HTTP',
    tags: [server.transport === 'stdio' ? 'stdio' : 'streamable-http'],
    icon: 'server',
    configPath: server.configPath,
    canRemove: true,
    canUpdate: true,
    status,
    statusMessage: status === 'missing-config' ? 'Missing command or URL.' : '',
    raw: lastTest ? { ...server, lastTest } : server,
  };
}

function truncateText(value, limit = 4000) {
  const text = String(value || '');
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n... truncated ...`;
}

function redactSensitiveText(text, env = {}) {
  let redacted = String(text || '');
  for (const [key, value] of Object.entries(env || {})) {
    const secret = String(value || '');
    if (!secret || secret.length < 8) continue;
    if (!/(api[_-]?key|token|secret|password|credential)/i.test(key) && !/^sk-[A-Za-z0-9_-]+/.test(secret)) continue;
    redacted = redacted.split(secret).join('[redacted]');
  }
  return redacted.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, 'sk-[redacted]');
}

function pathValueFromEnv(env = process.env) {
  if (Object.prototype.hasOwnProperty.call(env, 'Path')) return env.Path || '';
  if (Object.prototype.hasOwnProperty.call(env, 'PATH')) return env.PATH || '';
  return process.env.Path || process.env.PATH || '';
}

function executableCandidates(command, env = process.env) {
  const extension = path.extname(command);
  if (process.platform !== 'win32' || extension) return [command];
  const pathext = String(env.PATHEXT || process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return [...pathext.map((ext) => `${command}${ext}`), command];
}

function resolveCommandForSpawn(command, env = process.env) {
  if (!command) return command;
  if (path.isAbsolute(command) || /[\\/]/.test(command)) {
    if (fsSync.existsSync(command)) return path.resolve(command);
    for (const candidate of executableCandidates(command, env)) {
      if (fsSync.existsSync(candidate)) return path.resolve(candidate);
    }
    return command;
  }
  for (const entry of pathValueFromEnv(env).split(path.delimiter).filter(Boolean)) {
    for (const candidate of executableCandidates(command, env)) {
      const fullPath = path.join(entry, candidate);
      if (fsSync.existsSync(fullPath)) return fullPath;
    }
  }
  return command;
}

function rawMcpCwd(server, dependencies = {}) {
  const raw = server && server.raw && typeof server.raw === 'object' ? server.raw : {};
  return path.resolve(raw.cwd || dependencies.workspaceRoot || process.cwd());
}

function mcpTestEnv(server) {
  const explicitEnv = server && server.env && typeof server.env === 'object' ? server.env : {};
  if (server && server.inheritEnv === false) {
    return { ...explicitEnv };
  }
  return { ...process.env, ...explicitEnv };
}

function createMcpSmokeTestError(message, details = {}) {
  const error = new Error(message);
  error.code = details.code || 'MCP_SERVER_TEST_FAILED';
  error.details = details;
  return error;
}

function runStdioMcpSmokeTest(server, dependencies = {}) {
  const env = mcpTestEnv(server);
  const command = resolveCommandForSpawn(server.command, env);
  const args = Array.isArray(server.args) ? server.args : [];
  const spawnTarget = spawnTargetFor(command, args);
  const cwd = rawMcpCwd(server, dependencies);
  const timeoutMs = Math.max(1000, Number(server.startupTimeoutSec || 20) * 1000);
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let child = null;
    let nextId = 1;
    let stdoutBuffer = '';
    let stdoutText = '';
    let stderrText = '';
    let settled = false;
    const pending = new Map();
    const protocolErrors = [];

    function finish(lastTest) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
      }
      pending.clear();
      if (child && !child.killed) {
        try {
          child.stdin.end();
        } catch {
          // Process cleanup is best effort after the smoke test result is known.
        }
        try {
          child.kill();
        } catch {
          // Ignore cleanup errors.
        }
      }
      resolve({
        ...lastTest,
        stdout: redactSensitiveText(truncateText(lastTest.stdout || stdoutText), server.env),
        stderr: redactSensitiveText(truncateText(lastTest.stderr || stderrText), server.env),
        durationMs: Date.now() - startedAt,
        testedAt: new Date().toISOString(),
      });
    }

    function fail(message, extra = {}) {
      finish({
        ok: false,
        error: message,
        ...extra,
      });
    }

    const timer = setTimeout(() => {
      fail('Timed out while initializing the MCP server.', { timeoutMs });
    }, timeoutMs);

    function writeMessage(message) {
      if (!child || !child.stdin || child.stdin.destroyed) {
        throw createMcpSmokeTestError('MCP server stdin is not available.', { code: 'MCP_STDIN_CLOSED' });
      }
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    }

    function request(method, params = {}) {
      const id = nextId++;
      return new Promise((requestResolve, requestReject) => {
        const requestTimer = setTimeout(() => {
          pending.delete(id);
          requestReject(createMcpSmokeTestError(`MCP request timed out: ${method}`, {
            code: 'MCP_REQUEST_TIMEOUT',
            method,
          }));
        }, timeoutMs);
        pending.set(id, { method, resolve: requestResolve, reject: requestReject, timer: requestTimer });
        writeMessage({ id, method, params });
      });
    }

    function handleMessage(message) {
      if (!message || !Object.prototype.hasOwnProperty.call(message, 'id')) return;
      const entry = pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(message.id);
      if (message.error) {
        entry.reject(createMcpSmokeTestError(message.error.message || `MCP request failed: ${entry.method}`, {
          code: message.error.code || 'MCP_JSON_RPC_ERROR',
          method: entry.method,
          rpcError: message.error,
        }));
        return;
      }
      entry.resolve(message.result || {});
    }

    function consumeStdout(chunk) {
      const text = chunk.toString('utf8');
      stdoutText += text;
      stdoutBuffer += text;
      let index = stdoutBuffer.indexOf('\n');
      while (index !== -1) {
        const line = stdoutBuffer.slice(0, index).trim();
        stdoutBuffer = stdoutBuffer.slice(index + 1);
        if (line) {
          try {
            handleMessage(JSON.parse(line));
          } catch (error) {
            protocolErrors.push(`Invalid JSON from stdout: ${line.slice(0, 240)}`);
          }
        }
        index = stdoutBuffer.indexOf('\n');
      }
    }

    async function smoke() {
      try {
        const initialize = await request('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'redou-agent',
            version: '0.4.1',
          },
        });
        writeMessage({ method: 'notifications/initialized', params: {} });
        const toolsResult = await request('tools/list', {});
        const tools = Array.isArray(toolsResult.tools) ? toolsResult.tools : [];
        finish({
          ok: true,
          protocolVersion: initialize.protocolVersion || null,
          serverInfo: initialize.serverInfo || null,
          capabilities: initialize.capabilities || null,
          toolCount: tools.length,
          tools: tools.map((tool) => ({
            name: String(tool.name || ''),
            description: String(tool.description || '').slice(0, 240),
          })).filter((tool) => tool.name),
          protocolErrors,
        });
      } catch (error) {
        fail(error && error.message ? error.message : String(error), {
          code: error && error.code,
          protocolErrors,
        });
      }
    }

    try {
      child = spawn(spawnTarget.command, spawnTarget.args, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        windowsVerbatimArguments: Boolean(spawnTarget.windowsVerbatimArguments),
      });
    } catch (error) {
      fail(error && error.message ? error.message : String(error), { code: error && error.code });
      return;
    }

    child.stdout.on('data', consumeStdout);
    child.stderr.on('data', (chunk) => {
      stderrText += chunk.toString('utf8');
    });
    child.once('error', (error) => {
      fail(error && error.message ? error.message : String(error), { code: error && error.code });
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      fail('MCP server exited before the smoke test completed.', { code: 'MCP_PROCESS_EXITED', exitCode: code, signal });
    });
    child.once('spawn', () => {
      void smoke();
    });
  });
}

function skillItem(skill) {
  return {
    id: extensionId('skill', skill.id || skill.path || skill.name),
    kind: 'skill',
    name: skill.name,
    title: skill.title || skill.name,
    description: skill.description || skill.path || '',
    source: skill.source || 'user',
    installed: true,
    enabled: Boolean(skill.enabled),
    category: skill.category,
    tags: skill.category ? [skill.category] : [],
    icon: 'sparkles',
    path: skill.path,
    canRemove: skill.source !== 'system' && skill.source !== 'bundled',
    canUpdate: true,
    status: skill.enabled ? 'ready' : 'disabled',
    raw: skill,
  };
}

function pluginItem(plugin) {
  return {
    id: extensionId('plugin', plugin.id),
    kind: 'plugin',
    name: plugin.name,
    title: plugin.title || plugin.name,
    description: plugin.description || '',
    source: plugin.source || (plugin.marketplace === 'local' ? 'user' : 'market'),
    installed: Boolean(plugin.installed),
    enabled: Boolean(plugin.enabled),
    category: plugin.category || 'System',
    tags: plugin.tags || [],
    icon: 'plug',
    path: plugin.path,
    authRequired: Boolean(plugin.authRequired),
    canRemove: plugin.canRemove === undefined ? Boolean(plugin.installed) : Boolean(plugin.canRemove),
    canUpdate: plugin.canUpdate === undefined ? false : Boolean(plugin.canUpdate),
    status: plugin.status || (plugin.installed && !plugin.enabled ? 'disabled' : 'ready'),
    statusMessage: plugin.statusMessage || '',
    raw: plugin,
  };
}

async function listPluginCatalogWithBuiltIns(dependencies = {}) {
  const plugins = await listPluginCatalog(dependencies);
  const minimaxItem = await minimaxProvider.pluginCatalogItem(dependencies);
  return [
    minimaxItem,
    ...plugins.filter((plugin) => plugin.id !== minimaxProvider.PLUGIN_ID),
  ].sort((a, b) => a.title.localeCompare(b.title));
}

async function listExtensions(dependencies = {}, options = {}) {
  const kind = options.kind || null;
  const items = [];
  if (!kind || kind === 'plugin') items.push(...(await listPluginCatalogWithBuiltIns(dependencies)).map(pluginItem));
  if (!kind || kind === 'skill') items.push(...(await listSkills(dependencies)).map(skillItem));
  if (!kind || kind === 'mcp') items.push(...(await readMcpServers(dependencies)).map((server) => mcpItem(server, dependencies)));
  if (options.mode === 'manage') return items.filter((item) => item.installed || item.kind !== 'plugin');
  return items;
}

async function listExtensionCatalog(dependencies = {}, options = {}) {
  return listExtensions(dependencies, options);
}

async function refreshExtensions(dependencies = {}, options = {}) {
  return listExtensions(dependencies, options);
}

async function getExtension(dependencies = {}, id) {
  const kind = extensionKindFromId(id);
  const rawId = rawIdFromExtensionId(id);
  const items = await listExtensions(dependencies, kind ? { kind } : {});
  return items.find((item) => item.id === id || item.name === rawId || rawIdFromExtensionId(item.id) === rawId) || null;
}

function requireKind(id) {
  const kind = extensionKindFromId(id);
  const rawId = rawIdFromExtensionId(id);
  if (!kind || !rawId) {
    const error = new Error(`Invalid extension id: ${id}`);
    error.code = 'EXTENSION_ID_INVALID';
    throw error;
  }
  return { kind, rawId };
}

async function setSkillEnabled(dependencies = {}, id, enabled) {
  const rawId = rawIdFromExtensionId(id);
  const settings = await readSkillSettings(dependencies);
  const disabled = new Set(settings.disabled || []);
  if (enabled) disabled.delete(rawId);
  else disabled.add(rawId);
  await writeSkillSettings(dependencies, { disabled: Array.from(disabled).sort() });
  return { skills: await listSkills(dependencies) };
}

async function setPluginEnabled(dependencies = {}, id, enabled) {
  const rawId = rawIdFromExtensionId(id);
  const configs = await readPluginConfigs(dependencies);
  if (!configs[rawId]) configs[rawId] = {};
  configs[rawId].enabled = Boolean(enabled);
  const catalog = await listPluginCatalogWithBuiltIns(dependencies);
  const existing = catalog.find((item) => item.id === rawId);
  if (existing?.path && !configs[rawId].path) configs[rawId].path = existing.path;
  await writePluginConfigs(dependencies, configs);
  return { plugins: await listPluginCatalog(dependencies) };
}

async function setMcpEnabled(dependencies = {}, name, enabled) {
  const servers = await readMcpServers(dependencies);
  const index = servers.findIndex((server) => server.name === name);
  if (index < 0) {
    const error = new Error(`MCP server not found: ${name}`);
    error.code = 'MCP_SERVER_NOT_FOUND';
    throw error;
  }
  servers[index] = { ...servers[index], enabled: Boolean(enabled) };
  return { servers: await writeMcpServers(dependencies, servers), server: servers[index] };
}

async function enableExtension(dependencies = {}, id) {
  const { kind, rawId } = requireKind(id);
  if (kind === 'skill') return setSkillEnabled(dependencies, rawId, true);
  if (kind === 'plugin') return setPluginEnabled(dependencies, rawId, true);
  if (kind === 'mcp') return setMcpEnabled(dependencies, rawId, true);
  return { ok: true };
}

async function disableExtension(dependencies = {}, id) {
  const { kind, rawId } = requireKind(id);
  if (kind === 'skill') return setSkillEnabled(dependencies, rawId, false);
  if (kind === 'plugin') return setPluginEnabled(dependencies, rawId, false);
  if (kind === 'mcp') return setMcpEnabled(dependencies, rawId, false);
  return { ok: true };
}

async function removeExtension(dependencies = {}, id) {
  const { kind, rawId } = requireKind(id);
  if (kind === 'plugin') {
    const configs = await readPluginConfigs(dependencies);
    delete configs[rawId];
    await writePluginConfigs(dependencies, configs);
    return { plugins: await listPluginCatalog(dependencies), removed: rawId };
  }
  if (kind === 'mcp') return removeMcpServer(dependencies, rawId);
  if (kind === 'skill') {
    const extension = await getExtension(dependencies, id);
    const skillPath = extension?.path;
    if (!skillPath || !fsSync.existsSync(skillPath)) return { removed: rawId, skills: await listSkills(dependencies) };
    const skillDir = path.dirname(skillPath);
    fsSync.rmSync(skillDir, { recursive: true, force: true });
    return { removed: rawId, skills: await listSkills(dependencies) };
  }
  return { removed: rawId };
}

async function listMcpServers(dependencies = {}) {
  return { servers: await readMcpServers(dependencies) };
}

async function addMcpServer(dependencies = {}, config = {}) {
  const server = normalizeMcpServer(config.name, config);
  if (!server.name) {
    const error = new Error('MCP server name is required.');
    error.code = 'MCP_SERVER_NAME_REQUIRED';
    throw error;
  }
  if (server.transport === 'stdio' && !server.command) {
    const error = new Error('STDIO MCP server command is required.');
    error.code = 'MCP_SERVER_COMMAND_REQUIRED';
    throw error;
  }
  if (server.transport !== 'stdio' && !server.url) {
    const error = new Error('HTTP MCP server URL is required.');
    error.code = 'MCP_SERVER_URL_REQUIRED';
    throw error;
  }
  const servers = await readMcpServers(dependencies);
  const next = [server, ...servers.filter((item) => item.name !== server.name)];
  mcpLastTests.delete(mcpLastTestKey(dependencies, server.name));
  const saved = await writeMcpServers(dependencies, next);
  return { servers: saved, server: saved.find((item) => item.name === server.name) || server };
}

async function updateMcpServer(dependencies = {}, id, config = {}) {
  const currentName = String(id || config.name || '').trim();
  const nextName = String(config.name || currentName || '').trim();
  const lookupName = currentName || nextName;
  if (!lookupName || !nextName) {
    const error = new Error('MCP server name is required.');
    error.code = 'MCP_SERVER_NAME_REQUIRED';
    throw error;
  }
  const servers = await readMcpServers(dependencies);
  const existing = servers.find((item) => item.name === lookupName);
  if (!existing) {
    const error = new Error(`MCP server not found: ${lookupName}`);
    error.code = 'MCP_SERVER_NOT_FOUND';
    throw error;
  }
  if (nextName !== lookupName && servers.some((item) => item.name === nextName)) {
    const error = new Error(`MCP server already exists: ${nextName}`);
    error.code = 'MCP_SERVER_EXISTS';
    throw error;
  }
  const merged = { ...existing };
  for (const [key, value] of Object.entries(config || {})) {
    if (value !== undefined) merged[key] = value;
  }
  const updated = normalizeMcpServer(nextName, { ...merged, name: nextName });
  mcpLastTests.delete(mcpLastTestKey(dependencies, lookupName));
  if (nextName !== lookupName) mcpLastTests.delete(mcpLastTestKey(dependencies, nextName));
  const saved = await writeMcpServers(
    dependencies,
    servers.map((item) => item.name === lookupName ? updated : item)
  );
  return { servers: saved, server: saved.find((item) => item.name === nextName) || updated };
}

async function removeMcpServer(dependencies = {}, id) {
  const name = typeof id === 'object' ? String(id.name || '') : String(id || '');
  if (!name.trim()) {
    const error = new Error('MCP server name is required.');
    error.code = 'MCP_SERVER_NAME_REQUIRED';
    throw error;
  }
  const servers = await readMcpServers(dependencies);
  mcpLastTests.delete(mcpLastTestKey(dependencies, name));
  const saved = await writeMcpServers(dependencies, servers.filter((item) => item.name !== name));
  return { servers: saved, removed: name };
}

async function toggleMcpServer(dependencies = {}, id, enabled) {
  return setMcpEnabled(dependencies, id, enabled);
}

async function testMcpServerConfig(dependencies = {}, servers, server) {
  if (!server.name) {
    const error = new Error('MCP server name is required.');
    error.code = 'MCP_SERVER_NAME_REQUIRED';
    throw error;
  }
  if (server.transport !== 'stdio') {
    if (!server.url) {
      const lastTest = {
        ok: false,
        error: 'HTTP MCP server URL is required.',
        testedAt: new Date().toISOString(),
      };
      mcpLastTests.set(mcpLastTestKey(dependencies, server.name), lastTest);
      return {
        servers,
        server,
        lastTest,
      };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(server.startupTimeoutSec || 10) * 1000));
    try {
      const response = await fetch(server.url, { method: 'GET', signal: controller.signal });
      const lastTest = {
        ok: response.status < 500,
        status: response.status,
        statusText: response.statusText,
        testedAt: new Date().toISOString(),
      };
      mcpLastTests.set(mcpLastTestKey(dependencies, server.name), lastTest);
      return {
        servers,
        server,
        lastTest,
      };
    } catch (error) {
      const lastTest = {
        ok: false,
        error: error && error.message ? error.message : String(error),
        testedAt: new Date().toISOString(),
      };
      mcpLastTests.set(mcpLastTestKey(dependencies, server.name), lastTest);
      return {
        servers,
        server,
        lastTest,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  const command = server.command;
  if (!command) {
    const lastTest = {
      ok: false,
      error: 'STDIO MCP server command is required.',
      testedAt: new Date().toISOString(),
    };
    mcpLastTests.set(mcpLastTestKey(dependencies, server.name), lastTest);
    return {
      servers,
      server,
      lastTest,
    };
  }
  const lastTest = await runStdioMcpSmokeTest(server, dependencies);
  mcpLastTests.set(mcpLastTestKey(dependencies, server.name), lastTest);
  return {
    servers,
    server,
    lastTest,
  };
}

async function testMcpServer(dependencies = {}, id) {
  const payload = id && typeof id === 'object' ? id : null;
  const name = payload ? String(payload.id || payload.name || '') : String(id || '');
  const servers = await readMcpServers(dependencies);
  const existing = servers.find((item) => item.name === name);
  const hasInlineConfig = payload && (payload.config || payload.command || payload.url || payload.transport || payload.transportType);
  const server = hasInlineConfig ? normalizeMcpServer(name, payload.config || payload) : existing;
  if (!server) {
    const error = new Error(`MCP server not found: ${name}`);
    error.code = 'MCP_SERVER_NOT_FOUND';
    throw error;
  }
  return testMcpServerConfig(dependencies, servers, server);
}

async function listPlugins(dependencies = {}) {
  return { plugins: await listPluginCatalogWithBuiltIns(dependencies) };
}

async function listSkillsResult(dependencies = {}) {
  return { skills: await listSkills(dependencies) };
}

module.exports = {
  addMcpServer,
  createPlugin,
  createSkill,
  disableExtension,
  enableExtension,
  getExtension,
  listExtensionCatalog,
  listExtensions,
  listMcpServers,
  listPlugins,
  listSkills: listSkillsResult,
  getMiniMaxConfig: minimaxProvider.readMiniMaxConfig,
  saveMiniMaxConfig: minimaxProvider.saveMiniMaxConfig,
  testMiniMaxConnection: minimaxProvider.testConnection,
  runMiniMaxTextToAudio: minimaxProvider.runTextToAudio,
  runMiniMaxTextToImage: minimaxProvider.runTextToImage,
  openMiniMaxOutputTarget: minimaxProvider.openOutputTarget,
  listMiniMaxTools: minimaxProvider.toolDescriptors,
  normalizeMcpServer,
  refreshExtensions,
  removeExtension,
  removeMcpServer,
  setPluginEnabled,
  setSkillEnabled,
  testMcpServer,
  toggleMcpServer,
  updateMcpServer,
};
