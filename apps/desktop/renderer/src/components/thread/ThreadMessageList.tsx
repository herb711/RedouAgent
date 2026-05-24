import { AgentMessage } from './AgentMessage';
import { ThinkingIndicator } from './ThinkingIndicator';
import { UserPromptCard } from './UserPromptCard';
import type { AgentThreadMessage, ChangesData, ProgressStepData, WorkbenchTask } from '../../types';

interface ThreadMessageListProps {
  task: WorkbenchTask;
  agentMessages: AgentThreadMessage[];
  changes: ChangesData;
  progressSteps: ProgressStepData[];
  onOpenDiff: () => void;
  onGuideQueuedMessage?: (message: AgentThreadMessage) => void;
  onDeleteQueuedMessage?: (message: AgentThreadMessage) => void;
}

export function ThreadMessageList({ task, agentMessages, changes, progressSteps, onOpenDiff, onGuideQueuedMessage, onDeleteQueuedMessage }: ThreadMessageListProps) {
  const hasUserMessage = agentMessages.some((message) => message.role === 'user');
  const hasUserPrompt = !hasUserMessage && Boolean(task.userPrompt?.trim());
  const running = task.status === 'running';
  const hasChanges = changes.files.length > 0;
  const hasActiveRuntimeStatus = running || progressSteps.some((step) => step.status === 'active');

  return (
    <section className="redou-thread-message-list" aria-label="Thread messages">
      {hasUserPrompt ? <UserPromptCard prompt={task.userPrompt ?? ''} /> : null}
      {agentMessages.map((message) => (
        message.role === 'user'
          ? (
              <UserPromptCard
                key={message.id}
                prompt={message.body}
                deliveryMode={message.deliveryMode}
                status={message.status}
                queueId={message.queueId}
                onGuide={() => onGuideQueuedMessage?.(message)}
                onDelete={() => onDeleteQueuedMessage?.(message)}
              />
            )
          : <AgentMessage key={message.id} message={message} />
      ))}
      {hasActiveRuntimeStatus ? <ThinkingIndicator /> : null}
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
