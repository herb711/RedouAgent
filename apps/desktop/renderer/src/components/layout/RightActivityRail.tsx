import {
  BookOpen,
  Code2,
  Files,
  GitCompare,
  ListChecks,
  Network,
  Package,
  ScrollText,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { RightPanelDefinition, RightPanelId } from '../../types';

const panelIcons: Record<RightPanelId, LucideIcon> = {
  progress: ListChecks,
  codeReview: Code2,
  fileExplorer: Files,
  changes: GitCompare,
  logs: ScrollText,
  artifacts: Package,
  rules: BookOpen,
  context: Network,
};

interface RightActivityRailProps {
  panels: RightPanelDefinition[];
  activePanel: RightPanelId | null;
  panelOpen: boolean;
  onSelectPanel: (panel: RightPanelId) => void;
}

export function RightActivityRail({ panels, activePanel, panelOpen, onSelectPanel }: RightActivityRailProps) {
  return (
    <nav className="redou-right-activity-rail" aria-label="Right activity rail">
      {panels.map((panel) => {
        const Icon = panelIcons[panel.id];
        const active = activePanel === panel.id && panelOpen;

        return (
          <button
            className="redou-activity-button"
            data-active={active ? 'true' : 'false'}
            type="button"
            key={panel.id}
            title={panel.label}
            aria-label={panel.label}
            aria-pressed={active}
            onClick={() => onSelectPanel(panel.id)}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </nav>
  );
}
