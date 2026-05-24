'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  buildRedouModelChildEnv,
  readRedouModelConfig,
  redactRedouModelConfig,
} = require('./redouCodexModelConfig.cjs');

const REDOU_CODEX_RUNTIME_ID = 'redou-codex';
const REDOU_CODEX_DISPLAY_NAME = 'Redou Codex';
const REDOU_CODEX_RUNTIME_NOT_FOUND = 'REDOU_CODEX_RUNTIME_NOT_FOUND';
const REDOU_CODEX_START_FAILED = 'REDOU_CODEX_START_FAILED';
const REDOU_MODEL_CONFIG_MISSING = 'REDOU_MODEL_CONFIG_MISSING';
const REDOU_CODEX_CONFIG_FILE = 'config.toml';
const APP_SERVER_ARGS = Object.freeze(['app-server']);
const REDOU_CODEX_AUTH_ENV_BLOCKLIST = Object.freeze([
  'OPENAI_API_KEY',
  'OPENAI_ACCESS_TOKEN',
  'OPENAI_REFRESH_TOKEN',
  'CODEX_API_KEY',
  'CODEX_ACCESS_TOKEN',
  'CODEX_REFRESH_TOKEN',
  'CHATGPT_ACCESS_TOKEN',
  'CHATGPT_REFRESH_TOKEN',
  'CODEX_AGENT_IDENTITY_AUTHAPI_BASE_URL',
  'CODEX_INTERNAL_ORIGINATOR_OVERRIDE',
  'CODEX_REFRESH_TOKEN_URL_OVERRIDE',
  'CODEX_REVOKE_TOKEN_URL_OVERRIDE',
]);

function repoRootFromDesktopRuntime() {
  return path.resolve(__dirname, '..', '..', '..', '..', '..');
}

function redouWorkspaceRoot(options = {}) {
  return path.resolve(options.workspaceRoot || options.repoRoot || repoRootFromDesktopRuntime());
}

function defaultRedouCodexRuntimeRoot(options = {}) {
  const repoRoot = redouWorkspaceRoot(options);
  return path.join(repoRoot, 'runtimes', 'redou-codex');
}

function redouCodexExecutableName() {
  return process.platform === 'win32' ? 'redou-codex.exe' : 'redou-codex';
}

function redouCodexBinaryCandidates(options = {}) {
  const runtimeRoot = path.resolve(options.runtimeRoot || defaultRedouCodexRuntimeRoot(options));
  const exeName = redouCodexExecutableName();
  return [
    { mode: 'release', path: path.join(runtimeRoot, 'codex-rs', 'target', 'release', exeName) },
    { mode: 'debug', path: path.join(runtimeRoot, 'codex-rs', 'target', 'debug', exeName) },
    { mode: 'managed-bin', path: path.join(runtimeRoot, 'bin', exeName) },
  ];
}

function defaultRedouCodexCommand(options = {}) {
  return redouCodexBinaryCandidates(options)[0].path;
}

function defaultRedouCodexHome(options = {}) {
  const repoRoot = redouWorkspaceRoot(options);
  return path.join(repoRoot, '.redou', 'redou-codex');
}

