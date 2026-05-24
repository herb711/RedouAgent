'use strict';

const { createRedouCodexCapabilities } = require('./redouCodexAvailability.cjs');
const { checkRedouCodexAvailability } = require('./redouCodexAvailability.cjs');
const { createRedouCodexLifecycle } = require('./redouCodexLifecycle.cjs');
const { REDOU_CODEX_RUNTIME_ID } = require('./redouCodexRuntimeConfig.cjs');

function createRedouCodexRuntimeAdapter(dependencies = {}) {
  let lifecycle = dependencies.lifecycle || null;

  function getLifecycle() {
    if (!lifecycle) lifecycle = createRedouCodexLifecycle(dependencies);
    return lifecycle;
  }

  return {
    getId() {
      return REDOU_CODEX_RUNTIME_ID;
    },
    getCapabilities() {
      return createRedouCodexCapabilities();
    },
    getAvailability() {
      const checker = dependencies.checkAvailability || checkRedouCodexAvailability;
      return checker(dependencies.clientOptions || dependencies.redouCodex || {});
    },
    startTask(input) {
      return getLifecycle().startTask(input);
    },
    resumeTask(input) {
      return getLifecycle().resumeTask(input);
    },
    steerTask(input) {
      return getLifecycle().steerTask(input);
    },
    interruptTask(input) {
      return getLifecycle().interruptTask(input);
    },
    respondApproval(input) {
      const activeLifecycle = getLifecycle();
      if (typeof activeLifecycle.respondApproval !== 'function') {
        throw new Error('redou-codex lifecycle does not support approval responses');
      }
      return activeLifecycle.respondApproval(input);
    },
    dispose() {
      return lifecycle && typeof lifecycle.dispose === 'function'
        ? lifecycle.dispose()
        : Promise.resolve();
    },
  };
}

module.exports = { createRedouCodexRuntimeAdapter };
