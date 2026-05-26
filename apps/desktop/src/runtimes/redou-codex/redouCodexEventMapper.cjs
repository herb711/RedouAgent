'use strict';

const RAW_LIMIT = 8 * 1024;
const { REDOU_CODEX_RUNTIME_ID } = require('./redouCodexRuntimeConfig.cjs');
const MCP_ELICITATION_REQUEST = 'mcpServer/elicitation/request';

function nowIso() {
  return new Date().toISOString();
}

function truncateRaw(value) {
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch (error) {
    text = String(value);
  }
  if (text.length <= RAW_LIMIT) return text;
  return text.slice(0, RAW_LIMIT) + '\n[truncated]';
}

function paramsOf(notification) {
  return notification && notification.params ? notification.params : {};
}

function itemOf(notification) {
  return paramsOf(notification).item || {};
}

function baseEvent(notification, context, overrides = {}) {
  const method = notification.method || notification.type || 'unknown';
  const params = paramsOf(notification);
  return {
    id: overrides.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    taskId: context.taskId || params.taskId || null,
    projectId: context.projectId || null,
    runtime: REDOU_CODEX_RUNTIME_ID,
    type: overrides.type || 'raw_log',
    level: overrides.level || 'info',
    timestamp: overrides.timestamp || nowIso(),
    title: overrides.title || method,
    message: overrides.message || '',
    payload: overrides.payload === undefined ? params : overrides.payload,
    metadata: {
      redouCodexMethod: method,
      threadId: params.threadId || context.threadId || null,
      turnId: params.turnId || context.turnId || null,
      itemId: params.itemId || (params.item && params.item.id) || null,
      raw: truncateRaw(notification),
      ...(overrides.metadata || {}),
    },
  };
}

function mapThreadEvent(notification, context) {
  const params = paramsOf(notification);
  const thread = params.thread || {};
  return baseEvent(notification, context, {
    type: 'thread_update',
    title: 'Thread update',
    message: thread.status || params.status || '',
    payload: { thread: params.thread, status: params.status, threadId: params.threadId || thread.id },
    metadata: { threadId: params.threadId || thread.id || context.threadId || null },
  });
}

function mapTurnEvent(notification, context) {
  const params = paramsOf(notification);
  const turn = params.turn || {};
  return baseEvent(notification, context, {
    type: 'turn_update',
    title: 'Turn update',
    message: turn.status || '',
    payload: { threadId: params.threadId, turn },
    metadata: { turnId: turn.id || params.turnId || context.turnId || null },
  });
}

function mapPlanEvent(notification, context) {
  const params = paramsOf(notification);
  return baseEvent(notification, context, {
    type: 'plan_update',
    title: 'Plan update',
    message: params.explanation || '',
    payload: {
      threadId: params.threadId,
      turnId: params.turnId,
      explanation: params.explanation || null,
      plan: params.plan || [],
      delta: params.delta,
      itemId: params.itemId,
    },
  });
}

function mapItemLifecycleEvent(notification, context) {
  const item = itemOf(notification);
  const method = notification.method || '';
  return baseEvent(notification, context, {
    type: 'item_update',
    title: method === 'item/completed' ? 'Item completed' : 'Item started',
    message: item.type || '',
    payload: {
      ...paramsOf(notification),
      lifecycle: method === 'item/completed' ? 'completed' : 'started',
      item,
    },
    metadata: { itemKind: item.type || 'unknown' },
  });
}

function mapMessageDelta(notification, context) {
  const params = paramsOf(notification);
  return baseEvent(notification, context, {
    type: 'message_delta',
    title: 'Assistant message delta',
    message: params.delta || '',
    payload: params,
  });
}

function mapMessageCompleted(notification, context) {
  const item = itemOf(notification);
  return baseEvent(notification, context, {
    type: 'message_completed',
    title: 'Assistant message completed',
    message: item.text || '',
    payload: { ...paramsOf(notification), item },
  });
}

function mapCommandEvent(notification, context) {
  const params = paramsOf(notification);
  const item = params.item || {};
  return baseEvent(notification, context, {
    type: 'command_update',
    title: 'Command update',
    message: item.command || params.delta || '',
    payload: { ...params, item },
    metadata: { itemKind: 'commandExecution' },
  });
}

function mapFileChangeEvent(notification, context) {
  const params = paramsOf(notification);
  const item = params.item || {};
  return baseEvent(notification, context, {
    type: 'file_change',
    title: 'File change',
    message: item.status || '',
    payload: { ...params, item },
    metadata: { itemKind: 'fileChange' },
  });
}

