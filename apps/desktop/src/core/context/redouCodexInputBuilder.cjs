'use strict';

const { buildRedouCodexUserInputText } = require('../../redou-codex/app-compat/context/redouCodexContextSerializer.cjs');

function buildRedouCodexTurnInput(contextPackage = {}) {
  return {
    type: 'text',
    text: buildRedouCodexUserInputText({ contextPackage }),
    contextPackage,
  };
}

module.exports = { buildRedouCodexTurnInput };
