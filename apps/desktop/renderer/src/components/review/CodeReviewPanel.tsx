import { AlertTriangle, FileText } from 'lucide-react';
import type { CodeReviewData } from '../../types';

interface CodeReviewPanelProps {
  review: CodeReviewData;
}

export function CodeReviewPanel({ review }: CodeReviewPanelProps) {
  return (
    <div className="redou-panel-stack">
      <section className="redou-inspector-card">
        <div className="redou-card-title-row">
          <h3>代码审查摘要</h3>
          <span className="redou-risk-pill" data-risk={review.riskLevel}>
            {review.riskLevel}
          </span>
        </div>
        <p className="redou-muted-copy">{review.summary}</p>
        <div className="redou-metric-row">
          <FileText size={15} />
          <span>changed files</span>
          <strong>{review.changedFiles}</strong>
        </div>
      </section>

      <section className="redou-inspector-card">
        <div className="redou-card-title-row">
          <h3>Review findings</h3>
          <span>{review.findings.length}</span>
        </div>
        <div className="redou-finding-list">
          {review.findings.map((finding) => (
            <article className="redou-finding-item" key={finding.id}>
              <div className="redou-finding-severity" data-severity={finding.severity}>
                <AlertTriangle size={13} />
                {finding.severity}
              </div>
              <strong>{finding.file}</strong>
              <span>line {finding.line}</span>
              <p>{finding.message}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
