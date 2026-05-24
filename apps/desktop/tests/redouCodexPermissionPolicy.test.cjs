const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildTurnStartParams,
  mapRedouSandboxPolicy,
} = require('../src/runtimes/redou-codex/index.cjs');

test('Codex permission policy maps default workspace mode to schema-complete sandbox policy', () => {
  const mapped = mapRedouSandboxPolicy({
    sandboxMode: 'workspace-write',
    approvalMode: 'on-request',
    approvalsReviewer: 'user',
    networkPermission: 'restricted',
  });

  assert.equal(mapped.approvalPolicy, 'on-request');
  assert.equal(mapped.approvalsReviewer, 'user');
  assert.equal(mapped.threadSandbox, 'workspace-write');
  assert.deepEqual(mapped.turnSandboxPolicy, {
    type: 'workspaceWrite',
    writableRoots: [],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  });
});

test('Codex permission policy routes auto review to app-server approvalsReviewer', () => {
  const params = buildTurnStartParams({
    threadId: 'thread-1',
    userInput: 'Run the checks',
    permissionPolicy: {
      sandboxMode: 'workspace-write',
      approvalMode: 'on-request',
      approvalsReviewer: 'auto_review',
      networkPermission: 'restricted',
    },
  });

  assert.equal(params.approvalPolicy, 'on-request');
  assert.equal(params.approvalsReviewer, 'auto_review');
  assert.equal(params.sandboxPolicy.type, 'workspaceWrite');
});

test('Codex permission policy maps full access to dangerFullAccess', () => {
  const params = buildTurnStartParams({
    threadId: 'thread-1',
    userInput: 'Continue',
    permissionPolicy: {
      sandboxMode: 'danger-full-access',
      approvalMode: 'on-request',
      approvalsReviewer: 'user',
      networkPermission: 'enabled',
    },
  });

  assert.equal(params.approvalPolicy, 'on-request');
  assert.equal(params.approvalsReviewer, 'user');
  assert.deepEqual(params.sandboxPolicy, { type: 'dangerFullAccess' });
});
