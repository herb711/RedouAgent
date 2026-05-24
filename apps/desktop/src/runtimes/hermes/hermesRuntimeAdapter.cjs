'use strict';

const { createRuntimeCapabilities } = require('../common/runtimeCapabilities.cjs');

function createHermesRuntimeAdapter() {
  return {
    getId() { return 'hermes'; },
    getCapabilities() { return createRuntimeCapabilities({"supportsResume":true}); },
    async startTask(input) { void input; throw new Error('Hermes runtime is scaffold-only in Phase 1'); },
    async resumeTask(input) { void input; throw new Error('Hermes runtime is scaffold-only in Phase 1'); },
    async steerTask(input) { void input; throw new Error('Hermes runtime is scaffold-only in Phase 1'); },
    async interruptTask(input) { void input; throw new Error('Hermes runtime is scaffold-only in Phase 1'); },
    async dispose() {},
  };
}

module.exports = { createHermesRuntimeAdapter };
