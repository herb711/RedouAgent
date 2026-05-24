'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { ensureDir } = require('./paths.cjs');

async function appendJsonl(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, JSON.stringify(value) + '\n', 'utf8');
  return value;
}

async function readJsonl(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

module.exports = { appendJsonl, readJsonl };
