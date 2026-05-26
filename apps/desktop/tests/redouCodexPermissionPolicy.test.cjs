const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildInitializeRequest,
  buildThreadStartParams,
  buildTurnStartParams,
  mapRedouPermissionToRedouCodexApproval,
  mapRedouSandboxPolicy,
} = require('../src/runtimes/redou-codex/index.cjs');

test('Redou initializes redou-codex with experimental API for permission profiles', () => {
  const init = buildInitializeRequest({ experimentalApi: true });

  assert.equal(init.params.capabilities.experimentalApi, true);
});

test('Codex permission policy maps default workspace mode to schema-complete sandbox policy', () => {
  const mapped = mapRedouSandboxPolicy({
    sandboxMode: 'workspace-write',
    approvalMode: 'on-request',
    approvalsReviewer: 'user',
    networkPermission: 'restricted',
  });

  assert.equal(mapped.approvalPolicy, 'on-request');
  assert.equal(mapped.approvalsReviewer, 'user');
  assert.equal(mapped.permissionProfile, ':workspace');
  assert.equal(mapped.threadSandbox, 'workspace-write');
  assert.deepEqual(mapped.turnSandboxPolicy, {
    type: 'workspaceWrite',
    writableRoots: [],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  });
});

test('Codex permission policy uses redou-codex workspace profile on thread start', () => {
  const params = buildThreadStartParams({
    userInput: 'Start',
    permissionPolicy: {
      sandboxMode: 'workspace-write',
      approvalMode: 'on-request',
      approvalsReviewer: 'user',
      networkPermission: 'restricted',
      redouCodexPermissionProfile: ':workspace',
    },
  });

  assert.equal(params.approvalPolicy, 'on-request');
  assert.equal(params.approvalsReviewer, 'user');
  assert.equal(params.permissions, ':workspace');
  assert.equal(params.sandbox, undefined);
});

test('thread start params include dynamic Automation tools when supplied', () => {
  const dynamicTools = [{
    namespace: 'automation',
    name: 'create',
    description: 'Create an automation',
    inputSchema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] },
    deferLoading: false,
  }];
  const params = buildThreadStartParams({
    userInput: 'Start',
    dynamicTools,
  });

  assert.deepEqual(params.dynamicTools, dynamicTools);
});

test('Codex permission policy routes auto review to app-server approvalsReviewer and workspace profile', () => {
  const params = buildTurnStartParams({
    threadId: 'thread-1',
    userInput: 'Run the checks',
    permissionPolicy: {
      sandboxMode: 'workspace-write',
      approvalMode: 'on-request',
      approvalsReviewer: 'auto_review',
      networkPermission: 'restricted',
      redouCodexPermissionProfile: ':workspace',
    },
  });

  assert.equal(params.approvalPolicy, 'on-request');
  assert.equal(params.approvalsReviewer, 'auto_review');
  assert.equal(params.permissions, ':workspace');
  assert.equal(params.sandboxPolicy, undefined);
});

test('Codex permission policy maps full access to redou-codex danger profile', () => {
  const params = buildTurnStartParams({
    threadId: 'thread-1',
    userInput: 'Continue',
    permissionPolicy: {
      sandboxMode: 'danger-full-access',
      approvalMode: 'on-request',
      approvalsReviewer: 'user',
      networkPermission: 'enabled',
      redouCodexPermissionProfile: ':danger-full-access',
    },
  });

  assert.equal(params.approvalPolicy, 'on-request');
  assert.equal(params.approvalsReviewer, 'user');
  assert.equal(params.permissions, ':danger-full-access');
  assert.equal(params.sandboxPolicy, undefined);
});

test('MCP elicitation approvals map to app-server response shape', () => {
  const approve = mapRedouPermissionToRedouCodexApproval('approve', {
    method: 'mcpServer/elicitation/request',
    params: { mode: 'form', requestedSchema: { type: 'object', properties: {} } },
  });
  const reject = mapRedouPermissionToRedouCodexApproval('reject', {
    method: 'mcpServer/elicitation/request',
    params: { mode: 'form', requestedSchema: { type: 'object', properties: {} } },
  });

  assert.deepEqual(approve.result, { action: 'accept', content: {}, _meta: null });
  assert.deepEqual(reject.result, { action: 'decline', content: null, _meta: null });
});

test('approval decisions map for every approval request protocol shape', () => {
  const cases = [
    [
      'item/commandExecution/requestApproval',
      'approve',
      { decision: 'accept' },
    ],
    [
      'item/commandExecution/requestApproval',
      'approve-for-session',
      { decision: 'acceptForSession' },
    ],
    [
      'item/fileChange/requestApproval',
      'reject',
      { decision: 'decline' },
    ],
    [
      'item/fileChange/requestApproval',
      'cancel',
      { decision: 'cancel' },
    ],
    [
      'item/permissions/requestApproval',
      'approve',
      { permissions: { fileSystem: { write: ['D:/project'] } }, scope: 'turn' },
      { permissions: { fileSystem: { write: ['D:/project'] } } },
    ],
    [
      'execCommandApproval',
      'approve',
      { decision: 'approved' },
    ],
    [
      'applyPatchApproval',
      'reject',
      { decision: 'denied' },
    ],
    [
      'mcpServer/elicitation/request',
      'cancel',
      { action: 'cancel', content: null, _meta: null },
      { mode: 'form' },
    ],
  ];

  for (const [method, decision, expected, params = {}] of cases) {
    const mapped = mapRedouPermissionToRedouCodexApproval(decision, { method, params });
    assert.deepEqual(mapped.result, expected, method);
  }
});
