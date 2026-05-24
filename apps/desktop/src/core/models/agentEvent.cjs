'use strict';

const { REDOU_CODEX_RUNTIME_ID } = require('../../runtimes/redou-codex/redouCodexRuntimeConfig.cjs');

// Basic agentEvent field definition. Keep this file limited to defaults and normalization.
const AGENTEVENT_FIELDS = Object.freeze(['id', 'taskId', 'projectId', 'runtime', 'type', 'level', 'timestamp', 'title', 'message', 'payload', 'raw', 'metadata']);

function nowIso() {
  return new Date().toISOString();
}

function createDefaultAgentEvent(overrides = {}) {
  const base = {
    id: null,
    taskId: null,
    projectId: null,
    runtime: REDOU_CODEX_RUNTIME_ID,
    type: 'runtime.raw',
    level: 'info',
    timestamp: nowIso(),
    title: '',
    message: '',
    payload: {},
    raw: null,
    metadata: {},
  };
  return normalizeAgentEvent({ ...base, ...overrides });
}

function normalizeAgentEvent(input = {}) {
  const normalized = {};
  for (const field of AGENTEVENT_FIELDS) {
    normalized[field] = input[field];
  }
  return normalized;
}

module.exports = {
  AGENTEVENT_FIELDS,
  createDefaultAgentEvent,
  normalizeAgentEvent,
};
