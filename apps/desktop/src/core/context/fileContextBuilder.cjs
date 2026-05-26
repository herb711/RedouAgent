'use strict';

const fs = require('node:fs/promises');

const MAX_FILE_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 160 * 1024;

function isLikelyBinary(buffer) {
  if (!buffer || !buffer.length) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}

function normalizePathList(values = []) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [].concat(values || []))
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  ));
}

async function renderSelectedFile(filePath, remainingBytes) {
  const stat = await fs.stat(filePath);
  if (stat.isDirectory()) return `Directory: ${filePath}`;
  if (!stat.isFile()) return `Path: ${filePath}`;

  const readBytes = Math.max(0, Math.min(MAX_FILE_BYTES, remainingBytes, stat.size));
  if (!readBytes) return `File: ${filePath}\nSkipped: context file budget exhausted.`;

  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(readBytes);
    const { bytesRead } = await handle.read(buffer, 0, readBytes, 0);
    const contentBuffer = buffer.subarray(0, bytesRead);
    if (isLikelyBinary(contentBuffer)) {
      return `File: ${filePath}\nSize: ${stat.size} bytes\nSkipped: binary content.`;
    }
    const text = contentBuffer.toString('utf8');
    const truncated = stat.size > bytesRead ? `\n\n[Truncated after ${bytesRead} of ${stat.size} bytes]` : '';
    return `File: ${filePath}\nSize: ${stat.size} bytes\nContent:\n${text}${truncated}`;
  } finally {
    await handle.close();
  }
}

async function buildFileContext(input = {}) {
  const selectedPaths = normalizePathList(input.selectedFiles);
  const selectedFiles = [];
  let remainingBytes = MAX_TOTAL_BYTES;

  for (const filePath of selectedPaths) {
    try {
      const rendered = await renderSelectedFile(filePath, remainingBytes);
      selectedFiles.push(rendered);
      remainingBytes -= Buffer.byteLength(rendered, 'utf8');
    } catch (error) {
      selectedFiles.push(`File: ${filePath}\nSkipped: ${error && error.message ? error.message : String(error)}`);
    }
  }

  return { selectedFiles };
}

module.exports = { buildFileContext };
