import type {
  ComposerPermissionModeId,
  ComposerPermissionPolicy,
  ComposerReasoningEffortId,
} from '../../types';

export const permissionModeOptions: Array<{
  id: ComposerPermissionModeId;
  label: string;
  description: string;
}> = [
  {
    id: 'default',
    label: '\u9ed8\u8ba4\u6743\u9650',
    description: '\u5de5\u4f5c\u533a\u5199\u5165\uff0c\u654f\u611f\u64cd\u4f5c\u7531\u7528\u6237\u786e\u8ba4\u3002',
  },
  {
    id: 'auto-review',
    label: '\u81ea\u52a8\u5ba1\u67e5',
    description: '\u5de5\u4f5c\u533a\u5199\u5165\uff0c\u5ba1\u6279\u8bf7\u6c42\u4ea4\u7ed9\u81ea\u52a8\u5ba1\u67e5\u3002',
  },
  {
    id: 'full-access',
    label: '\u5b8c\u5168\u8bbf\u95ee\u6743\u9650',
    description: '\u5b8c\u6574\u672c\u5730\u8bbf\u95ee\u6743\u9650\uff0c\u4ecd\u4fdd\u7559 Codex \u5ba1\u6279\u901a\u8def\u3002',
  },
];

export const reasoningEffortOptions: Array<{ id: ComposerReasoningEffortId; label: string }> = [
  { id: 'auto', label: '\u667a\u80fd' },
  { id: 'low', label: '\u4f4e' },
  { id: 'medium', label: '\u4e2d' },
  { id: 'high', label: '\u9ad8' },
  { id: 'xhigh', label: '\u8d85\u9ad8' },
];

export const modelMenuLabel = '\u6a21\u578b';

export const speedMenuLabel = '\u901f\u5ea6';

export const modelOptions = [
  'GPT-5.5',
  'GPT-5.4',
  'GPT-5.4-Mini',
  'GPT-5.3-Codex',
  'GPT-5.3-Codex-Spark',
  'GPT-5.2',
];

export function getPermissionModeOption(mode: ComposerPermissionModeId) {
  return permissionModeOptions.find((option) => option.id === mode) || permissionModeOptions[0];
}

export function getReasoningEffortLabel(effort: ComposerReasoningEffortId) {
  return reasoningEffortOptions.find((option) => option.id === effort)?.label || '\u667a\u80fd';
}

export function createPermissionPolicy(mode: ComposerPermissionModeId): ComposerPermissionPolicy {
  if (mode === 'full-access') {
    return {
      sandboxMode: 'danger-full-access',
      approvalMode: 'on-request',
      approvalsReviewer: 'user',
      networkPermission: 'enabled',
    };
  }

  if (mode === 'auto-review') {
    return {
      sandboxMode: 'workspace-write',
      approvalMode: 'on-request',
      approvalsReviewer: 'auto_review',
      networkPermission: 'restricted',
    };
  }

  return {
    sandboxMode: 'workspace-write',
    approvalMode: 'on-request',
    approvalsReviewer: 'user',
    networkPermission: 'restricted',
  };
}
