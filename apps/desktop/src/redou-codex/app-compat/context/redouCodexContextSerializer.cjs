'use strict';

function stableJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map((item) => normalizeText(item)).filter(Boolean).join('\n');
  if (typeof value === 'object') return stableJson(value);
  return String(value);
}

function compactObject(input) {
  const output = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (value !== undefined && value !== null && value !== '') output[key] = value;
  }
  return output;
}

function normalizeContextPackage(contextPackage = {}) {
  return {
    projectId: contextPackage.projectId || null,
    taskId: contextPackage.taskId || null,
    workspaceRoot: contextPackage.workspaceRoot || null,
    userInput: normalizeText(contextPackage.userInput),
    projectRules: Array.isArray(contextPackage.projectRules) ? contextPackage.projectRules : [].concat(contextPackage.projectRules || []),
    taskRules: Array.isArray(contextPackage.taskRules) ? contextPackage.taskRules : [].concat(contextPackage.taskRules || []),
    recentMessages: Array.isArray(contextPackage.recentMessages) ? contextPackage.recentMessages : [].concat(contextPackage.recentMessages || []),
    selectedFiles: Array.isArray(contextPackage.selectedFiles) ? contextPackage.selectedFiles : [].concat(contextPackage.selectedFiles || []),
    attachments: Array.isArray(contextPackage.attachments) ? contextPackage.attachments : [].concat(contextPackage.attachments || []),
    environment: contextPackage.environment && typeof contextPackage.environment === 'object' ? contextPackage.environment : {},
    metadata: contextPackage.metadata && typeof contextPackage.metadata === 'object' ? contextPackage.metadata : {},
  };
}

function enrichRedouCodexContextPackage(contextPackage = {}, input = {}) {
  const context = normalizeContextPackage(contextPackage);
  const task = input.task || {};
  const project = input.project || {};
  const modelCapability = input.modelCapability || input.modelConfig?.modelCapability || null;
  return {
    ...context,
    projectId: context.projectId || project.id || task.projectId || null,
    taskId: context.taskId || task.id || input.taskId || null,
    workspaceRoot: context.workspaceRoot || project.rootPath || input.workspaceRoot || null,
    environment: {
      ...(context.environment || {}),
      runtime: task.runtime || input.runtime || 'redou-codex',
      model: input.model || context.environment?.model || null,
      modelProvider: input.modelProvider || context.environment?.modelProvider || null,
      permissionMode: input.permissionMode || input.permissionPolicy?.permissionMode || input.permissionPolicy?.redouCodexPermissionProfile || context.environment?.permissionMode || null,
      degradedModel: Boolean(modelCapability && modelCapability.degraded),
    },
    metadata: {
      ...(context.metadata || {}),
      redouCodex: {
        model: input.model || null,
        modelProvider: input.modelProvider || null,
        modelCapability,
        permissionPolicy: input.permissionPolicy || input.permissionsPolicy || null,
      },
    },
  };
}

function buildRedouCodexContextText(contextPackage = {}) {
  const context = normalizeContextPackage(contextPackage);
  const sections = [];
  const recentMessages = normalizeText(context.recentMessages);
  const selectedFiles = normalizeText(context.selectedFiles);
  const attachments = normalizeText(context.attachments);
  const environment = normalizeText(context.environment);
  const metadata = Object.keys(context.metadata).length ? stableJson(context.metadata) : '';

  if (recentMessages) sections.push(`Recent messages:\n${recentMessages}`);
  if (selectedFiles) sections.push(`Selected files:\n${selectedFiles}`);
  if (attachments) sections.push(`Attachments:\n${attachments}`);
  if (environment) sections.push(`Environment:\n${environment}`);
  if (metadata) sections.push(`Metadata:\n${metadata}`);

  return sections.length ? sections.join('\n\n') : '';
}

function buildRedouCodexUserInputText(input = {}) {
  const task = input.task || {};
  const contextPackage = normalizeContextPackage(input.contextPackage || {});
  const userText = normalizeText(input.userInput || contextPackage.userInput || task.userInput || task.title);
  const contextText = buildRedouCodexContextText(contextPackage);
  return contextText
    ? `${userText}\n\nRedou context package for this turn:\n${contextText}`
    : userText;
}

function buildRedouCodexUserInputArray(input = {}) {
  return [{ type: 'text', text: buildRedouCodexUserInputText(input) || '' }];
}

function assertNoObjectPlaceholder(text) {
  if (/\[object Object\]/.test(String(text || ''))) {
    const error = new Error('Redou context serialization produced [object Object].');
    error.code = 'REDOU_CODEX_CONTEXT_SERIALIZATION_FAILED';
    throw error;
  }
}

module.exports = {
  assertNoObjectPlaceholder,
  buildRedouCodexContextText,
  enrichRedouCodexContextPackage,
  buildRedouCodexUserInputArray,
  buildRedouCodexUserInputText,
  compactObject,
  normalizeContextPackage,
  normalizeText,
  stableJson,
};
