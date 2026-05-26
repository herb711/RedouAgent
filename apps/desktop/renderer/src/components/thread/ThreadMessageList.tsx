import { CommandRunSummary } from './CommandRunSummary';
import { AgentMessage } from './AgentMessage';
import { ThinkingIndicator } from './ThinkingIndicator';
import { ThreadApprovalCard } from './ThreadApprovalCard';
import { UserPromptCard } from './UserPromptCard';
import type { AgentThreadMessage, ApprovalRequestProjection, ChangesData, ComposerEditTarget, ProgressStepData, WorkbenchTask } from '../../types';

interface ThreadMessageListProps {
  task: WorkbenchTask;
  agentMessages: AgentThreadMessage[];
  changes: ChangesData;
  progressSteps: ProgressStepData[];
  approvalRequests?: ApprovalRequestProjection[];
  onOpenDiff: () => void;
  onGuideQueuedMessage?: (message: AgentThreadMessage) => void;
  onDeleteQueuedMessage?: (message: AgentThreadMessage) => void;
  onEditUserPrompt?: (target: ComposerEditTarget) => void;
}

export function ThreadMessageList({ task, agentMessages, changes, progressSteps, approvalRequests = [], onOpenDiff, onGuideQueuedMessage, onDeleteQueuedMessage, onEditUserPrompt }: ThreadMessageListProps) {
  const hasUserMessage = agentMessages.some((message) => message.role === 'user');
  const hasUserPrompt = !hasUserMessage && Boolean(task.userPrompt?.trim());
  const running = task.status === 'running';
  const hasChanges = changes.files.length > 0;
  const hasActiveRuntimeStatus = running || progressSteps.some((step) => step.status === 'active');
  const hasPendingApprovals = approvalRequests.length > 0;

  return (
    <section className="redou-thread-message-list" aria-label="Thread messages">
      {hasUserPrompt ? (
        <UserPromptCard
          prompt={task.userPrompt ?? ''}
          timestamp={task.updatedAt}
          editTarget={{
            taskId: task.id,
            messageId: `task:${task.id}:userPrompt`,
            prompt: task.userPrompt ?? '',
            timestamp: task.updatedAt,
            isInitialPrompt: true,
          }}
          onEdit={onEditUserPrompt}
        />
      ) : null}
      {agentMessages.map((message) => (
        message.kind === 'command_summary' && message.commandSummary
          ? <CommandRunSummary key={message.id} summary={message.commandSummary} />
          : message.role === 'user'
          ? (
              <UserPromptCard
                key={message.id}
                prompt={message.body}
                timestamp={message.timestamp}
                deliveryMode={message.deliveryMode}
                status={message.status}
                queueId={message.queueId}
                source={message.source}
                automationTitle={message.automation?.title}
                contextItems={message.contextItems}
                editTarget={{
                  taskId: task.id,
                  messageId: message.id,
                  prompt: message.body,
                  timestamp: message.timestamp,
                  sourceEventId: message.sourceEventId,
                  turnId: message.turnId,
                  isInitialPrompt: !task.userPrompt || task.userPrompt === message.body,
                }}
                onGuide={() => onGuideQueuedMessage?.(message)}
                onDelete={() => onDeleteQueuedMessage?.(message)}
                onEdit={onEditUserPrompt}
              />
            )
          : <AgentMessage key={message.id} message={message} />
      ))}
      {approvalRequests.map((approval) => (
        <ThreadApprovalCard key={approval.id} approval={approval} />
      ))}
      {hasActiveRuntimeStatus && !hasPendingApprovals ? <ThinkingIndicator /> : null}
      {hasChanges ? (
        <button className="redou-thread-change-banner" type="button" onClick={onOpenDiff}>
          <span>{changes.files.length} 个文件已更改</span>
          <strong>
            +{changes.insertions} -{changes.deletions}
          </strong>
          <em>在此审查</em>
        </button>
      ) : null}
    </section>
  );
}
