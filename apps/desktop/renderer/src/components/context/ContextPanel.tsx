import { X } from 'lucide-react';
import type { ContextPackageData } from '../../types';

interface ContextPanelProps {
  context: ContextPackageData;
  onRemoveItem?: (path: string) => void;
  onClear?: () => void;
}

export function ContextPanel({ context, onRemoveItem, onClear }: ContextPanelProps) {
  const total = context.selectedFiles.length + (context.selectedDirectories?.length || 0) + context.attachments.length;
  return (
    <div className="redou-panel-stack">
      <section className="redou-inspector-card">
        <div className="redou-card-title-row">
          <h3>Context package</h3>
          <span>{total}</span>
        </div>
        <p className="redou-muted-copy">{context.summary}</p>
        {total ? (
          <button className="redou-secondary-pill redou-context-clear-button" type="button" onClick={onClear}>
            Clear context
          </button>
        ) : null}
      </section>
      <ContextList title="recent messages" items={context.recentMessages} />
      <ContextList title="selected files" items={context.selectedFiles} onRemoveItem={onRemoveItem} />
      <ContextList title="selected folders" items={context.selectedDirectories || []} onRemoveItem={onRemoveItem} />
      <ContextList title="attachments" items={context.attachments} onRemoveItem={onRemoveItem} />
      <ContextList title="environment" items={context.environment} />
    </div>
  );
}

function ContextList({
  title,
  items,
  onRemoveItem,
}: {
  title: string;
  items: string[];
  onRemoveItem?: (path: string) => void;
}) {
  return (
    <section className="redou-inspector-card redou-compact-card">
      <div className="redou-card-title-row">
        <h3>{title}</h3>
        <span>{items.length}</span>
      </div>
      <ul className="redou-simple-list">
        {items.map((item) => (
          <li className="redou-context-list-item" key={item} title={item}>
            <span>{item}</span>
            {onRemoveItem ? (
              <button type="button" aria-label={`Remove ${item}`} onClick={() => onRemoveItem(item)}>
                <X size={13} />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
