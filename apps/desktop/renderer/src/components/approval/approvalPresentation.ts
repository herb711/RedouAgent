import type { ApprovalRequestProjection } from '../../types';

interface ApprovalPayload {
  kind?: string;
  method?: string;
  message?: string;
  reason?: string | null;
  command?: string | null;
  cwd?: string | null;
  serverName?: string | null;
  permissions?: unknown;
}

function payloadOf(approval: ApprovalRequestProjection): ApprovalPayload {
  return approval.payload && typeof approval.payload === 'object' ? approval.payload as ApprovalPayload : {};
}

export function approvalKindLabel(kind?: string) {
  switch (kind) {
    case 'command':
      return '命令';
    case 'file_change':
      return '文件变更';
    case 'permissions':
      return '权限申请';
    case 'mcp_elicitation':
      return 'MCP 工具';
    default:
      return '审批';
  }
}

export function approvalIsActionable(approval: ApprovalRequestProjection) {
  return approval.status === 'pending';
}

export function approvalStatusLabel(approval: ApprovalRequestProjection) {
  if (approval.status === 'expired') return '已失效';
  if (approval.status === 'pending') return approvalKindLabel(approval.kind);
  return approval.status || approvalKindLabel(approval.kind);
}

export function approvalExpiredMessage() {
  return '这条审批请求已经失效，不能再确认。请重新运行或继续这个任务，让 Redou 重新发起审批。';
}

function toolNameFromText(text: string) {
  const quoted = text.match(/tool\s+"([^"]+)"/i);
  if (quoted) return quoted[1];
  const singleQuoted = text.match(/tool\s+'([^']+)'/i);
  return singleQuoted ? singleQuoted[1] : '';
}

function shortCommand(command: string) {
  return command.length > 120 ? `${command.slice(0, 117)}...` : command;
}

export function approvalDescription(approval: ApprovalRequestProjection) {
  const payload = payloadOf(approval);
  const raw = payload.message || approval.description || approval.title || '';

  if (approval.kind === 'mcp_elicitation') {
    const server = payload.serverName || 'MCP 服务';
    const tool = toolNameFromText(raw);
    return tool ? `是否允许 ${server} 调用工具 ${tool}？` : `是否允许 ${server} 发起这次 MCP 请求？`;
  }

  if (approval.kind === 'command') {
    if (payload.command) return `是否允许执行命令：${shortCommand(payload.command)}`;
    return payload.reason || raw || '是否允许执行这条命令？';
  }

  if (approval.kind === 'file_change') {
    return payload.reason || raw || '是否允许应用这次文件变更？';
  }

  if (approval.kind === 'permissions') {
    return payload.reason || raw || '是否允许授予本轮请求的权限？';
  }

  return raw || '是否允许继续？';
}

export function approvalErrorMessage(message?: string | null) {
  if (!message) return '审批提交失败。';
  if (message.includes('Approval request is no longer active')) {
    return approvalExpiredMessage();
  }
  return message;
}
