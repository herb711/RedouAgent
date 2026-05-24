'use strict';

const { REDOU_CODEX_RUNTIME_ID } = require('../runtimes/redou-codex/redouCodexRuntimeConfig.cjs');

const { createDefaultContextPackage } = require('../core/models/contextPackage.cjs');

async function assembleContextPackage(input = {}, dependencies = {}) {
  const task = input.task || (input.taskId && dependencies.taskStore && await dependencies.taskStore.get(input.taskId)) || {};
  const project = input.project || (task.projectId && dependencies.projectStore && await dependencies.projectStore.get(task.projectId)) || {};
  return createDefaultContextPackage({
    projectId: project.id || task.projectId || null,
    taskId: task.id || input.taskId || null,
    workspaceRoot: project.rootPath || input.workspaceRoot || process.cwd(),
    userInput: input.userInput || task.userInput || '',
    projectRules: input.projectRules || project.projectRules || [],
    taskRules: input.taskRules || task.taskRules || [],
    recentMessages: input.recentMessages || [],
    selectedFiles: input.selectedFiles || [],
    attachments: input.attachments || [],
    environment: {
      cwd: project.rootPath || process.cwd(),
      runtime: task.runtime || REDOU_CODEX_RUNTIME_ID,
      ...(input.environment || {}),
    },
    metadata: {
      ...(input.metadata || {}),
      projectName: project.name || null,
      taskTitle: task.title || null,
    },
  });
}

function createContextAssembler(dependencies = {}) {
  return {
    assemble(input = {}) {
      return assembleContextPackage(input, dependencies);
    },
  };
}

module.exports = { assembleContextPackage, createContextAssembler };
