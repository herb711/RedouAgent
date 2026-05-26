import { AlertCircle, CheckCircle2, CircleDot, Loader2 } from 'lucide-react';
import type { RedouCodexPlanProjection, LogEntryData, ProgressStepData, RuntimeStatusData, WorkbenchTask } from '../../types';

interface RunStatusCardProps {
  task: WorkbenchTask;
  progressSteps: ProgressStepData[];
  planEntries: RedouCodexPlanProjection[];
  logs: LogEntryData[];
  runtimeStatus?: RuntimeStatusData | null;
}

function compactId(id?: string | null) {
  if (!id) return '';
  return id.length > 12 ? `${id.slice(0, 6)}...${id.slice(-4)}` : id;
}

function statusLabel(status?: string | null) {
  if (status === 'interrupted') return '已停止';
  if (!status) return '等待状态';
  if (status === 'running' || status === 'started' || status === 'active' || status === 'in_progress' || status === 'inProgress') return '正在执行';
  if (status === 'completed') return '已完成';
  if (status === 'failed' || status === 'error') return '执行出错';
  if (status === 'incomplete') return '未完成';
  if (status === 'waiting_approval') return '等待审批';
  if (status === 'degraded') return '兼容模式';
  if (status === 'cancelled' || status === 'canceled') return '已取消';
  return status;
}

function usageLabel(usage?: Record<string, unknown> | null) {
  if (!usage) return '';
  const pairs = Object.entries(usage).filter(([, value]) => typeof value === 'number') as Array<[string, number]>;
  const total = pairs.find(([key]) => /total.*tokens?|tokens.*total|total_tokens/i.test(key));
  const input = pairs.find(([key]) => /input.*tokens?|prompt.*tokens?/i.test(key));
  const output = pairs.find(([key]) => /output.*tokens?|completion.*tokens?/i.test(key));
  if (total) return `${total[1].toLocaleString()} tokens`;
  if (input || output) {
    return [
      input ? `in ${input[1].toLocaleString()}` : '',
      output ? `out ${output[1].toLocaleString()}` : '',
    ].filter(Boolean).join(' / ');
  }
  return '';
}

function activeLabel(progressSteps: ProgressStepData[], runtimeStatus?: RuntimeStatusData | null, logs: LogEntryData[] = []) {
  const activeStep = progressSteps.find((step) => step.status === 'active') || progressSteps.find((step) => step.status === 'error');
  if (activeStep) return activeStep.label;
  if (runtimeStatus?.activeItem?.title) return runtimeStatus.activeItem.title;
  const recentUsefulLog = [...logs].reverse().find((log) => log.message && log.level !== 'debug');
  return recentUsefulLog?.message || 'Redou 正在同步运行状态';
}

function runIcon(status: string) {
  if (status === 'interrupted') return <CircleDot size={16} />;
  if (status === 'error' || status === 'failed') return <AlertCircle size={16} />;
  if (status === 'waiting_approval' || status === 'degraded') return <AlertCircle size={16} />;
  if (status === 'completed') return <CheckCircle2 size={16} />;
  if (status === 'running' || status === 'started' || status === 'active' || status === 'in_progress' || status === 'inProgress') return <Loader2 size={16} />;
  return <CircleDot size={16} />;
}

export function RunStatusCard({ task, progressSteps, planEntries, logs, runtimeStatus }: RunStatusCardProps) {
  const turnStatus = runtimeStatus?.turnStatus || task.status;
  const stateLabel = statusLabel(turnStatus);
  const completed = progressSteps.filter((step) => step.status === 'completed').length;
  const activeText = activeLabel(progressSteps, runtimeStatus, logs);
  const usage = usageLabel(runtimeStatus?.usage);
  const visibleSteps = progressSteps.slice(-4);
  const errorMessage = runtimeStatus?.lastError?.message
    || runtimeStatus?.stopReason?.message
    || runtimeStatus?.continuation?.message
    || (task.status === 'error' ? [...logs].reverse().find((log) => log.level === 'error')?.message : '');

  return (
    <aside className="redou-run-status-card" data-status={turnStatus || task.status} aria-label="Redou runtime status">
      <div className="redou-run-status-topline">
        <span className="redou-run-status-icon">{runIcon(turnStatus || task.status)}</span>
        <div>
          <strong>{stateLabel}</strong>
          <span>{activeText}</span>
        </div>
      </div>
      <div className="redou-run-status-metrics">
        <span>{progressSteps.length ? `${completed}/${progressSteps.length} 步` : `${planEntries.length} 个计划项`}</span>
        {task.queueDepth ? <span>{task.queueDepth} 条排队</span> : null}
        {runtimeStatus?.activeTurnId ? <span>turn {compactId(runtimeStatus.activeTurnId)}</span> : null}
        {usage ? <span>{usage}</span> : null}
      </div>
      {visibleSteps.length ? (
        <div className="redou-run-status-steps">
          {visibleSteps.map((step) => (
            <span key={step.id} data-status={step.status}>{step.label}</span>
          ))}
        </div>
      ) : null}
      {errorMessage ? <p className="redou-run-status-error">{errorMessage}</p> : null}
    </aside>
  );
}
