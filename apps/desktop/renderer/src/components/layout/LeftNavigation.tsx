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
  activeBranch?: string;
  activeView: WorkbenchView;
  expandedProjectIds: string[];
  onCollapseSidebar: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  onCollapseAllProjects: () => void;
  onCreateBlankProject: (name?: string) => Promise<void>;
  onCreateConversationInProject: (projectId: string) => Promise<void>;
  onCreateProjectFromFolder: () => Promise<void>;
  onToggleProjectPinned: (projectId: string) => Promise<void>;
  onReorderProjects: (orderedProjectIds: string[]) => Promise<void>;
  onOpenProjectFolder: (projectId: string) => Promise<void>;
  onRenameProject: (projectId: string) => Promise<void>;
  onArchiveProjectConversation: (projectId: string) => Promise<void>;
  onRemoveProject: (projectId: string) => Promise<void>;
  onToggleTaskPinned: (taskId: string) => Promise<void>;
  onRenameTaskConversation: (taskId: string) => Promise<void>;
  onArchiveTaskConversation: (taskId: string) => Promise<void>;
  onToggleTaskUnread: (taskId: string) => Promise<void>;
  onOpenTaskWorkspace: (taskId: string) => Promise<void>;
  onCopyTaskWorkspace: (taskId: string) => Promise<void>;
  onCopyTaskConversationId: (taskId: string) => Promise<void>;
  onCopyTaskDeepLink: (taskId: string) => Promise<void>;
  onForkTaskToLocal: (taskId: string) => Promise<void>;
  onForkTaskToNewWorktree: (taskId: string) => Promise<void>;
  onOpenTaskInNewWindow: (taskId: string) => Promise<void>;
  onSelectProject: (projectId: string) => void;
  onToggleProjectExpanded: (projectId: string) => void;
  onSelectTask: (taskId: string) => void;
  onSelectView: (view: WorkbenchView) => void;
}

