import { Play, Terminal } from 'lucide-react';
import { useState } from 'react';
import { redouApi } from '../../api/redouApi';

interface TerminalPanelProps {
  projectId?: string;
}

interface TerminalRun {
  id: string;
  command: string;
  cwd?: string;
  code?: number;
  stdout?: string;
  stderr?: string;
  finishedAt?: string;
}

export function TerminalPanel({ projectId }: TerminalPanelProps) {
  const [command, setCommand] = useState('git status --short');
  const [runs, setRuns] = useState<TerminalRun[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  async function runCommand() {
    const trimmed = command.trim();
    if (!trimmed) return;
    setRunning(true);
    setError('');
    const result = await redouApi.runTerminalCommand({ projectId, command: trimmed }).finally(() => setRunning(false));
    if (!result.ok || !result.data) {
      setError(result.error?.message || 'Command failed.');
      return;
    }
    setRuns((current) => [result.data as TerminalRun, ...current].slice(0, 12));
  }

  return (
    <div className="redou-panel-stack">
      <section className="redou-inspector-card">
        <div className="redou-card-title-row">
          <h3>Integrated terminal</h3>
          <Terminal size={15} />
        </div>
        <div className="redou-terminal-command-row">
          <input value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter') void runCommand();
          }} />
          <button className="redou-primary-button" type="button" disabled={running || !command.trim()} onClick={() => void runCommand()}>
            <Play size={14} />
            Run
          </button>
        </div>
        {error ? <p className="redou-panel-error">{error}</p> : null}
      </section>

      <section className="redou-inspector-card">
        <div className="redou-card-title-row">
          <h3>Output</h3>
          <span>{runs.length} runs</span>
        </div>
        <div className="redou-terminal-run-list">
          {runs.length ? runs.map((run) => (
            <article className="redou-terminal-run" data-code={run.code === 0 ? 'ok' : 'failed'} key={run.id}>
              <div>
                <strong>{run.command}</strong>
                <span>{run.cwd}</span>
              </div>
              <pre>{[run.stdout, run.stderr].filter(Boolean).join('\n') || `(exit ${run.code})`}</pre>
            </article>
          )) : (
            <div className="redou-empty-compact">Run a command to see terminal output.</div>
          )}
        </div>
      </section>
    </div>
  );
}
