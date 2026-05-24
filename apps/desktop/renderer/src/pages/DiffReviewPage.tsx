import { ArrowLeft, CheckCircle2, FileCode2, GitBranch, Plus, SplitSquareHorizontal } from 'lucide-react';
import type { ChangesData } from '../types';

interface DiffReviewPageProps {
  changes: ChangesData;
  onBack: () => void;
}

export function DiffReviewPage({ changes, onBack }: DiffReviewPageProps) {
  const activeFile = changes.files[0];

  return (
    <main className="redou-review-page" aria-label="Diff review">
      <header className="redou-review-header">
        <button className="redou-icon-button" type="button" aria-label="Back to thread" onClick={onBack}>
          <ArrowLeft size={17} />
        </button>
        <div>
          <span className="redou-title-kicker">文件变更预览</span>
          <h2>{changes.files.length} 个文件已更改</h2>
        </div>
        <div className="redou-review-actions">
          <span className="redou-diff-stat">+{changes.insertions} -{changes.deletions}</span>
          <button className="redou-secondary-pill" type="button">
            <CheckCircle2 size={15} />
            继续修改
          </button>
          <button className="redou-primary-pill" type="button">提交</button>
        </div>
      </header>

      <div className="redou-review-grid">
        <aside className="redou-review-file-list" aria-label="Changed files">
          <div className="redou-card-title-row">
            <h3>Changed files</h3>
            <GitBranch size={15} />
          </div>
          {changes.files.map((file) => (
            <button className="redou-review-file-row" data-active={file.id === activeFile?.id ? 'true' : 'false'} type="button" key={file.id}>
              <FileCode2 size={15} />
              <span>{file.path}</span>
              <em>+{file.insertions} -{file.deletions}</em>
            </button>
          ))}
        </aside>

        <section className="redou-diff-viewer" aria-label="Diff viewer">
          <div className="redou-diff-toolbar">
            <div>
              <span className="redou-title-kicker">Split diff</span>
              <strong>{activeFile?.path || 'No file selected'}</strong>
            </div>
            <button className="redou-secondary-pill" type="button">
              <SplitSquareHorizontal size={15} />
              左右对比
            </button>
          </div>
          <div className="redou-diff-code">
            <pre aria-label="Before code">
              <code>{`const layout = "chat";\nconst sidebar = "minimal";\nconst rightPanel = false;\n\nexport function render() {\n  return <ChatOnly />;\n}`}</code>
            </pre>
            <pre aria-label="After code">
              <code>{`const layout = "codex-like";\nconst sidebar = "projects-and-tasks";\nconst rightPanel = "progress-environment";\n\nexport function render() {\n  return <RedouWorkbench />;\n}`}</code>
            </pre>
          </div>
          <div className="redou-diff-footer">
            <Plus size={14} />
            <span>{changes.diffSummary}</span>
          </div>
        </section>
      </div>
    </main>
  );
}
