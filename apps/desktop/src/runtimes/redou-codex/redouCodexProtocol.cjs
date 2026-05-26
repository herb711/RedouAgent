'use strict';

const { mapRedouSandboxPolicy } = require('./redouCodexPermissionMapper.cjs');
const {
  redouCodexActiveTurnIdFrom,
  redouCodexThreadIdFrom,
} = require('./redouCodexSessionStore.cjs');
const {
  buildRedouCodexDeveloperInstructions,
  buildRedouCodexUserInputArray,
  compactObject,
} = require('../../redou-codex/app-compat/index.cjs');

const DEFAULT_CLIENT_INFO = Object.freeze({
  name: 'redou_workbench',
  title: 'Redou Workbench',
  version: '0.3.4',
});

function mappedPermissionsForInput(input = {}) {
  if (typeof input.permissions === 'string') return { permissionProfile: input.permissions };
  const permissionPolicy = input.permissionPolicy || input.permissionsPolicy || null;
  return input.permissions || (permissionPolicy ? mapRedouSandboxPolicy(permissionPolicy) : {});
}

function buildInitializeRequest(options = {}) {
  const clientInfo = { ...DEFAULT_CLIENT_INFO, ...(options.clientInfo || {}) };
  return {
    method: 'initialize',
    params: compactObject({
      clientInfo,
      capabilities: compactObject({
        experimentalApi: Boolean(options.experimentalApi),
        optOutNotificationMethods: options.optOutNotificationMethods,
        requestAttestation: Boolean(options.requestAttestation),
      }),
    }),
  };
}

function buildCommonThreadParams(input = {}) {
  const permissions = mappedPermissionsForInput(input);
  const contextPackage = input.contextPackage || {};
  const permissionProfile = permissions.permissionProfile || input.permissionProfile || input.permissionProfileId;
  return compactObject({
    model: input.model,
    modelProvider: input.modelProvider,
    cwd: input.cwd || input.projectPath || contextPackage.cwd || contextPackage.workspaceRoot || contextPackage.environment?.cwd,
    approvalPolicy: permissions.approvalPolicy || input.approvalPolicy,
    approvalsReviewer: permissions.approvalsReviewer || input.approvalsReviewer || 'user',
    permissions: permissionProfile,
    sandbox: permissionProfile ? null : permissions.threadSandbox || input.sandbox,
    personality: input.personality,
    serviceName: input.serviceName || 'redou_workbench',
    serviceTier: input.serviceTier,
    baseInstructions: input.baseInstructions,
    developerInstructions: buildRedouCodexDeveloperInstructions(input),
    config: input.config,
  });
}

function buildThreadStartRequest(input = {}) {
  return {
    method: 'thread/start',
    params: compactObject({
      ...buildCommonThreadParams(input),
      ephemeral: input.ephemeral,
      sessionStartSource: input.sessionStartSource || 'startup',
      threadSource: input.threadSource || 'user',
      dynamicTools: input.dynamicTools || input.dynamic_tools,
    }),
  };
}

function buildThreadResumeRequest(input = {}) {
  return {
    method: 'thread/resume',
    params: compactObject({
      ...buildCommonThreadParams(input),
      threadId: input.threadId || redouCodexThreadIdFrom(input) || redouCodexThreadIdFrom(input.task),
    }),
  };
}

function buildThreadForkRequest(input = {}) {
  return {
    method: 'thread/fork',
    params: compactObject({
      ...buildCommonThreadParams(input),
      threadId: input.threadId || redouCodexThreadIdFrom(input) || redouCodexThreadIdFrom(input.task),
      ephemeral: input.ephemeral,
      threadSource: input.threadSource || 'user',
    }),
  };
}

function buildThreadArchiveRequest(input = {}) {
  return {
    method: 'thread/archive',
    params: compactObject({
      threadId: input.threadId || redouCodexThreadIdFrom(input) || redouCodexThreadIdFrom(input.task),
    }),
  };
}

