'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { ensureDir } = require('./paths.cjs');

async function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJsonFile(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
  return value;
}

module.exports = {
  readJsonFile,
  writeJsonFile,
  readJson: readJsonFile,
  writeJson: writeJsonFile,
};
