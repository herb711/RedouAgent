'use strict';

const { startRuntimeRun, steerRuntimeRun } = require('./runtimeRunOrchestrator.cjs');
const { REDOU_CODEX_RUNTIME_ID } = require('../runtimes/redou-codex/redouCodexRuntimeConfig.cjs');

const TERMINAL_TURN_STATUSES = new Set(['completed', 'failed', 'cancelled', 'canceled', 'interrupted', 'error']);

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function cleanInput(value) {
  return String(value || '').trim();
}

function queuedTurnsFrom(task = {}) {
  const queuedTurns = task.metadata && Array.isArray(task.metadata.queuedTurns)
    ? task.metadata.queuedTurns
    : [];
  return queuedTurns.filter((item) => item && item.status !== 'cancelled' && item.status !== 'completed');
}

function queueDepthFor(task = {}) {
  return queuedTurnsFrom(task).filter((item) => item.status === 'pending').length;
}

function queueMetadata(task = {}, queuedTurns = []) {
  const pending = queuedTurns.filter((item) => item && item.status === 'pending');
  return {
    ...(task.metadata || {}),
    queuedTurns: pending,
    queueDepth: pending.length,
  };
}

async function emitRuntimeEvent(dependencies = {}, event = {}) {
  const sink = dependencies.eventSink || dependencies.ingestRuntimeEvent;
  if (!sink) return event;
  if (typeof sink === 'function') return sink(event);
  if (typeof sink.ingestRuntimeEvent === 'function') return sink.ingestRuntimeEvent(event);
  if (typeof sink.ingest === 'function') return sink.ingest(event);
  return event;
}

async function saveMessage(dependencies = {}, message = {}) {
  const store = dependencies.messageStore;
  if (!store || typeof store.save !== 'function') return null;
  return store.save(message);
}

async function saveTask(task, dependencies = {}, extra = {}) {
  const store = dependencies.taskStore;
  if (!store || typeof store.save !== 'function') return { ...task, ...extra };
  return store.save({
    ...task,
    ...extra,
    metadata: {
      ...(task.metadata || {}),
      ...(extra.metadata || {}),
    },
  });
}

function userTurnPayload(input = {}, overrides = {}) {
  const status = overrides.status || input.status || 'consumed';
  return {
    id: overrides.id || input.userMessageId || randomId('user-message'),
    userInput: cleanInput(input.userInput),
    deliveryMode: overrides.deliveryMode || input.deliveryMode || 'new_turn',
    status,
    queuedTurnId: overrides.queuedTurnId || input.queuedTurnId || null,
    queuedAt: overrides.queuedAt || input.queuedAt || null,
    consumedAt: overrides.consumedAt !== undefined ? overrides.consumedAt : (status === 'pending' ? null : nowIso()),
  };
}

async function persistUserTurn(task, input = {}, dependencies = {}, overrides = {}) {
  const payload = userTurnPayload(input, overrides);
  if (!payload.userInput) return null;
  const queueId = payload.queuedTurnId || (payload.deliveryMode === 'queue' ? payload.id : null);
  const message = {
    id: payload.id,
    taskId: task.id,
    projectId: task.projectId || input.projectId || null,
    role: 'user',
    content: payload.userInput,
    metadata: {
      deliveryMode: payload.deliveryMode,
      queuedTurnId: payload.queuedTurnId,
      queueId,
      inputEnvelope: {
        id: payload.id,
        text: payload.userInput,
        deliveryMode: payload.deliveryMode,
        status: payload.status,
        queuedTurnId: payload.queuedTurnId,
        queuedAt: payload.queuedAt,
        consumedAt: payload.consumedAt,
      },
    },
  };
  await saveMessage(dependencies, message);
  await emitRuntimeEvent(dependencies, {
    id: `event:${payload.id}`,
    taskId: task.id,
    projectId: task.projectId || input.projectId || null,
    runtime: task.runtime || REDOU_CODEX_RUNTIME_ID,
    type: 'user_message',
    level: 'info',
    title: payload.deliveryMode === 'guide' ? 'Guidance' : 'User message',
    message: payload.userInput,
    payload,
    metadata: {
      deliveryMode: payload.deliveryMode,
      queuedTurnId: payload.queuedTurnId,
      queueId,
      inputEnvelope: message.metadata.inputEnvelope,
    },
  });
  return message;
}

async function emitQueueUpdate(task, dependencies = {}, message, payload = {}) {
  const queuedTurns = queuedTurnsFrom(task);
  return emitRuntimeEvent(dependencies, {
    taskId: task.id,
    projectId: task.projectId || null,
    runtime: task.runtime || REDOU_CODEX_RUNTIME_ID,
    type: 'queue_update',
    level: 'info',
    title: 'Queue update',
    message,
    payload: {
      taskId: task.id,
      queueDepth: queuedTurns.filter((item) => item.status === 'pending').length,
      ...payload,
    },
    metadata: {
      queueDepth: queuedTurns.filter((item) => item.status === 'pending').length,
      ...payload,
    },
  });
}

