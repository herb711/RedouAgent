'use strict';

const RUNTIME_KINDS = Object.freeze({
  CODEX: 'redou-codex',
  HERMES: 'hermes',
  PI: 'pi',
  CUSTOM: 'custom',
});

const RUNTIME_STATUS = Object.freeze({
  UNKNOWN: 'unknown',
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  RUNNING: 'running',
});

module.exports = { RUNTIME_KINDS, RUNTIME_STATUS };
