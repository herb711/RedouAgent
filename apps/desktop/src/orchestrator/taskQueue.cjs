'use strict';

const { startRuntimeRun, steerRuntimeRun, interruptRuntimeRun } = require('./runtimeRunOrchestrator.cjs');
const { REDOU_CODEX_RUNTIME_ID } = require('../runtimes/redou-codex/redouCodexRuntimeConfig.cjs');
const { buildRedouCodexStateSnapshot } = require('../redou-codex/app-compat/state/redouCodexStateSnapshot.cjs');

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

function pathFromRenderedContext(value) {
  const text = String(value || '').trim();
  const firstLine = text.split(/\r?\n/, 1)[0] || text;
  const match = /^(?:File|Directory|Path):\s*(.+)$/i.exec(firstLine);
  return match ? match[1].trim() : firstLine;
}

function normalizeContextItem(path, kind = 'file') {
  const itemPath = String(path || '').trim();
  if (!itemPath) return null;
  const normalizedKind = kind === 'image' || kind === 'directory' ? kind : 'file';
  return {
    path: itemPath,
    name: itemPath.split(/[\\/]/).filter(Boolean).pop() || itemPath,
    kind: normalizedKind,
  };
}

function uniqueContextItems(items = []) {
  const byKey = new Map();
  for (const item of items) {
    const normalized = normalizeContextItem(item && item.path, item && item.kind);
    if (normalized) byKey.set(`${normalized.kind}:${normalized.path}`, normalized);
  }
  return Array.from(byKey.values());
}

function contextItemsFromInput(input = {}) {
  const contextPackage = input.contextPackage || {};
  const metadata = contextPackage.metadata || {};
  if (Array.isArray(metadata.contextItems) && metadata.contextItems.length) {
    return uniqueContextItems(metadata.contextItems);
  }

  const selectedFiles = Array.isArray(metadata.selectedFiles)
    ? metadata.selectedFiles
    : (Array.isArray(contextPackage.selectedFiles) ? contextPackage.selectedFiles.map(pathFromRenderedContext) : []);
  const selectedDirectories = Array.isArray(metadata.selectedDirectories) ? metadata.selectedDirectories : [];
  const attachments = Array.isArray(metadata.attachments)
    ? metadata.attachments
    : (Array.isArray(contextPackage.attachments) ? contextPackage.attachments : []);

  return uniqueContextItems([
    ...selectedFiles.map((path) => ({ path, kind: 'file' })),
    ...selectedDirectories.map((path) => ({ path, kind: 'directory' })),
    ...attachments.map((path) => ({ path, kind: 'image' })),
  ]);
}

async function persistUserTurn(task, input = {}, dependencies = {}, overrides = {}) {
  const payload = userTurnPayload(input, overrides);
  if (!payload.userInput) return null;
  const queueId = payload.queuedTurnId || (payload.deliveryMode === 'queue' ? payload.id : null);
  const contextItems = contextItemsFromInput(input);
  const automation = input.automation || (input.metadata && input.metadata.automation) || null;
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
        contextItems,
        queuedTurnId: payload.queuedTurnId,
        queuedAt: payload.queuedAt,
        consumedAt: payload.consumedAt,
      },
      contextItems,
      contextPackage: input.contextPackage || null,
      automation,
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
    payload: { ...payload, contextItems },
    metadata: {
      deliveryMode: payload.deliveryMode,
      queuedTurnId: payload.queuedTurnId,
      queueId,
      contextItems,
      inputEnvelope: message.metadata.inputEnvelope,
      automation,
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
    permissionMode: input.permissionMode || null,
    permissionPolicy: input.permissionPolicy || null,
    modelSelection: input.modelSelection || null,
    reasoningEffort: input.reasoningEffort || null,
    contextPackage: input.contextPackage || null,
    automation: input.automation || null,
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
  await recoverStaleApprovalBlock(task, input, dependencies);
  await persistUserTurn(task, input, dependencies, overrides);
  const runner = dependencies.startRuntimeRun || startRuntimeRun;
  const result = await runner(input, dependencies);
  const automation = input.automation || (input.metadata && input.metadata.automation) || null;
  const turnId = result && (result.activeTurnId || result.turnId);
  if (automation && turnId) {
    await emitRuntimeEvent(dependencies, {
      taskId: task.id,
      projectId: task.projectId || input.projectId || null,
      runtime: task.runtime || REDOU_CODEX_RUNTIME_ID,
      type: 'automation_run_dispatched',
      level: 'info',
      title: 'Automation dispatched',
      message: automation.title || 'Automation',
      payload: {
        automationId: automation.id || null,
        automationTitle: automation.title || null,
        automationRunId: automation.runId || null,
        triggeredAt: automation.triggeredAt || null,
        turnId,
      },
      metadata: {
        automation,
        automationId: automation.id || null,
        automationRunId: automation.runId || null,
        turnId,
      },
    });
  }
  return result;
}

