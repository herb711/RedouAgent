import { Package } from 'lucide-react';
import type { ArtifactData } from '../../types';

interface ArtifactPanelProps {
  artifacts?: ArtifactData[];
  onOpenPreview?: () => void;
}

export function ArtifactPanel({ artifacts = [], onOpenPreview }: ArtifactPanelProps = {}) {
  return (
    <section className="redou-inspector-card">
      <div className="redou-card-title-row">
        <h3>交付物</h3>
        <span>{artifacts.length}</span>
      </div>
      <div className="redou-artifact-list">
        {artifacts.map((artifact) => (
          <article className="redou-artifact-item" key={artifact.id}>
            <Package size={15} />
            <div>
              <strong>{artifact.name}</strong>
              <span>{artifact.type}</span>
            </div>
            <em>{artifact.status}</em>
          </article>
        ))}
      </div>
      {artifacts.length ? (
        <button className="redou-secondary-action redou-panel-footer-action" type="button" onClick={onOpenPreview}>
          打开预览
        </button>
      ) : null}
    </section>
  );
}