function mapDiffEvent(notification, context) {
  return baseEvent(notification, context, {
    type: 'diff_update',
    title: 'Diff update',
    payload: paramsOf(notification),
  });
}

function approvalKind(method) {
  if (method === MCP_ELICITATION_REQUEST) return 'mcp_elicitation';
  if (method.includes('commandExecution') || method === 'execCommandApproval') return 'command';
  if (method.includes('fileChange') || method === 'applyPatchApproval') return 'file_change';
  if (method.includes('permissions')) return 'permissions';
  return 'unknown';
}

function approvalMessage(params, kind) {
  return params.message || params.reason || params.command || kind;
}

function isApprovalRequestMethod(method) {
  return method === MCP_ELICITATION_REQUEST
    || method.endsWith('/requestApproval')
    || method === 'execCommandApproval'
    || method === 'applyPatchApproval';
}

function mapApprovalEvent(notification, context) {
  const params = paramsOf(notification);
  const kind = approvalKind(notification.method || '');
  return baseEvent(notification, context, {
    type: 'approval_required',
    title: 'Approval required',
    message: approvalMessage(params, kind),
    payload: {
      requestId: notification.id,
      method: notification.method,
      kind,
      ...params,
    },
    metadata: {
      requestId: notification.id,
      approvalKind: kind,
      threadId: params.threadId || params.conversationId || context.threadId || null,
      turnId: params.turnId || context.turnId || null,
    },
  });
}

function mapUsageEvent(notification, context) {
  return baseEvent(notification, context, {
    type: 'usage_update',
    title: 'Usage update',
    payload: paramsOf(notification),
  });
}

function mapRawEvent(notification, context, level = 'info') {
  const params = paramsOf(notification);
  return baseEvent(notification, context, {
    type: 'raw_log',
    level: params.level || level,
    title: notification.method || 'redou-codex event',
    message: params.message || '',
    payload: params,
  });
}

function mapRedouCodexNotificationToAgentEvents(notification = {}, context = {}) {
  const method = notification.method || notification.type || '';
  const item = itemOf(notification);
  const events = [];

  if (method === 'thread/tokenUsage/updated') events.push(mapUsageEvent(notification, context));
  else if (method.startsWith('thread/')) events.push(mapThreadEvent(notification, context));
  else if (method === 'turn/started' || method === 'turn/completed') events.push(mapTurnEvent(notification, context));
  else if (method === 'turn/plan/updated' || method === 'item/plan/delta') events.push(mapPlanEvent(notification, context));
  else if (method === 'turn/diff/updated') events.push(mapDiffEvent(notification, context));
  else if (method === 'item/agentMessage/delta') events.push(mapMessageDelta(notification, context));
  else if (method === 'item/commandExecution/outputDelta') events.push(mapCommandEvent(notification, context));
  else if (method === 'item/fileChange/patchUpdated' || method === 'item/fileChange/outputDelta') events.push(mapFileChangeEvent(notification, context));
  else if (isApprovalRequestMethod(method)) events.push(mapApprovalEvent(notification, context));
  else if (method === 'serverRequest/resolved') {
    const params = paramsOf(notification);
    events.push(baseEvent(notification, context, {
      type: 'approval_resolved',
      title: 'Approval resolved',
      payload: params,
      metadata: { requestId: params.requestId || params.id || notification.id || null },
    }));
  }
  else if (method === 'error' || method === 'warning' || method === 'protocol_error' || method === 'raw_log') events.push(mapRawEvent(notification, context, method === 'error' ? 'error' : 'info'));
  else if (method === 'item/started' || method === 'item/completed') events.push(mapItemLifecycleEvent(notification, context));
  else events.push(mapRawEvent(notification, context));

  if (method === 'item/completed' && item.type === 'agentMessage') {
    events.push(mapMessageCompleted(notification, context));
  }
  if ((method === 'item/started' || method === 'item/completed') && item.type === 'commandExecution') {
    events.push(mapCommandEvent(notification, context));
  }
  if ((method === 'item/started' || method === 'item/completed') && item.type === 'fileChange') {
    events.push(mapFileChangeEvent(notification, context));
  }

  return events;
}

function mapRedouCodexNotificationToAgentEvent(notification = {}, context = {}) {
  return mapRedouCodexNotificationToAgentEvents(notification, context)[0];
}

module.exports = {
  mapRedouCodexNotificationToAgentEvent,
  mapRedouCodexNotificationToAgentEvents,
};
