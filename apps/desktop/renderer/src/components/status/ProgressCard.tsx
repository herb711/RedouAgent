import { AlertCircle, CheckCircle2, CircleDot, Loader2 } from 'lucide-react';
import { ProgressStep } from './ProgressStep';
import type { CodexPlanProjection, LogEntryData, ProgressStepData, RuntimeStatusData, WorkbenchTask } from '../../types';

interface ProgressCardProps {
  task: WorkbenchTask;
  steps: ProgressStepData[];
  planEntries: CodexPlanProjection[];
  logs: LogEntryData[];
  runtimeStatus?: RuntimeStatusData | null;
  runtimeAvailability?: unknown;
  runtimeError?: string | null;
  apiMode?: 'ipc' | 'mock';
}

function compactId(id?: string | null) {
  if (!id) return '';
  return id.length > 18 ? `${id.slice(0, 8)}...${id.slice(-6)}` : id;
}

function statusLabel(status?: string | null) {
  if (!status) return '等待状态';
  if (status === 'running' || status === 'started' || status === 'active' || status === 'in_progress' || status === 'inProgress') return '正在执行';
  if (status === 'completed') return '已完成';
  if (status === 'failed' || status === 'error') return '执行出错';
  if (status === 'cancelled' || status === 'canceled') return '已取消';
  if (status === 'blocked') return '等待处理';
  if (status === 'created') return '未开始';
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

function activeLabel(steps: ProgressStepData[], runtimeStatus?: RuntimeStatusData | null, logs: LogEntryData[] = []) {
  const activeStep = steps.find((step) => step.status === 'active') || steps.find((step) => step.status === 'error');
  if (activeStep) return activeStep.label;
  if (runtimeStatus?.activeItem?.title) return runtimeStatus.activeItem.title;
  const recentUsefulLog = [...logs].reverse().find((log) => log.message && log.level !== 'debug');
  return recentUsefulLog?.message || '等待 Redou 上报执行步骤';
}

function runIcon(status: string) {
  if (status === 'error' || status === 'failed') return <AlertCircle size={16} />;
  if (status === 'completed') return <CheckCircle2 size={16} />;
  if (status === 'running' || status === 'started' || status === 'active' || status === 'in_progress' || status === 'inProgress') return <Loader2 size={16} />;
  return <CircleDot size={16} />;
}

function readAvailability(availability: unknown) {
  const value = availability as {
    available?: boolean;
    status?: string;
    lastError?: { code?: string; message?: string };
    executablePath?: string;
  } | null;
  return {
    available: Boolean(value && value.available),
    status: value && value.status ? value.status : 'unknown',
    code: value && value.lastError ? value.lastError.code : null,
    message: value && value.lastError ? value.lastError.message : null,
    executablePath: value && value.executablePath ? value.executablePath : null,
  };
}

export function ProgressCard({
  task,
  steps,
  planEntries,
  logs,
  runtimeStatus,
  runtimeAvailability,
  runtimeError,
  apiMode = 'mock',
}: ProgressCardProps) {
  const turnStatus = runtimeStatus?.turnStatus || task.status;
  const completed = steps.filter((step) => step.status === 'completed').length;
  const stateLabel = statusLabel(turnStatus);
  const activeText = activeLabel(steps, runtimeStatus, logs);
  const usage = usageLabel(runtimeStatus?.usage);
  const codex = readAvailability(runtimeAvailability);
  const statusLabelText = apiMode === 'mock' ? 'mock fallback' : codex.available ? 'available' : 'unavailable';
  const runtimeMessage = runtimeError
    || runtimeStatus?.lastError?.message
    || codex.message
    || (apiMode === 'mock' ? 'Electron preload API is not available.' : '');
  const metricText = steps.length ? `${completed}/${steps.length} 步` : `${planEntries.length} 个计划项`;

  return (
    <section className="redou-inspector-card redou-progress-card" data-status={turnStatus || task.status}>
      <div className="redou-card-title-row">
        <h3>本轮状态</h3>
        <span>{statusLabelText}</span>
      </div>
      <div className="redou-progress-status-summary" data-status={turnStatus || task.status}>
        <span className="redou-run-status-icon">{runIcon(turnStatus || task.status)}</span>
        <div>
          <strong>{stateLabel}</strong>
          <span>{activeText}</span>
        </div>
      </div>
      <div className="redou-run-status-metrics redou-progress-status-metrics">
        <span>{metricText}</span>
        {task.queueDepth ? <span>{task.queueDepth} 条排队</span> : null}
        {runtimeStatus?.activeTurnId ? <span>turn {compactId(runtimeStatus.activeTurnId)}</span> : null}
        {usage ? <span>{usage}</span> : null}
      </div>
      <div className="redou-progress-list">
        {steps.length ? steps.map((step) => (
          <ProgressStep key={step.id} step={step} />
        )) : <p className="redou-muted-copy">等待 Redou 上报执行步骤</p>}
      </div>
      <div className="redou-env-list redou-progress-runtime-details">
        <div>
          <span>Runtime</span>
          <strong>{runtimeStatus?.runtime || task.runtime}</strong>
        </div>
        <div>
          <span>Bridge</span>
          <strong>{apiMode === 'ipc' ? 'window.redouApi' : 'mock'}</strong>
        </div>
        <div>
          <span>Availability</span>
          <strong>{codex.status}</strong>
        </div>
        {runtimeStatus?.threadStatus ? (
          <div>
            <span>Thread</span>
            <strong>{runtimeStatus.threadStatus}</strong>
          </div>
        ) : null}
        {runtimeStatus?.activeItem?.source ? (
          <div>
            <span>Active source</span>
            <strong>{runtimeStatus.activeItem.source}</strong>
          </div>
        ) : null}
        {codex.code ? (
          <div>
            <span>Error</span>
            <strong>{codex.code}</strong>
          </div>
        ) : null}
        {codex.executablePath ? (
          <div>
            <span>Executable</span>
            <strong>{codex.executablePath}</strong>
          </div>
        ) : null}
      </div>
      {runtimeMessage ? <p className="redou-runtime-note">{runtimeMessage}</p> : null}
    </section>
  );
}
