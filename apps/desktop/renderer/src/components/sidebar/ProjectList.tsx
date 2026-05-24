import {
  AlertCircle,
  Archive,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  SquarePen,
  Trash2,
} from 'lucide-react';
import { type CSSProperties, type MouseEvent, useEffect, useRef, useState } from 'react';
import type { WorkbenchProject } from '../../types';

interface ProjectListProps {
  projects: WorkbenchProject[];
  activeProjectId: string;
  activeTaskId?: string;
  compact?: boolean;
  expandedProjectIds?: string[];
  onSelectProject?: (projectId: string) => void;
  onSelectTask?: (taskId: string) => void;
  onCreateConversation?: (projectId: string) => void | Promise<void>;
  onToggleProjectPinned?: (projectId: string) => void | Promise<void>;
  onOpenProjectFolder?: (projectId: string) => void | Promise<void>;
  onRenameProject?: (projectId: string) => void | Promise<void>;
  onArchiveProjectConversation?: (projectId: string) => void | Promise<void>;
  onRemoveProject?: (projectId: string) => void | Promise<void>;
}

const PROJECT_MENU_WIDTH = 236;
const PROJECT_MENU_HEIGHT = 232;

function clampMenuPosition(left: number, top: number) {
  if (typeof window === 'undefined') return { left, top };
  return {
    left: Math.min(Math.max(8, left), Math.max(8, window.innerWidth - PROJECT_MENU_WIDTH - 8)),
    top: Math.min(Math.max(8, top), Math.max(8, window.innerHeight - PROJECT_MENU_HEIGHT - 8)),
  };
}

export function ProjectList({
  projects,
  activeProjectId,
  activeTaskId,
  compact,
  expandedProjectIds = [],
  onSelectProject,
  onSelectTask,
  onCreateConversation,
  onToggleProjectPinned,
  onOpenProjectFolder,
  onRenameProject,
  onArchiveProjectConversation,
  onRemoveProject,
}: ProjectListProps) {
  const [contextMenu, setContextMenu] = useState<{
    project: WorkbenchProject;
    left: number;
    top: number;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuStyle: CSSProperties | undefined = contextMenu
    ? { left: contextMenu.left, top: contextMenu.top }
    : undefined;

  useEffect(() => {
    if (!contextMenu) return undefined;
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target as Node;
      if (contextMenuRef.current?.contains(target)) return;
      setContextMenu(null);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setContextMenu(null);
    }
    function closeOnWindowChange() {
      setContextMenu(null);
    }
    window.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeOnWindowChange);
    window.addEventListener('scroll', closeOnWindowChange, true);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeOnWindowChange);
      window.removeEventListener('scroll', closeOnWindowChange, true);
    };
  }, [contextMenu]);

  function openProjectMenu(event: MouseEvent<HTMLElement>, project: WorkbenchProject, mode: 'button' | 'context') {
    event.preventDefault();
    event.stopPropagation();
    if (mode === 'button') {
      const rect = event.currentTarget.getBoundingClientRect();
      setContextMenu({
        project,
        ...clampMenuPosition(rect.left, rect.bottom + 6),
      });
      return;
    }
    setContextMenu({
      project,
      ...clampMenuPosition(event.clientX, event.clientY),
    });
  }

  async function runProjectAction(action?: (projectId: string) => void | Promise<void>) {
    const projectId = contextMenu?.project.id;
    setContextMenu(null);
    if (!projectId || !action) return;
    await action(projectId);
  }

  return (
    <div className="redou-project-list" data-compact={compact ? 'true' : 'false'}>
      {projects.map((project) => {
        const active = project.id === activeProjectId;
        const expanded = expandedProjectIds.includes(project.id);
        const showTasks = !compact && expanded && project.tasks.length > 0;
        const projectMenuOpen = contextMenu?.project.id === project.id;

        return (
          <div className="redou-project-block" key={project.id}>
            <div
              className="redou-project-row"
              data-active={active ? 'true' : 'false'}
              data-menu-open={projectMenuOpen ? 'true' : 'false'}
              onContextMenu={(event) => openProjectMenu(event, project, 'context')}
            >
              <button
                className="redou-project-main"
                type="button"
                onClick={() => onSelectProject?.(project.id)}
              >
                {project.pinned ? <Pin size={13} /> : <Folder size={14} />}
                <span>{project.name}</span>
                {!compact && project.tasks.length > 0 ? (
                  expanded ? <ChevronDown className="redou-project-chevron" size={13} /> : <ChevronRight className="redou-project-chevron" size={13} />
                ) : null}
              </button>
              <div className="redou-project-row-actions" aria-label={`${project.name} 项目操作`}>
                <button
                  className="redou-project-inline-action"
                  type="button"
                  aria-label={`${project.name} 项目菜单`}
                  title={`${project.name} 项目菜单`}
                  aria-haspopup="menu"
                  aria-expanded={projectMenuOpen ? 'true' : 'false'}
                  onClick={(event) => openProjectMenu(event, project, 'button')}
                >
                  <MoreHorizontal size={14} />
                </button>
                <button
                  className="redou-project-inline-action redou-project-new-chat"
                  type="button"
                  aria-label={`在 ${project.name} 中开始新对话`}
                  title={`在 ${project.name} 中开始新对话`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void onCreateConversation?.(project.id);
                  }}
                >
                  <SquarePen size={14} />
                </button>
              </div>
            </div>
            {showTasks ? (
              <div className="redou-task-list">
                {project.tasks.map((task) => (
                  <button
                    className="redou-task-row"
                    data-active={task.id === activeTaskId ? 'true' : 'false'}
                    data-status={task.status}
                    type="button"
                    key={task.id}
                    onClick={() => onSelectTask?.(task.id)}
                  >
                    {task.status === 'running' ? <Loader2 className="redou-task-state-icon" size={13} /> : null}
                    {task.status === 'error' ? <AlertCircle className="redou-task-state-icon" size={13} /> : null}
                    <span>{task.title}</span>
                    {task.updatedAt ? <em>{task.updatedAt}</em> : null}
                  </button>
                ))}
                <button className="redou-show-more" type="button">展开显示</button>
              </div>
            ) : null}
          </div>
        );
      })}
      {contextMenu ? (
        <div
          ref={contextMenuRef}
          className="redou-project-context-menu"
          role="menu"
          style={contextMenuStyle}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" role="menuitem" onClick={() => void runProjectAction(onToggleProjectPinned)}>
            {contextMenu.project.pinned ? <PinOff size={17} /> : <Pin size={17} />}
            <span>{contextMenu.project.pinned ? '取消置顶项目' : '置顶项目'}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!contextMenu.project.rootPath}
            onClick={() => void runProjectAction(onOpenProjectFolder)}
          >
            <FolderOpen size={17} />
            <span>在资源管理器中打开</span>
          </button>
          <button type="button" role="menuitem" onClick={() => void runProjectAction(onRenameProject)}>
            <Pencil size={17} />
            <span>重命名项目</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={contextMenu.project.tasks.length === 0}
            onClick={() => void runProjectAction(onArchiveProjectConversation)}
          >
            <Archive size={17} />
            <span>归档对话</span>
          </button>
          <div className="redou-project-menu-separator" />
          <button
            type="button"
            role="menuitem"
            data-danger="true"
            onClick={() => void runProjectAction(onRemoveProject)}
          >
            <Trash2 size={17} />
            <span>移除</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
