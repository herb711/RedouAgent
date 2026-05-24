import type { CodexPlanProjection } from '../../types';

interface PlanViewProps {
  entries?: CodexPlanProjection[];
}

export function PlanView({ entries = [] }: PlanViewProps) {
  if (!entries.length) return null;

  return (
    <section className="redou-inspector-card" aria-label="Codex plan events">
      <div className="redou-card-title-row">
        <h3>Codex plan</h3>
        <span>{entries.length}</span>
      </div>
      <div className="redou-progress-list">
        {entries.map((entry) => (
          <div className="redou-plan-entry" data-status={entry.status} key={entry.id}>
            <span>{entry.title}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
