import { ArrowLeft, ExternalLink, FileText, Package, Play } from 'lucide-react';
import type { ArtifactData } from '../types';

interface ArtifactPreviewPageProps {
  artifacts: ArtifactData[];
  onBack: () => void;
}

export function ArtifactPreviewPage({ artifacts, onBack }: ArtifactPreviewPageProps) {
  const activeArtifact = artifacts[0];

  return (
    <main className="redou-artifact-page" aria-label="Artifact preview">
      <header className="redou-review-header">
        <button className="redou-icon-button" type="button" aria-label="Back to thread" onClick={onBack}>
          <ArrowLeft size={17} />
        </button>
        <div>
          <span className="redou-title-kicker">交付物</span>
          <h2>{activeArtifact?.name || '暂无交付物'}</h2>
        </div>
        <div className="redou-review-actions">
          <button className="redou-secondary-pill" type="button">
            <ExternalLink size={15} />
            新窗口打开
          </button>
        </div>
      </header>

      <div className="redou-artifact-grid">
        <aside className="redou-review-file-list" aria-label="Artifacts">
          <div className="redou-card-title-row">
            <h3>Artifacts</h3>
            <Package size={15} />
          </div>
          {artifacts.map((artifact) => (
            <button className="redou-review-file-row" data-active={artifact.id === activeArtifact?.id ? 'true' : 'false'} type="button" key={artifact.id}>
              <FileText size={15} />
              <span>{artifact.name}</span>
              <em>{artifact.status}</em>
            </button>
          ))}
        </aside>

        <section className="redou-artifact-preview" aria-label="Artifact detail">
          <div className="redou-artifact-preview-top">
            <div>
              <span className="redou-title-kicker">{activeArtifact?.type || 'Preview'}</span>
              <strong>{activeArtifact?.name || 'Select an artifact'}</strong>
            </div>
            <button className="redou-primary-pill" type="button">
              <Play size={15} />
              预览
            </button>
          </div>
          <div className="redou-artifact-document">
            <h3>RedouAgent Codex-like UI baseline</h3>
            <p>这个预览区域用于承载 agent 生成的报告、网页、截图、日志包或其他交付物。第一阶段先复刻 Codex 的 preview 信息架构，后续再接真实 artifact 数据。</p>
            <ul>
              <li>来源任务：继续执行 Redou Workbench Rewrite Phase 1</li>
              <li>运行环境：本地模式 / Codex-compatible runtime</li>
              <li>状态：ready</li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
