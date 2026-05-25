import { Loader2 } from 'lucide-react';
import type { ProgressStepData, RuntimeStatusData, WorkbenchTask } from '../../types';

interface ThreadHeaderProps {
  activeProjectName: string;
  task: WorkbenchTask;
  progressSteps?: ProgressStepData[];
  runtimeStatus?: RuntimeStatusData | null;
}

function displayStatus(task: WorkbenchTask, progressSteps: ProgressStepData[] = [], runtimeStatus?: RuntimeStatusData | null) {
  const running = task.status === 'running';
  const queueDepth = task.queueDepth || 0;
  const active = progressSteps.find((step) => step.status === 'active');
  if (runtimeStatus?.turnStatus === 'incomplete') return '未完成，需要继续';
  if (runtimeStatus?.turnStatus === 'waiting_approval') return '等待审批';
  if (runtimeStatus?.turnStatus === 'degraded') return '兼容模式';
  if (running) {
    const suffix = active?.label || runtimeStatus?.activeItem?.title || runtimeStatus?.turnStatus || '';
    return `正在执行${suffix ? ` · ${suffix}` : ''}${queueDepth ? ` · ${queueDepth} 排队` : ''}`;
  }
  if (task.status === 'error' && runtimeStatus?.lastError?.message) return '执行出错';
  return task.status;
}

export function ThreadHeader({ activeProjectName, task, progressSteps = [], runtimeStatus }: ThreadHeaderProps) {
  const running = task.status === 'running';
  const status = displayStatus(task, progressSteps, runtimeStatus);

  return (
    <section className="redou-thread-header">
      <div>
        <span className="redou-thread-eyebrow">任务线程</span>
        <h2>{task.title}</h2>
      </div>
      <div className="redou-thread-meta">
        <span>{activeProjectName}</span>
        <span className="redou-thinking-chip" data-running={running ? 'true' : 'false'} title={status}>
          {running ? <Loader2 size={13} /> : null}
          {status}
        </span>
      </div>
    </section>
  );
}