async function enqueueTaskTurn(input = {}, dependencies = {}) {
  const taskId = cleanInput(input.taskId || input.id);
  const userInput = cleanInput(input.userInput);
  if (!taskId) throw new Error('taskId is required to queue a turn');
  if (!userInput) throw new Error('Message is empty');
  const task = await dependencies.taskStore.get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const queuedAt = nowIso();
  const item = {
    id: input.queueId || randomId('queued-turn'),
    userInput,
    queuedAt,
    status: 'pending',
    permissionPolicy: input.permissionPolicy || null,
    modelSelection: input.modelSelection || null,
    reasoningEffort: input.reasoningEffort || null,
    contextPackage: input.contextPackage || null,
  };
  const queuedTurns = [...queuedTurnsFrom(task), item];
  const saved = await saveTask(task, dependencies, {
    metadata: queueMetadata(task, queuedTurns),
  });
  await persistUserTurn(task, {
    ...input,
    userInput,
  }, dependencies, {
    id: item.id,
    deliveryMode: 'queue',
    queuedTurnId: item.id,
    queuedAt,
    consumedAt: null,
    status: 'pending',
  });
  await emitQueueUpdate(saved, dependencies, 'Message queued for the next turn.', {
    queueId: item.id,
    queueState: 'queued',
  });
  return {
    ok: true,
    queued: true,
    queueId: item.id,
    queueDepth: queueDepthFor(saved),
  };
}

async function startRuntimeTurn(input = {}, dependencies = {}, overrides = {}) {
  const taskId = cleanInput(input.taskId || input.id);
  if (!taskId) throw new Error('taskId is required to start a turn');
  const task = await dependencies.taskStore.get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  await persistUserTurn(task, input, dependencies, overrides);
  const runner = dependencies.startRuntimeRun || startRuntimeRun;
  return runner(input, dependencies);
}

function isRuntimeFailure(result) {
  const status = String(result && result.status ? result.status : '').toLowerCase();
  return status === 'error' || status === 'unavailable' || status === 'failed';
}

async function updateQueuedTaskTurn(input = {}, dependencies = {}) {
  const taskId = cleanInput(input.taskId || input.id);
  const queueId = cleanInput(input.queueId || input.queuedTurnId);
  const action = cleanInput(input.action).toLowerCase();
  if (!taskId) throw new Error('taskId is required to update a queued turn');
  if (!queueId) throw new Error('queueId is required to update a queued turn');
  if (action !== 'delete' && action !== 'guide') {
    throw new Error('Queued turn action must be delete or guide');
  }
  const task = await dependencies.taskStore.get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const queuedTurns = queuedTurnsFrom(task);
  const queued = queuedTurns.find((item) => item.id === queueId) || null;
  if (!queued) {
    return {
      ok: false,
      message: 'Queued message was not found. It may have already started.',
      queueDepth: queueDepthFor(task),
    };
  }

  const remaining = queuedTurns.filter((item) => item.id !== queueId);

  if (action === 'delete') {
    const saved = await saveTask(task, dependencies, {
      metadata: queueMetadata(task, remaining),
    });
    await persistUserTurn(task, {
      ...input,
      userInput: queued.userInput,
    }, dependencies, {
      id: queueId,
      deliveryMode: 'queue',
      queuedTurnId: queueId,
      queuedAt: queued.queuedAt,
      consumedAt: null,
      status: 'cancelled',
    });
    await emitQueueUpdate(saved, dependencies, 'Queued message deleted.', {
      queueId,
      queueState: 'deleted',
    });
    return { ok: true, deleted: true, queueDepth: queueDepthFor(saved), queueId };
  }

  const steer = dependencies.steerRuntimeRun || steerRuntimeRun;
  const result = await steer({
    taskId,
    userInput: queued.userInput,
    permissionPolicy: queued.permissionPolicy,
    modelSelection: queued.modelSelection,
    reasoningEffort: queued.reasoningEffort,
    contextPackage: queued.contextPackage,
    deliveryMode: 'guide',
  }, dependencies);
  if (isRuntimeFailure(result)) {
    await emitQueueUpdate(task, dependencies, 'Queued message could not be inserted into the active run.', {
      queueId,
      queueState: 'queued',
      warning: result && (result.error || result.message),
    });
    return {
      ok: false,
      message: (result && (result.error || result.message)) || 'Queued message could not be inserted into the active run.',
      queueDepth: queueDepthFor(task),
      queueId,
      result,
    };
  }

  const saved = await saveTask(task, dependencies, {
    metadata: queueMetadata(task, remaining),
  });
  await persistUserTurn(task, {
    ...input,
    userInput: queued.userInput,
  }, dependencies, {
    id: queueId,
    deliveryMode: 'guide',
    queuedTurnId: queueId,
    queuedAt: queued.queuedAt,
    status: 'completed',
  });
  await emitQueueUpdate(saved, dependencies, 'Queued message inserted into the active run.', {
    queueId,
    queueState: 'guided',
    guided: true,
  });
  return { ok: true, guided: true, queueDepth: queueDepthFor(saved), queueId, result };
}

