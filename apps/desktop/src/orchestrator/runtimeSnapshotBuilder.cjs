'use strict';

const { REDOU_CODEX_RUNTIME_ID } = require('../runtimes/redou-codex/redouCodexRuntimeConfig.cjs');

const NON_PROGRESS_ITEM_TYPES = new Set(['userMessage', 'agentMessage']);
const TERMINAL_ERROR_STATUSES = new Set(['failed', 'error', 'cancelled', 'canceled']);
const TERMINAL_ITEM_STATUSES = new Set(['completed', 'failed', 'error', 'cancelled', 'canceled']);

function textFromMessageEvent(event) {
  if (event.type === 'message_delta') return event.message || (event.payload && event.payload.delta) || '';
  if (event.type === 'message_completed') return event.message || (event.payload && event.payload.item && event.payload.item.text) || '';
  return '';
}

function planEntriesFrom(event) {
  const plan = event.payload && Array.isArray(event.payload.plan) ? event.payload.plan : [];
  return plan.map((entry, index) => ({
    id: `${event.payload.turnId || event.id}:plan:${index}`,
    title: entry.step,
    step: entry.step,
    status: entry.status,
    explanation: event.payload.explanation || null,
    turnId: event.payload.turnId || null,
    sourceEventId: event.id,
  }));
}

function itemFromEvent(event) {
  return event.payload && event.payload.item ? event.payload.item : {};
}

function itemTypeFromEvent(event) {
  const item = itemFromEvent(event);
  return item.type || (event.metadata && event.metadata.itemKind) || '';
}

function itemStatusFromEvent(event) {
  const item = itemFromEvent(event);
  return event.payload && event.payload.lifecycle ? event.payload.lifecycle : item.status || 'updated';
}

function itemTitleFromEvent(event) {
  const item = itemFromEvent(event);
  return item.title || item.command || item.type || event.message || event.title;
}

function isProgressItemEvent(event) {
  const itemType = itemTypeFromEvent(event);
  return Boolean(itemType && !NON_PROGRESS_ITEM_TYPES.has(itemType));
}

function latestItemEntries(itemEvents) {
  const entries = new Map();
  const order = [];
  for (const event of itemEvents) {
    if (!isProgressItemEvent(event)) continue;
    const item = itemFromEvent(event);
    const id = item.id || event.id;
    if (!entries.has(id)) order.push(id);
    entries.set(id, {
      id,
      title: itemTitleFromEvent(event),
      status: itemStatusFromEvent(event),
      source: 'redou_codex_item',
      lifecycle: event.payload && event.payload.lifecycle ? event.payload.lifecycle : null,
      sourceEventId: event.id,
    });
  }
  return order.map((id) => entries.get(id));
}

function buildTodoProjection(planEntries, itemEvents) {
  const itemEntries = latestItemEntries(itemEvents);
  const planProjection = planEntries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    status: entry.status,
    source: 'redou_codex_plan',
    lifecycle: null,
  }));
  if (!planProjection.length) return [];
  const plannedIds = new Set(planProjection.map((entry) => entry.id));
  return [
    ...planProjection,
    ...itemEntries.filter((entry) => !plannedIds.has(entry.id)),
  ];
}

function changedFilesFrom(event) {
  const payload = event.payload || {};
  const item = payload.item || {};
  const changes = payload.changes || item.changes || [];
  return changes.map((change, index) => ({
    id: `${event.id}:file:${index}`,
    path: change.path,
    status: item.status || 'updated',
    diff: change.diff,
    kind: change.kind,
    sourceEventId: event.id,
  }));
}

function latest(events, type) {
  return [...events].reverse().find((event) => event.type === type) || null;
}

function eventTurnId(event) {
  if (!event) return null;
  return (event.metadata && event.metadata.turnId)
    || (event.payload && event.payload.turnId)
    || (event.payload && event.payload.turn && event.payload.turn.id)
    || null;
}

function userMessageIdFrom(event = {}) {
  const payload = event.payload || {};
  const metadata = event.metadata || {};
  return payload.id || metadata.queueId || metadata.queuedTurnId || event.id;
}

function queueIdFrom(event = {}) {
  const payload = event.payload || {};
  const metadata = event.metadata || {};
  return metadata.queueId || metadata.queuedTurnId || payload.queuedTurnId || null;
}

function scopedItemEvents(itemEvents, turnId) {
  if (!turnId) return itemEvents;
  return itemEvents.filter((event) => eventTurnId(event) === turnId);
}

function progressStepsFrom(planEntries, itemEvents) {
  const planSteps = planEntries.map((entry) => ({ id: entry.id, label: entry.title, status: entry.status }));
  const planIds = new Set(planSteps.map((step) => step.id));
  const itemSteps = latestItemEntries(itemEvents)
    .map((entry) => ({
      id: entry.id,
      label: entry.title,
      status: entry.status,
    }))
    .filter((step) => !planIds.has(step.id));
  return [...planSteps, ...itemSteps];
}

