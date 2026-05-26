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
const { redouCodexThreadIdFrom } = require('../runtimes/redou-codex/redouCodexSessionStore.cjs');

const CHANNELS = Object.freeze([
  'redou:tasks:list',
  'redou:tasks:get',
  'redou:tasks:create',
  'redou:tasks:update',
  'redou:tasks:archive',
  'redou:tasks:restore',
  'redou:tasks:fork',
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

async function tryRuntimeThreadAction(dependencies, method, input) {
  const adapter = dependencies.redouCodexAdapter;
  if (!adapter || typeof adapter[method] !== 'function') return null;
  try {
    return { ok: true, data: await adapter[method](input) };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: error && error.code ? error.code : 'REDOU_CODEX_THREAD_ACTION_FAILED',
        message: error && error.message ? error.message : String(error),
      },
    };
  }
}

async function archiveTask(payload, dependencies) {
  const taskStore = dependencies.taskStore;
  const id = payload.id || payload.taskId;
  const existing = id ? await taskStore.get(id) : null;
  const threadId = redouCodexThreadIdFrom(existing || payload);
  const runtimeArchive = threadId
    ? await tryRuntimeThreadAction(dependencies, 'archiveThread', { task: existing, threadId })
    : null;
  return updateTask({
    id,
    metadata: {
      archived: true,
      archivedAt: new Date().toISOString(),
      ...(runtimeArchive && !runtimeArchive.ok ? { redouCodexArchiveError: runtimeArchive.error } : {}),
    },
  }, taskStore);
}

async function restoreTask(payload, dependencies) {
  const taskStore = dependencies.taskStore;
  const id = payload.id || payload.taskId;
  const existing = id ? await taskStore.get(id) : null;
  const threadId = redouCodexThreadIdFrom(existing || payload);
  const runtimeUnarchive = threadId
    ? await tryRuntimeThreadAction(dependencies, 'unarchiveThread', { task: existing, threadId })
    : null;
  return updateTask({
    id,
    metadata: {
      archived: false,
      archivedAt: null,
      ...(runtimeUnarchive && !runtimeUnarchive.ok ? { redouCodexUnarchiveError: runtimeUnarchive.error } : {}),
    },
  }, taskStore);
}

async function updateTaskWithRuntimeMetadata(payload, dependencies) {
  const taskStore = dependencies.taskStore;
  const id = payload.id || payload.taskId;
  if (!id) throw new Error('task id is required');
  const existing = await taskStore.get(id);
  const nextTitle = payload.title ? String(payload.title).trim() : '';
  if (existing && nextTitle && nextTitle !== existing.title && redouCodexThreadIdFrom(existing)) {
    await tryRuntimeThreadAction(dependencies, 'setThreadName', {
      task: existing,
      threadId: redouCodexThreadIdFrom(existing),
      name: nextTitle,
    });
  }
  return updateTask(payload, taskStore);
}

function forkedTaskTitle(source, overrideTitle) {
  const title = String(overrideTitle || source.title || source.userInput || '新对话').trim();
  return title || '新对话';
}

async function forkTask(payload, dependencies) {
  const taskStore = dependencies.taskStore;
  const projectStore = dependencies.projectStore;
  const id = payload.id || payload.taskId;
  if (!id) throw new Error('task id is required');
  const source = await taskStore.get(id);
  if (!source) throw new Error(`Task not found: ${id}`);
  const threadId = redouCodexThreadIdFrom(source);
  if (!threadId) throw new Error('This conversation has no Codex thread id yet.');

  const projectId = payload.projectId || source.projectId || null;
  const project = projectId && projectStore && typeof projectStore.get === 'function'
    ? await projectStore.get(projectId)
    : null;
  const cwd = payload.cwd || payload.projectPath || (project && project.rootPath) || null;
  const runtimeFork = await tryRuntimeThreadAction(dependencies, 'forkThread', {
    task: source,
    threadId,
    projectId,
    cwd,
    projectPath: cwd,
    threadSource: payload.threadSource || 'user',
  });
  if (!runtimeFork || !runtimeFork.ok) {
    const message = runtimeFork && runtimeFork.error ? runtimeFork.error.message : 'redou-codex thread forking is unavailable.';
    const error = new Error(message);
    error.code = runtimeFork && runtimeFork.error ? runtimeFork.error.code : 'REDOU_CODEX_FORK_UNAVAILABLE';
    throw error;
  }

  const forkedThreadId = runtimeFork.data.threadId || (runtimeFork.data.thread && runtimeFork.data.thread.id);
  if (!forkedThreadId) throw new Error('redou-codex did not return a forked thread id.');
  const task = await taskStore.save(createDefaultTask({
    projectId,
    title: forkedTaskTitle(source, payload.title),
    status: 'created',
    runtime: source.runtime || REDOU_CODEX_RUNTIME_ID,
    runtimeMode: source.runtimeMode || 'thread',
    redouCodexThreadId: forkedThreadId,
    userInput: source.userInput || '',
    metadata: {
      ...(payload.metadata || {}),
      forkedFromTaskId: source.id,
      forkedFromThreadId: threadId,
      forkedAt: new Date().toISOString(),
      forkMode: payload.mode || 'local',
      thread: runtimeFork.data.thread || null,
    },
  }));
  return { task, thread: runtimeFork.data.thread || null, sourceTaskId: source.id, sourceThreadId: threadId };
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
    if (payload.archivedOnly) return tasks.filter((task) => isArchivedTask(task));
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
  handle(ipcMain, 'redou:tasks:update', async (payload) => updateTaskWithRuntimeMetadata(payload, dependencies));
  handle(ipcMain, 'redou:tasks:archive', async (payload) => archiveTask(payload, dependencies));
  handle(ipcMain, 'redou:tasks:restore', async (payload) => restoreTask(payload, dependencies));
  handle(ipcMain, 'redou:tasks:fork', async (payload) => forkTask(payload, dependencies));
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

module.exports = { CHANNELS, archiveTask, forkTask, registerTaskIpc, restoreTask, updateTask };
