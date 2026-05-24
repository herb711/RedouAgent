'use strict';

function buildRedouCodexTurnInput(contextPackage = {}) {
  return {
    type: 'text',
    text: [
      contextPackage.userInput || '',
      contextPackage.projectRules ? `Project rules:\n${[].concat(contextPackage.projectRules).join('\n')}` : '',
      contextPackage.taskRules ? `Task rules:\n${[].concat(contextPackage.taskRules).join('\n')}` : '',
    ].filter(Boolean).join('\n\n'),
    contextPackage,
  };
}

module.exports = { buildRedouCodexTurnInput };
