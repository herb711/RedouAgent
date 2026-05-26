import { CalendarClock, Check, Copy, CornerDownRight, FileText, FolderOpen, Image, Pencil, X } from 'lucide-react';
import { useState } from 'react';
import { redouApi } from '../../api/redouApi';
import type { ComposerEditTarget, ContextItemData } from '../../types';

interface UserPromptCardProps {
  prompt: string;
  timestamp?: string;
  deliveryMode?: string;
  status?: string;
  queueId?: string | null;
  contextItems?: ContextItemData[];
  editTarget?: ComposerEditTarget;
  source?: string | null;
  automationTitle?: string | null;
  onGuide?: () => void;
  onDelete?: () => void;
  onEdit?: (target: ComposerEditTarget) => void;
}

function statusLabel(deliveryMode?: string, status?: string) {
  if (deliveryMode === 'automation') return 'Automation';
  if (deliveryMode === 'queue' && status === 'pending') return '排队中';
  if (deliveryMode === 'queue' && status === 'consumed') return '已开始';
  if (deliveryMode === 'guide' && status === 'completed') return '已引导';
  if (deliveryMode === 'guide') return '引导';
  return null;
}

function shortPathLabel(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join('/') || path;
}

function ContextIcon({ kind }: { kind: ContextItemData['kind'] }) {
  if (kind === 'image') return <Image size={13} />;
  if (kind === 'directory') return <FolderOpen size={13} />;
  return <FileText size={13} />;
}

function timeLabel(timestamp?: string) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function writePromptToClipboard(prompt: string) {
  const result = await redouApi.copyText(prompt);
  if (result.ok) return;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(prompt);
  }
}

export function UserPromptCard({
  prompt,
  timestamp,
  deliveryMode,
  status,
  queueId,
  contextItems = [],
  editTarget,
  source,
  automationTitle,
  onGuide,
  onDelete,
  onEdit,
}: UserPromptCardProps) {
  const label = statusLabel(deliveryMode, status);
  const isAutomation = source === 'automation' || deliveryMode === 'automation';
  const canUpdateQueue = Boolean(queueId && deliveryMode === 'queue' && status === 'pending');
  const [copied, setCopied] = useState(false);
  const sentAt = timeLabel(timestamp);

  async function copyPrompt() {
    try {
      await writePromptToClipboard(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (_error) {
      setCopied(false);
    }
  }

  return (
    <div className="redou-user-prompt-shell" data-delivery-mode={deliveryMode || undefined} data-status={status || undefined}>
      <article className="redou-user-prompt-card">
        <div className="redou-user-prompt-meta">
          <span className="redou-message-role">{isAutomation ? <CalendarClock size={13} /> : null}{isAutomation ? 'Automation' : 'User'}</span>
          {label ? <span className="redou-message-status-pill">{label}</span> : null}
          {automationTitle ? <span className="redou-message-status-pill">{automationTitle}</span> : null}
        </div>
        <p>{prompt}</p>
        {contextItems.length ? (
          <div className="redou-user-context-pills" aria-label="Sent context">
            {contextItems.map((item) => (
              <span className="redou-user-context-pill" data-kind={item.kind} key={`${item.kind}:${item.path}`} title={item.path}>
                <ContextIcon kind={item.kind} />
                <span>{shortPathLabel(item.path)}</span>
              </span>
            ))}
          </div>
        ) : null}
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
      <div className="redou-user-prompt-toolbar" aria-label="Message actions">
        {sentAt ? <time dateTime={timestamp}>{sentAt}</time> : null}
        <button type="button" aria-label="Copy message" title="Copy message" onClick={() => void copyPrompt()}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
        <button type="button" aria-label="Edit message" title="Edit message" disabled={!editTarget} onClick={() => editTarget ? onEdit?.(editTarget) : undefined}>
          <Pencil size={15} />
        </button>
      </div>
    </div>
  );
}
