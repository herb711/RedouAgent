import { ApprovalCards } from '../approval/ApprovalCards';
import { PlanView } from '../plan/PlanView';
import { TodoProjectionView } from '../todo/TodoProjectionView';
import { EnvironmentCard } from './EnvironmentCard';
import { ProgressCard } from './ProgressCard';
import type { ApprovalRequestProjection, RedouCodexPlanProjection, EnvironmentInfo, LogEntryData, ProgressStepData, RuntimeStatusData, TodoProjectionEntry, WorkbenchTask } from '../../types';

interface ProgressPanelProps {
  task: WorkbenchTask;
  steps: ProgressStepData[];
  environment: EnvironmentInfo;
  planEntries?: RedouCodexPlanProjection[];
  logs?: LogEntryData[];
  todoProjectionEntries?: TodoProjectionEntry[];
  approvalRequests?: ApprovalRequestProjection[];
  runtimeStatus?: RuntimeStatusData | null;
  runtimeAvailability?: unknown;
  runtimeError?: string | null;
  apiMode?: 'ipc' | 'mock';
  onCommitGitChanges?: () => Promise<void>;
  onPushGitBranch?: () => Promise<void>;
  onCreatePullRequest?: () => Promise<void>;
}

export function ProgressPanel({
  task,
  steps,
  environment,
  planEntries = [],
  logs = [],
  todoProjectionEntries = [],
  approvalRequests = [],
  runtimeStatus,
  runtimeAvailability,
  runtimeError,
  apiMode = 'mock',
  onCommitGitChanges,
  onPushGitBranch,
  onCreatePullRequest,
}: ProgressPanelProps) {
  return (
    <div className="redou-panel-stack">
      <ProgressCard
        task={task}
        steps={steps}
        planEntries={planEntries}
        logs={logs}
        runtimeStatus={runtimeStatus}
        runtimeAvailability={runtimeAvailability}
        runtimeError={runtimeError}
        apiMode={apiMode}
      />
      <PlanView entries={planEntries} />
      <TodoProjectionView entries={todoProjectionEntries} />
      <ApprovalCards approvals={approvalRequests} />
      <EnvironmentCard
        environment={environment}
        onCommitGitChanges={onCommitGitChanges}
        onPushGitBranch={onPushGitBranch}
        onCreatePullRequest={onCreatePullRequest}
      />
    </div>
  );
}
