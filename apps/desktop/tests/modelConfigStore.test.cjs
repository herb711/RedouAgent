const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  MODEL_PROVIDER_PRESETS,
  createModelConfigStore,
} = require('../src/core/store/modelConfigStore.cjs');

function tempStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redou-model-config-'));
  return {
    root,
    store: createModelConfigStore({
      dataRoot: path.join(root, 'data'),
      redouCodexHome: path.join(root, 'codex-home'),
    }),
  };
}

test('model provider catalog includes domestic model presets for the settings dropdown', () => {
  const ids = new Set(MODEL_PROVIDER_PRESETS.map((preset) => preset.id));

  for (const id of ['deepseek', 'minimax', 'doubao', 'moonshot', 'mimo']) {
    assert.equal(ids.has(id), true, `${id} preset should be available`);
  }

  const mimo = MODEL_PROVIDER_PRESETS.find((preset) => preset.id === 'mimo');
  assert.equal(mimo.defaultModel, 'mimo-v2.5-pro');
  assert.equal(mimo.baseUrl, 'https://api.xiaomimimo.com/v1');
});

test('custom provider saves without an API key and writes a runnable Codex config', async () => {
  const { root, store } = tempStore();
  try {
    const snapshot = await store.saveProvider({
      provider: 'custom',
      label: '自定义模型',
      baseUrl: 'http://127.0.0.1:8000/v1',
      models: ['qwen3-coder'],
      selectedModel: 'qwen3-coder',
      custom: true,
      select: true,
    });

    assert.equal(snapshot.providers[0].id, '127-0-0-1-8000-v1');
    assert.equal(snapshot.providers[0].apiKeyOptional, true);
    assert.deepEqual(snapshot.selected, { providerId: '127-0-0-1-8000-v1', modelId: 'qwen3-coder' });

    const resolved = await store.resolveRuntimeModel();
    assert.equal(resolved.model, 'qwen3-coder');
    assert.equal(resolved.modelProvider, 'redou-127-0-0-1-8000-v1');

    const toml = fs.readFileSync(path.join(root, 'codex-home', 'config.toml'), 'utf8');
    assert.match(toml, /model_provider = "redou-127-0-0-1-8000-v1"/);
    assert.match(toml, /model = "qwen3-coder"/);
    assert.match(toml, /base_url = "http:\/\/127\.0\.0\.1:8000\/v1"/);
    assert.doesNotMatch(toml, /experimental_bearer_token/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preset provider saves API key and selected model into Codex user config', async () => {
  const { root, store } = tempStore();
  try {
    const snapshot = await store.saveProvider({
      provider: 'minimax',
      apiKey: 'mm-test-key',
      selectedModel: 'MiniMax-M2.7',
      select: true,
    });

    assert.deepEqual(snapshot.selected, { providerId: 'minimax', modelId: 'MiniMax-M2.7' });
    const provider = snapshot.providers[0];
    assert.equal(provider.label, 'MiniMax');
    assert.equal(provider.apiKeySet, true);
    assert.equal(provider.apiKey, undefined);

    const toml = fs.readFileSync(path.join(root, 'codex-home', 'config.toml'), 'utf8');
    assert.match(toml, /model_provider = "redou-minimax"/);
    assert.match(toml, /model = "MiniMax-M2\.7"/);
    assert.match(toml, /base_url = "https:\/\/api\.minimaxi\.com\/v1"/);
    assert.match(toml, /experimental_bearer_token = "mm-test-key"/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('chat-completions providers resolve through the local Responses proxy', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redou-model-config-proxy-'));
  const calls = [];
  const store = createModelConfigStore({
    dataRoot: path.join(root, 'data'),
    redouCodexHome: path.join(root, 'codex-home'),
    responsesChatProxy: {
      async ensureProxy(provider) {
        calls.push(provider.id);
        return { proxied: true, baseUrl: 'http://127.0.0.1:39123/v1' };
      },
    },
  });

  try {
    await store.saveProvider({
      provider: 'minimax',
      apiKey: 'mm-test-key',
      selectedModel: 'MiniMax-M2.7',
      select: true,
    });

    const resolved = await store.resolveRuntimeModel();
    const runtimeProvider = resolved.config['model_providers.redou-minimax'];

    assert.deepEqual(calls, ['minimax']);
    assert.equal(runtimeProvider.base_url, 'http://127.0.0.1:39123/v1');
    assert.equal(runtimeProvider.wire_api, 'responses');
    assert.equal(runtimeProvider.experimental_bearer_token, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
