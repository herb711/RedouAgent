'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');

const {
  DEFAULTS,
  IMAGE_ASPECT_RATIOS,
  TTS_MODELS,
  absoluteOutputDir,
  configWithOverrides,
  readMiniMaxConfig,
  validateLocalConfig,
} = require('./minimaxConfig.cjs');
const { createMiniMaxHttpDriver } = require('./minimaxHttpDriver.cjs');
const { baseRespFrom, minimaxError, outputError } = require('./minimaxErrors.cjs');
const {
  downloadToFile,
  ensureOutputDir,
  saveBase64Image,
  saveHexAudio,
} = require('./minimaxFileStore.cjs');

function toolDescriptors(config = {}) {
  const outputDir = config.outputDir || '.redou/minimax-output';
  return [
    {
      name: 'minimax.health_check',
      displayName: 'MiniMax Health Check',
      description: 'Validate MiniMax Direct HTTP configuration locally.',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object' },
      requiresPermission: false,
      estimatedCostHint: '',
      outputDir,
    },
    {
      name: 'minimax.text_to_audio',
      displayName: 'MiniMax Text To Audio',
      description: 'Generate speech with the MiniMax Direct HTTP API.',
      inputSchema: {
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string' },
          model: { type: 'string', enum: TTS_MODELS },
          voice_id: { type: 'string' },
          speed: { type: 'number', minimum: 0.5, maximum: 2 },
          vol: { type: 'number', minimum: 0, maximum: 10 },
          pitch: { type: 'number', minimum: -12, maximum: 12 },
          output_format: { type: 'string', enum: ['url', 'hex'] },
        },
      },
      outputSchema: { type: 'object' },
      requiresPermission: true,
      estimatedCostHint: '会调用 MiniMax 付费语音生成 API',
      outputDir,
    },
    {
      name: 'minimax.text_to_image',
      displayName: 'MiniMax Text To Image',
      description: 'Generate images with the MiniMax Direct HTTP API.',
      inputSchema: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: { type: 'string' },
          model: { type: 'string' },
          aspect_ratio: { type: 'string', enum: IMAGE_ASPECT_RATIOS },
          n: { type: 'integer', minimum: 1, maximum: 4 },
          response_format: { type: 'string', enum: ['url', 'base64'] },
        },
      },
      outputSchema: { type: 'object' },
      requiresPermission: true,
      estimatedCostHint: '会调用 MiniMax 付费图片生成 API',
      outputDir,
    },
  ];
}

function isUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function isHex(value) {
  const text = String(value || '').replace(/\s+/g, '');
  return text.length >= 16 && text.length % 2 === 0 && /^[0-9a-f]+$/i.test(text);
}

function isBase64(value) {
  const text = String(value || '').trim();
  const body = text.includes(',') ? text.slice(text.indexOf(',') + 1) : text;
  return body.length >= 16 && /^[A-Za-z0-9+/]+={0,2}$/.test(body);
}

function valuesFrom(...items) {
  return items.flatMap((item) => {
    if (item === undefined || item === null) return [];
    if (Array.isArray(item)) return item;
    return [item];
  });
}

function urlFromEntry(entry) {
  if (isUrl(entry)) return String(entry);
  if (entry && typeof entry === 'object') {
    return valuesFrom(entry.url, entry.image_url, entry.imageUrl, entry.audio_url, entry.audioUrl, entry.file_url, entry.fileUrl)
      .find(isUrl) || '';
  }
  return '';
}

function base64FromEntry(entry) {
  if (typeof entry === 'string' && !isUrl(entry) && isBase64(entry)) return entry;
  if (entry && typeof entry === 'object') {
    return valuesFrom(entry.base64, entry.b64_json, entry.image_base64, entry.imageBase64, entry.data)
      .find((value) => typeof value === 'string' && isBase64(value)) || '';
  }
  return '';
}

function extractAudio(raw = {}) {
  const data = raw.data && typeof raw.data === 'object' ? raw.data : {};
  const urls = valuesFrom(
    data.audio_url,
    data.audioUrl,
    data.audio_file,
    data.audioFile,
    data.url,
    data.file_url,
    data.audio,
    raw.audio_url,
    raw.url,
  ).map(urlFromEntry).filter(Boolean);
  if (urls.length) return { mode: 'url', value: urls[0] };
  const hex = valuesFrom(data.audio_hex, data.audioHex, data.audio, raw.audio)
    .find((value) => typeof value === 'string' && isHex(value));
  if (hex) return { mode: 'hex', value: hex };
  return null;
}

