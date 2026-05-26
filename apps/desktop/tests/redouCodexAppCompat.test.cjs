'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRedouCodexDeveloperInstructions,
  buildRedouCodexStateSnapshot,
  buildRedouCodexUserInputText,
  detectIncompleteTurn,
  explainRedouCodexStopReason,
  inferRedouCodexModelCapability,
} = require('../src/redou-codex/app-compat/index.cjs');

test('redou-codex context serialization does not emit object placeholders', () => {
  const text = buildRedouCodexUserInputText({
    userInput: 'Check server',
    contextPackage: {
      environment: { cwd: 'D:\\work', shell: 'powershell' },
      metadata: { taskTitle: 'DoGame' },
    },
  });

  assert.doesNotMatch(text, /\[object Object\]/);
  assert.match(text, /"cwd": "D:\\\\work"/);
  assert.match(text, /"taskTitle": "DoGame"/);
});

test('developer instructions include degraded model compatibility warnings', () => {
  const capability = inferRedouCodexModelCapability({
    providerId: 'custom-provider',
    model: 'unknown-agent-model',
  });
  const instructions = buildRedouCodexDeveloperInstructions({
    task: { id: 'task-1', title: 'Investigate' },
    modelCapability: capability,
  });

  assert.equal(capability.degraded, true);
  assert.match(instructions, /degraded compatibility mode/);
  assert.match(instructions, /Model metadata/);
});

test('incomplete detector catches assistant promise without following tool call', () => {
  const events = [
    {
      id: 'msg-1',
      type: 'message_completed',
      timestamp: '2026-05-24T05:29:47.000Z',
      message: '服务器安装了 Synology Drive Client 8.0.3，正在同步。我来查看当前的同步配置。',
      payload: { item: { id: 'msg-1', type: 'agentMessage', text: '服务器安装了 Synology Drive Client 8.0.3，正在同步。我来查看当前的同步配置。' } },
      metadata: { turnId: 'turn-1', itemId: 'msg-1' },
    },
    {
      id: 'turn-1-completed',
      type: 'turn_update',
      timestamp: '2026-05-24T05:29:48.000Z',
      message: 'completed',
      payload: { turn: { id: 'turn-1', status: 'completed' } },
      metadata: { turnId: 'turn-1', redouCodexMethod: 'turn/completed' },
    },
  ];

  const incomplete = detectIncompleteTurn(events);
  const state = buildRedouCodexStateSnapshot(events);
  const diagnostics = explainRedouCodexStopReason(events);

  assert.equal(incomplete.incomplete, true);
  assert.equal(state.status, 'incomplete');
  assert.equal(state.needsAttention, true);
  assert.equal(state.continuation.recommended, true);
  assert.equal(diagnostics.stopReason.code, 'assistant_promised_followup_without_tool_call');
});

test('incomplete detector ignores promises followed by a tool event', () => {
  const events = [
    {
      id: 'msg-1',
      type: 'message_completed',
      timestamp: '2026-05-24T05:29:47.000Z',
      message: '我来查看当前配置。',
      payload: { item: { id: 'msg-1', type: 'agentMessage', text: '我来查看当前配置。' } },
      metadata: { turnId: 'turn-1', itemId: 'msg-1' },
    },
    {
      id: 'cmd-1',
      type: 'command_update',
      timestamp: '2026-05-24T05:29:47.500Z',
      message: 'synology-drive status',
      payload: { item: { id: 'cmd-1', type: 'commandExecution', command: 'synology-drive status' } },
      metadata: { turnId: 'turn-1', itemId: 'cmd-1', itemKind: 'commandExecution' },
    },
    {
      id: 'turn-1-completed',
      type: 'turn_update',
      timestamp: '2026-05-24T05:29:48.000Z',
      message: 'completed',
      payload: { turn: { id: 'turn-1', status: 'completed' } },
      metadata: { turnId: 'turn-1', redouCodexMethod: 'turn/completed' },
    },
  ];

  assert.equal(detectIncompleteTurn(events).incomplete, false);
  assert.equal(buildRedouCodexStateSnapshot(events).status, 'completed');
});

test('state snapshot marks legacy raw MCP approval stalls as interrupted', () => {
  const events = [
    {
      id: 'turn-started',
      type: 'turn_update',
      timestamp: '2026-05-26T03:28:20.431Z',
      message: 'inProgress',
      payload: { turn: { id: 'turn-1', status: 'inProgress' } },
      metadata: { turnId: 'turn-1', redouCodexMethod: 'turn/started' },
    },
    {
      id: 'thread-waiting',
      type: 'thread_update',
      timestamp: '2026-05-26T03:28:55.191Z',
      message: { type: 'active', activeFlags: ['waitingOnApproval'] },
      payload: { status: { type: 'active', activeFlags: ['waitingOnApproval'] }, threadId: 'thread-1' },
      metadata: { redouCodexMethod: 'thread/status/changed', threadId: 'thread-1' },
    },
    {
      id: 'raw-mcp-approval',
      type: 'raw_log',
      timestamp: '2026-05-26T03:28:55.191Z',
      title: 'mcpServer/elicitation/request',
      message: 'Allow MCP tool?',
      payload: { threadId: 'thread-1', turnId: 'turn-1', serverName: 'MiniMax', message: 'Allow MCP tool?' },
      metadata: {
        redouCodexMethod: 'mcpServer/elicitation/request',
        threadId: 'thread-1',
        turnId: 'turn-1',
        raw: JSON.stringify({
          id: 0,
          method: 'mcpServer/elicitation/request',
          params: { threadId: 'thread-1', turnId: 'turn-1', serverName: 'MiniMax', message: 'Allow MCP tool?' },
        }),
      },
    },
  ];

  const state = buildRedouCodexStateSnapshot(events);
  assert.equal(state.status, 'interrupted');
  assert.equal(state.needsAttention, true);
  assert.equal(state.threadStatus, 'active');
  assert.equal(state.stopReason.code, 'approval_request_expired');
  assert.equal(state.stopReason.details.approvalRequestId, 0);
});
