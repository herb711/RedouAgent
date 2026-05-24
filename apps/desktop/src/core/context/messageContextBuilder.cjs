'use strict';

async function buildMessageContext(input = {}) {
  // TODO: select recent user/assistant messages without creating a Redou planner.
  return { recentMessages: input.recentMessages || [] };
}

module.exports = { buildMessageContext };