function imageEntries(raw = {}) {
  const data = raw.data && typeof raw.data === 'object' ? raw.data : {};
  return valuesFrom(
    data.image_urls,
    data.imageUrls,
    data.images,
    data.image,
    data.image_url,
    data.imageUrl,
    data.url,
    raw.images,
    raw.image_url,
    raw.url,
  );
}

function extractImages(raw = {}) {
  const entries = imageEntries(raw);
  const urls = entries.map(urlFromEntry).filter(Boolean);
  if (urls.length) return { mode: 'url', values: urls };
  const base64 = entries.map(base64FromEntry).filter(Boolean);
  if (base64.length) return { mode: 'base64', values: base64 };
  return null;
}

function rawSummary(raw = {}) {
  return {
    trace_id: raw.trace_id || raw.traceId || raw.request_id || raw.requestId || null,
    base_resp: baseRespFrom(raw) || {},
  };
}

function driverFor(config, options = {}) {
  return createMiniMaxHttpDriver(config, {
    fetchImpl: options.fetchImpl,
    logger: options.logger,
    timeoutMs: options.timeoutMs,
  });
}

async function loadConfig(dependencies = {}, input = {}) {
  const baseConfig = await readMiniMaxConfig(dependencies, { includeSecret: true });
  return configWithOverrides(baseConfig, input, dependencies);
}

async function healthCheck(dependencies = {}, input = {}) {
  const config = await loadConfig(dependencies, input);
  const validation = validateLocalConfig(config);
  if (!validation.ok) {
    return {
      ok: false,
      provider: 'minimax',
      driver: 'direct_http',
      code: validation.code,
      message: validation.message,
      hint: validation.hint,
      rawStatus: null,
      raw: {},
    };
  }
  return {
    ok: true,
    provider: 'minimax',
    driver: 'direct_http',
    host: config.host,
    region: config.region,
    message: validation.message,
  };
}

function ttsBody(config, input = {}) {
  const defaults = config.defaults || DEFAULTS;
  return {
    model: String(input.model || input.ttsModel || defaults.ttsModel),
    text: String(input.text || ''),
    stream: false,
    voice_setting: {
      voice_id: String(input.voice_id || input.voiceId || defaults.voiceId),
      speed: Number(input.speed ?? 1),
      vol: Number(input.vol ?? 1),
      pitch: Number(input.pitch ?? 0),
    },
    audio_setting: {
      sample_rate: Number(input.sample_rate || input.sampleRate || 32000),
      bitrate: Number(input.bitrate || 128000),
      format: String(input.format || defaults.audioFormat || 'mp3'),
      channel: Number(input.channel || 1),
    },
    output_format: String(input.output_format || input.outputFormat || 'url'),
  };
}

function imageBody(config, input = {}) {
  const defaults = config.defaults || DEFAULTS;
  return {
    model: String(input.model || input.imageModel || defaults.imageModel),
    prompt: String(input.prompt || ''),
    aspect_ratio: String(input.aspect_ratio || input.aspectRatio || defaults.imageAspectRatio),
    response_format: String(input.response_format || input.responseFormat || 'url'),
    n: Math.max(1, Number(input.n || 1)),
  };
}

