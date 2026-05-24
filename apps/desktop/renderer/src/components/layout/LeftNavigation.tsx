import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ChevronsUp,
  FolderOpen,
  FolderPlus,
  Globe2,
  MessageSquare,
  PanelLeft,
  Plug,
  Search,
} from 'lucide-react';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { NavItem } from '../sidebar/NavItem';
import { ProjectList } from '../sidebar/ProjectList';
import { ProjectSection } from '../sidebar/ProjectSection';
import { SettingsEntry } from '../sidebar/SettingsEntry';
import type { WorkbenchProject, WorkbenchView } from '../../types';

interface LeftNavigationProps {
  projects: WorkbenchProject[];
  activeProjectId: string;
  activeTaskId: string;
  activeView: WorkbenchView;
  expandedProjectIds: string[];
  onCollapseSidebar: () => void;
  onCollapseAllProjects: () => void;
  onCreateBlankProject: (name?: string) => Promise<void>;
  onCreateConversationInProject: (projectId: string) => Promise<void>;
  onCreateProjectFromFolder: () => Promise<void>;
  onToggleProjectPinned: (projectId: string) => Promise<void>;
  onOpenProjectFolder: (projectId: string) => Promise<void>;
  onRenameProject: (projectId: string) => Promise<void>;
  onArchiveProjectConversation: (projectId: string) => Promise<void>;
  onRemoveProject: (projectId: string) => Promise<void>;
  onSelectProject: (projectId: string) => void;
  onSelectTask: (taskId: string) => void;
  onSelectView: (view: WorkbenchView) => void;
}

export function LeftNavigation({
  projects,
  activeProjectId,
  activeTaskId,
  activeView,
  expandedProjectIds,
  onCollapseSidebar,
  onCollapseAllProjects,
  onCreateBlankProject,
  onCreateConversationInProject,
  onCreateProjectFromFolder,
  onToggleProjectPinned,
  onOpenProjectFolder,
  onRenameProject,
  onArchiveProjectConversation,
  onRemoveProject,
  onSelectProject,
  onSelectTask,
  onSelectView,
}: LeftNavigationProps) {
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectMenuPosition, setProjectMenuPosition] = useState({ top: 0, left: 0 });
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const pinnedProjects = projects.filter((project) => project.pinned);
  const projectMenuStyle: CSSProperties = {
    left: projectMenuPosition.left,
    top: projectMenuPosition.top,
  };

  useEffect(() => {
    if (!projectMenuOpen) return undefined;
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target as Node;
      if (projectMenuRef.current?.contains(target) || createButtonRef.current?.contains(target)) return;
      setProjectMenuOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setProjectMenuOpen(false);
    }
    window.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [projectMenuOpen]);

  function toggleProjectMenu() {
    const rect = createButtonRef.current?.getBoundingClientRect();
    if (rect) {
      const menuWidth = 240;
      setProjectMenuPosition({
        top: rect.bottom + 8,
        left: Math.min(Math.max(8, rect.right - menuWidth), window.innerWidth - menuWidth - 8),
      });
    }
    setProjectMenuOpen((open) => !open);
  }

  async function handleCreateBlankProject() {
    setProjectMenuOpen(false);
    const name = window.prompt('项目名称', '空白项目');
    if (name === null) return;
    await onCreateBlankProject(name.trim() || undefined);
  }

  async function handleCreateProjectFromFolder() {
    setProjectMenuOpen(false);
    await onCreateProjectFromFolder();
  }

  return (
    <aside className="redou-left-navigation" aria-label="Redou navigation">
      <div className="redou-left-toolbar">
        <button className="redou-nav-icon" type="button" aria-label="隐藏侧边栏" title="隐藏侧边栏" onClick={onCollapseSidebar}>
          <PanelLeft size={16} />
        </button>
        <div className="redou-history-controls" aria-label="Navigation history">
          <button className="redou-nav-icon" type="button" aria-label="Back">
            <ArrowLeft size={15} />
          </button>
          <button className="redou-nav-icon" type="button" aria-label="Forward">
            <ArrowRight size={15} />
          </button>
        </div>
      </div>

      <nav className="redou-primary-nav" aria-label="Main">
        <NavItem icon={MessageSquare} label="新对话" active={activeView === 'thread'} onClick={() => onSelectView('thread')} />
        <NavItem icon={Search} label="搜索" />
        <NavItem icon={Plug} label="插件" />
        <NavItem icon={CalendarClock} label="自动化" />
      </nav>

      <div className="redou-sidebar-scroll">
        <ProjectSection title="置顶">
          <ProjectList
            projects={pinnedProjects}
            activeProjectId={activeProjectId}
            activeTaskId={activeTaskId}
            expandedProjectIds={expandedProjectIds}
            compact
            onSelectProject={onSelectProject}
            onSelectTask={onSelectTask}
            onCreateConversation={onCreateConversationInProject}
            onToggleProjectPinned={onToggleProjectPinned}
            onOpenProjectFolder={onOpenProjectFolder}
            onRenameProject={onRenameProject}
            onArchiveProjectConversation={onArchiveProjectConversation}
            onRemoveProject={onRemoveProject}
          />
        </ProjectSection>
        <ProjectSection
          title="项目"
          actions={(
            <>
              <button
                className="redou-project-action"
                type="button"
                aria-label="全部收起"
                title="全部收起"
                onClick={onCollapseAllProjects}
              >
                <ChevronsUp size={14} />
              </button>
              <button
                ref={createButtonRef}
                className="redou-project-action"
                type="button"
                aria-label="新建项目"
                aria-haspopup="menu"
                aria-expanded={projectMenuOpen ? 'true' : 'false'}
                title="新建项目"
                onClick={toggleProjectMenu}
              >
                <FolderPlus size={15} />
              </button>
            </>
          )}
        >
          <ProjectList
            projects={projects}
            activeProjectId={activeProjectId}
            activeTaskId={activeTaskId}
            expandedProjectIds={expandedProjectIds}
            onSelectProject={onSelectProject}
            onSelectTask={onSelectTask}
            onCreateConversation={onCreateConversationInProject}
            onToggleProjectPinned={onToggleProjectPinned}
            onOpenProjectFolder={onOpenProjectFolder}
            onRenameProject={onRenameProject}
            onArchiveProjectConversation={onArchiveProjectConversation}
            onRemoveProject={onRemoveProject}
          />
        </ProjectSection>
      </div>

      <SettingsEntry active={activeView === 'settings'} onClick={() => onSelectView('settings')} />
      {projectMenuOpen ? (
        <div ref={projectMenuRef} className="redou-project-create-menu" role="menu" style={projectMenuStyle}>
          <button type="button" role="menuitem" onClick={() => void handleCreateBlankProject()}>
            <FolderPlus size={17} />
            <span>新建空白项目</span>
          </button>
          <button type="button" role="menuitem" onClick={() => void handleCreateProjectFromFolder()}>
            <FolderOpen size={17} />
            <span>使用现有文件夹</span>
          </button>
          <div className="redou-project-menu-separator" />
          <button type="button" role="menuitem" disabled>
            <Globe2 size={17} />
            <span>远程项目</span>
          </button>
        </div>
      ) : null}
    </aside>
  );
}
