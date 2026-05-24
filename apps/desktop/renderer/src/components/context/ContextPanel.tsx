import type { ContextPackageData } from '../../types';

interface ContextPanelProps {
  context: ContextPackageData;
}

export function ContextPanel({ context }: ContextPanelProps) {
  return (
    <div className="redou-panel-stack">
      <section className="redou-inspector-card">
        <div className="redou-card-title-row">
          <h3>上下文包摘要</h3>
          <span>mock</span>
        </div>
        <p className="redou-muted-copy">{context.summary}</p>
      </section>
      <ContextList title="recent messages" items={context.recentMessages} />
      <ContextList title="selected files" items={context.selectedFiles} />
      <ContextList title="attachments" items={context.attachments} />
      <ContextList title="environment" items={context.environment} />
    </div>
  );
}

function ContextList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="redou-inspector-card redou-compact-card">
      <div className="redou-card-title-row">
        <h3>{title}</h3>
        <span>{items.length}</span>
      </div>
      <ul className="redou-simple-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
