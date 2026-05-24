'use strict';

const path = require('node:path');
const { readJsonFile, writeJsonFile } = require('../../platform/filesystem/jsonFile.cjs');
const { safeJoin } = require('../../platform/filesystem/paths.cjs');
const { writeRedouCodexUserConfigSync } = require('../../runtimes/redou-codex/redouCodexRuntimeConfig.cjs');
const { shouldProxyProvider } = require('../models/responsesChatProxy.cjs');

const MODEL_CONFIG_VERSION = 1;

const MODEL_PROVIDER_PRESETS = Object.freeze([
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek V4 chat and reasoning models.',
    baseUrl: 'https://api.deepseek.com',
    apiProtocol: 'chat-completions',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    models: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-v4-pro',
    region: 'CN',
    tags: ['reasoning', 'coding'],
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    description: 'MiniMax OpenAI-compatible endpoint for coding agents.',
    baseUrl: 'https://api.minimaxi.com/v1',
    apiProtocol: 'chat-completions',
    apiKeyEnv: 'MINIMAX_API_KEY',
    models: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5', 'MiniMax-M2.5-highspeed'],
    defaultModel: 'MiniMax-M2.7',
    region: 'CN',
    tags: ['agent', 'coding'],
  },
  {
    id: 'moonshot',
    label: 'Kimi / Moonshot',
    description: 'Kimi OpenAI-compatible endpoint.',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiProtocol: 'chat-completions',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    models: ['kimi-k2.6', 'kimi-k2.5', 'kimi-k2-thinking', 'kimi-k2-turbo-preview'],
    defaultModel: 'kimi-k2.6',
    region: 'CN',
    tags: ['long-context', 'coding'],
  },
  {
    id: 'doubao',
    label: '豆包 / 火山方舟',
    description: 'Volcengine Ark OpenAI-compatible endpoint.',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiProtocol: 'chat-completions',
    apiKeyEnv: 'ARK_API_KEY',
    models: ['doubao-seed-2-0-pro-260215', 'doubao-seed-2-0-code-preview-260215', 'doubao-seed-2-0-lite-260215', 'doubao-seed-1-6-flash-250715'],
    defaultModel: 'doubao-seed-2-0-pro-260215',
    region: 'CN',
    tags: ['fast', 'coding'],
  },
  {
    id: 'mimo',
    label: '小米 MiMo',
    description: 'Xiaomi MiMo OpenAI-compatible endpoint.',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    apiProtocol: 'chat-completions',
    apiKeyEnv: 'MIMO_API_KEY',
    models: ['mimo-v2.5-pro', 'mimo-v2.5', 'mimo-v2-pro'],
    defaultModel: 'mimo-v2.5-pro',
    region: 'CN',
    tags: ['long-context', 'coding'],
  },
  {
    id: 'qwen',
    label: 'Qwen / DashScope',
    description: 'Alibaba DashScope compatible-mode endpoint.',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    apiProtocol: 'chat-completions',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    models: ['qwen3.6-plus', 'qwen3.5-plus', 'qwen3-coder-plus'],
    defaultModel: 'qwen3.6-plus',
    region: 'CN/Global',
    tags: ['qwen', 'coding'],
  },
  {
    id: 'zhipu',
    label: 'GLM / Zhipu',
    description: 'Z.AI / Zhipu GLM family.',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    apiProtocol: 'chat-completions',
    apiKeyEnv: 'GLM_API_KEY',
    models: ['glm-5.1', 'glm-5', 'glm-4.7'],
    defaultModel: 'glm-5',
    region: 'CN/Global',
    tags: ['reasoning', 'coding'],
  },
  {
    id: 'local-vllm',
    label: 'Local vLLM',
    description: 'Local OpenAI-compatible server.',
    baseUrl: 'http://127.0.0.1:8000/v1',
    apiProtocol: 'chat-completions',
    apiKeyEnv: 'VLLM_API_KEY',
    models: ['local-model'],
    defaultModel: 'local-model',
    region: 'Local',
    tags: ['local', 'openai-compatible'],
    apiKeyOptional: true,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'Hosted model marketplace.',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiProtocol: 'chat-completions',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5.1', 'google/gemini-3-pro-preview'],
    defaultModel: 'anthropic/claude-sonnet-4.5',
    region: 'Global',
    tags: ['marketplace'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'OpenAI API compatible endpoint.',
    baseUrl: 'https://api.openai.com/v1',
    apiProtocol: 'responses',
    apiKeyEnv: 'OPENAI_API_KEY',
    models: ['gpt-5.1', 'gpt-5.1-mini', 'gpt-4.1'],
    defaultModel: 'gpt-5.1',
    region: 'Global',
    tags: ['tools', 'vision'],
  },
]);