function ensureRedouCodexHome(redouCodexHome) {
  const resolved = path.resolve(redouCodexHome);
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function commandBasename(command) {
  return path.basename(String(command || '')).toLowerCase();
}

function isPathLike(command) {
  return path.isAbsolute(command) || /[\\/]/.test(command);
}

function isRedouCodexCommandName(command) {
  const base = commandBasename(command);
  if (process.platform === 'win32') return base === 'redou-codex.exe';
  return base === 'redou-codex';
}

function createRuntimeConfigError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function resolveRedouCodexCommand(options = {}) {
  const env = options.env || process.env;
  const explicit = options.command || options.executable || env.REDOU_CODEX_COMMAND;
  if (!explicit) return defaultRedouCodexCommand(options);

  if (!isPathLike(explicit) || !isRedouCodexCommandName(explicit)) {
    throw createRuntimeConfigError(
      'REDOU_CODEX_COMMAND must be an explicit path to redou-codex.exe.',
      REDOU_CODEX_RUNTIME_NOT_FOUND,
      { command: explicit },
    );
  }
  return path.resolve(explicit);
}

function inspectRedouCodexCommand(command) {
  if (!command) {
    return { ok: false, code: REDOU_CODEX_RUNTIME_NOT_FOUND, message: 'redou-codex command path is empty.' };
  }
  if (!isPathLike(command) || !isRedouCodexCommandName(command)) {
    return {
      ok: false,
      code: REDOU_CODEX_RUNTIME_NOT_FOUND,
      message: 'redou-codex command must be an explicit executable path.',
      details: command,
    };
  }
  const resolved = path.resolve(command);
  const lower = resolved.toLowerCase();
  if (lower.includes(`${path.sep.toLowerCase()}windowsapps${path.sep.toLowerCase()}`) || /[\\/]windowsapps[\\/]/i.test(resolved)) {
    return {
      ok: false,
      code: REDOU_CODEX_RUNTIME_NOT_FOUND,
      message: 'WindowsApps redou-codex.exe is not a valid Redou runtime.',
      details: resolved,
    };
  }
  if (!fs.existsSync(resolved)) {
    return {
      ok: false,
      code: REDOU_CODEX_RUNTIME_NOT_FOUND,
      message: 'Project redou-codex runtime was not found.',
      details: resolved,
    };
  }
  return { ok: true, path: resolved };
}

function runtimeRootFromCommand(command) {
  const resolved = path.resolve(command);
  const dir = path.dirname(resolved);
  if (!isRedouCodexCommandName(command)) return null;
  if (path.basename(dir).toLowerCase() === 'bin') {
    return path.resolve(dir, '..');
  }
  const modeDir = path.basename(dir).toLowerCase();
  const targetDir = path.basename(path.dirname(dir)).toLowerCase();
  const codexRsDir = path.basename(path.dirname(path.dirname(dir))).toLowerCase();
  if ((modeDir === 'release' || modeDir === 'debug') && targetDir === 'target' && codexRsDir === 'codex-rs') {
    return path.dirname(path.dirname(path.dirname(dir)));
  }
  return null;
}

function pathValueFromEnv(env = process.env) {
  if (Object.prototype.hasOwnProperty.call(env, 'Path')) return env.Path || '';
  if (Object.prototype.hasOwnProperty.call(env, 'PATH')) return env.PATH || '';
  return process.env.Path || process.env.PATH || '';
}

function executableNamesForCommand(command) {
  if (process.platform !== 'win32') return [command];
  const extension = path.extname(command);
  if (extension) return [command];
  const pathext = String(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .filter(Boolean);
  return pathext.map((ext) => `${command}${ext.toLowerCase()}`);
}

function hasExecutableOnPath(command, env = process.env) {
  const pathEntries = pathValueFromEnv(env).split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    for (const name of executableNamesForCommand(command)) {
      if (fs.existsSync(path.join(entry, name))) return true;
    }
  }
  return false;
}

function truthyEnv(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function allowCargoFallback(options = {}) {
  if (typeof options.allowCargoFallback === 'boolean') return options.allowCargoFallback;
  const env = options.env || process.env;
  return truthyEnv(env.REDOU_CODEX_ALLOW_CARGO_FALLBACK) || truthyEnv(env.REDOU_CODEX_DEV_MODE);
}

function cargoFallbackLaunch(runtimeRoot, args) {
  return {
    command: 'cargo',
    args: [
      'run',
      '--manifest-path',
      path.join(runtimeRoot, 'codex-rs', 'Cargo.toml'),
      '-p',
      'redou-codex-cli',
      '--bin',
      'redou-codex',
      '--',
      ...args,
    ],
  };
}

function resolveRedouCodexLaunch(options = {}) {
  const env = options.env || process.env;
  const args = [...APP_SERVER_ARGS];
  const explicit = options.command || options.executable || env.REDOU_CODEX_COMMAND;

  if (explicit) {
    const command = resolveRedouCodexCommand(options);
    const probe = inspectRedouCodexCommand(command);
    if (!probe.ok) {
      throw createRuntimeConfigError(
        probe.message || 'Project redou-codex runtime was not found.',
        probe.code || REDOU_CODEX_RUNTIME_NOT_FOUND,
        probe.details || { command },
      );
    }
    return {
      command: probe.path,
      args,
      mode: 'explicit',
      actualExecutablePath: probe.path,
      runtimeRoot: runtimeRootFromCommand(probe.path),
    };
  }

  const runtimeRoot = path.resolve(options.runtimeRoot || defaultRedouCodexRuntimeRoot(options));
  const candidates = redouCodexBinaryCandidates({ ...options, runtimeRoot });
  for (const candidate of candidates) {
    if (fs.existsSync(candidate.path)) {
      return {
        command: candidate.path,
        args,
        mode: candidate.mode,
        actualExecutablePath: candidate.path,
        runtimeRoot,
      };
    }
  }

  const cargoAllowed = allowCargoFallback(options);
  if (cargoAllowed && hasExecutableOnPath('cargo', env)) {
    const fallback = cargoFallbackLaunch(runtimeRoot, args);
    return {
      ...fallback,
      mode: 'cargo-fallback',
      actualExecutablePath: null,
      intendedExecutablePath: candidates.find((candidate) => candidate.mode === 'debug').path,
      runtimeRoot,
    };
  }

  const missingDetails = {
    runtimeRoot,
    candidates: candidates.map((candidate) => candidate.path),
    allowCargoFallback: cargoAllowed,
  };
  const message = cargoAllowed
    ? 'Project redou-codex.exe runtime was not found, and Cargo is not available for development fallback.'
    : 'Project redou-codex.exe runtime was not found.';
  throw createRuntimeConfigError(message, REDOU_CODEX_RUNTIME_NOT_FOUND, missingDetails);
}

function inspectRedouCodexRuntimeReadiness(command) {
  const probe = inspectRedouCodexCommand(command);
  if (!probe.ok) return probe;
  return {
    ok: true,
    mode: runtimeModeFromExecutable(probe.path),
    executablePath: probe.path,
  };
}

function runtimeModeFromExecutable(command) {
  const resolved = path.resolve(command);
  const dir = path.dirname(resolved);
  const mode = path.basename(dir).toLowerCase();
  if (mode === 'release' || mode === 'debug') return mode;
  if (path.basename(dir).toLowerCase() === 'bin') return 'managed-bin';
  return 'external';
}

function deleteEnvCaseInsensitive(env, keys) {
  const blocked = new Set(keys.map((key) => key.toUpperCase()));
  for (const key of Object.keys(env)) {
    if (blocked.has(key.toUpperCase())) delete env[key];
  }
}

function sanitizeRedouCodexChildEnv(env = {}, redouCodexHome, options = {}) {
  const sanitized = { ...env };
  deleteEnvCaseInsensitive(sanitized, [
    ...REDOU_CODEX_AUTH_ENV_BLOCKLIST,
    'CODEX_HOME',
    'REDOU_CODEX_HOME',
    'REDOU_PROJECT_ROOT',
  ]);
  const resolvedHome = path.resolve(redouCodexHome || defaultRedouCodexHome(options));
  sanitized.REDOU_PROJECT_ROOT = redouWorkspaceRoot(options);
  sanitized.REDOU_CODEX_HOME = resolvedHome;
  sanitized.CODEX_HOME = resolvedHome;
  sanitized.REDOU_CODEX_RUNTIME = '1';
  sanitized.REDOU_CODEX_MANAGED_PACKAGE_ROOT = path.resolve(options.runtimeRoot || defaultRedouCodexRuntimeRoot(options));
  return sanitized;
}

function cleanString(value) {
  return String(value || '').trim();
}

function slugify(value, fallback = 'model') {
  const slug = cleanString(value)
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

function runtimeProviderId(id) {
  const slug = slugify(id, 'model');
  return slug.startsWith('redou-') ? slug : `redou-${slug}`;
}

function tomlString(value) {
  return JSON.stringify(String(value ?? ''));
}

function tomlValue(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return tomlString(value);
}

function tomlKey(key) {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key);
}

function normalizeGeneratedProvider(provider = {}) {
  const id = cleanString(provider.runtimeProviderId || runtimeProviderId(provider.id || provider.provider || provider.label || provider.baseUrl));
  const label = cleanString(provider.label || provider.name || provider.id || id);
  const baseUrl = cleanString(provider.baseUrl || provider.base_url);
  const apiKey = cleanString(provider.apiKey || provider.experimental_bearer_token);
  if (!id || !baseUrl) return null;
  return {
    id,
    label,
    baseUrl,
    apiKey,
    wireApi: cleanString(provider.wireApi || provider.wire_api || 'responses') || 'responses',
    requestMaxRetries: Number.isFinite(provider.requestMaxRetries) ? provider.requestMaxRetries : 4,
    streamMaxRetries: Number.isFinite(provider.streamMaxRetries) ? provider.streamMaxRetries : 5,
    streamIdleTimeoutMs: Number.isFinite(provider.streamIdleTimeoutMs) ? provider.streamIdleTimeoutMs : 300000,
  };
}

function normalizeEnvModelProvider(modelConfig = {}) {
  if (!modelConfig.complete) return null;
  return normalizeGeneratedProvider({
    id: modelConfig.provider || 'redou-env',
    label: modelConfig.provider || 'Redou Model',
    baseUrl: modelConfig.baseUrl,
    apiKey: modelConfig.apiKey,
  });
}

function selectedModelForConfig(options = {}) {
  if (options.selected && options.selected.modelId) return cleanString(options.selected.modelId);
  if (options.model) return cleanString(options.model);
  const modelConfig = options.modelConfig || options.envModelConfig;
  if (modelConfig && modelConfig.modelName) return cleanString(modelConfig.modelName);
  const providers = Array.isArray(options.providers) ? options.providers : [];
  const selectedProviderId = options.selected && options.selected.providerId;
  const provider = selectedProviderId
    ? providers.find((item) => item.id === selectedProviderId || item.runtimeProviderId === selectedProviderId)
    : providers[0];
  return cleanString(provider && (provider.selectedModel || provider.defaultModel || (provider.models && provider.models[0])));
}

function selectedProviderForConfig(options = {}, generatedProviders = []) {
  if (options.modelProvider) return cleanString(options.modelProvider);
  const providers = Array.isArray(options.providers) ? options.providers : [];
  if (options.selected && options.selected.providerId) {
    const selected = providers.find((item) => item.id === options.selected.providerId || item.runtimeProviderId === options.selected.providerId);
    return cleanString((selected && selected.runtimeProviderId) || runtimeProviderId(options.selected.providerId));
  }
  const modelConfig = options.modelConfig || options.envModelConfig;
  if (modelConfig && modelConfig.complete) return runtimeProviderId(modelConfig.provider || 'redou-env');
  return generatedProviders[0] && generatedProviders[0].id;
}

function renderRedouCodexUserConfig(options = {}) {
  const providers = Array.isArray(options.providers)
    ? options.providers.map(normalizeGeneratedProvider).filter(Boolean)
    : [];
  const envProvider = normalizeEnvModelProvider(options.modelConfig || options.envModelConfig);
  const generatedProviders = providers.length ? providers : (envProvider ? [envProvider] : []);
  if (!generatedProviders.length) return '';

  const model = selectedModelForConfig(options);
  const modelProvider = selectedProviderForConfig(options, generatedProviders);
  const lines = [
    '# Generated by Redou Agent.',
    '# Redou stores Codex user-level provider settings here because project .codex/config.toml cannot override provider configuration.',
    'cli_auth_credentials_store = "file"',
  ];
  if (model) lines.push(`model = ${tomlString(model)}`);
  if (modelProvider) lines.push(`model_provider = ${tomlString(modelProvider)}`);
  lines.push('');

  for (const provider of generatedProviders) {
    lines.push(`[model_providers.${tomlKey(provider.id)}]`);
    lines.push(`name = ${tomlString(provider.label)}`);
    lines.push(`base_url = ${tomlString(provider.baseUrl)}`);
    lines.push(`wire_api = ${tomlString(provider.wireApi)}`);
    lines.push('requires_openai_auth = false');
    lines.push('supports_websockets = false');
    lines.push(`request_max_retries = ${tomlValue(provider.requestMaxRetries)}`);
    lines.push(`stream_max_retries = ${tomlValue(provider.streamMaxRetries)}`);
    lines.push(`stream_idle_timeout_ms = ${tomlValue(provider.streamIdleTimeoutMs)}`);
    if (provider.apiKey) lines.push(`experimental_bearer_token = ${tomlString(provider.apiKey)}`);
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function writeRedouCodexUserConfigSync(options = {}) {
  const redouCodexHome = ensureRedouCodexHome(options.redouCodexHome || options.codexHome || defaultRedouCodexHome(options));
  const toml = renderRedouCodexUserConfig(options);
  if (!toml) return null;
  const configPath = path.join(redouCodexHome, REDOU_CODEX_CONFIG_FILE);
  fs.writeFileSync(configPath, toml, 'utf8');
  return configPath;
}

function buildRedouCodexEnv(options = {}) {
  const env = options.env || process.env;
  const modelConfig = options.modelConfig || readRedouModelConfig(env);
  const redouCodexHome = path.resolve(options.redouCodexHome || options.codexHome || env.REDOU_CODEX_HOME || defaultRedouCodexHome(options));
  return sanitizeRedouCodexChildEnv({
    ...buildRedouModelChildEnv(modelConfig),
    ...(options.extraEnv || {}),
  }, redouCodexHome, options);
}

function buildRedouCodexClientOptions(options = {}) {
  const env = options.env || process.env;
  const modelConfig = options.modelConfig || readRedouModelConfig(env);
  const redouCodexHome = ensureRedouCodexHome(options.redouCodexHome || options.codexHome || env.REDOU_CODEX_HOME || defaultRedouCodexHome(options));
  writeRedouCodexUserConfigSync({ ...options, redouCodexHome, modelConfig });
  const childEnv = sanitizeRedouCodexChildEnv({
    ...buildRedouCodexEnv({ ...options, redouCodexHome, modelConfig }),
    ...(options.childEnv || {}),
  }, redouCodexHome, options);
  const launch = resolveRedouCodexLaunch({ ...options, env });
  return {
    ...options,
    command: launch.command,
    args: launch.args,
    launch,
    launchMode: launch.mode,
    actualExecutablePath: launch.actualExecutablePath,
    intendedExecutablePath: launch.intendedExecutablePath,
    redouCodexHome,
    env: childEnv,
    modelConfig,
  };
}

module.exports = {
  REDOU_CODEX_RUNTIME_ID,
  REDOU_CODEX_DISPLAY_NAME,
  REDOU_CODEX_RUNTIME_NOT_FOUND,
  REDOU_CODEX_START_FAILED,
  REDOU_MODEL_CONFIG_MISSING,
  buildRedouCodexClientOptions,
  buildRedouCodexEnv,
  defaultRedouCodexCommand,
  defaultRedouCodexHome,
  defaultRedouCodexRuntimeRoot,
  ensureRedouCodexHome,
  inspectRedouCodexCommand,
  inspectRedouCodexRuntimeReadiness,
  readRedouModelConfig,
  redactRedouModelConfig,
  redouCodexBinaryCandidates,
  renderRedouCodexUserConfig,
  resolveRedouCodexCommand,
  resolveRedouCodexLaunch,
  runtimeProviderId,
  sanitizeRedouCodexChildEnv,
  writeRedouCodexUserConfigSync,
};
