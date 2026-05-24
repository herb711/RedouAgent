import { MoreHorizontal } from 'lucide-react';

interface TopTitleBarProps {
  taskTitle: string;
  activeProjectName: string;
}

export function TopTitleBar({ taskTitle, activeProjectName }: TopTitleBarProps) {
  return (
    <header className="redou-top-title-bar">
      <div className="redou-title-copy">
        <span className="redou-title-kicker">{activeProjectName}</span>
        <h1>{taskTitle}</h1>
      </div>
      <button className="redou-icon-button" type="button" aria-label="More task options">
        <MoreHorizontal size={16} />
      </button>
    </header>
  );
}