function nowIso() {
  return new Date().toISOString();
}

function cleanString(value) {
  return String(value || '').trim();
}

function dedupeStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const text = cleanString(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function slugify(value, fallback = 'custom') {
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

function presetById(id) {
  return MODEL_PROVIDER_PRESETS.find((preset) => preset.id === id) || null;
}

function providerInputId(input = {}, preset = {}) {
  const explicit = cleanString(input.id);
  if (explicit) return explicit;
  const provider = cleanString(input.provider || preset.id);
  if (provider && provider !== 'custom') return provider;
  for (const value of [input.label, input.customProviderName, input.baseUrl, input.selectedModel, provider]) {
    const slug = slugify(value, '');
    if (slug) return slug;
  }
  return 'custom';
}

function modelEndpoint(baseUrl) {
  const trimmed = cleanString(baseUrl).replace(/\/+$/, '');
  if (!trimmed) return '';
  return /\/models$/i.test(trimmed) ? trimmed : `${trimmed}/models`;
}

function normalizeProvider(input = {}, existing = {}) {
  const preset = presetById(input.provider || input.id) || {};
  const id = providerInputId(input, preset);
  const label = cleanString(input.label || input.customProviderName || preset.label || id);
  const models = dedupeStrings(input.models && input.models.length ? input.models : existing.models || preset.models || []);
  const selectedModel = cleanString(input.selectedModel || input.model || existing.selectedModel || preset.defaultModel || models[0]);
  const defaultModel = cleanString(input.defaultModel || existing.defaultModel || selectedModel || preset.defaultModel || models[0]);
  const apiKey = cleanString(input.apiKey) || cleanString(existing.apiKey);
  const isCustomProvider = Boolean(input.custom) || cleanString(input.provider) === 'custom';
  const apiKeyOptional = Boolean(input.apiKeyOptional ?? existing.apiKeyOptional ?? preset.apiKeyOptional ?? isCustomProvider);
  const apiProtocol = cleanString(input.apiProtocol || existing.apiProtocol || preset.apiProtocol || 'chat-completions');

  return {
    id,
    runtimeProviderId: runtimeProviderId(id),
    provider: cleanString(input.provider || preset.id || existing.provider || id),
    label,
    description: cleanString(input.description || preset.description || existing.description),
    baseUrl: cleanString(input.baseUrl || existing.baseUrl || preset.baseUrl),
    apiProtocol,
    apiKey,
    apiKeySet: Boolean(apiKey),
    apiKeyOptional,
    apiKeyEnv: cleanString(input.apiKeyEnv || existing.apiKeyEnv || preset.apiKeyEnv),
    models,
    defaultModel: defaultModel || selectedModel || models[0] || '',
    selectedModel: selectedModel || defaultModel || models[0] || '',
    region: cleanString(input.region || preset.region || existing.region),
    tags: dedupeStrings(input.tags || existing.tags || preset.tags || []),
    custom: Boolean(input.custom ?? existing.custom ?? !preset.id),
    connectedAt: cleanString(input.connectedAt || existing.connectedAt),
    createdAt: cleanString(existing.createdAt || input.createdAt || nowIso()),
    updatedAt: nowIso(),
  };
}

function redactProvider(provider) {
  return {
    ...provider,
    apiKey: undefined,
    apiKeySet: Boolean(provider.apiKey),
  };
}

function normalizeStoreData(data) {
  const providers = Array.isArray(data && data.providers)
    ? data.providers.map((provider) => normalizeProvider(provider))
    : [];
  const selected = data && data.selected && data.selected.providerId && data.selected.modelId
    ? { providerId: String(data.selected.providerId), modelId: String(data.selected.modelId) }
    : null;
  return {
    version: MODEL_CONFIG_VERSION,
    providers,
    selected,
  };
}

async function providerToRuntimeConfig(provider, options = {}) {
  const proxyManager = options.responsesChatProxy;
  let baseUrl = provider.baseUrl;
  let proxied = false;
  if (shouldProxyProvider(provider) && proxyManager && typeof proxyManager.ensureProxy === 'function') {
    const proxy = await proxyManager.ensureProxy(provider);
    baseUrl = proxy.baseUrl || baseUrl;
    proxied = Boolean(proxy.proxied);
  }

  const config = {
    name: provider.label || provider.id,
    base_url: baseUrl,
    wire_api: 'responses',
    requires_openai_auth: false,
    supports_websockets: false,
    request_max_retries: 4,
    stream_max_retries: 5,
    stream_idle_timeout_ms: 300000,
  };
  if (provider.apiKey && !proxied) config.experimental_bearer_token = provider.apiKey;
  return config;
}

function parseModelsResponse(payload) {
  const data = Array.isArray(payload && payload.data) ? payload.data : Array.isArray(payload) ? payload : [];
  return dedupeStrings(data.map((item) => {
    if (typeof item === 'string') return item;
    return item && (item.id || item.name || item.model);
  }));
}

async function probeOpenAiCompatibleModels(input, options = {}) {
  const baseUrl = cleanString(input.baseUrl);
  if (!baseUrl) throw new Error('baseUrl is required');
  const endpoint = modelEndpoint(baseUrl);
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch is not available in this runtime');

  const headers = { Accept: 'application/json' };
  const apiKey = cleanString(input.apiKey);
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 10000);
  try {
    const response = await fetchImpl(endpoint, { method: 'GET', headers, signal: controller.signal });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const detail = body && (body.error && (body.error.message || body.error) || body.message) || text;
      const error = new Error(`Provider returned HTTP ${response.status}${detail ? `: ${String(detail).slice(0, 240)}` : ''}`);
      error.statusCode = response.status;
      error.probedUrl = endpoint;
      throw error;
    }
    return { models: parseModelsResponse(body), probedUrl: endpoint };
  } finally {
    clearTimeout(timeout);
  }
}

