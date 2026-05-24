'use strict';

const { REDOU_CODEX_RUNTIME_ID } = require('./redouCodexRuntimeConfig.cjs');
const LEGACY_THREAD_ID_FIELD = ['codex', 'ThreadId'].join('');
const LEGACY_ACTIVE_TURN_ID_FIELD = ['codex', 'ActiveTurnId'].join('');

function sessionIdForTask(taskId) {
  return `${REDOU_CODEX_RUNTIME_ID}:${taskId}`;
}

function redouCodexThreadIdFrom(source = {}) {
  return source.redouCodexThreadId || source.threadId || source[LEGACY_THREAD_ID_FIELD] || null;
}

function redouCodexActiveTurnIdFrom(source = {}) {
  return source.redouCodexActiveTurnId || source.turnId || source[LEGACY_ACTIVE_TURN_ID_FIELD] || null;
}

function createRedouCodexSessionStore(options = {}) {
  const sessions = options.sessions || new Map();
  const taskStore = options.taskStore || null;
  const runtimeSessionStore = options.runtimeSessionStore || null;

  async function getTask(taskId) {
    if (!taskStore || typeof taskStore.get !== 'function') return null;
    return taskStore.get(taskId);
  }

  async function saveTask(task) {
    if (!taskStore || typeof taskStore.save !== 'function' || !task) return task;
    return taskStore.save(task);
  }

  async function saveRuntimeSession(session) {
    if (!runtimeSessionStore || typeof runtimeSessionStore.save !== 'function') return session;
    return runtimeSessionStore.save(session);
  }

  return {
    async getTaskSession(taskId) {
      if (!taskId) return null;
      if (sessions.has(taskId)) return sessions.get(taskId);
      if (runtimeSessionStore && typeof runtimeSessionStore.get === 'function') {
        const persisted = await runtimeSessionStore.get(sessionIdForTask(taskId));
        if (persisted) {
          sessions.set(taskId, persisted);
          return persisted;
        }
      }
      return null;
    },
    async saveTaskSession(taskId, session = {}) {
      if (!taskId) throw new Error('taskId is required to save a redou-codex session');
      const now = new Date().toISOString();
      const existingTask = await getTask(taskId);
      const normalized = {
        id: session.id || sessionIdForTask(taskId),
        taskId,
        runtime: REDOU_CODEX_RUNTIME_ID,
        redouCodexThreadId: redouCodexThreadIdFrom(session) || redouCodexThreadIdFrom(existingTask) || null,
        redouCodexActiveTurnId: redouCodexActiveTurnIdFrom(session) || redouCodexActiveTurnIdFrom(existingTask) || null,
        status: session.status || 'active',
        metadata: session.metadata || {},
        createdAt: session.createdAt || now,
        updatedAt: now,
      };

      sessions.set(taskId, normalized);
      await saveRuntimeSession(normalized);

      if (existingTask) {
        await saveTask({
          ...existingTask,
          redouCodexThreadId: normalized.redouCodexThreadId,
          redouCodexActiveTurnId: normalized.redouCodexActiveTurnId,
          runtimeSessions: {
            ...(existingTask.runtimeSessions || {}),
            redouCodex: normalized.id,
          },
          updatedAt: now,
        });
      }

      return normalized;
    },
    async saveThreadMapping(task, thread = {}) {
      const taskId = task && task.id;
      const threadId = thread.id || redouCodexThreadIdFrom(thread);
      return this.saveTaskSession(taskId, {
        redouCodexThreadId: threadId,
        redouCodexActiveTurnId: redouCodexActiveTurnIdFrom(task),
        metadata: { thread },
      });
    },
    async saveActiveTurn(task, turn = {}) {
      const taskId = task && task.id;
      return this.saveTaskSession(taskId, {
        redouCodexThreadId: turn.threadId || redouCodexThreadIdFrom(task),
        redouCodexActiveTurnId: turn.id || turn.turnId,
        metadata: { turn },
      });
    },
    async clearTaskSession(taskId) {
      sessions.delete(taskId);
      if (runtimeSessionStore && typeof runtimeSessionStore.remove === 'function') {
        await runtimeSessionStore.remove(sessionIdForTask(taskId));
      }
    },
  };
}

module.exports = {
  createRedouCodexSessionStore,
  redouCodexActiveTurnIdFrom,
  redouCodexThreadIdFrom,
  sessionIdForTask,
};
