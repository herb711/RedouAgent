'use strict';

function assertRuntimeAdapter(adapter) {
  for (const method of ['getId', 'getCapabilities', 'startTask', 'resumeTask', 'steerTask', 'interruptTask', 'dispose']) {
    if (!adapter || typeof adapter[method] !== 'function') {
      throw new Error('Runtime adapter missing method: ' + method);
    }
  }
  return adapter;
}

module.exports = { assertRuntimeAdapter };
