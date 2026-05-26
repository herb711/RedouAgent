import { CheckCircle2, ChevronDown, ChevronRight, Loader2, XCircle } from 'lucide-react';
import { useState } from 'react';
import type { CommandRunData, CommandRunSummaryData } from '../../types';

interface CommandRunSummaryProps {
  summary: CommandRunSummaryData;
}

function commandState(run: CommandRunData) {
  const status = String(run.lifecycle || '').toLowerCase();
  if (run.level === 'error' || status === 'failed' || status === 'error') {
    return 'failed';
  }
  if (status === 'running' || status === 'started' || status === 'active') {
    return 'running';
  }
  return 'completed';
}

function commandStatus(run: CommandRunData) {
  const state = commandState(run);
  if (state === 'failed') return { label: '运行失败', icon: <XCircle size={13} /> };
  if (state === 'running') return { label: '正在运行', icon: <Loader2 size={13} /> };
  return { label: '已运行', icon: <CheckCircle2 size={13} /> };
}

function timestampMs(value?: string) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function durationLabel(commands: CommandRunData[]) {
  const times = commands.map((command) => timestampMs(command.timestamp)).filter((value): value is number => value !== null);
  if (times.length < 2) return '';
  const seconds = Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}

function summaryLabel(summary: CommandRunSummaryData, commands: CommandRunData[]) {
  if (!commands.length) return summary.label;
  const states = commands.map(commandState);
  const failed = states.filter((state) => state === 'failed').length;
  const running = states.includes('running');
  const duration = durationLabel(commands);
  if (failed) return duration ? `处理异常 ${duration}` : `处理异常 ${failed} 条失败`;
  if (running) return `正在处理 ${commands.length} 条命令`;
  return duration ? `已处理 ${duration}` : `已处理 ${commands.length} 条命令`;
}

function commandLabel(command: string) {
  return command.trim() || '命令输出';
}

export function CommandRunSummary({ summary }: CommandRunSummaryProps) {
  const commands = summary.commands || [];
  const [expanded, setExpanded] = useState(false);
  const label = summaryLabel(summary, commands);

  return (
    <div className="redou-command-run-block" data-expanded={expanded ? 'true' : 'false'}>
      <button
        className="redou-command-run-summary"
        type="button"
        aria-expanded={expanded}
        disabled={!commands.length}
        onClick={() => setExpanded((value) => !value)}
      >
        <span>{label}</span>
        {commands.length ? <ChevronDown className="redou-command-summary-chevron" size={15} /> : null}
      </button>
      {expanded && commands.length ? (
        <div className="redou-command-run-list">
          {commands.map((run) => {
            const status = commandStatus(run);
            const output = String(run.output || '').trim();
            return (
              <details className="redou-command-run-item" key={run.id} data-has-output={output ? 'true' : 'false'}>
                <summary>
                  <span className="redou-command-run-status">
                    {status.icon}
                    {status.label}
                  </span>
                  <code>{commandLabel(run.command)}</code>
                  {output ? <ChevronRight className="redou-command-run-chevron" size={14} /> : null}
                </summary>
                {output ? <pre>{output}</pre> : null}
              </details>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
