'use strict';

// Basic artifact field definition. Keep this file limited to defaults and normalization.
const ARTIFACT_FIELDS = Object.freeze(['id', 'taskId', 'projectId', 'type', 'name', 'path', 'mimeType', 'size', 'createdAt', 'metadata']);

function nowIso() {
  return new Date().toISOString();
}

function createDefaultArtifact(overrides = {}) {
  const base = {
    id: null,
    taskId: null,
    projectId: null,
    type: 'file',
    name: '',
    path: null,
    mimeType: null,
    size: 0,
    createdAt: nowIso(),
    metadata: {},
  };
  return normalizeArtifact({ ...base, ...overrides });
}

function normalizeArtifact(input = {}) {
  const normalized = {};
  for (const field of ARTIFACT_FIELDS) {
    normalized[field] = input[field];
  }
  return normalized;
}

module.exports = {
  ARTIFACT_FIELDS,
  createDefaultArtifact,
  normalizeArtifact,
};
