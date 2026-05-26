import { CalendarClock, Check, ChevronDown, ChevronRight, Copy, PauseCircle, Quote, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { redouApi } from '../../api/redouApi';
import { CommandRunSummary } from './CommandRunSummary';
import { MessageContent } from './MessageContent';
import type { AgentThreadMessage } from '../../types';

interface AgentMessageProps {
  message: AgentThreadMessage;
}

type MessageFeedback = 'up' | 'down' | null;

function durationLabel(ms?: number) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
  const seconds = Math.max(1, Math.round(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}

function timeLabel(timestamp?: string) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function writeMessageToClipboard(text: string) {
  const result = await redouApi.copyText(text);
  if (result.ok) return;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  }
}

function feedbackStorageKey(messageId: string) {
  return `redou.message.feedback.${messageId}`;
}

function readStoredFeedback(messageId: string): MessageFeedback {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(feedbackStorageKey(messageId));
  return value === 'up' || value === 'down' ? value : null;
}

function quoteMessageText(text: string) {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
}

export function AgentMessage({ message }: AgentMessageProps) {
  const automation = message.automation || null;
  const isAutomation = message.source === 'automation' || Boolean(automation);
  const roleLabel = message.status === 'error' ? 'Redou runtime' : isAutomation ? 'Automation' : 'Redou';
  const statusLabel = message.status && message.status !== 'consumed' ? message.status : null;
  const processedText = message.processedStatus === 'completed' && typeof message.processedDurationMs === 'number'
    ? `已处理 ${durationLabel(message.processedDurationMs)}`
    : '';
  const sentAt = timeLabel(message.timestamp);
  const [processOpen, setProcessOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<MessageFeedback>(() => readStoredFeedback(message.id));

  useEffect(() => {
    setFeedback(readStoredFeedback(message.id));
    setCopied(false);
    setProcessOpen(false);
  }, [message.id]);

  function openAutomation() {
    if (!automation?.id) return;
    window.localStorage.setItem('redou.automation.selectedId', automation.id);
    window.dispatchEvent(new CustomEvent('redou:open-automation', { detail: { id: automation.id } }));
  }

  async function pauseAutomation() {
    if (!automation?.id) return;
    await redouApi.updateAutomation({ id: automation.id, enabled: false });
  }

  async function copyMessage() {
    try {
      await writeMessageToClipboard(message.body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (_error) {
      setCopied(false);
    }
  }

  function updateFeedback(next: Exclude<MessageFeedback, null>) {
    const value = feedback === next ? null : next;
    setFeedback(value);
    if (value) {
      window.localStorage.setItem(feedbackStorageKey(message.id), value);
    } else {
      window.localStorage.removeItem(feedbackStorageKey(message.id));
    }
    window.dispatchEvent(new CustomEvent('redou:message-feedback', { detail: { messageId: message.id, feedback: value } }));
  }

  function quoteToComposer() {
    const quoted = quoteMessageText(message.body);
    if (!quoted) return;
    window.dispatchEvent(new CustomEvent('redou:quote-message', { detail: { messageId: message.id, text: quoted } }));
    window.dispatchEvent(new CustomEvent('redou:focus-composer'));
  }

  return (
    <article className="redou-agent-message" data-status={message.status || undefined} data-source={isAutomation ? 'automation' : undefined}>
      <div className="redou-agent-avatar">{isAutomation ? <CalendarClock size={15} /> : 'R'}</div>
      <div className="redou-agent-message-body">
        {processedText ? (
          <button className="redou-agent-processed-row" type="button" aria-expanded={processOpen} onClick={() => setProcessOpen((open) => !open)}>
            <span>{processedText}</span>
            {processOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        ) : null}
        {processOpen ? (
          <div className="redou-agent-process-details">
            {sentAt ? <span>完成 {sentAt}</span> : null}
            {message.turnId ? <span>turn {message.turnId}</span> : null}
            {message.sourceEventId ? <span>event {message.sourceEventId}</span> : null}
          </div>
        ) : null}
        <div className="redou-message-meta-row">
          <span className="redou-message-role">{roleLabel}</span>
          {statusLabel ? <span className="redou-message-status-pill">{statusLabel}</span> : null}
          {automation?.title ? <span className="redou-message-status-pill">{automation.title}</span> : null}
          {automation?.triggeredAt ? <span className="redou-message-status-pill">{new Date(automation.triggeredAt).toLocaleString()}</span> : null}
        </div>
        <MessageContent body={message.body} />
        {automation?.id ? (
          <div className="redou-automation-message-actions">
            <button type="button" onClick={openAutomation}>Details</button>
            <button type="button" onClick={() => void pauseAutomation()}>
              <PauseCircle size={13} />
              <span>Disable</span>
            </button>
          </div>
        ) : null}
        {message.commandSummary ? <CommandRunSummary summary={message.commandSummary} /> : null}
        <div className="redou-agent-message-toolbar" aria-label="Redou message actions">
          <button type="button" aria-label="复制 Redou 回复" title="复制 Redou 回复" onClick={() => void copyMessage()}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
          <button type="button" aria-label="好评" title="好评" data-active={feedback === 'up' ? 'true' : undefined} onClick={() => updateFeedback('up')}>
            <ThumbsUp size={15} />
          </button>
          <button type="button" aria-label="差评" title="差评" data-active={feedback === 'down' ? 'true' : undefined} onClick={() => updateFeedback('down')}>
            <ThumbsDown size={15} />
          </button>
          <button type="button" aria-label="引用到输入框" title="引用到输入框" onClick={quoteToComposer}>
            <Quote size={15} />
          </button>
          {sentAt ? <time dateTime={message.timestamp}>{sentAt}</time> : null}
        </div>
      </div>
    </article>
  );
}
