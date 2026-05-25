'use strict';

const { detectIncompleteTurn, eventTurnId } = require('../continuation/redouCodexIncompleteTurnDetector.cjs');
const { buildRedouCodexContinuationDecision } = require('../continuation/redouCodexContinuation.cjs');

const ERROR_STATUSES = new Set(['failed', 'error', 'cancelled', 'canceled']);
const RUNNING_STATUSES = new Set(['running', 'started', 'active', 'in_progress', 'inprogress']);

function latest(events, predicate) {
  return [...events].reverse().find(predicate) || null;
}

function turnStatusFrom(event = {}) {
  if (!event) return null;
  const turn = event.payload && event.payload.turn ? event.payload.turn : {};
  return String(turn.status || event.payload?.status || event.message || '').toLowerCase() || null;
}

function isPendingApproval(event = {}) {
  return event.type === 'approval_required';
}

function isApprovalResolved(event = {}) {
  return event.type === 'approval_resolved';
}

function pendingApprovals(events = []) {
  const resolved = new Set(events.filter(isApprovalResolved).map((event) => String(event.metadata?.requestId || event.payload?.requestId || event.id)));
  return events.filter(isPendingApproval).filter((event) => {
    const id = String(event.metadata?.requestId || event.payload?.requestId || event.id);
    return !resolved.has(id);
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
  const degraded = Boolean(warning && warning.payload && warning.payload.degraded);

  let status = 'unknown';
  let stopReason = buildStopReason('unknown');
  let needsAttention = false;

  if (approvals.length) {
    status = 'waiting_approval';
    needsAttention = true;
    stopReason = buildStopReason(status, {
      message: approvals[approvals.length - 1].message || 'Approval is required.',
      approvalRequestId: approvals[approvals.length - 1].metadata?.requestId || approvals[approvals.length - 1].id,
    });
  } else if (incomplete.incomplete) {
    status = 'incomplete';
    needsAttention = true;
    stopReason = buildStopReason(status, incomplete);
  } else if (rawTurnStatus && ERROR_STATUSES.has(rawTurnStatus)) {
    status = 'failed';
    needsAttention = true;
    stopReason = buildStopReason(status, { message: turn && (turn.message || turn.title) || 'Turn failed.' });
  } else if (rawTurnStatus && RUNNING_STATUSES.has(rawTurnStatus)) {
    status = 'running';
    stopReason = buildStopReason(status);
  } else if (rawTurnStatus === 'completed') {
    status = degraded ? 'degraded' : 'completed';
    needsAttention = degraded;
    stopReason = degraded
      ? buildStopReason('degraded', { message: warning.message || 'Model is running in degraded compatibility mode.' })
      : buildStopReason('completed');
  } else if (thread && (thread.payload?.status || thread.message) === 'idle') {
    status = degraded ? 'degraded' : 'idle';
    needsAttention = degraded;
    stopReason = degraded
      ? buildStopReason('degraded', { message: warning.message || 'Model is running in degraded compatibility mode.' })
      : buildStopReason('idle');
  }

  return {
    status,
    rawTurnStatus,
    threadStatus: thread && thread.payload ? thread.payload.status || (thread.payload.thread && thread.payload.thread.status) : null,
    turnId: eventTurnId(turn),
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
