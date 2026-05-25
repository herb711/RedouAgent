'use strict';

function redouCodexMethodFromEvent(event = {}) {
  return event.metadata && event.metadata.redouCodexMethod ? event.metadata.redouCodexMethod : null;
}

function isRedouCodexTurnCompletedEvent(event = {}) {
  return event.type === 'turn_update' && redouCodexMethodFromEvent(event) === 'turn/completed';
}

module.exports = {
  isRedouCodexTurnCompletedEvent,
  redouCodexMethodFromEvent,
};
