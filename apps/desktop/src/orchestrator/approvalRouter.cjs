'use strict';

const { REDOU_CODEX_RUNTIME_ID } = require('../runtimes/redou-codex/redouCodexRuntimeConfig.cjs');

async function findApprovalRequest(requestId, dependencies = {}) {
  if (dependencies.eventStore && typeof dependencies.eventStore.list === 'function') {
    const events = await dependencies.eventStore.list();
    return [...events].reverse().find((event) => (
      event.type === 'approval_required'
      && String(event.payload && event.payload.requestId) === String(requestId)
    )) || null;
  }
  return null;
}

async function routeApprovalDecision(decision, dependencies = {}) {
  const requestId = decision.requestId || decision.id;
  if (!requestId) throw new Error('requestId is required for approval response');
  const approvalEvent = decision.request || await findApprovalRequest(requestId, dependencies);
  const runtimeId = decision.runtime || (approvalEvent && approvalEvent.runtime) || REDOU_CODEX_RUNTIME_ID;
  const runtime = dependencies.runtimeRegistry && dependencies.runtimeRegistry.getRuntime
    ? dependencies.runtimeRegistry.getRuntime(runtimeId)
    : dependencies.runtime;

  if (!runtime || typeof runtime.respondApproval !== 'function') {
    throw new Error(`Runtime ${runtimeId} cannot respond to approvals`);
  }

  return runtime.respondApproval({
    ...decision,
    requestId,
    request: approvalEvent ? approvalEvent.payload : decision.request,
  });
}

module.exports = { routeApprovalDecision };
