const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createMiniMaxHttpDriver } = require('../src/services/local-service/extensions/providers/minimax/minimaxHttpDriver.cjs');
const { saveMiniMaxConfig } = require('../src/services/local-service/extensions/providers/minimax/minimaxConfig.cjs');
const { textToAudio, textToImage } = require('../src/services/local-service/extensions/providers/minimax/minimaxTools.cjs');

function tempDeps(prefix = 'redou-minimax-http-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    workspaceRoot: root,
    dataRoot: path.join(root, 'data'),
    redouCodexHome: path.join(root, 'redou-codex'),
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function binaryResponse(buffer) {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
}

function createFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return handler(url, options, calls.length);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

async function depsWithConfig() {
  const deps = tempDeps();
  const fakeSecret = ['unit', 'test', 'secret', 'abcdef123456'].join('-');
  await saveMiniMaxConfig(deps, {
    enabled: true,
    region: 'cn',
    apiKey: fakeSecret,
    outputDir: '.redou/minimax-output',
  });
  return { deps, fakeSecret };
}

test('MiniMax driver does not send a request without API Key', async () => {
  const fetchImpl = createFetch(() => jsonResponse(200, {}));
  const driver = createMiniMaxHttpDriver({ host: 'https://api.minimaxi.com', apiKey: '' }, { fetchImpl });

  const result = await driver.request('/v1/t2a_v2', {});

  assert.equal(result.ok, false);
  assert.equal(result.code, 'MINIMAX_API_KEY_MISSING');
  assert.equal(fetchImpl.calls.length, 0);
});

test('MiniMax driver uses Bearer Authorization and redacts logs', async () => {
  const fakeSecret = ['unit', 'test', 'secret', 'abcdef123456'].join('-');
  const logs = [];
  const fetchImpl = createFetch(() => jsonResponse(200, { base_resp: { status_code: 0 }, trace_id: 'trace' }));
  const driver = createMiniMaxHttpDriver(
    { host: 'https://api.minimaxi.com', apiKey: fakeSecret },
    { fetchImpl, logger: { debug: (message, payload) => logs.push({ message, payload }) } },
  );

  const result = await driver.request('/v1/t2a_v2', { text: 'hello' });

  assert.equal(result.ok, true);
  assert.equal(fetchImpl.calls[0].options.headers.Authorization, `Bearer ${fakeSecret}`);
  const serializedLogs = JSON.stringify(logs);
  assert.ok(!serializedLogs.includes(fakeSecret));
  assert.ok(!serializedLogs.includes(`Bearer ${fakeSecret}`));
});

test('MiniMax driver maps 401 and base_resp 1004 to auth guidance', async () => {
  const fakeSecret = ['unit', 'test', 'secret', 'abcdef123456'].join('-');
  const driver401 = createMiniMaxHttpDriver({
    host: 'https://api.minimaxi.com',
    apiKey: fakeSecret,
  }, {
    fetchImpl: createFetch(() => jsonResponse(401, { message: `bad ${fakeSecret}` })),
  });

  const httpResult = await driver401.request('/v1/t2a_v2', {});
  assert.equal(httpResult.ok, false);
  assert.equal(httpResult.code, 'MINIMAX_AUTH_FAILED');
  assert.equal(httpResult.rawStatus, 401);
  assert.match(httpResult.hint, /region\/host/);
  assert.ok(!JSON.stringify(httpResult).includes(fakeSecret));

  const driver1004 = createMiniMaxHttpDriver({
    host: 'https://api.minimaxi.com',
    apiKey: fakeSecret,
  }, {
    fetchImpl: createFetch(() => jsonResponse(200, { base_resp: { status_code: 1004, status_msg: 'invalid key' } })),
  });
  const baseRespResult = await driver1004.request('/v1/t2a_v2', {});
  assert.equal(baseRespResult.ok, false);
  assert.equal(baseRespResult.code, 'MINIMAX_AUTH_FAILED');
  assert.match(baseRespResult.hint, /Token Plan/);
});

test('MiniMax TTS url response downloads and saves audio output', async () => {
  const { deps } = await depsWithConfig();
  const fetchImpl = createFetch((url, _options, index) => {
    if (index === 1) {
      return jsonResponse(200, {
        trace_id: 'tts-url',
        base_resp: { status_code: 0 },
        data: { audio_url: 'https://files.example/audio.mp3' },
      });
    }
    assert.equal(url, 'https://files.example/audio.mp3');
    return binaryResponse(Buffer.from('audio-bytes'));
  });

  const result = await textToAudio(deps, { text: 'hello' }, { fetchImpl });

  assert.equal(result.ok, true);
  assert.equal(result.tool, 'minimax.text_to_audio');
  assert.equal(path.basename(path.dirname(result.filePath)), 'minimax-output');
  assert.equal(fs.readFileSync(result.filePath, 'utf8'), 'audio-bytes');
  assert.equal(fetchImpl.calls[0].options.headers.Authorization.startsWith('Bearer '), true);
});

test('MiniMax TTS hex response decodes and saves mp3 output', async () => {
  const { deps } = await depsWithConfig();
  const hex = Buffer.from('hex-audio').toString('hex');
  const fetchImpl = createFetch(() => jsonResponse(200, {
    trace_id: 'tts-hex',
    base_resp: { status_code: 0 },
    data: { audio: hex },
  }));

  const result = await textToAudio(deps, { text: 'hello', output_format: 'hex' }, { fetchImpl });

  assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(result.filePath, 'utf8'), 'hex-audio');
  assert.equal(fetchImpl.calls.length, 1);
});

test('MiniMax image url response downloads and saves image output', async () => {
  const { deps } = await depsWithConfig();
  const fetchImpl = createFetch((url, _options, index) => {
    if (index === 1) {
      return jsonResponse(200, {
        trace_id: 'image-url',
        base_resp: { status_code: 0 },
        data: { image_urls: ['https://files.example/image.png'] },
      });
    }
    assert.equal(url, 'https://files.example/image.png');
    return binaryResponse(Buffer.from('png-bytes'));
  });

  const result = await textToImage(deps, { prompt: 'cat' }, { fetchImpl });

  assert.equal(result.ok, true);
  assert.equal(result.tool, 'minimax.text_to_image');
  assert.deepEqual(result.files.map((filePath) => fs.readFileSync(filePath, 'utf8')), ['png-bytes']);
  assert.ok(result.previews[0].dataUrl.startsWith('data:image/png;base64,'));
});

test('MiniMax image base64 response decodes and creates output directory', async () => {
  const { deps } = await depsWithConfig();
  const outputDir = path.join(deps.workspaceRoot, '.redou', 'minimax-output');
  assert.equal(fs.existsSync(outputDir), false);
  const fetchImpl = createFetch(() => jsonResponse(200, {
    trace_id: 'image-base64',
    base_resp: { status_code: 0 },
    data: { images: [{ base64: Buffer.from('base64-png').toString('base64') }] },
  }));

  const result = await textToImage(deps, { prompt: 'cat', response_format: 'base64' }, { fetchImpl });

  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(outputDir), true);
  assert.equal(fs.readFileSync(result.files[0], 'utf8'), 'base64-png');
});
