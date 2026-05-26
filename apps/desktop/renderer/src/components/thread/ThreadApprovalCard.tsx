import { Check, ShieldQuestion, X } from 'lucide-react';
import { useState } from 'react';
import { redouApi } from '../../api/redouApi';
import {
  approvalDescription,
  approvalErrorMessage,
  approvalExpiredMessage,
  approvalIsActionable,
  approvalStatusLabel,
} from '../approval/approvalPresentation';
import type { ApprovalRequestProjection } from '../../types';

interface ThreadApprovalCardProps {
  approval: ApprovalRequestProjection;
}

export function ThreadApprovalCard({ approval }: ThreadApprovalCardProps) {
  const [submitting, setSubmitting] = useState<null | 'approve' | 'reject'>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const actionable = approvalIsActionable(approval);

  async function respond(decision: 'approve' | 'reject') {
    if (submitting || !actionable) return;
    setSubmitting(decision);
    setMessage('');
    setError('');
    const result = await redouApi.respondApproval(approval.id, decision, approval.taskId);
    if (result.ok) {
      setMessage('已提交审批，等待运行时继续。');
    } else {
      setError(approvalErrorMessage(result.error?.message));
    }
    setSubmitting(null);
  }

  const disabled = Boolean(submitting || message || !actionable);

  return (
    <article className="redou-thread-approval-card" aria-label={actionable ? '需要审批' : '审批已失效'} data-status={approval.status || undefined}>
      <div className="redou-thread-approval-avatar">
        <ShieldQuestion size={16} />
      </div>
      <div className="redou-thread-approval-body">
        <div className="redou-message-meta-row">
          <span className="redou-message-role">{actionable ? '需要审批' : '审批已失效'}</span>
          <span className="redou-message-status-pill">{approvalStatusLabel(approval)}</span>
        </div>
        <p>{approvalDescription(approval)}</p>
        {actionable ? (
          <div className="redou-thread-approval-actions">
            <button
              type="button"
              aria-label="允许"
              title="允许"
              disabled={disabled}
              onClick={() => void respond('approve')}
            >
              <Check size={15} />
            </button>
            <button
              type="button"
              aria-label="拒绝"
              title="拒绝"
              disabled={disabled}
              onClick={() => void respond('reject')}
            >
              <X size={15} />
            </button>
          </div>
        ) : null}
        {!actionable ? <p className="redou-approval-feedback" data-status="expired">{approvalExpiredMessage()}</p> : null}
        {submitting ? <p className="redou-approval-feedback">正在提交审批...</p> : null}
        {message ? <p className="redou-approval-feedback" data-status="ok">{message}</p> : null}
        {error ? <p className="redou-approval-feedback" data-status="error">{error}</p> : null}
      </div>
    </article>
  );
}