function activeItemFrom(itemEvents) {
  const items = latestItemEntries(itemEvents);
  return items.find((entry) => !TERMINAL_ITEM_STATUSES.has(String(entry.status || '').toLowerCase()))
    || items[items.length - 1]
    || null;
}

function parseErrorText(value) {
  if (!value) return '';
  if (typeof value !== 'string') {
    if (value.message) return parseErrorText(value.message);
    if (value.error) return parseErrorText(value.error);
    return String(value);
  }
  const text = value.trim();
  if (!text) return '';
  if (!text.startsWith('{') && !text.startsWith('[')) return text;
  try {
    const parsed = JSON.parse(text);
    return parseErrorText(
      (parsed.error && (parsed.error.message || parsed.error))
        || parsed.message
        || parsed.detail
        || text,
    );
  } catch {
    return text;
  }
}

function turnErrorFrom(event) {
  if (!event || event.type !== 'turn_update') return null;
  const turn = event.payload && event.payload.turn ? event.payload.turn : {};
  const status = String(turn.status || event.payload?.status || event.message || '').toLowerCase();
  const errorText = parseErrorText(turn.error || event.payload?.error);
  if (!errorText && !TERMINAL_ERROR_STATUSES.has(status)) return null;
  const message = errorText || `Turn ${status || 'failed'}`;
  return {
    id: `${event.id}:turn-error`,
    sourceEventId: event.id,
    turnId: turn.id || event.metadata?.turnId || null,
    type: 'turn_error',
    level: 'error',
    timestamp: event.timestamp,
    title: 'Turn failed',
    message: `Turn failed: ${message}`,
    payload: event.payload,
    metadata: event.metadata || {},
  };
}

function isAfter(left, right) {
  if (!left) return false;
  if (!right) return true;
  return String(left.timestamp || '').localeCompare(String(right.timestamp || '')) > 0;
}

