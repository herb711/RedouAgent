import {
  ArrowLeft,
  CheckCircle2,
  FileCode2,
  GitBranch,
  GitPullRequest,
  MessageSquarePlus,
  MinusCircle,
  RotateCcw,
  Send,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ChangeFileData, ChangesData } from '../types';

interface DiffReviewPageProps {
  changes: ChangesData;
  onBack: () => void;
  onStageFile?: (file: ChangeFileData) => Promise<void>;
  onUnstageFile?: (file: ChangeFileData) => Promise<void>;
  onRevertFile?: (file: ChangeFileData) => Promise<void>;
  onStageHunk?: (file: ChangeFileData, hunkIndex: number) => Promise<void>;
  onRevertHunk?: (file: ChangeFileData, hunkIndex: number) => Promise<void>;
  onCreatePullRequest?: () => Promise<void>;
}

interface SplitDiffRow {
  id: string;
  kind: 'meta' | 'hunk' | 'context' | 'add' | 'del';
  raw: string;
  hunkIndex?: number;
  oldNumber?: number;
  newNumber?: number;
  oldText?: string;
  newText?: string;
}

interface InlineComment {
  id: string;
  fileId: string;
  side: 'old' | 'new';
  line: number;
  body: string;
}

interface DraftTarget {
  rowId: string;
  side: 'old' | 'new';
  line: number;
}

function parseHunkHeader(line: string) {
  const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (!match) return null;
  return {
    oldLine: Number(match[1]),
    newLine: Number(match[2]),
  };
}

function splitPatchRows(patch: string): SplitDiffRow[] {
  const lines = patch ? patch.split(/\r?\n/) : [];
  const rows: SplitDiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let hunkIndex = -1;

  lines.forEach((line, index) => {
    if (
      line.startsWith('diff --git')
      || line.startsWith('index ')
      || line.startsWith('new file mode')
      || line.startsWith('deleted file mode')
      || line.startsWith('rename from')
      || line.startsWith('rename to')
      || line.startsWith('--- ')
      || line.startsWith('+++ ')
    ) {
      rows.push({ id: `meta:${index}`, kind: 'meta', raw: line, oldText: line, newText: line });
      return;
    }

    if (line.startsWith('@@')) {
      hunkIndex += 1;
      const parsed = parseHunkHeader(line);
      if (parsed) {
        oldLine = parsed.oldLine;
        newLine = parsed.newLine;
      }
      rows.push({ id: `hunk:${index}`, kind: 'hunk', raw: line, hunkIndex, oldText: line, newText: line });
      return;
    }

    if (line.startsWith('\\')) {
      rows.push({ id: `meta:${index}`, kind: 'meta', raw: line, oldText: line, newText: line });
      return;
    }

    if (line.startsWith('+')) {
      rows.push({
        id: `new:${newLine}:${index}`,
        kind: 'add',
        raw: line,
        newNumber: newLine,
        newText: line.slice(1) || ' ',
      });
      newLine += 1;
      return;
    }

    if (line.startsWith('-')) {
      rows.push({
        id: `old:${oldLine}:${index}`,
        kind: 'del',
        raw: line,
        oldNumber: oldLine,
        oldText: line.slice(1) || ' ',
      });
      oldLine += 1;
      return;
    }

    const text = line.startsWith(' ') ? line.slice(1) : line;
    rows.push({
      id: `ctx:${oldLine}:${newLine}:${index}`,
      kind: 'context',
      raw: line,
      oldNumber: oldLine,
      newNumber: newLine,
      oldText: text || ' ',
      newText: text || ' ',
    });
    oldLine += 1;
    newLine += 1;
  });

  return rows;
}

function fileStatusLabel(file: ChangeFileData) {
  if (file.untracked) return 'untracked';
  if (file.gitStatus) return file.gitStatus;
  return file.status;
}

function fileStatLabel(file: ChangeFileData) {
  if (file.binary) return 'binary';
  return `+${file.insertions} -${file.deletions}`;
}

function commentsForCell(comments: InlineComment[], fileId: string, side: 'old' | 'new', line?: number) {
  if (!line) return [];
  return comments.filter((comment) => comment.fileId === fileId && comment.side === side && comment.line === line);
}

