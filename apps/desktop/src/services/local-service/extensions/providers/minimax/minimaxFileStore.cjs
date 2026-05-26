'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { absoluteOutputDir } = require('./minimaxConfig.cjs');

function sanitizeName(value, fallback = 'minimax-output') {
  return String(value || fallback)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[. -]+$/g, '')
    .slice(0, 80) || fallback;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function ensureOutputDir(config = {}, dependencies = {}) {
  const dir = absoluteOutputDir(config, dependencies);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function uniquePath(dir, preferredName) {
  const parsed = path.parse(sanitizeName(preferredName, 'minimax-output'));
  const base = parsed.name || 'minimax-output';
  const ext = parsed.ext || '.bin';
  for (let index = 0; index < 1000; index += 1) {
    const name = index === 0 ? `${base}${ext}` : `${base}-${index + 1}${ext}`;
    const candidate = path.join(dir, name);
    try {
      const handle = await fs.open(candidate, 'wx');
      await handle.close();
      return candidate;
    } catch (error) {
      if (error && error.code === 'EEXIST') continue;
      throw error;
    }
  }
  throw new Error('Unable to allocate a unique MiniMax output path.');
}

async function saveBuffer(config, dependencies, buffer, options = {}) {
  const dir = await ensureOutputDir(config, dependencies);
  const ext = options.extension || '.bin';
  const prefix = sanitizeName(options.prefix || 'minimax', 'minimax');
  const filePath = await uniquePath(dir, `${prefix}-${timestamp()}${ext}`);
  await fs.writeFile(filePath, buffer);
  return {
    filePath,
    outputDir: dir,
    size: buffer.length,
    mimeType: options.mimeType || 'application/octet-stream',
  };
}

function bufferFromHex(value) {
  const hex = String(value || '').replace(/\s+/g, '');
  return Buffer.from(hex, 'hex');
}

function bufferFromBase64(value) {
  const text = String(value || '');
  const body = text.includes(',') ? text.slice(text.indexOf(',') + 1) : text;
  return Buffer.from(body, 'base64');
}

async function saveHexAudio(config, dependencies, hex, options = {}) {
  return saveBuffer(config, dependencies, bufferFromHex(hex), {
    prefix: options.prefix || 'text-to-audio',
    extension: options.extension || '.mp3',
    mimeType: options.mimeType || 'audio/mpeg',
  });
}

async function saveBase64Image(config, dependencies, base64, options = {}) {
  return saveBuffer(config, dependencies, bufferFromBase64(base64), {
    prefix: options.prefix || 'text-to-image',
    extension: options.extension || '.png',
    mimeType: options.mimeType || 'image/png',
  });
}

async function downloadToFile(config, dependencies, driver, url, options = {}) {
  const buffer = await driver.download(url, options);
  return saveBuffer(config, dependencies, buffer, options);
}

module.exports = {
  bufferFromBase64,
  bufferFromHex,
  downloadToFile,
  ensureOutputDir,
  saveBase64Image,
  saveBuffer,
  saveHexAudio,
};
