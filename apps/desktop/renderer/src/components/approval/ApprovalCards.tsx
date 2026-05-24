import { Check, X } from 'lucide-react';
import { redouApi } from '../../api/redouApi';
import type { ApprovalRequestProjection } from '../../types';

interface ApprovalCardsProps {
  approvals?: ApprovalRequestProjection[];
}

export function ApprovalCards({ approvals = [] }: ApprovalCardsProps) {
  if (!approvals.length) return null;

  return (
    <section className="redou-inspector-card" aria-label="Approvals">
      <div className="redou-card-title-row">
        <h3>Approvals</h3>
        <span>{approvals.length}</span>
      </div>
      <div className="redou-log-list">
        {approvals.map((approval) => (
          <article className="redou-log-entry" data-level="warn" key={approval.id}>
            <strong>{approval.kind}</strong>
            <p>{approval.description || approval.title}</p>
            <div>
              <button type="button" aria-label="Approve" onClick={() => redouApi.respondApproval(approval.id, 'approve')}>
                <Check size={14} />
              </button>
              <button type="button" aria-label="Reject" onClick={() => redouApi.respondApproval(approval.id, 'reject')}>
                <X size={14} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
