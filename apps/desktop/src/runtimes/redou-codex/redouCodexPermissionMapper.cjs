'use strict';

const REDOU_CODEX_PERMISSION_PROFILES = Object.freeze({
  readOnly: ':read-only',
  workspace: ':workspace',
  dangerFullAccess: ':danger-full-access',
});

function normalizeMode(value, fallback) {
  if (!value) return fallback;
  return String(value).trim().replace(/[_\s]+/g, '-').toLowerCase();
}

function normalizePermissionProfile(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function mapApprovalPolicy(mode, warnings) {
  const normalized = normalizeMode(mode, 'on-request');
  if (normalized === 'allow-always' || normalized === 'always' || normalized === 'auto-approve') {
    warnings.push('Redou allow_always was downgraded to Codex on-request approval with session-scoped decisions.');
    return 'on-request';
  }
  if (normalized === 'on-failure' || normalized === 'on-request' || normalized === 'never' || normalized === 'untrusted') {
    return normalized;
  }
  return 'on-request';
}

function normalizeWritableRoots(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
}

function mapSandboxMode(policy, networkEnabled, warnings) {
  const mode = policy && (policy.sandboxMode || policy.sandbox || policy.mode);
  const normalized = normalizeMode(mode, 'workspace-write');
  if (normalized === 'read-only' || normalized === 'readonly') {
    return {
      threadSandbox: 'read-only',
      turnSandboxPolicy: { type: 'readOnly', networkAccess: Boolean(networkEnabled) },
    };
  }
  if (normalized === 'danger-full-access' || normalized === 'full-access') {
    warnings.push('Danger full access is passed through to Codex; Redou will still route high-risk actions through Codex approvals.');
    return {
      threadSandbox: 'danger-full-access',
      turnSandboxPolicy: { type: 'dangerFullAccess' },
    };
  }
  return {
    threadSandbox: 'workspace-write',
    turnSandboxPolicy: {
      type: 'workspaceWrite',
      writableRoots: normalizeWritableRoots(policy.writableRoots || policy.writable_roots),
      networkAccess: Boolean(networkEnabled),
      excludeTmpdirEnvVar: Boolean(policy.excludeTmpdirEnvVar || policy.exclude_tmpdir_env_var),
      excludeSlashTmp: Boolean(policy.excludeSlashTmp || policy.exclude_slash_tmp),
    },
  };
}

function permissionProfileForSandboxPolicy(policy = {}) {
  const explicit = normalizePermissionProfile(
    policy.redouCodexPermissionProfile
      || policy.permissionProfile
      || policy.permissionProfileId
      || policy.permissions,
  );
  if (explicit) return explicit;

  const normalized = normalizeMode(policy.sandboxMode || policy.sandbox || policy.mode, 'workspace-write');
  if (normalized === 'read-only' || normalized === 'readonly') return REDOU_CODEX_PERMISSION_PROFILES.readOnly;
  if (normalized === 'danger-full-access' || normalized === 'full-access') return REDOU_CODEX_PERMISSION_PROFILES.dangerFullAccess;
  return REDOU_CODEX_PERMISSION_PROFILES.workspace;
}

function mapRedouSandboxPolicy(policy = {}) {
  const warnings = [];
  const networkEnabled = policy.networkPermission === 'enabled'
    || policy.networkPermission === true
    || policy.network === 'enabled'
    || policy.network === true;
  const sandbox = mapSandboxMode(policy, networkEnabled, warnings);
  return {
    ...sandbox,
    permissionProfile: permissionProfileForSandboxPolicy(policy),
    approvalPolicy: mapApprovalPolicy(policy.approvalMode || policy.approvalPolicy, warnings),
    approvalsReviewer: policy.approvalsReviewer || 'user',
    commandPermission: policy.commandPermission || 'codex',
    filePermission: policy.filePermission || 'codex',
    networkPermission: networkEnabled ? 'enabled' : 'restricted',
    warnings,
  };
}

function normalizeApprovalDecision(decision = {}) {
  if (typeof decision === 'string') return { action: decision };
  return {
    action: decision.action || decision.decision || decision.status,
    content: decision.content,
    meta: decision._meta === undefined ? decision.meta : decision._meta,
    permissions: decision.permissions,
    scope: decision.scope,
    execpolicyAmendment: decision.execpolicyAmendment || decision.execpolicy_amendment,
    networkPolicyAmendment: decision.networkPolicyAmendment || decision.network_policy_amendment,
  };
}

function mapCommandDecision(action, normalized) {
  if (action === 'approve' || action === 'accept' || action === 'approved') return 'accept';
  if (action === 'approve-for-session' || action === 'accept-for-session' || action === 'allow-always') return 'acceptForSession';
  if (action === 'reject' || action === 'decline' || action === 'denied') return 'decline';
  if (action === 'cancel' || action === 'abort') return 'cancel';
  if (action === 'accept-with-execpolicy' && normalized.execpolicyAmendment) {
    return { acceptWithExecpolicyAmendment: { execpolicy_amendment: normalized.execpolicyAmendment } };
  }
  if (action === 'apply-network-policy' && normalized.networkPolicyAmendment) {
    return { applyNetworkPolicyAmendment: { network_policy_amendment: normalized.networkPolicyAmendment } };
  }
  return 'decline';
}

function mapLegacyCommandDecision(action) {
  if (action === 'approve' || action === 'accept' || action === 'approved') return 'approved';
  if (action === 'approve-for-session' || action === 'accept-for-session' || action === 'allow-always') return 'approved_for_session';
  if (action === 'cancel' || action === 'abort') return 'abort';
  return 'denied';
}

function mapFileDecision(action) {
  if (action === 'approve' || action === 'accept' || action === 'approved') return 'accept';
  if (action === 'approve-for-session' || action === 'accept-for-session' || action === 'allow-always') return 'acceptForSession';
  if (action === 'cancel' || action === 'abort') return 'cancel';
  return 'decline';
}

function mapPermissionsDecision(action, normalized, request = {}) {
  if (action === 'approve' || action === 'accept' || action === 'approved' || action === 'approve-for-session') {
    return {
      permissions: normalized.permissions || request.permissions || {},
      scope: normalized.scope || (action === 'approve-for-session' ? 'session' : 'turn'),
    };
  }
  if (action === 'allow-always') {
    return {
      permissions: normalized.permissions || request.permissions || {},
      scope: 'session',
    };
  }
  return { permissions: {}, scope: 'turn' };
}

function defaultMcpElicitationContent(request = {}) {
  const params = request.params || request;
  return params.mode === 'form' ? {} : null;
}

function mapMcpElicitationDecision(action, normalized, request = {}) {
  const meta = normalized.meta === undefined ? null : normalized.meta;
  if (
    action === 'approve'
    || action === 'accept'
    || action === 'approved'
    || action === 'approve-for-session'
    || action === 'allow-always'
  ) {
    return {
      action: 'accept',
      content: normalized.content === undefined ? defaultMcpElicitationContent(request) : normalized.content,
      _meta: meta,
    };
  }
  if (action === 'cancel' || action === 'abort') {
    return { action: 'cancel', content: null, _meta: meta };
  }
  return { action: 'decline', content: null, _meta: meta };
}

function mapRedouPermissionToRedouCodexApproval(decision = {}, request = {}) {
  const warnings = [];
  const normalized = normalizeApprovalDecision(decision);
  const action = normalizeMode(normalized.action, 'decline');
  const method = request.method || decision.method || '';

  if (action === 'allow-always') {
    warnings.push('Redou allow_always was downgraded to a Codex session-scoped approval.');
  }

  if (method === 'item/permissions/requestApproval') {
    return { result: mapPermissionsDecision(action, normalized, request.params || request), warnings };
  }

  if (method === 'mcpServer/elicitation/request') {
    return { result: mapMcpElicitationDecision(action, normalized, request.params || request), warnings };
  }

  if (method === 'item/fileChange/requestApproval') {
    return { result: { decision: mapFileDecision(action) }, warnings };
  }

  if (method === 'applyPatchApproval' || method === 'execCommandApproval') {
    return { result: { decision: mapLegacyCommandDecision(action) }, warnings };
  }

  return { result: { decision: mapCommandDecision(action, normalized) }, warnings };
}

module.exports = {
  REDOU_CODEX_PERMISSION_PROFILES,
  mapRedouPermissionToRedouCodexApproval,
  mapRedouSandboxPolicy,
};
