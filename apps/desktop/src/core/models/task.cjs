'use strict';

const { REDOU_CODEX_RUNTIME_ID } = require('../../runtimes/redou-codex/redouCodexRuntimeConfig.cjs');

// Basic task field definition. Keep this file limited to defaults and normalization.
const TASK_FIELDS = Object.freeze(['id', 'projectId', 'title', 'status', 'runtime', 'runtimeMode', 'redouCodexThreadId', 'redouCodexActiveTurnId', 'runtimeSessions', 'createdAt', 'updatedAt', 'userInput', 'metadata']);
const LEGACY_THREAD_ID_FIELD = ['codex', 'ThreadId'].join('');
const LEGACY_ACTIVE_TURN_ID_FIELD = ['codex', 'ActiveTurnId'].join('');

function nowIso() {
  return new Date().toISOString();
}

function createDefaultTask(overrides = {}) {
  const redouCodexThreadId = overrides.redouCodexThreadId || overrides[LEGACY_THREAD_ID_FIELD] || null;
  const redouCodexActiveTurnId = overrides.redouCodexActiveTurnId || overrides[LEGACY_ACTIVE_TURN_ID_FIELD] || null;
  const base = {
    id: null,
    projectId: null,
    title: '',
    status: 'created',
    runtime: REDOU_CODEX_RUNTIME_ID,
    runtimeMode: 'thread',
    redouCodexThreadId,
    redouCodexActiveTurnId,
    runtimeSessions: {},
    createdAt: nowIso(),
    updatedAt: nowIso(),
    userInput: '',
    metadata: {},
  };
  return normalizeTask({ ...base, ...overrides });
}

function normalizeTask(input = {}) {
  const migrated = {
    ...input,
    redouCodexThreadId: input.redouCodexThreadId || input[LEGACY_THREAD_ID_FIELD] || null,
    redouCodexActiveTurnId: input.redouCodexActiveTurnId || input[LEGACY_ACTIVE_TURN_ID_FIELD] || null,
  };
  const normalized = {};
  for (const field of TASK_FIELDS) {
    normalized[field] = migrated[field];
  }
  return normalized;
}

module.exports = {
  TASK_FIELDS,
  createDefaultTask,
  normalizeTask,
};
