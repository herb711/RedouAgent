import { CalendarClock, Check, ClipboardList, Pause, Play, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { redouApi, type AutomationRunSnapshot, type AutomationSnapshot } from '../../api/redouApi';

interface AutomationPanelProps {
  projectId?: string;
  conversationId?: string;
}

type ScheduleType = AutomationSnapshot['scheduleType'];
type ReplyTarget = AutomationSnapshot['replyTarget'];

interface DraftState {
  id?: string;
  title: string;
  description: string;
  prompt: string;
  enabled: boolean;
  scheduleType: ScheduleType;
  scheduleText: string;
  rrule: string;
  startAt: string;
  intervalMinutes: number;
  bindConversation: boolean;
  replyTarget: ReplyTarget;
  exposeResultInConversation: boolean;
  requireConfirmationBeforeRun: boolean;
  maxRetries: number;
}

const emptyDraft: DraftState = {
  title: '',
  description: '',
  prompt: '',
  enabled: true,
  scheduleType: 'daily',
  scheduleText: 'daily 09:00',
  rrule: '',
  startAt: '',
  intervalMinutes: 60,
  bindConversation: true,
  replyTarget: 'bound_conversation',
  exposeResultInConversation: true,
  requireConfirmationBeforeRun: false,
  maxRetries: 0,
};

function localDateTimeValue(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function isoFromLocalInput(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatDate(value?: string | null) {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function draftFromAutomation(automation: AutomationSnapshot): DraftState {
  return {
    id: automation.id,
    title: automation.title || automation.name || '',
    description: automation.description || '',
    prompt: automation.prompt || '',
    enabled: automation.enabled,
    scheduleType: automation.scheduleType || 'daily',
    scheduleText: automation.scheduleText || automation.schedule || '',
    rrule: automation.rrule || '',
    startAt: localDateTimeValue(automation.startAt || automation.nextRunAt),
    intervalMinutes: Number((automation as AutomationSnapshot & { intervalMinutes?: number }).intervalMinutes || 60),
    bindConversation: Boolean(automation.conversationId),
    replyTarget: automation.replyTarget || 'automation_log_only',
    exposeResultInConversation: automation.exposeResultInConversation,
    requireConfirmationBeforeRun: automation.requireConfirmationBeforeRun,
    maxRetries: automation.maxRetries || 0,
  };
}

function scheduleTextForDraft(draft: DraftState) {
  if (draft.scheduleType === 'interval') return `every ${Math.max(1, draft.intervalMinutes)} minutes`;
  if (draft.scheduleType === 'condition_watch') return `condition watch every ${Math.max(1, draft.intervalMinutes)} minutes`;
  if (draft.scheduleType === 'rrule') return draft.rrule;
  return draft.scheduleText;
}

function payloadFromDraft(draft: DraftState, projectId?: string, conversationId?: string) {
  const boundConversationId = draft.bindConversation ? conversationId : null;
  return {
    ...(draft.id ? { id: draft.id } : {}),
    title: draft.title || draft.prompt.slice(0, 72) || 'Untitled automation',
    description: draft.description,
    prompt: draft.prompt,
    enabled: draft.enabled,
    scheduleType: draft.scheduleType,
    scheduleText: scheduleTextForDraft(draft),
    rrule: draft.scheduleType === 'rrule' ? draft.rrule : null,
    startAt: isoFromLocalInput(draft.startAt),
    intervalMinutes: draft.intervalMinutes,
    projectId: projectId || null,
    conversationId: boundConversationId,
    replyTarget: boundConversationId ? draft.replyTarget : 'automation_log_only',
    exposeResultInConversation: Boolean(boundConversationId && draft.exposeResultInConversation),
    requireConfirmationBeforeRun: draft.requireConfirmationBeforeRun,
    maxRetries: draft.maxRetries,
    createdFrom: draft.id ? undefined : 'automation_page',
  };
}

export function AutomationPanel({ projectId, conversationId }: AutomationPanelProps) {
  const [automations, setAutomations] = useState<AutomationSnapshot[]>([]);
  const [runs, setRuns] = useState<AutomationRunSnapshot[]>([]);
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const selected = useMemo(() => automations.find((item) => item.id === selectedId) || null, [automations, selectedId]);

  function applyResult(data: unknown) {
    const next = ((data as { automations?: AutomationSnapshot[] })?.automations) || [];
    setAutomations(next);
    if (selectedId && !next.some((item) => item.id === selectedId)) setSelectedId(null);
  }

  async function load() {
    const result = await redouApi.listAutomations({ projectId });
    if (result.ok) {
      applyResult(result.data);
      const preferred = window.localStorage.getItem('redou.automation.selectedId');
      if (preferred) setSelectedId(preferred);
    } else {
      setMessage(result.error?.message || 'Failed to load automations.');
    }
  }

  async function loadRuns(id?: string | null) {
    if (!id) {
      setRuns([]);
      return;
    }
    const result = await redouApi.listAutomationRuns({ id, limit: 8 });
    if (result.ok) setRuns(((result.data as { runs?: AutomationRunSnapshot[] })?.runs) || []);
  }

  async function save() {
    const payload = payloadFromDraft(draft, projectId, conversationId);
    const result = draft.id
      ? await redouApi.updateAutomation(payload)
      : await redouApi.createAutomation(payload);
    if (!result.ok) {
      setMessage(result.error?.message || 'Failed to save automation.');
      return;
    }
    applyResult(result.data);
    const automation = (result.data as { automation?: AutomationSnapshot })?.automation;
    if (automation) {
      setSelectedId(automation.id);
      setDraft(draftFromAutomation(automation));
      window.localStorage.setItem('redou.automation.selectedId', automation.id);
      void loadRuns(automation.id);
    }
    setMessage(draft.id ? 'Automation updated.' : 'Automation created.');
  }

  async function setEnabled(automation: AutomationSnapshot, enabled: boolean) {
    const result = await redouApi.updateAutomation({ id: automation.id, enabled });
    if (result.ok) applyResult(result.data);
    else setMessage(result.error?.message || 'Failed to update automation.');
  }

  async function remove(automation: AutomationSnapshot) {
    if (!window.confirm(`Delete automation "${automation.title || automation.name}"?`)) return;
    const result = await redouApi.deleteAutomation({ id: automation.id, projectId });
    if (result.ok) {
      applyResult(result.data);
      if (selectedId === automation.id) {
        setSelectedId(null);
        setDraft(emptyDraft);
      }
    } else {
      setMessage(result.error?.message || 'Failed to delete automation.');
    }
  }

  async function run(automation: AutomationSnapshot) {
    const result = await redouApi.runAutomation({ id: automation.id, projectId, conversationId, trigger: 'manual', confirmed: true });
    if (result.ok) {
      applyResult(result.data);
      void loadRuns(automation.id);
      setMessage('Automation run dispatched.');
    } else {
      setMessage(result.error?.message || 'Failed to run automation.');
    }
  }

  function selectAutomation(automation: AutomationSnapshot) {
    setSelectedId(automation.id);
    setDraft(draftFromAutomation(automation));
    window.localStorage.setItem('redou.automation.selectedId', automation.id);
    void loadRuns(automation.id);
  }

  function createNew() {
    setSelectedId(null);
    setDraft({ ...emptyDraft, bindConversation: Boolean(conversationId) });
    setRuns([]);
    setMessage('');
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  useEffect(() => {
    if (!selected) return;
    setDraft(draftFromAutomation(selected));
    void loadRuns(selected.id);
  }, [selected?.id]);

  return (
    <div className="redou-panel-stack">
      <section className="redou-inspector-card">
        <div className="redou-card-title-row">
          <h3>Automation</h3>
          <CalendarClock size={15} />
        </div>
        <div className="redou-automation-toolbar">
          <button className="redou-secondary-button" type="button" onClick={createNew}>
            <Plus size={14} />
            New
          </button>
          <span>{automations.length} saved</span>
        </div>
        <div className="redou-automation-form">
          <input value={draft.title} placeholder="Name" onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
          <textarea value={draft.prompt} rows={3} placeholder="Prompt to run" onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))} />
          <textarea value={draft.description} rows={2} placeholder="Description (optional)" onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
          <div className="redou-automation-grid">
            <label>
              <span>Schedule</span>
              <select value={draft.scheduleType} onChange={(event) => setDraft((current) => ({ ...current, scheduleType: event.target.value as ScheduleType }))}>
                <option value="once">Once</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="interval">Interval</option>
                <option value="rrule">RRULE</option>
                <option value="condition_watch">Condition watch</option>
              </select>
            </label>
            <label>
              <span>First run</span>
              <input type="datetime-local" value={draft.startAt} onChange={(event) => setDraft((current) => ({ ...current, startAt: event.target.value }))} />
            </label>
          </div>
          {draft.scheduleType === 'interval' || draft.scheduleType === 'condition_watch' ? (
            <label className="redou-automation-field">
              <span>Interval minutes</span>
              <input type="number" min={1} value={draft.intervalMinutes} onChange={(event) => setDraft((current) => ({ ...current, intervalMinutes: Number(event.target.value) || 1 }))} />
            </label>
          ) : draft.scheduleType === 'rrule' ? (
            <label className="redou-automation-field">
              <span>RRULE</span>
              <input value={draft.rrule} placeholder="FREQ=WEEKLY;BYDAY=FR;BYHOUR=9;BYMINUTE=0" onChange={(event) => setDraft((current) => ({ ...current, rrule: event.target.value }))} />
            </label>
          ) : (
            <label className="redou-automation-field">
              <span>Schedule text</span>
              <input value={draft.scheduleText} placeholder="daily 09:00" onChange={(event) => setDraft((current) => ({ ...current, scheduleText: event.target.value }))} />
            </label>
          )}
          <div className="redou-automation-options">
            <label><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} /> Enabled</label>
            <label><input type="checkbox" checked={draft.bindConversation} disabled={!conversationId} onChange={(event) => setDraft((current) => ({ ...current, bindConversation: event.target.checked, replyTarget: event.target.checked ? 'bound_conversation' : 'automation_log_only', exposeResultInConversation: event.target.checked }))} /> Bind current conversation</label>
            <label><input type="checkbox" checked={draft.exposeResultInConversation} disabled={!draft.bindConversation} onChange={(event) => setDraft((current) => ({ ...current, exposeResultInConversation: event.target.checked }))} /> Reply in conversation</label>
            <label><input type="checkbox" checked={draft.requireConfirmationBeforeRun} onChange={(event) => setDraft((current) => ({ ...current, requireConfirmationBeforeRun: event.target.checked }))} /> Confirm before run</label>
          </div>
          <div className="redou-automation-grid">
            <label>
              <span>Reply target</span>
              <select value={draft.replyTarget} disabled={!draft.bindConversation} onChange={(event) => setDraft((current) => ({ ...current, replyTarget: event.target.value as ReplyTarget }))}>
                <option value="bound_conversation">Bound conversation</option>
                <option value="automation_log_only">Log only</option>
                <option value="system_notification">System notification</option>
              </select>
            </label>
            <label>
              <span>Max retries</span>
              <input type="number" min={0} max={10} value={draft.maxRetries} onChange={(event) => setDraft((current) => ({ ...current, maxRetries: Number(event.target.value) || 0 }))} />
            </label>
          </div>
          <button className="redou-primary-button" type="button" disabled={!draft.prompt.trim()} onClick={() => void save()}>
            {draft.id ? <Save size={14} /> : <Plus size={14} />}
            {draft.id ? 'Save changes' : 'Create automation'}
          </button>
        </div>
        {message ? <p className="redou-muted-copy">{message}</p> : null}
      </section>

      <section className="redou-inspector-card">
        <div className="redou-card-title-row">
          <h3>Saved jobs</h3>
          <ClipboardList size={15} />
        </div>
        <div className="redou-resource-list">
          {automations.length ? automations.map((automation) => {
            const active = selectedId === automation.id;
            return (
              <article className="redou-resource-row redou-resource-row-stack redou-automation-row" data-active={active ? 'true' : 'false'} key={automation.id}>
                <button type="button" className="redou-automation-row-main" onClick={() => selectAutomation(automation)}>
                  <strong>{automation.title || automation.name}</strong>
                  <span>{automation.scheduleText || automation.schedule} · {automation.createdBy === 'model' ? 'model' : 'manual'} · {automation.status}</span>
                  <small>Next: {formatDate(automation.nextRunAt)} · Last: {formatDate(automation.lastRunAt)}</small>
                </button>
                <button type="button" aria-label="Run automation" onClick={() => void run(automation)}>
                  <Play size={14} />
                </button>
                <button
                  type="button"
                  aria-label={automation.enabled ? 'Pause automation' : 'Resume automation'}
                  onClick={() => void setEnabled(automation, !automation.enabled)}
                >
                  {automation.enabled ? <Pause size={14} /> : <RotateCcw size={14} />}
                </button>
                <button type="button" aria-label="Delete automation" onClick={() => void remove(automation)}>
                  <Trash2 size={14} />
                </button>
              </article>
            );
          }) : (
            <div className="redou-empty-compact">No automations yet.</div>
          )}
        </div>
      </section>

      <section className="redou-inspector-card">
        <div className="redou-card-title-row">
          <h3>Recent runs</h3>
          <Check size={15} />
        </div>
        <div className="redou-resource-list">
          {runs.length ? runs.map((runItem) => (
            <article className="redou-resource-row redou-resource-row-stack" key={`${runItem.id}:${runItem.status}:${runItem.finishedAt || runItem.startedAt}`}>
              <div>
                <strong>{runItem.status}</strong>
                <span>{formatDate(runItem.startedAt)} · {runItem.trigger || 'manual'}</span>
                <small>{runItem.error || runItem.turnId || runItem.taskId || 'Log only'}</small>
              </div>
            </article>
          )) : (
            <div className="redou-empty-compact">Select an automation to see runs.</div>
          )}
        </div>
      </section>
    </div>
  );
}
