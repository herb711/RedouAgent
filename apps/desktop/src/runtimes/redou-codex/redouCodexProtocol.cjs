'use strict';

const { mapRedouSandboxPolicy } = require('./redouCodexPermissionMapper.cjs');
const {
  redouCodexActiveTurnIdFrom,
  redouCodexThreadIdFrom,
} = require('./redouCodexSessionStore.cjs');

const DEFAULT_CLIENT_INFO = Object.freeze({
  name: 'redou_workbench',
  title: 'Redou Workbench',
  version: '0.3.4',
});

const DEFAULT_DEVELOPER_INSTRUCTIONS = [
  'You are running inside Redou Workbench. Continue working until the user request is actually handled or you are blocked.',
  'Do not end a turn by saying you will inspect, check, run, change, or continue something next; either do it in the same turn with the available tools, or clearly state what user input/permission is needed.',
].join('\n');

function compactObject(input) {
  const output = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (value !== undefined && value !== null) output[key] = value;
  }
  return output;
}

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map((item) => normalizeText(item)).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function buildDeveloperInstructions(input = {}) {
  const task = input.task || {};
  const contextPackage = input.contextPackage || {};
  const sections = [DEFAULT_DEVELOPER_INSTRUCTIONS];

  const projectRules = normalizeText(contextPackage.projectRules || input.projectRules);
  if (projectRules) sections.push(`Project rules:\n${projectRules}`);

  const taskRules = normalizeText(contextPackage.taskRules || input.taskRules);
  if (taskRules) sections.push(`Task rules:\n${taskRules}`);

  const metadata = compactObject({
    redouTaskId: task.id,
    redouTaskTitle: task.title,
    redouRuntime: task.runtime,
    redouRuntimeMode: task.runtimeMode,
  });
  if (Object.keys(metadata).length) {
    sections.push(`Redou task metadata:\n${JSON.stringify(metadata, null, 2)}`);
  }

  const explicit = normalizeText(input.developerInstructions || contextPackage.developerInstructions);
  if (explicit) sections.push(explicit);

  return sections.length ? sections.join('\n\n') : null;
}

function buildContextText(contextPackage = {}) {
  const sections = [];
  const recentMessages = normalizeText(contextPackage.recentMessages);
  const selectedFiles = normalizeText(contextPackage.selectedFiles);
  const attachments = normalizeText(contextPackage.attachments);
  const environment = normalizeText(contextPackage.environment);
  const metadata = contextPackage.metadata && Object.keys(contextPackage.metadata).length
    ? JSON.stringify(contextPackage.metadata, null, 2)
    : '';

  if (recentMessages) sections.push(`Recent messages:\n${recentMessages}`);
  if (selectedFiles) sections.push(`Selected files:\n${selectedFiles}`);
  if (attachments) sections.push(`Attachments:\n${attachments}`);
  if (environment) sections.push(`Environment:\n${environment}`);
  if (metadata) sections.push(`Metadata:\n${metadata}`);

  return sections.length ? sections.join('\n\n') : '';
}

function buildUserInputArray(input = {}) {
  const task = input.task || {};
  const contextPackage = input.contextPackage || {};
  const userText = normalizeText(input.userInput || contextPackage.userInput || task.userInput || task.title);
  const contextText = buildContextText(contextPackage);
  const text = contextText
    ? `${userText}\n\nRedou context package for this turn:\n${contextText}`
    : userText;
  return [{ type: 'text', text: text || '' }];
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
  const permissionPolicy = input.permissionPolicy || input.permissionsPolicy || null;
  const permissions = input.permissions || (permissionPolicy ? mapRedouSandboxPolicy(permissionPolicy) : {});
  return compactObject({
    model: input.model,
    modelProvider: input.modelProvider,
    cwd: input.cwd || input.projectPath || (input.contextPackage && input.contextPackage.cwd),
    approvalPolicy: permissions.approvalPolicy || input.approvalPolicy,
    approvalsReviewer: permissions.approvalsReviewer || input.approvalsReviewer || 'user',
    sandbox: permissions.threadSandbox || input.sandbox,
    personality: input.personality,
    serviceName: input.serviceName || 'redou_workbench',
    serviceTier: input.serviceTier,
    baseInstructions: input.baseInstructions,
    developerInstructions: buildDeveloperInstructions(input),
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

function buildTurnStartRequest(input = {}) {
  const permissionPolicy = input.permissionPolicy || input.permissionsPolicy || null;
  const permissions = input.permissions || (permissionPolicy ? mapRedouSandboxPolicy(permissionPolicy) : {});
  return {
    method: 'turn/start',
    params: compactObject({
      threadId: input.threadId || redouCodexThreadIdFrom(input) || redouCodexThreadIdFrom(input.task),
      input: buildUserInputArray(input),
      cwd: input.cwd || input.projectPath || (input.contextPackage && input.contextPackage.cwd),
      model: input.model,
      effort: input.effort || input.reasoningEffort,
      summary: input.summary,
      personality: input.personality,
      serviceTier: input.serviceTier,
      approvalPolicy: permissions.approvalPolicy || input.approvalPolicy,
      approvalsReviewer: permissions.approvalsReviewer || input.approvalsReviewer || 'user',
      sandboxPolicy: permissions.turnSandboxPolicy,
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
      input: buildUserInputArray(input),
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
  const requestId = input.requestId || input.id;
  const result = input.result || (input.decision !== undefined ? { decision: input.decision } : {});
  return { requestId, result };
}

module.exports = {
  buildInitializeRequest,
  buildThreadStartRequest,
  buildThreadResumeRequest,
  buildTurnStartRequest,
  buildTurnSteerRequest,
  buildTurnInterruptRequest,
  buildApprovalResponseRequest,
  buildThreadStartParams: (input) => buildThreadStartRequest(input).params,
  buildThreadResumeParams: (input) => buildThreadResumeRequest(input).params,
  buildTurnStartParams: (input) => buildTurnStartRequest(input).params,
  buildTurnSteerParams: (input) => buildTurnSteerRequest(input).params,
  buildTurnInterruptParams: (input) => buildTurnInterruptRequest(input).params,
};
