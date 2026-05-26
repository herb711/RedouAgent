const assert = require('node:assert/strict');
const test = require('node:test');

const { routeApprovalDecision } = require('../src/orchestrator/approvalRouter.cjs');

test('approval router preserves original request id type from stored approval events', async () => {
  let received = null;
  const runtime = {
    async respondApproval(input) {
      received = input;
      return { ok: true };
    },
  };
  const eventStore = {
    async list() {
      return [{
        id: 'event:approval',
        type: 'approval_required',
        runtime: 'redou-codex',
        payload: {
          requestId: 0,
          method: 'mcpServer/elicitation/request',
          kind: 'mcp_elicitation',
          mode: 'form',
        },
      }];
    },
  };

  await routeApprovalDecision({ requestId: '0', decision: 'approve' }, { eventStore, runtime });

  assert.equal(received.requestId, 0);
  assert.equal(received.request.method, 'mcpServer/elicitation/request');
});

test('approval router scopes approval lookup to the current task', async () => {
  let filter = null;
  let received = null;
  const runtime = {
    async respondApproval(input) {
      received = input;
      return { ok: true };
    },
  };
  const eventStore = {
    async list(input) {
      filter = input;
      return [{
        id: 'event:approval',
        taskId: 'task-1',
        type: 'approval_required',
        runtime: 'redou-codex',
        payload: {
          requestId: 0,
          method: 'mcpServer/elicitation/request',
          kind: 'mcp_elicitation',
          mode: 'form',
        },
      }];
    },
  };

  await routeApprovalDecision({ requestId: '0', taskId: 'task-1', decision: 'approve' }, { eventStore, runtime });

  assert.deepEqual(filter, { taskId: 'task-1' });
  assert.equal(received.taskId, 'task-1');
  assert.equal(received.requestId, 0);
});

test('approval router can respond to legacy raw MCP elicitation logs', async () => {
  let received = null;
  const runtime = {
    async respondApproval(input) {
      received = input;
      return { ok: true };
    },
  };
  const eventStore = {
    async list() {
      return [{
        id: 'event:raw-approval',
        type: 'raw_log',
        runtime: 'redou-codex',
        title: 'mcpServer/elicitation/request',
        payload: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          serverName: 'MiniMax',
          mode: 'form',
          message: 'Allow MCP tool?',
        },
        metadata: {
          redouCodexMethod: 'mcpServer/elicitation/request',
          raw: JSON.stringify({
            id: 0,
            method: 'mcpServer/elicitation/request',
            params: {
              threadId: 'thread-1',
              turnId: 'turn-1',
              serverName: 'MiniMax',
              mode: 'form',
              message: 'Allow MCP tool?',
            },
          }),
        },
      }];
    },
  };

  await routeApprovalDecision({ requestId: '0', decision: 'approve' }, { eventStore, runtime });

  assert.equal(received.requestId, 0);
  assert.equal(received.request.kind, 'mcp_elicitation');
  assert.equal(received.request.message, 'Allow MCP tool?');
});
