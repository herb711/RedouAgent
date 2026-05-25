import { CalendarClock, Pause, Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { redouApi } from '../../api/redouApi';

interface AutomationPanelProps {
  projectId?: string;
}

interface AutomationItem {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  status: 'ACTIVE' | 'PAUSED';
  lastRunAt?: string | null;
  lastTaskId?: string | null;
}

export function AutomationPanel({ projectId }: AutomationPanelProps) {
  const [automations, setAutomations] = useState<AutomationItem[]>([]);
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState('daily 09:00');
  const [prompt, setPrompt] = useState('');
  const [message, setMessage] = useState('');

  function applyResult(data: unknown) {
    setAutomations(((data as { automations?: AutomationItem[] })?.automations) || []);
  }

  async function load() {
    const result = await redouApi.listAutomations({ projectId });
    if (result.ok) applyResult(result.data);
    else setMessage(result.error?.message || 'Failed to load automations.');
  }

  async function create() {
    const result = await redouApi.createAutomation({ projectId, name: name || prompt.slice(0, 48), schedule, prompt });
    if (!result.ok) {
      setMessage(result.error?.message || 'Failed to create automation.');
      return;
    }
    applyResult(result.data);
    setName('');
    setPrompt('');
    setMessage('Automation saved.');
  }

  async function setStatus(automation: AutomationItem, status: 'ACTIVE' | 'PAUSED') {
    const result = await redouApi.updateAutomation({ id: automation.id, status });
    if (result.ok) applyResult(result.data);
    else setMessage(result.error?.message || 'Failed to update automation.');
  }

  async function remove(automation: AutomationItem) {
    if (!window.confirm(`Delete automation "${automation.name}"?`)) return;
    const result = await redouApi.deleteAutomation({ id: automation.id });
    if (result.ok) applyResult(result.data);
    else setMessage(result.error?.message || 'Failed to delete automation.');
  }

  async function run(automation: AutomationItem) {
    const result = await redouApi.runAutomation({ id: automation.id, projectId });
    if (result.ok) {
      applyResult(result.data);
      const taskId = (result.data as { task?: { id?: string } })?.task?.id;
      setMessage(taskId ? `Created task ${taskId}.` : 'Automation run recorded.');
    } else {
      setMessage(result.error?.message || 'Failed to run automation.');
    }
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  return (
    <div className="redou-panel-stack">
      <section className="redou-inspector-card">
        <div className="redou-card-title-row">
          <h3>Automations</h3>
          <CalendarClock size={15} />
        </div>
        <div className="redou-automation-form">
          <input value={name} placeholder="Name" onChange={(event) => setName(event.target.value)} />
          <input value={schedule} placeholder="daily 09:00 or manual" onChange={(event) => setSchedule(event.target.value)} />
          <textarea value={prompt} rows={3} placeholder="Prompt to run" onChange={(event) => setPrompt(event.target.value)} />
          <button className="redou-primary-button" type="button" disabled={!prompt.trim()} onClick={() => void create()}>
            <Plus size={14} />
            Add automation
          </button>
        </div>
        {message ? <p className="redou-muted-copy">{message}</p> : null}
      </section>

      <section className="redou-inspector-card">
        <div className="redou-card-title-row">
          <h3>Saved jobs</h3>
          <span>{automations.length}</span>
        </div>
        <div className="redou-resource-list">
          {automations.length ? automations.map((automation) => (
            <article className="redou-resource-row redou-resource-row-stack" key={automation.id}>
              <div>
                <strong>{automation.name}</strong>
                <span>{automation.schedule} · {automation.status}</span>
                <small>{automation.prompt}</small>
              </div>
              <button type="button" aria-label="Run automation" onClick={() => void run(automation)}>
                <Play size={14} />
              </button>
              <button
                type="button"
                aria-label={automation.status === 'ACTIVE' ? 'Pause automation' : 'Resume automation'}
                onClick={() => void setStatus(automation, automation.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE')}
              >
                <Pause size={14} />
              </button>
              <button type="button" aria-label="Delete automation" onClick={() => void remove(automation)}>
                <Trash2 size={14} />
              </button>
            </article>
          )) : (
            <div className="redou-empty-compact">No automations yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}
