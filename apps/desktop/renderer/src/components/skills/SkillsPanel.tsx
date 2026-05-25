import { RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { redouApi } from '../../api/redouApi';

interface SkillItem {
  id: string;
  name: string;
  title?: string;
  description?: string;
  path?: string;
  enabled: boolean;
}

export function SkillsPanel() {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return skills;
    return skills.filter((skill) => `${skill.name} ${skill.title || ''} ${skill.description || ''}`.toLowerCase().includes(needle));
  }, [query, skills]);

  function applyResult(data: unknown) {
    setSkills(((data as { skills?: SkillItem[] })?.skills) || []);
  }

  async function load() {
    const result = await redouApi.listSkills();
    if (result.ok) applyResult(result.data);
    else setMessage(result.error?.message || 'Failed to load skills.');
  }

  async function toggle(skill: SkillItem) {
    const result = await redouApi.toggleSkill({ id: skill.id, enabled: !skill.enabled });
    if (result.ok) applyResult(result.data);
    else setMessage(result.error?.message || 'Failed to update skill.');
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="redou-panel-stack">
      <section className="redou-inspector-card">
        <div className="redou-card-title-row">
          <h3>Skills</h3>
          <button className="redou-icon-button" type="button" aria-label="Rescan skills" onClick={() => void load()}>
            <RefreshCw size={14} />
          </button>
        </div>
        <input className="redou-panel-search" value={query} placeholder="Search skills" onChange={(event) => setQuery(event.target.value)} />
        {message ? <p className="redou-muted-copy">{message}</p> : null}
      </section>

      <section className="redou-inspector-card">
        <div className="redou-card-title-row">
          <h3>Available skills</h3>
          <span>{filtered.length}</span>
        </div>
        <div className="redou-resource-list">
          {filtered.length ? filtered.map((skill) => (
            <article className="redou-resource-row redou-resource-row-stack" key={skill.id}>
              <Sparkles size={15} />
              <div>
                <strong>{skill.title || skill.name}</strong>
                <span>{skill.description || skill.path || skill.name}</span>
              </div>
              <label className="redou-switch">
                <input type="checkbox" checked={skill.enabled} onChange={() => void toggle(skill)} />
                <span />
              </label>
            </article>
          )) : (
            <div className="redou-empty-compact">No skills found in the configured skill roots.</div>
          )}
        </div>
      </section>
    </div>
  );
}
