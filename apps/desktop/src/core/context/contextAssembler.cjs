'use strict';

const { buildRulesContext } = require('./rulesContextBuilder.cjs');
const { buildMessageContext } = require('./messageContextBuilder.cjs');
const { buildFileContext } = require('./fileContextBuilder.cjs');
const { buildAttachmentContext } = require('./attachmentContextBuilder.cjs');
const { buildEnvironmentContext } = require('./environmentContextBuilder.cjs');
const { applyContextBudget } = require('./contextBudgeter.cjs');

async function assembleContextPackage(input = {}) {
  const rules = await buildRulesContext(input);
  const messages = await buildMessageContext(input);
  const files = await buildFileContext(input);
  const attachments = await buildAttachmentContext(input);
  const environment = await buildEnvironmentContext(input);
  return applyContextBudget({
    projectId: input.projectId || null,
    taskId: input.taskId || null,
    workspaceRoot: input.workspaceRoot || null,
    userInput: input.userInput || '',
    projectRules: rules.projectRules,
    taskRules: rules.taskRules,
    recentMessages: messages.recentMessages,
    selectedFiles: files.selectedFiles,
    attachments: attachments.attachments,
    environment,
    metadata: { phase: 'phase-1-skeleton' },
  });
}

module.exports = { assembleContextPackage };
