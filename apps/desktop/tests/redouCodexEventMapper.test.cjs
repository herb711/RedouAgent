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

test('MCP elicitation requests map to approval events', () => {
  const events = mapRedouCodexNotificationToAgentEvents({
    id: 0,
    method: 'mcpServer/elicitation/request',
    params: {
      threadId: 'thread-1',
      turnId: 'turn-1',
      serverName: 'MiniMax',
      mode: 'form',
      message: 'Allow the MiniMax MCP server to run tool "understand_image"?',
      requestedSchema: { type: 'object', properties: {} },
    },
  }, { taskId: 'task-1', projectId: 'project-1' });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'approval_required');
  assert.equal(events[0].payload.requestId, 0);
  assert.equal(events[0].payload.kind, 'mcp_elicitation');
  assert.equal(events[0].message, 'Allow the MiniMax MCP server to run tool "understand_image"?');
});

test('all approval server request methods map to approval events', () => {
  const cases = [
    ['item/commandExecution/requestApproval', 'command'],
    ['item/fileChange/requestApproval', 'file_change'],
    ['item/permissions/requestApproval', 'permissions'],
    ['execCommandApproval', 'command'],
    ['applyPatchApproval', 'file_change'],
    ['mcpServer/elicitation/request', 'mcp_elicitation'],
  ];

  for (const [method, kind] of cases) {
    const events = mapRedouCodexNotificationToAgentEvents({
      id: `${method}:request`,
      method,
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        reason: 'Needs approval',
        command: 'echo ok',
        message: method === 'mcpServer/elicitation/request' ? 'Allow MCP tool?' : undefined,
      },
    }, { taskId: 'task-1', projectId: 'project-1' });

    assert.equal(events.length, 1, method);
    assert.equal(events[0].type, 'approval_required', method);
    assert.equal(events[0].payload.kind, kind, method);
    assert.equal(events[0].metadata.requestId, `${method}:request`, method);
  }
});

test('non-approval server request methods do not map to approval cards', () => {
  for (const method of [
    'item/tool/requestUserInput',
    'item/tool/call',
    'account/chatgptAuthTokens/refresh',
    'attestation/generate',
  ]) {
    const events = mapRedouCodexNotificationToAgentEvents({
      id: `${method}:request`,
      method,
      params: { threadId: 'thread-1', turnId: 'turn-1' },
    }, { taskId: 'task-1', projectId: 'project-1' });

    assert.equal(events.some((event) => event.type === 'approval_required'), false, method);
  }
});
