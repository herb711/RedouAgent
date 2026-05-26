'use strict';

const { REDOU_CODEX_RUNTIME_ID } = require('../runtimes/redou-codex/redouCodexRuntimeConfig.cjs');
const MCP_ELICITATION_REQUEST = 'mcpServer/elicitation/request';

function parseRawNotification(event = {}) {
  const raw = event.metadata && typeof event.metadata.raw === 'string' ? event.metadata.raw : '';
  if (!raw || raw.includes('\n[truncated]')) return null;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function legacyMcpApprovalPayload(event = {}) {
  if (event.type !== 'raw_log') return null;
  const raw = parseRawNotification(event);
  const method = raw?.method || event.metadata?.redouCodexMethod || event.title || '';
  if (method !== MCP_ELICITATION_REQUEST) return null;
  const params = raw?.params || event.payload || {};
  const requestId = raw && raw.id !== undefined && raw.id !== null
    ? raw.id
    : event.payload && event.payload.requestId !== undefined && event.payload.requestId !== null
      ? event.payload.requestId
      : event.id;
  return {
    requestId,
    method,
    kind: 'mcp_elicitation',
    ...params,
  };
}

function approvalPayload(event = {}) {
  if (event.type === 'approval_required') return event.payload || {};
  return legacyMcpApprovalPayload(event);
}

function normalizeApprovalEvent(event = {}) {
  const payload = approvalPayload(event);
  if (!payload) return null;
  return event.type === 'approval_required'
    ? event
    : { ...event, type: 'approval_required', payload };
}

async function findApprovalRequest(requestId, dependencies = {}, options = {}) {
  if (dependencies.eventStore && typeof dependencies.eventStore.list === 'function') {
    const events = await dependencies.eventStore.list(options.taskId ? { taskId: options.taskId } : {});
    return [...events].reverse()
      .map(normalizeApprovalEvent)
      .find((event) => {
        const payload = event && event.payload ? event.payload : null;
        return payload && String(payload.requestId) === String(requestId);
      }) || null;
  }
  return null;
}

async function routeApprovalDecision(decision, dependencies = {}) {
  const requestId = decision.requestId ?? decision.id;
  if (requestId === undefined || requestId === null || requestId === '') {
    throw new Error('requestId is required for approval response');
  }
  const taskId = decision.taskId || (decision.request && decision.request.taskId) || null;
  const approvalEvent = decision.request || await findApprovalRequest(requestId, dependencies, { taskId });
  const runtimeId = decision.runtime || (approvalEvent && approvalEvent.runtime) || REDOU_CODEX_RUNTIME_ID;
  const runtime = dependencies.runtimeRegistry && dependencies.runtimeRegistry.getRuntime
    ? dependencies.runtimeRegistry.getRuntime(runtimeId)
    : dependencies.runtime;

  if (!runtime || typeof runtime.respondApproval !== 'function') {
    throw new Error(`Runtime ${runtimeId} cannot respond to approvals`);
  }

  return runtime.respondApproval({
    ...decision,
    taskId,
    requestId: approvalEvent && approvalEvent.payload && approvalEvent.payload.requestId !== undefined && approvalEvent.payload.requestId !== null
      ? approvalEvent.payload.requestId
      : requestId,
    request: approvalEvent ? approvalEvent.payload : decision.request,
  });
}

module.exports = { routeApprovalDecision };
