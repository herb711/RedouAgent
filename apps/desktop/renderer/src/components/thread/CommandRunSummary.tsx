import { Terminal } from 'lucide-react';
import type { CommandRunSummaryData } from '../../types';

interface CommandRunSummaryProps {
  summary: CommandRunSummaryData;
}

export function CommandRunSummary({ summary }: CommandRunSummaryProps) {
  return (
    <button className="redou-command-run-summary" type="button">
      <Terminal size={14} />
      <span>{summary.label}</span>
      <span className="redou-command-count">{summary.count}</span>
    </button>
  );
}