function createModelConfigStore(options = {}) {
  const dataRoot = path.resolve(options.dataRoot || '.redou');
  const configPath = options.configPath || safeJoin(dataRoot, 'model-configs.json');
  const redouCodexHome = options.redouCodexHome || options.codexHome || null;
  const responsesChatProxy = options.responsesChatProxy || null;
  const memory = { loaded: false, data: normalizeStoreData(null) };

  function syncRuntimeConfig(data) {
    if (!redouCodexHome) return null;
    return writeRedouCodexUserConfigSync({
      redouCodexHome,
      providers: data.providers,
      selected: data.selected,
    });
  }

  async function load() {
    if (memory.loaded) return memory.data;
    memory.data = normalizeStoreData(await readJsonFile(configPath, null));
    memory.loaded = true;
    return memory.data;
  }

  async function save(data) {
    memory.data = normalizeStoreData(data);
    memory.loaded = true;
    await writeJsonFile(configPath, memory.data);
    syncRuntimeConfig(memory.data);
    return memory.data;
  }

  async function snapshot() {
    const data = await load();
    return {
      catalog: MODEL_PROVIDER_PRESETS,
      providers: data.providers.map(redactProvider),
      selected: data.selected,
    };
  }

  async function saveProvider(input = {}) {
    const data = await load();
    const preset = presetById(input.provider || input.id) || {};
    const id = providerInputId(input, preset);
    const existing = data.providers.find((provider) => provider.id === id) || {};
    const provider = normalizeProvider(
      {
        ...input,
        id,
        connectedAt: input.connectedAt || existing.connectedAt || nowIso(),
      },
      existing,
    );
    if (!provider.baseUrl) throw new Error('baseUrl is required');
    if (!provider.apiKey && !provider.apiKeyOptional) throw new Error('apiKey is required');
    if (!provider.models.length && provider.selectedModel) provider.models = [provider.selectedModel];
    if (!provider.selectedModel && provider.models[0]) provider.selectedModel = provider.models[0];
    const providers = data.providers.filter((item) => item.id !== provider.id);
    providers.unshift(provider);
    const selected = input.select === false
      ? data.selected
      : { providerId: provider.id, modelId: provider.selectedModel || provider.defaultModel || provider.models[0] };
    await save({ ...data, providers, selected });
    return snapshot();
  }

  async function removeProvider(input = {}) {
    const providerId = cleanString(input.providerId || input.id);
    if (!providerId) throw new Error('providerId is required');
    const data = await load();
    const providers = data.providers.filter((provider) => provider.id !== providerId);
    const selected = data.selected && data.selected.providerId === providerId ? null : data.selected;
    await save({ ...data, providers, selected });
    return snapshot();
  }

  async function selectModel(input = {}) {
    const providerId = cleanString(input.providerId || input.id);
    const modelId = cleanString(input.modelId || input.model);
    if (!providerId || !modelId) throw new Error('providerId and modelId are required');
    const data = await load();
    const providers = data.providers.map((provider) => {
      if (provider.id !== providerId) return provider;
      return normalizeProvider({ ...provider, selectedModel: modelId, models: dedupeStrings([modelId, ...provider.models]) }, provider);
    });
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) throw new Error(`Model provider not found: ${providerId}`);
    await save({ ...data, providers, selected: { providerId, modelId } });
    return snapshot();
  }

  async function probeModels(input = {}) {
    const providerId = cleanString(input.provider || input.id);
    const preset = presetById(providerId) || {};
    const baseUrl = cleanString(input.baseUrl || preset.baseUrl);
    const selectedModel = cleanString(input.selectedModel || input.model || preset.defaultModel);
    const fallbackModels = dedupeStrings([selectedModel, ...(input.models || []), ...(preset.models || [])]);
    try {
      const probe = await probeOpenAiCompatibleModels({ ...input, baseUrl }, options);
      const models = probe.models.length ? probe.models : fallbackModels;
      return {
        provider: providerId,
        baseUrl,
        models,
        defaultModel: selectedModel && models.includes(selectedModel) ? selectedModel : models[0] || '',
        modelCount: models.length,
        refreshed: probe.models.length > 0,
        warning: probe.models.length ? '' : 'Provider returned no models; showing preset models.',
        probedUrl: probe.probedUrl,
      };
    } catch (error) {
      if (error && (error.statusCode === 401 || error.statusCode === 403)) throw error;
      return {
        provider: providerId,
        baseUrl,
        models: fallbackModels,
        defaultModel: selectedModel && fallbackModels.includes(selectedModel) ? selectedModel : fallbackModels[0] || '',
        modelCount: fallbackModels.length,
        refreshed: false,
        warning: `Could not refresh models from the provider: ${error && error.message ? error.message : String(error)}`,
        probedUrl: error && error.probedUrl ? error.probedUrl : modelEndpoint(baseUrl),
      };
    }
  }

  async function resolveRuntimeModel(selection = null) {
    const data = await load();
    const selected = selection && selection.providerId && selection.modelId
      ? selection
      : data.selected;
    let provider = selected
      ? data.providers.find((item) => item.id === selected.providerId)
      : null;
    if (!provider) provider = data.providers[0] || null;
    if (!provider) return null;
    const model = cleanString((selected && selected.modelId) || provider.selectedModel || provider.defaultModel || provider.models[0]);
    if (!model) return null;
    syncRuntimeConfig(data);
    const runtimeConfig = await providerToRuntimeConfig(provider, { responsesChatProxy });
    return {
      model,
      modelProvider: provider.runtimeProviderId,
      config: {
        [`model_providers.${provider.runtimeProviderId}`]: runtimeConfig,
      },
      provider: redactProvider(provider),
    };
  }

  return {
    configPath,
    runtimeConfigPath: redouCodexHome ? path.join(redouCodexHome, 'config.toml') : null,
    catalog: MODEL_PROVIDER_PRESETS,
    snapshot,
    saveProvider,
    removeProvider,
    selectModel,
    probeModels,
    resolveRuntimeModel,
  };
}

module.exports = {
  MODEL_PROVIDER_PRESETS,
  createModelConfigStore,
  probeOpenAiCompatibleModels,
  runtimeProviderId,
};
