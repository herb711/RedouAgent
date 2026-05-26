'use strict';

const path = require('node:path');

const {
  readPluginConfigs,
  writePluginConfigs,
} = require('../../extensionCatalog.cjs');
const { maskSecret } = require('./minimaxErrors.cjs');

const PLUGIN_ID = 'minimax@redou';
const PROVIDER = 'minimax';
const DRIVER = 'direct_http';
const DEFAULT_OUTPUT_DIR = '.redou/minimax-output';
const HOSTS = Object.freeze({
  cn: 'https://api.minimaxi.com',
  global: 'https://api.minimax.io',
});
const DEFAULTS = Object.freeze({
  ttsModel: 'speech-2.8-hd',
  voiceId: 'male-qn-qingse',
  audioFormat: 'mp3',
  imageModel: 'image-01',
  imageAspectRatio: '16:9',
});
const TTS_MODELS = Object.freeze(['speech-2.8-hd', 'speech-2.8-turbo', 'speech-2.6-hd', 'speech-02-hd']);
const IMAGE_ASPECT_RATIOS = Object.freeze(['1:1', '16:9', '9:16', '4:3', '3:4']);

function workspaceRoot(dependencies = {}) {
  return path.resolve(dependencies.workspaceRoot || process.cwd());
}

function defaultOutputDir() {
  return DEFAULT_OUTPUT_DIR;
}

function absoluteOutputDir(config = {}, dependencies = {}) {
  const outputDir = String(config.outputDir || defaultOutputDir()).trim() || defaultOutputDir();
  return path.isAbsolute(outputDir) ? path.resolve(outputDir) : path.resolve(workspaceRoot(dependencies), outputDir);
}

function normalizeRegion(region) {
  const value = String(region || '').trim().toLowerCase();
  if (value === 'global' || value === 'advanced') return value;
  return 'cn';
}

function normalizeHost(region, host) {
  const normalizedRegion = normalizeRegion(region);
  if (normalizedRegion === 'cn') return HOSTS.cn;
  if (normalizedRegion === 'global') return HOSTS.global;
  const text = String(host || '').trim().replace(/\/+$/, '');
  return text || HOSTS.cn;
}

function normalizeDefaults(input = {}, existing = {}) {
  const merged = { ...DEFAULTS, ...(existing || {}), ...(input || {}) };
  const ttsModel = TTS_MODELS.includes(merged.ttsModel) ? merged.ttsModel : DEFAULTS.ttsModel;
  const imageAspectRatio = IMAGE_ASPECT_RATIOS.includes(merged.imageAspectRatio)
    ? merged.imageAspectRatio
    : DEFAULTS.imageAspectRatio;
  return {
    ttsModel,
    voiceId: String(merged.voiceId || DEFAULTS.voiceId).trim() || DEFAULTS.voiceId,
    audioFormat: String(merged.audioFormat || DEFAULTS.audioFormat).trim() || DEFAULTS.audioFormat,
    imageModel: String(merged.imageModel || DEFAULTS.imageModel).trim() || DEFAULTS.imageModel,
    imageAspectRatio,
  };
}

function normalizeConfig(input = {}, existing = {}, dependencies = {}) {
  const base = existing && typeof existing === 'object' ? existing : {};
  const patch = input && typeof input === 'object' ? input : {};
  const region = normalizeRegion(patch.region ?? base.region);
  const host = normalizeHost(region, patch.host ?? base.host);
  const defaults = normalizeDefaults(patch.defaults, base.defaults);
  const apiKeyCandidate = patch.clearApiKey
    ? ''
    : Object.prototype.hasOwnProperty.call(patch, 'apiKey')
      ? String(patch.apiKey || '').trim()
      : String(base.apiKey || '').trim();
  const apiKey = apiKeyCandidate.includes('*') ? String(base.apiKey || '').trim() : apiKeyCandidate;
  const outputDir = String(patch.outputDir ?? base.outputDir ?? defaultOutputDir()).trim() || defaultOutputDir();
  return {
    enabled: patch.enabled === undefined ? Boolean(base.enabled) : Boolean(patch.enabled),
    provider: PROVIDER,
    driver: DRIVER,
    region,
    host,
    apiKey,
    outputDir,
    absoluteOutputDir: absoluteOutputDir({ outputDir }, dependencies),
    defaults,
  };
}

