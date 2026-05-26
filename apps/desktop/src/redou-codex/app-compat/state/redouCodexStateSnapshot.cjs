'use strict';

const { detectIncompleteTurn, eventTurnId } = require('../continuation/redouCodexIncompleteTurnDetector.cjs');
const { buildRedouCodexContinuationDecision } = require('../continuation/redouCodexContinuation.cjs');

const ERROR_STATUSES = new Set(['failed', 'error', 'cancelled', 'canceled']);
const RUNNING_STATUSES = new Set(['running', 'started', 'active', 'in_progress', 'inprogress']);
const MCP_ELICITATION_REQUEST = 'mcpServer/elicitation/request';

function latest(events, predicate) {
  return [...events].reverse().find(predicate) || null;
}

function turnStatusFrom(event = {}) {
  if (!event) return null;
  const turn = event.payload && event.payload.turn ? event.payload.turn : {};
  return String(turn.status || event.payload?.status || event.message || '').toLowerCase() || null;
}

function threadStatusFrom(event = {}) {
  if (!event) return null;
  const status = event.payload?.status || event.payload?.thread?.status || event.message || null;
  if (!status || typeof status !== 'object') return status || null;
  return status.type || status.status || status.state || null;
}

function threadWaitingOnApproval(event = {}) {
  if (!event) return false;
  const status = event.payload?.status || event.payload?.thread?.status || event.message || null;
  if (!status || typeof status !== 'object') {
    return String(status || '').toLowerCase() === 'waiting_approval';
  }
  const flags = Array.isArray(status.activeFlags) ? status.activeFlags : [];
  return flags.includes('waitingOnApproval') || String(status.type || '').toLowerCase() === 'waiting_approval';
}

function isPendingApproval(event = {}) {
  return event.type === 'approval_required';
}

function isApprovalResolved(event = {}) {
  return event.type === 'approval_resolved';
}

function approvalRequestId(event = {}) {
  if (event.metadata && event.metadata.requestId !== undefined && event.metadata.requestId !== null) {
    return event.metadata.requestId;
  }
  if (event.payload && event.payload.requestId !== undefined && event.payload.requestId !== null) {
    return event.payload.requestId;
  }
  return event.id;
}

function parseRawNotification(event = {}) {
  const raw = event.metadata && typeof event.metadata.raw === 'string' ? event.metadata.raw : '';
  if (!raw || raw.includes('\n[truncated]')) return null;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function legacyMcpElicitationRequest(event = {}) {
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
    turnId: params.turnId || event.metadata?.turnId || null,
    message: params.message || event.message || '',
    serverName: params.serverName || null,
  };
}

function pendingApprovals(events = []) {
  const resolved = new Set(events.filter(isApprovalResolved).map((event) => String(approvalRequestId(event))));
  return events.filter(isPendingApproval).filter((event) => {
    const id = String(approvalRequestId(event));
    return !resolved.has(id);
  });
}

function staleLegacyApprovals(events = [], turnId = null) {
  const resolved = new Set(events.filter(isApprovalResolved).map((event) => String(approvalRequestId(event))));
  return events
    .map((event) => ({ event, request: legacyMcpElicitationRequest(event) }))
    .filter(({ request }) => {
      if (!request) return false;
      if (resolved.has(String(request.requestId))) return false;
      if (turnId && request.turnId && request.turnId !== turnId) return false;
      return true;
    });
}

function latestRuntimeWarning(events = []) {
  return latest(events, (event) => event.type === 'model_degraded' || event.type === 'runtime_warning');
}

function buildStopReason(status, details = {}) {
  const reasons = {
    completed: 'turn_completed',
    running: 'turn_running',
    failed: 'turn_failed',
    interrupted: 'turn_interrupted',
    waiting_approval: 'waiting_for_approval',
    incomplete: 'assistant_promised_followup_without_tool_call',
    degraded: 'model_degraded',
    idle: 'thread_idle',
    unknown: 'unknown',
  };
  return {
    status,
    code: details.code || reasons[status] || reasons.unknown,
    message: details.message || '',
    details,
  };
}

function buildRedouCodexStateSnapshot(events = []) {
  const ordered = [...events].sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
  const turn = latest(ordered, (event) => event.type === 'turn_update');
  const thread = latest(ordered, (event) => event.type === 'thread_update');
  const warning = latestRuntimeWarning(ordered);
  const approvals = pendingApprovals(ordered);
  const incomplete = detectIncompleteTurn(ordered);
  const rawTurnStatus = turnStatusFrom(turn);
  const activeTurnId = eventTurnId(turn);
  const normalizedThreadStatus = threadStatusFrom(thread);
  const staleApprovals = staleLegacyApprovals(ordered, activeTurnId);
  const degraded = Boolean(warning && warning.payload && warning.payload.degraded);

  let status = 'unknown';
  let stopReason = buildStopReason('unknown');
  let needsAttention = false;

  if (approvals.length) {
    status = 'waiting_approval';
    needsAttention = true;
    stopReason = buildStopReason(status, {
      message: approvals[approvals.length - 1].message || 'Approval is required.',
      approvalRequestId: approvalRequestId(approvals[approvals.length - 1]),
    });
  } else if (incomplete.incomplete) {
    status = 'incomplete';
    needsAttention = true;
    stopReason = buildStopReason(status, incomplete);
  } else if (rawTurnStatus && ERROR_STATUSES.has(rawTurnStatus)) {
    status = 'failed';
    needsAttention = true;
    stopReason = buildStopReason(status, { message: turn && (turn.message || turn.title) || 'Turn failed.' });
  } else if (rawTurnStatus && RUNNING_STATUSES.has(rawTurnStatus) && threadWaitingOnApproval(thread) && staleApprovals.length) {
    const latestApproval = staleApprovals[staleApprovals.length - 1].request;
    status = 'interrupted';
    needsAttention = true;
    stopReason = buildStopReason(status, {
      code: 'approval_request_expired',
      message: 'Approval request expired before Redou could respond. Start or continue the task to request approval again.',
      approvalRequestId: latestApproval.requestId,
      turnId: activeTurnId,
      serverName: latestApproval.serverName,
    });
  } else if (rawTurnStatus && RUNNING_STATUSES.has(rawTurnStatus)) {
    status = 'running';
    stopReason = buildStopReason(status);
  } else if (rawTurnStatus === 'completed') {
    status = degraded ? 'degraded' : 'completed';
    needsAttention = degraded;
    stopReason = degraded
      ? buildStopReason('degraded', { message: warning.message || 'Model is running in degraded compatibility mode.' })
      : buildStopReason('completed');
  } else if (normalizedThreadStatus === 'idle') {
    status = degraded ? 'degraded' : 'idle';
    needsAttention = degraded;
    stopReason = degraded
      ? buildStopReason('degraded', { message: warning.message || 'Model is running in degraded compatibility mode.' })
      : buildStopReason('idle');
  }

  return {
    status,
    rawTurnStatus,
    threadStatus: normalizedThreadStatus,
    turnId: activeTurnId,
    needsAttention,
    degraded,
    warning: warning ? warning.payload || null : null,
    pendingApprovals: approvals,
    incompleteTurn: incomplete,
    stopReason,
    continuation: buildRedouCodexContinuationDecision(ordered),
  };
}

module.exports = {
  buildRedouCodexStateSnapshot,
  buildStopReason,
  pendingApprovals,
};
