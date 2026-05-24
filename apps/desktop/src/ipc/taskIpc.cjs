'use strict';

const {
  steerRuntimeRun,
  interruptRuntimeRun,
} = require('../orchestrator/runtimeRunOrchestrator.cjs');
const {
  enqueueTaskTurn,
  installQueuedTurnDrainer,
  persistUserTurn,
  startRuntimeTurn,
  updateQueuedTaskTurn,
} = require('../orchestrator/taskQueue.cjs');
const { createDefaultTask } = require('../core/models/task.cjs');
const { REDOU_CODEX_RUNTIME_ID } = require('../runtimes/redou-codex/redouCodexRuntimeConfig.cjs');

const CHANNELS = Object.freeze([
  'redou:tasks:list',
  'redou:tasks:get',
  'redou:tasks:create',
  'redou:tasks:update',
  'redou:tasks:archive',
  'redou:tasks:remove',
  'redou:tasks:start',
  'redou:tasks:queue',
  'redou:tasks:queue:update',
  'redou:tasks:steer',
  'redou:tasks:interrupt',
]);

function ok(data, warnings = []) {
  return { ok: true, data, error: null, warnings };
}

function fail(error) {
  return {
    ok: false,
    data: null,
    error: {
      code: error && error.code ? error.code : 'IPC_ERROR',
      message: error && error.message ? error.message : String(error),
      details: error && error.details ? error.details : null,
    },
    warnings: [],
  };
}

function handle(ipcMain, channel, handler) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return ok(await handler(payload || {}));
    } catch (error) {
      return fail(error);
    }
  });
}

function isArchivedTask(task) {
  return Boolean(task && task.metadata && task.metadata.archived);
}

function promptTitle(input) {
  const title = String(input || '').trim().replace(/\s+/g, ' ');
  return title ? title.slice(0, 80) : '新对话';
}

function shouldReplaceBlankTitle(task) {
  const title = String(task && task.title ? task.title : '').trim();
  return !title || title === 'Untitled task' || title === 'New redou-codex task' || title === '新对话';
}

async function updateTask(payload, taskStore) {
  const id = payload.id || payload.taskId;
  if (!id) throw new Error('task id is required');
  const existing = await taskStore.get(id);
  if (!existing) throw new Error(`Task not found: ${id}`);
  return taskStore.save({
    ...existing,
    ...payload,
    id,
    metadata: {
      ...(existing.metadata || {}),
      ...(payload.metadata || {}),
    },
  });
}

async function archiveTask(payload, taskStore) {
  return updateTask({
    id: payload.id || payload.taskId,
    metadata: {
      archived: true,
      archivedAt: new Date().toISOString(),
    },
  }, taskStore);
}

async function saveStartInput(payload, taskStore) {
  if (!payload.taskId || !payload.userInput) return null;
  const existing = await taskStore.get(payload.taskId);
  if (!existing) return null;
  const userInput = String(payload.userInput);
  return taskStore.save({
    ...existing,
    userInput,
    title: shouldReplaceBlankTitle(existing) ? promptTitle(userInput) : existing.title,
  });
}

function registerTaskIpc(ipcMain, dependencies = {}) {
  if (!ipcMain) return CHANNELS;
  const taskStore = dependencies.taskStore;
  if (!dependencies.queuedTurnDrainer) {
    dependencies.queuedTurnDrainer = installQueuedTurnDrainer(dependencies);
  }

  handle(ipcMain, 'redou:tasks:list', async (payload) => {
    const tasks = await taskStore.list(payload);
    return payload.includeArchived ? tasks : tasks.filter((task) => !isArchivedTask(task));
  });
  handle(ipcMain, 'redou:tasks:get', async (payload) => taskStore.get(payload.id));
  handle(ipcMain, 'redou:tasks:create', async (payload) => {
    const projects = payload.projectId || !dependencies.projectStore ? [] : await dependencies.projectStore.list();
    const task = createDefaultTask({
      ...payload,
      projectId: payload.projectId || (projects[0] && projects[0].id) || null,
      runtime: payload.runtime || REDOU_CODEX_RUNTIME_ID,
      runtimeMode: payload.runtimeMode || 'thread',
      title: payload.title || payload.userInput || 'Untitled task',
    });
    return taskStore.save(task);
  });
  handle(ipcMain, 'redou:tasks:update', async (payload) => updateTask(payload, taskStore));
  handle(ipcMain, 'redou:tasks:archive', async (payload) => archiveTask(payload, taskStore));
  handle(ipcMain, 'redou:tasks:remove', async (payload) => {
    const id = payload.id || payload.taskId;
    if (!id) throw new Error('task id is required');
    await taskStore.remove(id);
    return { id, removed: true };
  });
  handle(ipcMain, 'redou:tasks:start', async (payload) => {
    await saveStartInput(payload, taskStore);
    return startRuntimeTurn(payload, dependencies, { deliveryMode: payload.deliveryMode || 'new_turn' });
  });
  handle(ipcMain, 'redou:tasks:queue', async (payload) => enqueueTaskTurn(payload, dependencies));
  handle(ipcMain, 'redou:tasks:queue:update', async (payload) => updateQueuedTaskTurn(payload, dependencies));
  handle(ipcMain, 'redou:tasks:steer', async (payload) => {
    const result = await steerRuntimeRun({ ...payload, deliveryMode: 'guide' }, dependencies);
    if (!result || (result.status !== 'error' && result.status !== 'unavailable')) {
      const task = await taskStore.get(payload.taskId || payload.id);
      if (task) await persistUserTurn(task, payload, dependencies, { deliveryMode: 'guide', status: 'completed' });
    }
    return result;
  });
  handle(ipcMain, 'redou:tasks:interrupt', async (payload) => interruptRuntimeRun(payload, dependencies));

  return CHANNELS;
}

module.exports = { CHANNELS, registerTaskIpc };
