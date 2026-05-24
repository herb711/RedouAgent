import { CommandRunSummary } from './CommandRunSummary';
import { MessageContent } from './MessageContent';
import type { AgentThreadMessage } from '../../types';

interface AgentMessageProps {
  message: AgentThreadMessage;
}

export function AgentMessage({ message }: AgentMessageProps) {
  const roleLabel = message.status === 'error' ? 'Redou runtime' : 'Redou';
  const statusLabel = message.status && message.status !== 'consumed' ? message.status : null;

  return (
    <article className="redou-agent-message" data-status={message.status || undefined}>
      <div className="redou-agent-avatar">R</div>
      <div className="redou-agent-message-body">
        <div className="redou-message-meta-row">
          <span className="redou-message-role">{roleLabel}</span>
          {statusLabel ? <span className="redou-message-status-pill">{statusLabel}</span> : null}
        </div>
        <MessageContent body={message.body} />
        {message.commandSummary ? <CommandRunSummary summary={message.commandSummary} /> : null}
      </div>
    </article>
  );
}