function buildThreadUnarchiveRequest(input = {}) {
  return {
    method: 'thread/unarchive',
    params: compactObject({
      threadId: input.threadId || redouCodexThreadIdFrom(input) || redouCodexThreadIdFrom(input.task),
    }),
  };
}

function buildThreadSetNameRequest(input = {}) {
  return {
    method: 'thread/name/set',
    params: compactObject({
      threadId: input.threadId || redouCodexThreadIdFrom(input) || redouCodexThreadIdFrom(input.task),
      name: input.name || input.title,
    }),
  };
}

function buildTurnStartRequest(input = {}) {
  const permissions = mappedPermissionsForInput(input);
  const contextPackage = input.contextPackage || {};
  const permissionProfile = permissions.permissionProfile || input.permissionProfile || input.permissionProfileId;
  return {
    method: 'turn/start',
    params: compactObject({
      threadId: input.threadId || redouCodexThreadIdFrom(input) || redouCodexThreadIdFrom(input.task),
      input: buildRedouCodexUserInputArray(input),
      cwd: input.cwd || input.projectPath || contextPackage.cwd || contextPackage.workspaceRoot || contextPackage.environment?.cwd,
      model: input.model,
      effort: input.effort || input.reasoningEffort,
      summary: input.summary,
      personality: input.personality,
      serviceTier: input.serviceTier,
      approvalPolicy: permissions.approvalPolicy || input.approvalPolicy,
      approvalsReviewer: permissions.approvalsReviewer || input.approvalsReviewer || 'user',
      permissions: permissionProfile,
      sandboxPolicy: permissionProfile ? null : permissions.turnSandboxPolicy,
      outputSchema: input.outputSchema,
    }),
  };
}

function buildTurnSteerRequest(input = {}) {
  return {
    method: 'turn/steer',
    params: compactObject({
      threadId: input.threadId || redouCodexThreadIdFrom(input) || redouCodexThreadIdFrom(input.task),
      expectedTurnId: input.turnId || redouCodexActiveTurnIdFrom(input) || redouCodexActiveTurnIdFrom(input.task),
      input: buildRedouCodexUserInputArray(input),
    }),
  };
}

function buildTurnInterruptRequest(input = {}) {
  return {
    method: 'turn/interrupt',
    params: compactObject({
      threadId: input.threadId || redouCodexThreadIdFrom(input) || redouCodexThreadIdFrom(input.task),
      turnId: input.turnId || redouCodexActiveTurnIdFrom(input) || redouCodexActiveTurnIdFrom(input.task),
    }),
  };
}

function buildApprovalResponseRequest(input = {}) {
  const requestId = input.requestId ?? input.id;
  const result = input.result || (input.decision !== undefined ? { decision: input.decision } : {});
  return { requestId, result };
}

module.exports = {
  buildInitializeRequest,
  buildThreadStartRequest,
  buildThreadResumeRequest,
  buildThreadForkRequest,
  buildThreadArchiveRequest,
  buildThreadUnarchiveRequest,
  buildThreadSetNameRequest,
  buildTurnStartRequest,
  buildTurnSteerRequest,
  buildTurnInterruptRequest,
  buildApprovalResponseRequest,
  buildThreadStartParams: (input) => buildThreadStartRequest(input).params,
  buildThreadResumeParams: (input) => buildThreadResumeRequest(input).params,
  buildThreadForkParams: (input) => buildThreadForkRequest(input).params,
  buildThreadArchiveParams: (input) => buildThreadArchiveRequest(input).params,
  buildThreadUnarchiveParams: (input) => buildThreadUnarchiveRequest(input).params,
  buildThreadSetNameParams: (input) => buildThreadSetNameRequest(input).params,
  buildTurnStartParams: (input) => buildTurnStartRequest(input).params,
  buildTurnSteerParams: (input) => buildTurnSteerRequest(input).params,
  buildTurnInterruptParams: (input) => buildTurnInterruptRequest(input).params,
};