function terminalStatusFromEvent(event = {}) {
  const turn = event.payload && event.payload.turn ? event.payload.turn : {};
  const status = cleanInput(turn.status || event.payload?.status || event.message).toLowerCase();
  return TERMINAL_TURN_STATUSES.has(status) ? status : null;
}

function isTerminalTurnEvent(event = {}) {
  const compatibilityStatus = event.metadata?.redouCodexStopStatus
    || event.payload?.compatibility?.status
    || event.payload?.stopReason?.status;
  if (compatibilityStatus === 'incomplete' || compatibilityStatus === 'waiting_approval') return false;
  const method = event.metadata && event.metadata.redouCodexMethod;
  if (method === 'turn/completed') return true;
  return Boolean(event.type === 'turn_update' && terminalStatusFromEvent(event));
}

async function drainNextQueuedTurn(taskId, dependencies = {}, options = {}) {
  if (!taskId || !dependencies.taskStore) return { started: false, queueDepth: 0 };
  const task = await dependencies.taskStore.get(taskId);
  if (!task) return { started: false, queueDepth: 0 };
  const queuedTurns = queuedTurnsFrom(task);
  const next = queuedTurns.find((item) => item.status === 'pending') || null;
  const remaining = queuedTurns.filter((item) => item !== next);

  if (!next) {
    const status = options.status && options.status !== 'completed' ? 'error' : 'completed';
    const saved = await saveTask(task, dependencies, {
      status,
      redouCodexActiveTurnId: null,
      metadata: {
        ...queueMetadata(task, []),
        lastTurnCompletedAt: nowIso(),
        lastTurnStatus: options.status || 'completed',
      },
    });
    return { started: false, queueDepth: queueDepthFor(saved), status: saved.status };
  }

  const saved = await saveTask(task, dependencies, {
    status: 'running',
    metadata: {
      ...queueMetadata(task, remaining),
      lastQueuedTurnStartedAt: nowIso(),
      lastQueuedTurnId: next.id,
    },
  });
  await emitQueueUpdate(saved, dependencies, 'Queued message started.', {
    queueId: next.id,
    queueState: 'started',
  });
  await startRuntimeTurn({
    taskId,
    userMessageId: next.id,
    userInput: next.userInput,
    permissionPolicy: next.permissionPolicy,
    modelSelection: next.modelSelection,
    reasoningEffort: next.reasoningEffort,
    contextPackage: next.contextPackage,
    deliveryMode: 'queue',
    queuedTurnId: next.id,
    queuedAt: next.queuedAt,
  }, dependencies, {
    deliveryMode: 'queue',
    queuedTurnId: next.id,
    queuedAt: next.queuedAt,
  });
  return { started: true, queueDepth: queueDepthFor(saved), queueId: next.id };
}

function installQueuedTurnDrainer(dependencies = {}) {
  const eventSink = dependencies.eventSink;
  if (!eventSink || typeof eventSink.subscribe !== 'function') return () => {};
  const draining = new Set();
  return eventSink.subscribe((event) => {
    if (!isTerminalTurnEvent(event) || !event.taskId || draining.has(event.taskId)) return;
    draining.add(event.taskId);
    drainNextQueuedTurn(event.taskId, dependencies, { status: terminalStatusFromEvent(event) || 'completed' })
      .catch((error) => emitRuntimeEvent(dependencies, {
        taskId: event.taskId,
        projectId: event.projectId || null,
        runtime: event.runtime || REDOU_CODEX_RUNTIME_ID,
        type: 'runtime_error',
        level: 'error',
        title: 'Queue failed',
        message: error && error.message ? error.message : String(error),
        payload: { sourceEventId: event.id },
      }).catch(() => {}))
      .finally(() => draining.delete(event.taskId));
  });
}

module.exports = {
  drainNextQueuedTurn,
  enqueueTaskTurn,
  installQueuedTurnDrainer,
  isTerminalTurnEvent,
  persistUserTurn,
  queueDepthFor,
  startRuntimeTurn,
  updateQueuedTaskTurn,
};
