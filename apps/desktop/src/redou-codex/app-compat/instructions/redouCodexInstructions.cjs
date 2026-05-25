'use strict';

const {
  compactObject,
  normalizeText,
  stableJson,
} = require('../context/redouCodexContextSerializer.cjs');

const REDOU_CODEX_AUTONOMY_INSTRUCTIONS = [
  'You are running inside Redou Workbench. Continue working until the user request is actually handled or you are blocked.',
  'Do not end a turn by saying you will inspect, check, run, change, or continue something next; either do it in the same turn with the available tools, or clearly state what user input/permission is needed.',
].join('\n');

function modelCapabilityInstructions(capability = null) {
  if (!capability) return '';
  const warnings = Array.isArray(capability.warnings) ? capability.warnings : [];
  const lines = [];
  if (capability.degraded) {
    lines.push('This model is running in Redou degraded compatibility mode. Prefer explicit tool use, short verification loops, and clear blocker reporting.');
  }
  for (const warning of warnings) {
    const text = normalizeText(warning);
    if (text) lines.push(`- ${text}`);
  }
  return lines.length ? `Model compatibility notes:\n${lines.join('\n')}` : '';
}

function buildRedouCodexDeveloperInstructions(input = {}) {
  const task = input.task || {};
  const contextPackage = input.contextPackage || {};
  const sections = [REDOU_CODEX_AUTONOMY_INSTRUCTIONS];

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
    sections.push(`Redou task metadata:\n${stableJson(metadata)}`);
  }

  const capabilityText = modelCapabilityInstructions(input.modelCapability || input.modelCompatibility || input.modelConfig?.modelCapability);
  if (capabilityText) sections.push(capabilityText);

  const explicit = normalizeText(input.developerInstructions || contextPackage.developerInstructions);
  if (explicit) sections.push(explicit);

  return sections.filter(Boolean).join('\n\n') || null;
}

module.exports = {
  REDOU_CODEX_AUTONOMY_INSTRUCTIONS,
  buildRedouCodexDeveloperInstructions,
  modelCapabilityInstructions,
};
