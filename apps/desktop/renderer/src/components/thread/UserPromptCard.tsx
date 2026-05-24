import { CornerDownRight, X } from 'lucide-react';

interface UserPromptCardProps {
  prompt: string;
  deliveryMode?: string;
  status?: string;
  queueId?: string | null;
  onGuide?: () => void;
  onDelete?: () => void;
}

function statusLabel(deliveryMode?: string, status?: string) {
  if (deliveryMode === 'queue' && status === 'pending') return '排队中';
  if (deliveryMode === 'queue' && status === 'consumed') return '已开始';
  if (deliveryMode === 'guide' && status === 'completed') return '已引导';
  if (deliveryMode === 'guide') return '引导';
  return null;
}

export function UserPromptCard({ prompt, deliveryMode, status, queueId, onGuide, onDelete }: UserPromptCardProps) {
  const label = statusLabel(deliveryMode, status);
  const canUpdateQueue = Boolean(queueId && deliveryMode === 'queue' && status === 'pending');
  return (
    <article className="redou-user-prompt-card" data-delivery-mode={deliveryMode || undefined} data-status={status || undefined}>
      <div className="redou-user-prompt-meta">
        <span className="redou-message-role">User</span>
        {label ? <span className="redou-message-status-pill">{label}</span> : null}
      </div>
      <p>{prompt}</p>
      {canUpdateQueue ? (
        <div className="redou-queued-message-actions">
          <button type="button" onClick={onGuide}>
            <CornerDownRight size={13} />
            <span>引导当前任务</span>
          </button>
          <button type="button" onClick={onDelete}>
            <X size={13} />
            <span>取消排队</span>
          </button>
        </div>
      ) : null}
    </article>
  );
}
