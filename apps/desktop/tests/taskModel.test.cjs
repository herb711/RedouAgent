'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createDefaultTask } = require('../src/core/models/task.cjs');

test('task model migrates legacy Codex session fields to redou-codex fields', () => {
  const task = createDefaultTask({
    id: 'task-1',
    codexThreadId: 'thread-legacy',
    codexActiveTurnId: 'turn-legacy',
  });

  assert.equal(task.redouCodexThreadId, 'thread-legacy');
  assert.equal(task.redouCodexActiveTurnId, 'turn-legacy');
  assert.equal(Object.prototype.hasOwnProperty.call(task, 'codexThreadId'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(task, 'codexActiveTurnId'), false);
});
