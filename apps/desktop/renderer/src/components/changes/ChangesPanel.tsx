import { GitBranch } from 'lucide-react';
import type { ChangesData } from '../../types';

interface ChangesPanelProps {
  changes: ChangesData;
}

export function ChangesPanel({ changes }: ChangesPanelProps) {
  return (
    <div className="redou-panel-stack">
      <section className="redou-inspector-card">
        <div className="redou-card-title-row">
          <h3>文件变更</h3>
          <span className="redou-diff-stat">+{changes.insertions} -{changes.deletions}</span>
        </div>
        <p className="redou-muted-copy">{changes.diffSummary}</p>
      </section>

      <section className="redou-inspector-card">
        <div className="redou-card-title-row">
          <h3>Changed files</h3>
          <GitBranch size={15} />
        </div>
        <div className="redou-change-file-list">
          {changes.files.map((file) => (
            <article className="redou-change-file" key={file.id}>
              <div>
                <strong>{file.path}</strong>
                <span>{file.status}</span>
              </div>
              <span className="redou-diff-stat">+{file.insertions} -{file.deletions}</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