export function DiffReviewPage({
  changes,
  onBack,
  onStageFile,
  onUnstageFile,
  onRevertFile,
  onStageHunk,
  onRevertHunk,
  onCreatePullRequest,
}: DiffReviewPageProps) {
  const [activeFileId, setActiveFileId] = useState(changes.files[0]?.id || '');
  const [comments, setComments] = useState<InlineComment[]>([]);
  const [draftTarget, setDraftTarget] = useState<DraftTarget | null>(null);
  const [draftBody, setDraftBody] = useState('');
  const activeFile = useMemo(
    () => changes.files.find((file) => file.id === activeFileId) || changes.files[0] || null,
    [activeFileId, changes.files],
  );
  const activePatch = activeFile?.patch || (!activeFile ? changes.patch || '' : '');
  const splitRows = useMemo(() => splitPatchRows(activePatch), [activePatch]);
  const canStage = Boolean(activeFile && (activeFile.status !== 'staged' || activeFile.unstaged || activeFile.untracked));
  const canUnstage = Boolean(activeFile && (activeFile.status === 'staged' || activeFile.staged));
  const fileComments = comments.filter((comment) => comment.fileId === activeFile?.id);

  useEffect(() => {
    if (!changes.files.length) {
      setActiveFileId('');
      return;
    }
    if (!changes.files.some((file) => file.id === activeFileId)) {
      setActiveFileId(changes.files[0].id);
    }
  }, [activeFileId, changes.files]);

  async function stageActiveFile() {
    if (activeFile && onStageFile) await onStageFile(activeFile);
  }

  async function unstageActiveFile() {
    if (activeFile && onUnstageFile) await onUnstageFile(activeFile);
  }

  async function revertActiveFile() {
    if (!activeFile || !onRevertFile) return;
    const message = activeFile.untracked
      ? `Delete untracked file "${activeFile.path}"?`
      : `Revert all local changes in "${activeFile.path}"?`;
    if (typeof window !== 'undefined' && !window.confirm(message)) return;
    await onRevertFile(activeFile);
  }

  async function stageHunk(hunkIndex: number) {
    if (activeFile && onStageHunk) await onStageHunk(activeFile, hunkIndex);
  }

  async function revertHunk(hunkIndex: number) {
    if (!activeFile || !onRevertHunk) return;
    if (typeof window !== 'undefined' && !window.confirm(`Revert this hunk in "${activeFile.path}"?`)) return;
    await onRevertHunk(activeFile, hunkIndex);
  }

  function beginComment(rowId: string, side: 'old' | 'new', line?: number) {
    if (!line) return;
    setDraftTarget({ rowId, side, line });
    setDraftBody('');
  }

  function submitComment() {
    if (!activeFile || !draftTarget || !draftBody.trim()) return;
    setComments((current) => [
      ...current,
      {
        id: `comment:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        fileId: activeFile.id,
        side: draftTarget.side,
        line: draftTarget.line,
        body: draftBody.trim(),
      },
    ]);
    setDraftTarget(null);
    setDraftBody('');
  }

  function removeComment(commentId: string) {
    setComments((current) => current.filter((comment) => comment.id !== commentId));
  }

  return (
    <main className="redou-review-page" aria-label="Diff review">
      <header className="redou-review-header">
        <button className="redou-icon-button" type="button" aria-label="Back to thread" onClick={onBack}>
          <ArrowLeft size={17} />
        </button>
        <div>
          <span className="redou-title-kicker">Git changes</span>
          <h2>{changes.files.length} changed files</h2>
        </div>
        <div className="redou-review-actions">
          <span className="redou-diff-stat">+{changes.insertions} -{changes.deletions}</span>
          <button className="redou-secondary-pill" type="button" disabled={!canUnstage} onClick={unstageActiveFile}>
            <MinusCircle size={15} />
            Unstage
          </button>
          <button className="redou-secondary-pill" type="button" disabled={!activeFile} onClick={revertActiveFile}>
            <RotateCcw size={15} />
            Revert
          </button>
          <button className="redou-secondary-pill" type="button" disabled={!onCreatePullRequest} onClick={onCreatePullRequest}>
            <GitPullRequest size={15} />
            Create PR
          </button>
          <button className="redou-primary-pill" type="button" disabled={!canStage} onClick={stageActiveFile}>
            <CheckCircle2 size={15} />
            Stage file
          </button>
        </div>
      </header>

      <div className="redou-review-grid">
        <aside className="redou-review-file-list" aria-label="Changed files">
          <div className="redou-card-title-row">
            <h3>Changed files</h3>
            <GitBranch size={15} />
          </div>
          {changes.files.length ? changes.files.map((file) => (
            <button
              className="redou-review-file-row"
              data-active={file.id === activeFile?.id ? 'true' : 'false'}
              data-status={file.status}
              type="button"
              key={file.id}
              onClick={() => {
                setActiveFileId(file.id);
                setDraftTarget(null);
                setDraftBody('');
              }}
            >
              <FileCode2 size={15} />
              <span title={file.path}>{file.path}</span>
              <em>{fileStatLabel(file)}</em>
              <small>{fileStatusLabel(file)}</small>
            </button>
          )) : (
            <div className="redou-review-empty-list">Working tree is clean.</div>
          )}
        </aside>

        <section className="redou-diff-viewer" aria-label="Diff viewer">
          <div className="redou-diff-toolbar">
            <div>
              <span className="redou-title-kicker">Split diff</span>
              <strong>{activeFile?.path || 'No file selected'}</strong>
            </div>
            <div className="redou-diff-toolbar-status">
              {fileComments.length ? <span className="redou-diff-status-pill">{fileComments.length} comments</span> : null}
              <span className="redou-diff-status-pill">{activeFile ? fileStatusLabel(activeFile) : 'clean'}</span>
            </div>
          </div>
          <div className="redou-diff-code" data-mode="split">
            {activeFile && activePatch ? (
              <div className="redou-split-diff" role="region" aria-label="Split patch">
                <div className="redou-split-diff-header">
                  <span>Old</span>
                  <span>New</span>
                </div>
                {splitRows.map((row) => (
                  <SplitDiffRowView
                    key={row.id}
                    row={row}
                    fileId={activeFile.id}
                    comments={comments}
                    draftTarget={draftTarget}
                    draftBody={draftBody}
                    onBeginComment={beginComment}
                    onDraftBodyChange={setDraftBody}
                    onCancelDraft={() => {
                      setDraftTarget(null);
                      setDraftBody('');
                    }}
                    onSubmitComment={submitComment}
                    onRemoveComment={removeComment}
                    canStageHunk={canStage}
                    onStageHunk={onStageHunk ? stageHunk : undefined}
                    onRevertHunk={onRevertHunk ? revertHunk : undefined}
                  />
                ))}
              </div>
            ) : (
              <div className="redou-empty-diff">
                <strong>{activeFile ? 'No patch available' : 'No changes selected'}</strong>
                <span>
                  {activeFile?.binary
                    ? 'This file is binary, so Redou can show the file state but not a text patch.'
                    : 'Select a changed file with a text diff to review its patch.'}
                </span>
              </div>
            )}
          </div>
          <div className="redou-diff-footer">
            <CheckCircle2 size={14} />
            <span>{changes.stat || changes.diffSummary || 'No Git diff summary available.'}</span>
          </div>
        </section>
      </div>
    </main>
  );
}

function SplitDiffRowView({
  row,
  fileId,
  comments,
  draftTarget,
  draftBody,
  onBeginComment,
  onDraftBodyChange,
  onCancelDraft,
  onSubmitComment,
  onRemoveComment,
  canStageHunk,
  onStageHunk,
  onRevertHunk,
}: {
  row: SplitDiffRow;
  fileId: string;
  comments: InlineComment[];
  draftTarget: DraftTarget | null;
  draftBody: string;
  onBeginComment: (rowId: string, side: 'old' | 'new', line?: number) => void;
  onDraftBodyChange: (body: string) => void;
  onCancelDraft: () => void;
  onSubmitComment: () => void;
  onRemoveComment: (commentId: string) => void;
  canStageHunk: boolean;
  onStageHunk?: (hunkIndex: number) => Promise<void>;
  onRevertHunk?: (hunkIndex: number) => Promise<void>;
}) {
  const oldComments = commentsForCell(comments, fileId, 'old', row.oldNumber);
  const newComments = commentsForCell(comments, fileId, 'new', row.newNumber);
  const oldDraftOpen = draftTarget?.rowId === row.id && draftTarget.side === 'old';
  const newDraftOpen = draftTarget?.rowId === row.id && draftTarget.side === 'new';

  if (row.kind === 'meta' || row.kind === 'hunk') {
    return (
      <div className="redou-split-diff-row" data-kind={row.kind}>
        <div className="redou-split-diff-cell redou-split-diff-cell-wide">
          <code>{row.raw || ' '}</code>
          {row.kind === 'hunk' && row.hunkIndex !== undefined ? (
            <span className="redou-diff-hunk-actions">
              <button type="button" disabled={!canStageHunk || !onStageHunk} onClick={() => void onStageHunk?.(row.hunkIndex || 0)}>
                Stage hunk
              </button>
              <button type="button" disabled={!onRevertHunk} onClick={() => void onRevertHunk?.(row.hunkIndex || 0)}>
                Revert hunk
              </button>
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="redou-split-diff-row" data-kind={row.kind}>
      <DiffCell
        side="old"
        kind={row.kind === 'del' ? 'del' : row.kind}
        line={row.oldNumber}
        text={row.oldText}
        comments={oldComments}
        draftOpen={oldDraftOpen}
        draftBody={draftBody}
        canComment={Boolean(row.oldNumber)}
        onBeginComment={() => onBeginComment(row.id, 'old', row.oldNumber)}
        onDraftBodyChange={onDraftBodyChange}
        onCancelDraft={onCancelDraft}
        onSubmitComment={onSubmitComment}
        onRemoveComment={onRemoveComment}
      />
      <DiffCell
        side="new"
        kind={row.kind === 'add' ? 'add' : row.kind}
        line={row.newNumber}
        text={row.newText}
        comments={newComments}
        draftOpen={newDraftOpen}
        draftBody={draftBody}
        canComment={Boolean(row.newNumber)}
        onBeginComment={() => onBeginComment(row.id, 'new', row.newNumber)}
        onDraftBodyChange={onDraftBodyChange}
        onCancelDraft={onCancelDraft}
        onSubmitComment={onSubmitComment}
        onRemoveComment={onRemoveComment}
      />
    </div>
  );
}

function DiffCell({
  side,
  kind,
  line,
  text,
  comments,
  draftOpen,
  draftBody,
  canComment,
  onBeginComment,
  onDraftBodyChange,
  onCancelDraft,
  onSubmitComment,
  onRemoveComment,
}: {
  side: 'old' | 'new';
  kind: SplitDiffRow['kind'];
  line?: number;
  text?: string;
  comments: InlineComment[];
  draftOpen: boolean;
  draftBody: string;
  canComment: boolean;
  onBeginComment: () => void;
  onDraftBodyChange: (body: string) => void;
  onCancelDraft: () => void;
  onSubmitComment: () => void;
  onRemoveComment: (commentId: string) => void;
}) {
  return (
    <div className="redou-split-diff-cell" data-side={side} data-kind={text ? kind : 'empty'}>
      <div className="redou-split-diff-line">
        <span className="redou-diff-line-number">{line || ''}</span>
        <code>{text || ' '}</code>
        {canComment ? (
          <button className="redou-diff-comment-button" type="button" aria-label={`Comment on ${side} line ${line}`} onClick={onBeginComment}>
            <MessageSquarePlus size={13} />
          </button>
        ) : null}
      </div>
      {comments.length ? (
        <div className="redou-inline-comments">
          {comments.map((comment) => (
            <div className="redou-inline-comment" key={comment.id}>
              <span>{comment.body}</span>
              <button type="button" aria-label="Delete comment" onClick={() => onRemoveComment(comment.id)}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {draftOpen ? (
        <div className="redou-inline-comment-draft">
          <textarea
            rows={3}
            value={draftBody}
            onChange={(event) => onDraftBodyChange(event.target.value)}
            placeholder="Leave a review comment"
            autoFocus
          />
          <div>
            <button className="redou-secondary-pill" type="button" onClick={onCancelDraft}>
              Cancel
            </button>
            <button className="redou-primary-pill" type="button" disabled={!draftBody.trim()} onClick={onSubmitComment}>
              <Send size={13} />
              Comment
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
