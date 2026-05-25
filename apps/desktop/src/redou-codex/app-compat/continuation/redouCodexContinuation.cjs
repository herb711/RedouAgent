'use strict';

const { detectIncompleteTurn } = require('./redouCodexIncompleteTurnDetector.cjs');

function buildRedouCodexContinuationDecision(events = [], options = {}) {
  const incomplete = detectIncompleteTurn(events);
  if (!incomplete.incomplete) {
    return { recommended: false, automatic: false, reason: incomplete.status || 'not_needed' };
  }

  const allowAutomatic = Boolean(options.allowAutomaticContinuation);
  return {
    recommended: true,
    automatic: allowAutomatic,
    reason: incomplete.reason,
    turnId: incomplete.turnId,
    message: incomplete.message,
    nextInput: allowAutomatic
      ? 'Continue the work you just said you would do. Use tools now, or report the blocker clearly.'
      : null,
  };
}

module.exports = {
  buildRedouCodexContinuationDecision,
};
