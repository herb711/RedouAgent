import { ArrowLeft, Camera, ExternalLink, FileText, FolderOpen, ImagePlus, Package, PanelTopOpen } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { redouApi } from '../api/redouApi';
import type { ArtifactData } from '../types';

interface ArtifactPreviewPageProps {
  artifacts: ArtifactData[];
  onBack: () => void;
  onOpenArtifact: (artifact: ArtifactData) => Promise<void>;
  onRevealArtifact: (artifact: ArtifactData) => Promise<void>;
  onGenerateImage: (prompt: string) => Promise<void>;
  onCaptureScreenshot: (comment: string) => Promise<void>;
  onPopoutArtifact: (artifact: ArtifactData) => Promise<void>;
}

function statusLabel(artifact?: ArtifactData | null) {
  if (!artifact) return 'empty';
  return artifact.status || 'ready';
}

function renderPreview(artifact: ArtifactData | null) {
  const preview = artifact?.preview;
  if (!artifact) {
    return (
      <div className="redou-artifact-empty">
        <Package size={28} />
        <strong>暂无交付物</strong>
      </div>
    );
  }
  if (!preview && artifact.content) {
    return <pre className="redou-artifact-text">{artifact.content}</pre>;
  }
  if (!preview) {
    return (
      <div className="redou-artifact-empty">
        <FileText size={28} />
        <strong>{artifact.name}</strong>
        <span>{artifact.path || artifact.mimeType || artifact.type}</span>
      </div>
    );
  }
  if (preview.kind === 'image' && preview.dataUrl) {
    return <img className="redou-artifact-image" src={preview.dataUrl} alt={artifact.name} />;
  }
  if (preview.kind === 'html' && preview.content) {
    return <iframe className="redou-artifact-html" title={artifact.name} sandbox="allow-same-origin allow-scripts" srcDoc={preview.content} />;
  }
  if (preview.kind === 'directory') {
    return (
      <div className="redou-artifact-directory">
        {(preview.entries || []).map((entry) => (
          <span key={entry}>{entry}</span>
        ))}
      </div>
    );
  }
  if ((preview.kind === 'text' || preview.kind === 'diff') && preview.content) {
    return <pre className="redou-artifact-text" data-kind={preview.kind}>{preview.content}</pre>;
  }
  return (
    <div className="redou-artifact-empty">
      <FileText size={28} />
      <strong>{artifact.name}</strong>
      <span>{preview.message || artifact.path || artifact.mimeType || artifact.type}</span>
    </div>
  );
}

export function ArtifactPreviewPage({
  artifacts,
  onBack,
  onOpenArtifact,
  onRevealArtifact,
  onGenerateImage,
  onCaptureScreenshot,
  onPopoutArtifact,
}: ArtifactPreviewPageProps) {
  const [activeId, setActiveId] = useState(artifacts[0]?.id || '');
  const [activeArtifact, setActiveArtifact] = useState<ArtifactData | null>(artifacts[0] || null);
  const [imagePrompt, setImagePrompt] = useState('');
  const baseArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === activeId) || artifacts[0] || null,
    [activeId, artifacts],
  );

  useEffect(() => {
    if (!baseArtifact) {
      setActiveArtifact(null);
      return;
    }
    setActiveId(baseArtifact.id);
    setActiveArtifact(baseArtifact);
    let cancelled = false;
    redouApi.getArtifact({ id: baseArtifact.id, taskId: baseArtifact.taskId }).then((result) => {
      if (!cancelled && result.ok && result.data) setActiveArtifact(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [baseArtifact?.id]);

  async function captureComment() {
    const comment = window.prompt('截图评论', '');
    if (comment === null) return;
    await onCaptureScreenshot(comment);
  }

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
          <button className="redou-icon-button" type="button" aria-label="Capture screenshot comment" title="截图评论" onClick={() => void captureComment()}>
            <Camera size={16} />
          </button>
          <button className="redou-secondary-pill" type="button" disabled={!activeArtifact} onClick={() => activeArtifact && void onRevealArtifact(activeArtifact)}>
            <FolderOpen size={15} />
            定位
          </button>
          <button className="redou-secondary-pill" type="button" disabled={!activeArtifact} onClick={() => activeArtifact && void onPopoutArtifact(activeArtifact)}>
            <PanelTopOpen size={15} />
            弹出
          </button>
          <button className="redou-secondary-pill" type="button" disabled={!activeArtifact} onClick={() => activeArtifact && void onOpenArtifact(activeArtifact)}>
            <ExternalLink size={15} />
            打开
          </button>
        </div>
      </header>

      <div className="redou-artifact-grid">
        <aside className="redou-review-file-list" aria-label="Artifacts">
          <div className="redou-card-title-row">
            <h3>Artifacts</h3>
            <Package size={15} />
          </div>
          <form
            className="redou-artifact-generate"
            onSubmit={(event) => {
              event.preventDefault();
              const prompt = imagePrompt.trim();
              if (!prompt) return;
              setImagePrompt('');
              void onGenerateImage(prompt);
            }}
          >
            <input value={imagePrompt} placeholder="图片生成提示词" onChange={(event) => setImagePrompt(event.target.value)} />
            <button type="submit" aria-label="Generate image" title="生成图片">
              <ImagePlus size={15} />
            </button>
          </form>
          {artifacts.map((artifact) => (
            <button
              className="redou-review-file-row"
              data-active={artifact.id === activeArtifact?.id ? 'true' : 'false'}
              type="button"
              key={artifact.id}
              onClick={() => setActiveId(artifact.id)}
            >
              <FileText size={15} />
              <span>{artifact.name}</span>
              <em>{artifact.status}</em>
              <small>{artifact.type}</small>
            </button>
          ))}
          {!artifacts.length ? <div className="redou-review-empty-list">还没有可预览的交付物。</div> : null}
        </aside>

        <section className="redou-artifact-preview" aria-label="Artifact detail">
          <div className="redou-artifact-preview-top">
            <div>
              <span className="redou-title-kicker">{activeArtifact?.type || 'Preview'}</span>
              <strong>{activeArtifact?.name || 'Select an artifact'}</strong>
            </div>
            <span className="redou-diff-status-pill">{statusLabel(activeArtifact)}</span>
          </div>
          <div className="redou-artifact-document">
            {renderPreview(activeArtifact)}
          </div>
        </section>
      </div>
    </main>
  );
}
