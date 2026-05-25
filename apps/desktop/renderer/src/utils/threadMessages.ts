import type { AgentThreadMessage } from '../types';

export function isPendingQueuedUserMessage(message: AgentThreadMessage) {
  const queueStatus = message.status || message.queueState;
  return message.role === 'user' && message.deliveryMode === 'queue' && (queueStatus === 'pending' || queueStatus === 'queued');
}