function buildRuntimeSnapshot(events = []) {
  const ordered = [...events].sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
  const messageBuffers = new Map();
  const messages = [];
  let latestPlan = [];
  const itemEvents = [];
  const changedFiles = [];
  const approvalRequests = [];
  const logs = [];
  const artifacts = [];
  const userMessageIndexes = new Map();
  const hiddenUserMessages = new Set();
  const turnErrorMessageIndexes = new Map();
  const turnErrorLogIndexes = new Map();
  const upsertUserMessage = (event) => {
    const messageId = userMessageIdFrom(event);
    const activeQueueId = queueIdFrom(event);
    if (hiddenUserMessages.has(messageId) || (activeQueueId && hiddenUserMessages.has(activeQueueId))) return;
    const payload = event.payload || {};
    const metadata = event.metadata || {};
    const message = {
      id: messageId,
      role: 'user',
      body: event.message || payload.userInput || '',
      deliveryMode: metadata.deliveryMode || null,
      status: payload.status || null,
      queueId: activeQueueId,
      queueState: metadata.queueState || null,
      sourceEventId: event.id,
      turnId: metadata.turnId || null,
    };
    if (userMessageIndexes.has(messageId)) {
      messages[userMessageIndexes.get(messageId)] = message;
    } else {
      userMessageIndexes.set(messageId, messages.length);
      messages.push(message);
    }
  };
  const hideUserMessage = (messageId) => {
    if (!messageId) return;
    hiddenUserMessages.add(messageId);
    const index = userMessageIndexes.get(messageId);
    if (index !== undefined) messages[index] = null;
  };
  const upsertTurnError = (turnError) => {
    const key = turnError.turnId || turnError.sourceEventId;
    const message = {
      id: `${turnError.id}:message`,
      role: 'system',
      body: turnError.message,
      status: 'error',
      sourceEventId: turnError.sourceEventId,
      turnId: turnError.turnId,
    };
    const log = {
      id: turnError.id,
      level: 'error',
      message: turnError.message,
      time: turnError.timestamp,
      payload: turnError.payload,
    };

    if (turnErrorMessageIndexes.has(key)) {
      messages[turnErrorMessageIndexes.get(key)] = message;
    } else {
      turnErrorMessageIndexes.set(key, messages.length);
      messages.push(message);
    }
    if (turnErrorLogIndexes.has(key)) {
      logs[turnErrorLogIndexes.get(key)] = log;
    } else {
      turnErrorLogIndexes.set(key, logs.length);
      logs.push(log);
    }
  };

  for (const event of ordered) {
    if (event.type === 'user_message') {
      upsertUserMessage(event);
    } else if (event.type === 'message_delta') {
      const itemId = event.metadata && event.metadata.itemId ? event.metadata.itemId : 'assistant';
      messageBuffers.set(itemId, (messageBuffers.get(itemId) || '') + textFromMessageEvent(event));
    } else if (event.type === 'message_completed') {
      const itemId = event.metadata && event.metadata.itemId ? event.metadata.itemId : event.id;
      const text = textFromMessageEvent(event) || messageBuffers.get(itemId) || '';
      if (text.trim()) messages.push({ id: itemId, role: 'assistant', body: text, sourceEventId: event.id, turnId: eventTurnId(event) });
      messageBuffers.delete(itemId);
    } else if (event.type === 'plan_update') {
      latestPlan = planEntriesFrom(event);
    } else if (event.type === 'item_update') {
      itemEvents.push(event);
    } else if (event.type === 'file_change') {
      changedFiles.push(...changedFilesFrom(event));
    } else if (event.type === 'approval_required') {
      approvalRequests.push({
        id: String(event.payload && event.payload.requestId ? event.payload.requestId : event.id),
        status: 'pending',
        kind: event.payload && event.payload.kind ? event.payload.kind : 'unknown',
        title: event.title,
        description: event.message,
        payload: event.payload,
        sourceEventId: event.id,
      });
    } else if (event.type === 'runtime_error') {
      messages.push({
        id: `${event.id}:message`,
        role: 'system',
        body: event.message || event.title || 'Runtime error',
        status: 'error',
        sourceEventId: event.id,
        turnId: eventTurnId(event),
      });
      logs.push({
        id: event.id,
        level: event.level || 'error',
        message: event.message || event.title,
        time: event.timestamp,
        payload: event.payload,
      });
    } else if (event.type === 'turn_update') {
      const turnError = turnErrorFrom(event);
      if (turnError) upsertTurnError(turnError);
    } else if (event.type === 'raw_log' || event.type === 'queue_update') {
      if (event.type === 'queue_update' && event.metadata && event.metadata.queueState === 'deleted') {
        hideUserMessage(event.metadata.queueId);
      }
      logs.push({
        id: event.id,
        level: event.level || 'info',
        message: event.message || event.title,
        time: event.timestamp,
        payload: event.payload,
      });
    } else if (event.type === 'command_update') {
      logs.push({
        id: event.id,
        level: event.level || 'info',
        message: event.message || event.title,
        time: event.timestamp,
        payload: event.payload,
      });
    }
  }

  for (const [id, body] of messageBuffers.entries()) {
    if (String(body || '').trim()) messages.push({ id, role: 'assistant', body, sourceEventId: id, turnId: null });
  }

  const turn = latest(ordered, 'turn_update');
  const thread = latest(ordered, 'thread_update');
  const diff = latest(ordered, 'diff_update');
  const usage = latest(ordered, 'usage_update');
  const latestTurnId = eventTurnId(turn) || eventTurnId([...itemEvents].reverse().find(Boolean));
  const projectionItemEvents = scopedItemEvents(itemEvents, latestTurnId);
  const planEntries = latestTurnId && latestPlan.some((entry) => entry.turnId && entry.turnId !== latestTurnId)
    ? []
    : latestPlan;
  const activeItem = activeItemFrom(projectionItemEvents);
  const latestTurnError = turnErrorFrom(turn);
  const latestRuntimeError = latest(ordered, 'runtime_error');
  const lastError = latestTurnError || (isAfter(latestRuntimeError, turn) ? latestRuntimeError : null);

  return {
    messages: messages.filter(Boolean),
    progressSteps: progressStepsFrom(planEntries, projectionItemEvents),
    planEntries,
    todoProjectionEntries: buildTodoProjection(planEntries, projectionItemEvents),
    approvalRequests,
    diffSummary: diff && diff.payload
      ? diff.payload.diff || null
      : (changedFiles.length ? `${changedFiles.length} file change${changedFiles.length === 1 ? '' : 's'}` : null),
    changedFiles,
    logs,
    artifacts,
    runtimeStatus: {
      runtime: REDOU_CODEX_RUNTIME_ID,
      threadStatus: thread && thread.payload ? thread.payload.status || (thread.payload.thread && thread.payload.thread.status) : null,
      turnStatus: turn && turn.payload && turn.payload.turn ? turn.payload.turn.status : null,
      activeTurnId: turn && turn.metadata ? turn.metadata.turnId : null,
      activeItem,
      usage: usage ? usage.payload : null,
      lastError,
    },
    environmentInfo: {
      runtime: 'redou-codex',
      source: 'redou_codex_app_server',
      threadId: thread && thread.metadata ? thread.metadata.threadId : null,
      turnId: turn && turn.metadata ? turn.metadata.turnId : null,
    },
  };
}

module.exports = { buildRuntimeSnapshot };
