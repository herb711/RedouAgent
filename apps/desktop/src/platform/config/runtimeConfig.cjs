'use strict';

function createDefaultRuntimeConfig(overrides = {}) {
  return { redouCodex: {}, hermes: { legacy: true }, pi: {}, custom: {}, ...overrides };
}

module.exports = { createDefaultRuntimeConfig };
