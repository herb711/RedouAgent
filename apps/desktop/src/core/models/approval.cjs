'use strict';

const { REDOU_CODEX_RUNTIME_ID } = require('../../runtimes/redou-codex/redouCodexRuntimeConfig.cjs');

// Basic approvalRequest field definition. Keep this file limited to defaults and normalization.
const APPROVALREQUEST_FIELDS = Object.freeze(['id', 'taskId', 'runtime', 'kind', 'title', 'description', 'command', 'filePath', 'riskLevel', 'options', 'status', 'createdAt', 'resolvedAt']);

function nowIso() {
  return new Date().toISOString();
}

function createDefaultApprovalRequest(overrides = {}) {
  const base = {
    id: null,
    taskId: null,
    runtime: REDOU_CODEX_RUNTIME_ID,
    kind: 'unknown',
    title: '',
    description: '',
    command: null,
    filePath: null,
    riskLevel: 'unknown',
    options: [],
    status: 'pending',
    createdAt: nowIso(),
    resolvedAt: null,
  };
  return normalizeApprovalRequest({ ...base, ...overrides });
}

function normalizeApprovalRequest(input = {}) {
  const normalized = {};
  for (const field of APPROVALREQUEST_FIELDS) {
    normalized[field] = input[field];
  }
  return normalized;
}

module.exports = {
  APPROVALREQUEST_FIELDS,
  createDefaultApprovalRequest,
  normalizeApprovalRequest,
};
