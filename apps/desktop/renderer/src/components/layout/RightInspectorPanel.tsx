import { X } from 'lucide-react';
import { ArtifactPanel } from '../artifacts/ArtifactPanel';
import { AutomationPanel } from '../automations/AutomationPanel';
import { ChangesPanel } from '../changes/ChangesPanel';
import { ContextPanel } from '../context/ContextPanel';
import { FileExplorerPanel } from '../files/FileExplorerPanel';
import { LogPanel } from '../logs/LogPanel';
import { McpPanel } from '../mcp/McpPanel';
import { CodeReviewPanel } from '../review/CodeReviewPanel';
import { RulesPanel } from '../rules/RulesPanel';
import { SkillsPanel } from '../skills/SkillsPanel';
import { ProgressPanel } from '../status/ProgressPanel';
import { TerminalPanel } from '../terminal/TerminalPanel';
import { WorktreePanel } from '../worktrees/WorktreePanel';
import type { WorkbenchActions } from '../../state/workbenchStore';
import type { RightPanelId, WorkbenchMockData } from '../../types';

interface RightInspectorPanelProps {
  data: WorkbenchMockData;
  activePanel: RightPanelId;
  onClose: () => void;
  runtimeAvailability?: unknown;
  runtimeError?: string | null;
  apiMode?: 'ipc' | 'mock';
  actions: WorkbenchActions;
  onOpenArtifactPreview?: () => void;
}

export function RightInspectorPanel({ data, activePanel, onClose, runtimeAvailability, runtimeError, apiMode, actions, onOpenArtifactPreview }: RightInspectorPanelProps) {
  const panelDefinition = data.rightPanels.find((panel) => panel.id === activePanel);

  return (
    <section className="redou-right-inspector" aria-label={panelDefinition?.label ?? 'Inspector panel'}>
      <header className="redou-inspector-header">
        <div>
          <span className="redou-panel-kicker">Redou Inspector</span>
          <h2>{panelDefinition?.label ?? 'Panel'}</h2>
        </div>
        <button className="redou-icon-button" type="button" aria-label="Close inspector" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <div className="redou-inspector-content">
        {renderPanel(activePanel, data, { runtimeAvailability, runtimeError, apiMode, actions, onOpenArtifactPreview })}
      </div>
    </section>
  );
}

function renderPanel(
  activePanel: RightPanelId,
  data: WorkbenchMockData,
  runtime: Pick<RightInspectorPanelProps, 'runtimeAvailability' | 'runtimeError' | 'apiMode' | 'actions' | 'onOpenArtifactPreview'>,
) {
  switch (activePanel) {
    case 'progress':
      return (
        <ProgressPanel
          task={data.activeTask}
          steps={data.progressSteps}
          environment={data.environment}
          planEntries={data.planEntries}
          logs={data.mockLogs}
          todoProjectionEntries={data.todoProjectionEntries}
          approvalRequests={data.approvalRequests}
          runtimeStatus={data.runtimeStatus}
          runtimeAvailability={runtime.runtimeAvailability}
          runtimeError={runtime.runtimeError}
          apiMode={runtime.apiMode}
          onCommitGitChanges={runtime.actions.commitGitChanges}
          onPushGitBranch={runtime.actions.pushGitBranch}
          onCreatePullRequest={runtime.actions.createPullRequest}
        />
      );
    case 'codeReview':
      return <CodeReviewPanel review={data.mockCodeReview} />;
    case 'fileExplorer':
      return <FileExplorerPanel tree={data.mockFileTree} />;
    case 'changes':
      return <ChangesPanel changes={data.mockChanges} />;
    case 'logs':
      return <LogPanel logs={data.mockLogs} />;
    case 'artifacts':
      return <ArtifactPanel artifacts={data.mockArtifacts} onOpenPreview={runtime.onOpenArtifactPreview} />;
    case 'rules':
      return <RulesPanel rules={data.mockRules} />;
    case 'context':
      return <ContextPanel context={data.mockContext} onRemoveItem={runtime.actions.removeContextItem} onClear={runtime.actions.clearContext} />;
    case 'terminal':
      return <TerminalPanel projectId={data.activeProjectId} />;
    case 'worktrees':
      return <WorktreePanel projectId={data.activeProjectId} />;
    case 'automations':
      return <AutomationPanel projectId={data.activeProjectId} conversationId={data.activeTask.id} />;
    case 'skills':
      return <SkillsPanel />;
    case 'mcp':
      return <McpPanel />;
    default:
      return null;
  }
}