function filterProjects(projects: WorkbenchProject[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return projects;
  return projects
    .map((project) => {
      const projectMatches = project.name.toLowerCase().includes(normalized)
        || (project.rootPath || '').toLowerCase().includes(normalized);
      const tasks = projectMatches
        ? project.tasks
        : project.tasks.filter((task) => `${task.title} ${task.userPrompt || ''}`.toLowerCase().includes(normalized));
      return projectMatches || tasks.length ? { ...project, tasks } : null;
    })
    .filter(Boolean) as WorkbenchProject[];
}

export function LeftNavigation({
  projects,
  activeProjectId,
  activeTaskId,
  activeBranch,
  activeView,
  expandedProjectIds,
  onCollapseSidebar,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  onCollapseAllProjects,
  onCreateBlankProject,
  onCreateConversationInProject,
  onCreateProjectFromFolder,
  onToggleProjectPinned,
  onReorderProjects,
  onOpenProjectFolder,
  onRenameProject,
  onArchiveProjectConversation,
  onRemoveProject,
  onToggleTaskPinned,
  onRenameTaskConversation,
  onArchiveTaskConversation,
  onToggleTaskUnread,
  onOpenTaskWorkspace,
  onCopyTaskWorkspace,
  onCopyTaskConversationId,
  onCopyTaskDeepLink,
  onForkTaskToLocal,
  onForkTaskToNewWorktree,
  onOpenTaskInNewWindow,
  onSelectProject,
  onToggleProjectExpanded,
  onSelectTask,
  onSelectView,
}: LeftNavigationProps) {
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectMenuPosition, setProjectMenuPosition] = useState({ top: 0, left: 0 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const visibleProjects = filterProjects(projects, searchQuery);
  const pinnedProjects = visibleProjects.filter((project) => project.pinned);
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

  async function handleReorderProjects(orderedProjectIds: string[]) {
    await onReorderProjects(orderedProjectIds);
  }

  return (
    <aside className="redou-left-navigation" aria-label="Redou 导航">
      <div className="redou-left-toolbar">
        <button className="redou-nav-icon" type="button" aria-label="隐藏侧边栏" title="隐藏侧边栏" onClick={onCollapseSidebar}>
          <PanelLeft size={16} />
        </button>
        <div className="redou-history-controls" aria-label="导航历史">
          <button className="redou-nav-icon" type="button" aria-label="后退" disabled={!canGoBack} onClick={onGoBack}>
            <ArrowLeft size={15} />
          </button>
          <button className="redou-nav-icon" type="button" aria-label="前进" disabled={!canGoForward} onClick={onGoForward}>
            <ArrowRight size={15} />
          </button>
        </div>
      </div>

      <nav className="redou-primary-nav" aria-label="主导航">
        <NavItem
          icon={MessageSquare}
          label="新建对话"
          active={activeView === 'thread'}
          onClick={() => {
            if (activeProjectId) void onCreateConversationInProject(activeProjectId);
            else onSelectView('thread');
          }}
        />
        <NavItem icon={Search} label="搜索" active={searchOpen} onClick={() => setSearchOpen((open) => !open)} />
        <NavItem icon={Globe2} label="浏览器" active={activeView === 'browser'} onClick={() => onSelectView('browser')} />
        <NavItem icon={Plug} label="插件" active={activeView === 'extensions'} onClick={() => onSelectView('extensions')} />
        <NavItem icon={CalendarClock} label="自动化" />
      </nav>

      {searchOpen ? (
        <div className="redou-sidebar-search">
          <Search size={14} />
          <input
            value={searchQuery}
            placeholder="搜索项目或任务"
            onChange={(event) => setSearchQuery(event.target.value)}
            autoFocus
          />
        </div>
      ) : null}

      <div className="redou-sidebar-scroll">
        <ProjectSection title="置顶">
          <ProjectList
            projects={pinnedProjects}
            activeProjectId={activeProjectId}
            activeTaskId={activeTaskId}
            activeBranch={activeBranch}
            expandedProjectIds={expandedProjectIds}
            compact
            onSelectProject={onSelectProject}
            onToggleProjectExpanded={onToggleProjectExpanded}
            onSelectTask={onSelectTask}
            onCreateConversation={onCreateConversationInProject}
            onToggleProjectPinned={onToggleProjectPinned}
            onReorderProjects={searchQuery.trim() ? undefined : handleReorderProjects}
            onOpenProjectFolder={onOpenProjectFolder}
            onRenameProject={onRenameProject}
            onArchiveProjectConversation={onArchiveProjectConversation}
            onRemoveProject={onRemoveProject}
            onToggleTaskPinned={onToggleTaskPinned}
            onRenameTaskConversation={onRenameTaskConversation}
            onArchiveTaskConversation={onArchiveTaskConversation}
            onToggleTaskUnread={onToggleTaskUnread}
            onOpenTaskWorkspace={onOpenTaskWorkspace}
            onCopyTaskWorkspace={onCopyTaskWorkspace}
            onCopyTaskConversationId={onCopyTaskConversationId}
            onCopyTaskDeepLink={onCopyTaskDeepLink}
            onForkTaskToLocal={onForkTaskToLocal}
            onForkTaskToNewWorktree={onForkTaskToNewWorktree}
            onOpenTaskInNewWindow={onOpenTaskInNewWindow}
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
            projects={visibleProjects}
            activeProjectId={activeProjectId}
            activeTaskId={activeTaskId}
            activeBranch={activeBranch}
            expandedProjectIds={expandedProjectIds}
            onSelectProject={onSelectProject}
            onToggleProjectExpanded={onToggleProjectExpanded}
            onSelectTask={onSelectTask}
            onCreateConversation={onCreateConversationInProject}
            onToggleProjectPinned={onToggleProjectPinned}
            onReorderProjects={searchQuery.trim() ? undefined : handleReorderProjects}
            onOpenProjectFolder={onOpenProjectFolder}
            onRenameProject={onRenameProject}
            onArchiveProjectConversation={onArchiveProjectConversation}
            onRemoveProject={onRemoveProject}
            onToggleTaskPinned={onToggleTaskPinned}
            onRenameTaskConversation={onRenameTaskConversation}
            onArchiveTaskConversation={onArchiveTaskConversation}
            onToggleTaskUnread={onToggleTaskUnread}
            onOpenTaskWorkspace={onOpenTaskWorkspace}
            onCopyTaskWorkspace={onCopyTaskWorkspace}
            onCopyTaskConversationId={onCopyTaskConversationId}
            onCopyTaskDeepLink={onCopyTaskDeepLink}
            onForkTaskToLocal={onForkTaskToLocal}
            onForkTaskToNewWorktree={onForkTaskToNewWorktree}
            onOpenTaskInNewWindow={onOpenTaskInNewWindow}
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