async function textToAudio(dependencies = {}, input = {}, options = {}) {
  const config = await loadConfig(dependencies, input);
  const body = ttsBody(config, input);
  if (!body.text.trim()) {
    return minimaxError({
      code: 'MINIMAX_TEXT_REQUIRED',
      message: 'Text is required.',
      hint: '请输入要转换为语音的文本。',
    });
  }
  const driver = driverFor(config, options);
  const response = await driver.request('/v1/t2a_v2', body);
  if (!response.ok) return response;
  const audio = extractAudio(response.raw);
  if (!audio) {
    return minimaxError({
      code: 'MINIMAX_AUDIO_OUTPUT_MISSING',
      message: 'MiniMax response did not contain audio output.',
      hint: 'MiniMax 已返回成功响应，但没有发现可保存的音频 URL 或 hex 数据。',
      raw: rawSummary(response.raw),
    });
  }
  try {
    const saved = audio.mode === 'url'
      ? await downloadToFile(config, dependencies, driver, audio.value, {
          prefix: 'text-to-audio',
          extension: '.mp3',
          mimeType: 'audio/mpeg',
        })
      : await saveHexAudio(config, dependencies, audio.value, { extension: '.mp3' });
    return {
      ok: true,
      tool: 'minimax.text_to_audio',
      provider: 'minimax',
      driver: 'direct_http',
      model: body.model,
      filePath: saved.filePath,
      outputDir: saved.outputDir,
      mimeType: saved.mimeType,
      raw: rawSummary(response.raw),
    };
  } catch (error) {
    return outputError(error);
  }
}

async function textToImage(dependencies = {}, input = {}, options = {}) {
  const config = await loadConfig(dependencies, input);
  const body = imageBody(config, input);
  if (!body.prompt.trim()) {
    return minimaxError({
      code: 'MINIMAX_PROMPT_REQUIRED',
      message: 'Prompt is required.',
      hint: '请输入要生成图片的 prompt。',
    });
  }
  const driver = driverFor(config, options);
  const response = await driver.request('/v1/image_generation', body);
  if (!response.ok) return response;
  const images = extractImages(response.raw);
  if (!images || !images.values.length) {
    return minimaxError({
      code: 'MINIMAX_IMAGE_OUTPUT_MISSING',
      message: 'MiniMax response did not contain image output.',
      hint: 'MiniMax 已返回成功响应，但没有发现可保存的图片 URL 或 base64 数据。',
      raw: rawSummary(response.raw),
    });
  }
  try {
    const saved = [];
    for (let index = 0; index < images.values.length; index += 1) {
      const value = images.values[index];
      const item = images.mode === 'url'
        ? await downloadToFile(config, dependencies, driver, value, {
            prefix: `text-to-image-${index + 1}`,
            extension: '.png',
            mimeType: 'image/png',
          })
        : await saveBase64Image(config, dependencies, value, { prefix: `text-to-image-${index + 1}` });
      saved.push(item);
    }
    const previews = [];
    for (const item of saved.slice(0, 4)) {
      const buffer = await fs.readFile(item.filePath);
      previews.push({
        filePath: item.filePath,
        dataUrl: `data:${item.mimeType};base64,${buffer.toString('base64')}`,
      });
    }
    return {
      ok: true,
      tool: 'minimax.text_to_image',
      provider: 'minimax',
      driver: 'direct_http',
      model: body.model,
      files: saved.map((item) => item.filePath),
      outputDir: saved[0]?.outputDir || absoluteOutputDir(config, dependencies),
      previews,
      raw: rawSummary(response.raw),
    };
  } catch (error) {
    return outputError(error);
  }
}

async function openOutputTarget(dependencies = {}, input = {}) {
  const config = await loadConfig(dependencies, input);
  const shell = dependencies.shell;
  const filePath = input.filePath ? path.resolve(String(input.filePath)) : '';
  const dir = input.outputDir
    ? path.resolve(String(input.outputDir))
    : filePath ? path.dirname(filePath) : await ensureOutputDir(config, dependencies);
  if (!shell) return { opened: false, path: input.openFile && filePath ? filePath : dir };
  if (input.openFile && filePath && typeof shell.openPath === 'function') {
    const result = await shell.openPath(filePath);
    if (result) throw new Error(result);
    return { opened: true, path: filePath };
  }
  if (filePath && typeof shell.showItemInFolder === 'function') {
    shell.showItemInFolder(filePath);
    return { opened: true, path: filePath, revealed: true };
  }
  if (typeof shell.openPath === 'function') {
    const result = await shell.openPath(dir);
    if (result) throw new Error(result);
    return { opened: true, path: dir };
  }
  return { opened: false, path: dir };
}

module.exports = {
  extractAudio,
  extractImages,
  healthCheck,
  imageBody,
  openOutputTarget,
  textToAudio,
  textToImage,
  toolDescriptors,
  ttsBody,
};
