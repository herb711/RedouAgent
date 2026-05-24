import { BookOpen, Edit3 } from 'lucide-react';
import type { RulesData } from '../../types';

interface RulesPanelProps {
  rules: RulesData;
}

export function RulesPanel({ rules }: RulesPanelProps) {
  return (
    <div className="redou-panel-stack">
      <RulesBlock title="项目规则" items={rules.projectRules} />
      <RulesBlock title="任务规则" items={rules.taskRules} />
      <button className="redou-secondary-action" type="button">
        <Edit3 size={14} />
        编辑入口
      </button>
    </div>
  );
}

function RulesBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="redou-inspector-card">
      <div className="redou-card-title-row">
        <h3>{title}</h3>
        <BookOpen size={15} />
      </div>
      <ul className="redou-simple-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