function publicConfig(config = {}) {
  const apiKey = String(config.apiKey || '');
  const result = {
    enabled: Boolean(config.enabled),
    provider: PROVIDER,
    driver: DRIVER,
    region: normalizeRegion(config.region),
    host: normalizeHost(config.region, config.host),
    outputDir: String(config.outputDir || defaultOutputDir()),
    absoluteOutputDir: config.absoluteOutputDir,
    defaults: normalizeDefaults(config.defaults),
    apiKey: '',
    apiKeySet: Boolean(apiKey),
    apiKeyMask: apiKey ? maskSecret(apiKey) : '',
  };
  return result;
}

async function readMiniMaxConfig(dependencies = {}, options = {}) {
  const configs = await readPluginConfigs(dependencies);
  const stored = configs[PLUGIN_ID] || {};
  const normalized = normalizeConfig(stored, {}, dependencies);
  if (!normalized.apiKey && process.env.MINIMAX_API_KEY) {
    normalized.apiKey = String(process.env.MINIMAX_API_KEY || '').trim();
  }
  return options.includeSecret ? normalized : publicConfig(normalized);
}

async function saveMiniMaxConfig(dependencies = {}, input = {}) {
  const configs = await readPluginConfigs(dependencies);
  const existing = normalizeConfig(configs[PLUGIN_ID] || {}, {}, dependencies);
  const patch = { ...input };
  if (!patch.clearApiKey && Object.prototype.hasOwnProperty.call(patch, 'apiKey') && !String(patch.apiKey || '').trim()) {
    delete patch.apiKey;
  }
  const next = normalizeConfig(patch, existing, dependencies);
  configs[PLUGIN_ID] = {
    enabled: next.enabled,
    provider: PROVIDER,
    driver: DRIVER,
    region: next.region,
    host: next.host,
    apiKey: next.apiKey,
    outputDir: next.outputDir,
    defaults: next.defaults,
  };
  await writePluginConfigs(dependencies, configs);
  return publicConfig(next);
}

function configWithOverrides(baseConfig, overrides = {}, dependencies = {}) {
  const configOverride = overrides && overrides.config && typeof overrides.config === 'object' ? overrides.config : {};
  return normalizeConfig(configOverride, baseConfig, dependencies);
}

function validateLocalConfig(config = {}) {
  const apiKey = String(config.apiKey || '').trim();
  if (!apiKey) {
    return {
      ok: false,
      code: 'MINIMAX_API_KEY_MISSING',
      message: 'MiniMax API Key is missing.',
      hint: '请在 MiniMax 插件设置中填写 API Key。',
    };
  }
  try {
    const parsed = new URL(config.host);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('Unsupported protocol');
  } catch {
    return {
      ok: false,
      code: 'MINIMAX_HOST_INVALID',
      message: 'MiniMax host is invalid.',
      hint: '请检查 MiniMax Host，cn 使用 https://api.minimaxi.com，global 使用 https://api.minimax.io。',
    };
  }
  return {
    ok: true,
    provider: PROVIDER,
    driver: DRIVER,
    message: '本地配置已通过。真实鉴权将在测试语音/测试图片时完成。',
  };
}

module.exports = {
  DEFAULTS,
  DEFAULT_OUTPUT_DIR,
  DRIVER,
  HOSTS,
  IMAGE_ASPECT_RATIOS,
  PLUGIN_ID,
  PROVIDER,
  TTS_MODELS,
  absoluteOutputDir,
  configWithOverrides,
  defaultOutputDir,
  normalizeConfig,
  normalizeHost,
  normalizeRegion,
  publicConfig,
  readMiniMaxConfig,
  saveMiniMaxConfig,
  validateLocalConfig,
};
