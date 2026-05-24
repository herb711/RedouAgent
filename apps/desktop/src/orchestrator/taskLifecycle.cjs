'use strict';

const { createDefaultTask } = require('../core/models/task.cjs');
const { startRuntimeRun, steerRuntimeRun, interruptRuntimeRun } = require('./runtimeRunOrchestrator.cjs');
const { REDOU_CODEX_RUNTIME_ID } = require('../runtimes/redou-codex/redouCodexRuntimeConfig.cjs');

async function createTask(input = {}, dependencies = {}) {
  if (!dependencies.taskStore) throw new Error('taskStore is required');
  return dependencies.taskStore.save(createDefaultTask({ runtime: REDOU_CODEX_RUNTIME_ID, runtimeMode: 'thread', ...input }));
}

async function startTask(input = {}, dependencies = {}) {
  return startRuntimeRun(input, dependencies);
}

async function steerTask(input = {}, dependencies = {}) {
  return steerRuntimeRun(input, dependencies);
}

async function interruptTask(input = {}, dependencies = {}) {
  return interruptRuntimeRun(input, dependencies);
}

module.exports = { createTask, startTask, steerTask, interruptTask };
