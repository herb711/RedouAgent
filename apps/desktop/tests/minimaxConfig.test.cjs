const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  normalizeConfig,
  normalizeHost,
  readMiniMaxConfig,
  saveMiniMaxConfig,
  validateLocalConfig,
} = require('../src/services/local-service/extensions/providers/minimax/minimaxConfig.cjs');

function tempDeps(prefix = 'redou-minimax-config-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    workspaceRoot: root,
    dataRoot: path.join(root, 'data'),
    redouCodexHome: path.join(root, 'redou-codex'),
  };
}

test('MiniMax region maps to the official Direct HTTP hosts', () => {
  assert.equal(normalizeHost('cn'), 'https://api.minimaxi.com');
  assert.equal(normalizeHost('global'), 'https://api.minimax.io');
  assert.equal(normalizeHost('advanced', 'https://example.test/minimax/'), 'https://example.test/minimax');
  assert.notEqual(normalizeHost('cn'), 'https://api.minimax.chat');
});

test('MiniMax config persists cn/global/advanced hosts and defaults', async () => {
  const deps = tempDeps();

  await saveMiniMaxConfig(deps, { enabled: true, region: 'cn' });
  assert.equal((await readMiniMaxConfig(deps, { includeSecret: true })).host, 'https://api.minimaxi.com');

  await saveMiniMaxConfig(deps, { region: 'global' });
  assert.equal((await readMiniMaxConfig(deps, { includeSecret: true })).host, 'https://api.minimax.io');

  await saveMiniMaxConfig(deps, {
    region: 'advanced',
    host: 'https://unit.example',
    defaults: {
      ttsModel: 'speech-2.8-turbo',
      voiceId: 'custom-voice',
      imageModel: 'image-01',
      imageAspectRatio: '9:16',
    },
  });
  const config = await readMiniMaxConfig(deps, { includeSecret: true });
  assert.equal(config.region, 'advanced');
  assert.equal(config.host, 'https://unit.example');
  assert.equal(config.defaults.ttsModel, 'speech-2.8-turbo');
  assert.equal(config.defaults.voiceId, 'custom-voice');
  assert.equal(config.defaults.imageAspectRatio, '9:16');
});

test('MiniMax public config masks API Key and never returns the stored value', async () => {
  const deps = tempDeps();
  const fakeSecret = ['unit', 'test', 'secret', '123456789'].join('-');

  await saveMiniMaxConfig(deps, { apiKey: fakeSecret, enabled: true });
  const publicConfig = await readMiniMaxConfig(deps);
  const secretConfig = await readMiniMaxConfig(deps, { includeSecret: true });

  assert.equal(secretConfig.apiKey, fakeSecret);
  assert.equal(publicConfig.apiKey, '');
  assert.equal(publicConfig.apiKeySet, true);
  assert.match(publicConfig.apiKeyMask, /\*\*\*\*6789$/);
  assert.notEqual(publicConfig.apiKeyMask, fakeSecret);
});

test('MiniMax local validation blocks missing API Key before requests', () => {
  const config = normalizeConfig({ region: 'cn' }, {}, tempDeps());
  const result = validateLocalConfig(config);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'MINIMAX_API_KEY_MISSING');
  assert.match(result.hint, /API Key/);
});
