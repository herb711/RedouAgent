import { FolderGit2, FolderOpen, GitBranchPlus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { redouApi } from '../../api/redouApi';

interface WorktreePanelProps {
  projectId?: string;
}

interface WorktreeItem {
  id: string;
  path: string;
  name: string;
  branch?: string | null;
  head?: string | null;
  detached?: boolean;
}

export function WorktreePanel({ projectId }: WorktreePanelProps) {
  const [worktrees, setWorktrees] = useState<WorktreeItem[]>([]);
  const [branchName, setBranchName] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    const result = await redouApi.listWorktrees({ projectId }).finally(() => setLoading(false));
    if (!result.ok || !result.data) {
      setMessage(result.error?.message || 'Failed to load worktrees.');
      return;
    }
    const data = result.data as { worktrees?: WorktreeItem[] };
    setWorktrees(data.worktrees || []);
    setMessage('');
  }

  async function create() {
    const trimmed = branchName.trim();
    if (!trimmed) return;
    setLoading(true);
    const result = await redouApi.createWorktree({ projectId, branchName: trimmed }).finally(() => setLoading(false));
    if (!result.ok || !result.data) {
      setMessage(result.error?.message || 'Failed to create worktree.');
      return;
    }
    const data = result.data as { worktrees?: WorktreeItem[]; created?: { path?: string } };
    setWorktrees(data.worktrees || []);
    setBranchName('');
    setMessage(data.created?.path ? `Created ${data.created.path}` : 'Worktree created.');
  }

  async function remove(worktree: WorktreeItem) {
    if (!window.confirm(`Remove worktree "${worktree.path}"?`)) return;
    const result = await redouApi.removeWorktree({ projectId, path: worktree.path });
    if (!result.ok || !result.data) {
      setMessage(result.error?.message || 'Failed to remove worktree.');
      return;
    }
    setWorktrees(((result.data as { worktrees?: WorktreeItem[] }).worktrees) || []);
  }

  async function open(worktree: WorktreeItem) {
    const result = await redouApi.openWorktree({ path: worktree.path });
    if (!result.ok) setMessage(result.error?.message || 'Failed to open worktree.');
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  return (
    <div className="redou-panel-stack">
      <section className="redou-inspector-card">
        <div className="redou-card-title-row">
          <h3>Worktree mode</h3>
          <button className="redou-icon-button" type="button" aria-label="Refresh worktrees" onClick={() => void load()}>
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="redou-compact-form">
          <input value={branchName} placeholder="codex/feature-name" onChange={(event) => setBranchName(event.target.value)} />
          <button className="redou-primary-button" type="button" disabled={loading || !branchName.trim()} onClick={() => void create()}>
            <GitBranchPlus size={14} />
            Create
          </button>
        </div>
        {message ? <p className="redou-muted-copy">{message}</p> : null}
      </section>

      <section className="redou-inspector-card">
        <div className="redou-card-title-row">
          <h3>Registered worktrees</h3>
          <FolderGit2 size={15} />
        </div>
        <div className="redou-resource-list">
          {worktrees.length ? worktrees.map((worktree) => (
            <article className="redou-resource-row" key={worktree.id}>
              <div>
                <strong>{worktree.branch || worktree.name}</strong>
                <span>{worktree.path}</span>
              </div>
              <button type="button" aria-label="Open worktree" onClick={() => void open(worktree)}>
                <FolderOpen size={14} />
              </button>
              <button type="button" aria-label="Remove worktree" disabled={!worktree.branch} onClick={() => void remove(worktree)}>
                <Trash2 size={14} />
              </button>
            </article>
          )) : (
            <div className="redou-empty-compact">No Git worktrees found.</div>
          )}
        </div>
      </section>
    </div>
  );
}
