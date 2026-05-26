import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { redouApi } from '../../api/redouApi';
import {
  approvalDescription,
  approvalErrorMessage,
  approvalExpiredMessage,
  approvalIsActionable,
  approvalKindLabel,
} from './approvalPresentation';
import type { ApprovalRequestProjection } from '../../types';

interface ApprovalCardsProps {
  approvals?: ApprovalRequestProjection[];
}

export function ApprovalCards({ approvals = [] }: ApprovalCardsProps) {
  if (!approvals.length) return null;

  return (
    <section className="redou-inspector-card" aria-label="审批">
      <div className="redou-card-title-row">
        <h3>审批</h3>
        <span>{approvals.length}</span>
      </div>
      <div className="redou-log-list">
        {approvals.map((approval) => (
          <InspectorApprovalCard approval={approval} key={approval.id} />
        ))}
      </div>
    </section>
  );
}

function InspectorApprovalCard({ approval }: { approval: ApprovalRequestProjection }) {
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
    if (result.ok) setMessage('已提交');
    else setError(approvalErrorMessage(result.error?.message));
    setSubmitting(null);
  }

  const disabled = Boolean(submitting || message || !actionable);

  return (
    <article className="redou-log-entry" data-kind="approval" data-level="warn" data-status={approval.status || undefined}>
      <strong>{actionable ? approvalKindLabel(approval.kind) : '已失效'}</strong>
      <p>{approvalDescription(approval)}</p>
      {actionable ? (
        <div>
          <button type="button" aria-label="允许" title="允许" disabled={disabled} onClick={() => void respond('approve')}>
            <Check size={14} />
          </button>
          <button type="button" aria-label="拒绝" title="拒绝" disabled={disabled} onClick={() => void respond('reject')}>
            <X size={14} />
          </button>
        </div>
      ) : null}
      {!actionable ? <p className="redou-approval-feedback" data-status="expired">{approvalExpiredMessage()}</p> : null}
      {submitting ? <p className="redou-approval-feedback">提交中...</p> : null}
      {message ? <p className="redou-approval-feedback" data-status="ok">{message}</p> : null}
      {error ? <p className="redou-approval-feedback" data-status="error">{error}</p> : null}
    </article>
  );
}
