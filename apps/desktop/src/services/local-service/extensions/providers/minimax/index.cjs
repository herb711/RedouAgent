'use strict';

const {
  PLUGIN_ID,
  readMiniMaxConfig,
  saveMiniMaxConfig,
} = require('./minimaxConfig.cjs');
const {
  healthCheck,
  openOutputTarget,
  textToAudio,
  textToImage,
  toolDescriptors,
} = require('./minimaxTools.cjs');

const lastResults = new Map();

function stateKey(dependencies = {}) {
  return `${dependencies.redouCodexHome || dependencies.dataRoot || dependencies.workspaceRoot || process.cwd()}`;
}

function recordResult(dependencies = {}, result = {}) {
  lastResults.set(stateKey(dependencies), {
    ok: Boolean(result.ok),
    code: result.code || '',
    message: result.hint || result.message || '',
    testedAt: new Date().toISOString(),
  });
}

async function pluginCatalogItem(dependencies = {}) {
  const config = await readMiniMaxConfig(dependencies);
  const last = lastResults.get(stateKey(dependencies));
  const status = !config.apiKeySet
    ? 'missing-config'
    : last && last.ok === false && last.code === 'MINIMAX_AUTH_FAILED'
      ? 'error'
      : config.enabled ? 'ready' : 'disabled';
  const statusMessage = !config.apiKeySet
    ? '未配置 API Key'
    : status === 'error'
      ? (last.message || '鉴权失败')
      : config.enabled ? '可用' : '已停用';
  return {
    id: PLUGIN_ID,
    name: 'minimax',
    title: 'MiniMax 多模态',
    description: '通过 MiniMax 官方 HTTP API 生成语音和图片，支持 Token Plan 或普通 API Key。',
    version: '0.1.0',
    marketplace: 'redou',
    source: 'bundled',
    category: 'Multimodal',
    tags: ['语音生成', '图片生成', '多模态', 'HTTP API', 'MiniMax'],
    path: '',
    installed: true,
    enabled: Boolean(config.enabled),
    authRequired: true,
    canRemove: false,
    canUpdate: false,
    status,
    statusMessage,
    manifest: {
      name: 'minimax',
      title: 'MiniMax 多模态',
      description: '通过 MiniMax 官方 HTTP API 生成语音和图片，支持 Token Plan 或普通 API Key。',
      version: '0.1.0',
      category: 'Multimodal',
      tags: ['语音生成', '图片生成', '多模态', 'HTTP API', 'MiniMax'],
    },
    raw: {
      provider: 'minimax',
      driver: 'direct_http',
      config,
      tools: toolDescriptors(config),
      lastTest: last || null,
    },
  };
}

async function testConnection(dependencies = {}, input = {}) {
  const result = await healthCheck(dependencies, input);
  recordResult(dependencies, result);
  return result;
}

async function runTextToAudio(dependencies = {}, input = {}, options = {}) {
  const result = await textToAudio(dependencies, input, options);
  recordResult(dependencies, result);
  return result;
}

async function runTextToImage(dependencies = {}, input = {}, options = {}) {
  const result = await textToImage(dependencies, input, options);
  recordResult(dependencies, result);
  return result;
}

module.exports = {
  PLUGIN_ID,
  openOutputTarget,
  pluginCatalogItem,
  readMiniMaxConfig,
  runTextToAudio,
  runTextToImage,
  saveMiniMaxConfig,
  testConnection,
  toolDescriptors,
};
