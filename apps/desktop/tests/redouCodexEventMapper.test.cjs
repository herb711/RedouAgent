const assert = require('node:assert/strict');
const test = require('node:test');

const { mapRedouCodexNotificationToAgentEvents } = require('../src/runtimes/redou-codex/redouCodexEventMapper.cjs');

test('agent message started notifications do not emit completed assistant messages', () => {
  const events = mapRedouCodexNotificationToAgentEvents({
    method: 'item/started',
    params: {
      item: { id: 'msg-1', type: 'agentMessage', text: '' },
      threadId: 'thread-1',
      turnId: 'turn-1',
    },
  }, { taskId: 'task-1', projectId: 'project-1' });

  assert.equal(events.some((event) => event.type === 'message_completed'), false);
  assert.equal(events.some((event) => event.type === 'item_update'), true);
});

test('agent message completed notifications emit a single assistant message', () => {
  const events = mapRedouCodexNotificationToAgentEvents({
    method: 'item/completed',
    params: {
      item: { id: 'msg-1', type: 'agentMessage', text: 'done' },
      threadId: 'thread-1',
      turnId: 'turn-1',
    },
  }, { taskId: 'task-1', projectId: 'project-1' });

  assert.equal(events.filter((event) => event.type === 'message_completed').length, 1);
  assert.equal(events.find((event) => event.type === 'message_completed').message, 'done');
});
