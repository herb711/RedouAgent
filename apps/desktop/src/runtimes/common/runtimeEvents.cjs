'use strict';

const RUNTIME_EVENT_TYPES = Object.freeze({
  RAW: 'raw_log',
  THREAD: 'thread_update',
  TURN: 'turn_update',
  PLAN: 'plan_update',
  ITEM: 'item_update',
  MESSAGE_DELTA: 'message_delta',
  MESSAGE_COMPLETED: 'message_completed',
  DIFF: 'diff_update',
  APPROVAL: 'approval_required',
  APPROVAL_RESOLVED: 'approval_resolved',
  COMMAND: 'command_update',
  FILE_CHANGE: 'file_change',
  USAGE: 'usage_update',
  ERROR: 'runtime_error',
});

module.exports = { RUNTIME_EVENT_TYPES };