function isRuntimeFailure(result) {
  const status = String(result && result.status ? result.status : '').toLowerCase();
  return status === 'error' || status === 'unavailable' || status === 'failed';
}

function isStaleApprovalBlockedState(state = {}) {
  return state && state.stopReason && state.stopReason.code === 'approval_request_expired';
}

async function runtimeStateForTask(task = {}, dependencies = {}) {
  if (!task.id || (task.runtime && task.runtime !== REDOU_CODEX_RUNTIME_ID)) return null;
  const eventStore = dependencies.eventStore;
  if (!eventStore || typeof eventStore.list !== 'function') return null;
  try {
    const events = await eventStore.list({ taskId: task.id });
    return buildRedouCodexStateSnapshot(events);
  } catch (error) {
    await emitRuntimeEvent(dependencies, {
      taskId: task.id,
      projectId: task.projectId || null,
      runtime: task.runtime || REDOU_CODEX_RUNTIME_ID,
      type: 'runtime_warning',
      level: 'warn',
      title: 'Runtime state unavailable',
      message: error && error.message ? error.message : String(error),
      payload: { source: 'runtimeStateForTask' },
    });
    return null;
  }
}

async function recoverStaleApprovalBlock(task = {}, input = {}, dependencies = {}) {
  const state = await runtimeStateForTask(task, dependencies);
  if (!isStaleApprovalBlockedState(state)) return { stale: false, state };
  const interrupt = dependencies.interruptRuntimeRun || interruptRuntimeRun;
  try {
    await interrupt({
      ...input,
      id: task.id,
      taskId: task.id,
      task,
      threadId: input.threadId || task.redouCodexThreadId || null,
      turnId: input.turnId || state.turnId || task.redouCodexActiveTurnId || null,
    }, dependencies);
    return { stale: true, interrupted: true, state };
  } catch (error) {
    await emitRuntimeEvent(dependencies, {
      taskId: task.id,
      projectId: task.projectId || null,
      runtime: task.runtime || REDOU_CODEX_RUNTIME_ID,
      type: 'runtime_warning',
      level: 'warn',
      title: 'Stale approval recovery failed',
      message: error && error.message ? error.message : String(error),
      payload: {
        source: 'recoverStaleApprovalBlock',
        stopReason: state.stopReason || null,
      },
    });
    return { stale: true, interrupted: false, state, error };
  }
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
      contextPackage: queued.contextPackage,
      automation: queued.automation || null,
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

  const runtimeState = await runtimeStateForTask(task, dependencies);
  if (isStaleApprovalBlockedState(runtimeState)) {
    const saved = await saveTask(task, dependencies, {
      status: 'running',
      metadata: {
        ...queueMetadata(task, remaining),
        lastQueuedTurnStartedAt: nowIso(),
        lastQueuedTurnId: queued.id,
      },
    });
    await emitQueueUpdate(saved, dependencies, 'Queued message started after stale approval recovery.', {
      queueId,
      queueState: 'started',
      recoveredFrom: 'approval_request_expired',
    });
    const result = await startRuntimeTurn({
      taskId,
      userMessageId: queueId,
      userInput: queued.userInput,
      permissionMode: queued.permissionMode,
      permissionPolicy: queued.permissionPolicy,
      modelSelection: queued.modelSelection,
      reasoningEffort: queued.reasoningEffort,
      contextPackage: queued.contextPackage,
      automation: queued.automation || null,
      deliveryMode: 'queue',
      queuedTurnId: queueId,
      queuedAt: queued.queuedAt,
    }, dependencies, {
      deliveryMode: 'queue',
      queuedTurnId: queueId,
      queuedAt: queued.queuedAt,
    });
    return { ok: !isRuntimeFailure(result), started: true, queueDepth: queueDepthFor(saved), queueId, result };
  }

  const steer = dependencies.steerRuntimeRun || steerRuntimeRun;
  const result = await steer({
    taskId,
    userInput: queued.userInput,
    permissionMode: queued.permissionMode,
    permissionPolicy: queued.permissionPolicy,
    modelSelection: queued.modelSelection,
    reasoningEffort: queued.reasoningEffort,
    contextPackage: queued.contextPackage,
    automation: queued.automation || null,
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
    contextPackage: queued.contextPackage,
    automation: queued.automation || null,
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
    permissionMode: next.permissionMode,
    permissionPolicy: next.permissionPolicy,
    modelSelection: next.modelSelection,
    reasoningEffort: next.reasoningEffort,
    contextPackage: next.contextPackage,
    automation: next.automation || null,
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
