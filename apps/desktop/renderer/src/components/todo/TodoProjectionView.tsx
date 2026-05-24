import type { TodoProjectionEntry } from '../../types';

interface TodoProjectionViewProps {
  entries?: TodoProjectionEntry[];
}

export function TodoProjectionView({ entries = [] }: TodoProjectionViewProps) {
  if (!entries.length) return null;

  return (
    <section className="redou-inspector-card" aria-label="Codex todo projection">
      <div className="redou-card-title-row">
        <h3>Todo projection</h3>
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
