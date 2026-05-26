'use strict';

const fs = require('node:fs');
const path = require('node:path');

function queryObject(query) {
  if (!query || typeof query !== 'object') return null;
  const cleaned = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    cleaned[key] = String(value);
  }
  return Object.keys(cleaned).length ? cleaned : null;
}

function appendQuery(url, query) {
  const cleaned = queryObject(query);
  if (!cleaned) return url;
  const target = new URL(url);
  for (const [key, value] of Object.entries(cleaned)) {
    target.searchParams.set(key, value);
  }
  return target.toString();
}

function resolveRendererEntry(config = {}) {
  const rendererRoot = config.rendererRoot || path.resolve(__dirname, '../../../renderer');
  const distIndex = config.distIndex || path.join(rendererRoot, 'dist', 'index.html');
  if (config.devServerUrl || process.env.REDOU_RENDERER_URL) {
    return { kind: 'url', target: config.devServerUrl || process.env.REDOU_RENDERER_URL };
  }
  if (fs.existsSync(distIndex)) return { kind: 'file', target: distIndex };
  if (config.devServerFallback !== false) {
    return { kind: 'url', target: 'http://localhost:5173' };
  }
  return {
    kind: 'html',
    target: [
      '<!doctype html><html><head><meta charset="utf-8">',
      '<title>Redou Workbench</title></head>',
      '<body style="font-family: system-ui; padding: 24px;">',
      '<h1>Redou renderer is not built</h1>',
      '<p>Build apps/desktop/renderer or start the Vite dev server at http://localhost:5173.</p>',
      '</body></html>',
    ].join(''),
  };
}

async function loadRenderer(window, config = {}) {
  const entry = resolveRendererEntry(config);
  if (entry.kind === 'file') {
    const query = queryObject(config.query);
    if (query) await window.loadFile(entry.target, { query });
    else await window.loadFile(entry.target);
  } else if (entry.kind === 'url') {
    try {
      await window.loadURL(appendQuery(entry.target, config.query));
    } catch (error) {
      const fallback = resolveRendererEntry({ ...config, devServerFallback: false });
      if (fallback.kind === 'html') await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fallback.target)}`);
      else throw error;
    }
  } else {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(entry.target)}`);
  }
  return entry;
}

module.exports = { resolveRendererEntry, loadRenderer };
