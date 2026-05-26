import {
  AlertCircle,
  Archive,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Folder,
  FolderOpen,
  GitBranch,
  GitBranchPlus,
  GitFork,
  Loader2,
  Mail,
  MailOpen,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  SquarePen,
  Trash2,
} from 'lucide-react';
import {
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { WorkbenchProject } from '../../types';

interface ProjectListProps {
  projects: WorkbenchProject[];
  activeProjectId: string;
  activeTaskId?: string;
  activeBranch?: string;
  compact?: boolean;
  expandedProjectIds?: string[];
  onSelectProject?: (projectId: string) => void;
  onToggleProjectExpanded?: (projectId: string) => void;
  onSelectTask?: (taskId: string) => void;
  onCreateConversation?: (projectId: string) => void | Promise<void>;
  onToggleProjectPinned?: (projectId: string) => void | Promise<void>;
  onReorderProjects?: (orderedProjectIds: string[]) => void | Promise<void>;
  onOpenProjectFolder?: (projectId: string) => void | Promise<void>;
  onRenameProject?: (projectId: string) => void | Promise<void>;
  onArchiveProjectConversation?: (projectId: string) => void | Promise<void>;
  onRemoveProject?: (projectId: string) => void | Promise<void>;
  onToggleTaskPinned?: (taskId: string) => void | Promise<void>;
  onRenameTaskConversation?: (taskId: string) => void | Promise<void>;
  onArchiveTaskConversation?: (taskId: string) => void | Promise<void>;
  onToggleTaskUnread?: (taskId: string) => void | Promise<void>;
  onOpenTaskWorkspace?: (taskId: string) => void | Promise<void>;
  onCopyTaskWorkspace?: (taskId: string) => void | Promise<void>;
  onCopyTaskConversationId?: (taskId: string) => void | Promise<void>;
  onCopyTaskDeepLink?: (taskId: string) => void | Promise<void>;
  onForkTaskToLocal?: (taskId: string) => void | Promise<void>;
  onForkTaskToNewWorktree?: (taskId: string) => void | Promise<void>;
  onOpenTaskInNewWindow?: (taskId: string) => void | Promise<void>;
}

const PROJECT_MENU_WIDTH = 236;
const PROJECT_MENU_HEIGHT = 232;
const TASK_MENU_WIDTH = 244;
const TASK_MENU_HEIGHT = 434;
const TASK_HOVER_CARD_WIDTH = 420;
const TASK_HOVER_CARD_HEIGHT = 136;
const MAX_VISIBLE_TASKS = 5;
const PROJECT_DRAG_THRESHOLD = 6;
const PROJECT_DRAG_LONG_PRESS_MS = 260;

interface ProjectDropTarget {
  projectId: string;
  position: 'before' | 'after';
}

interface ProjectPointerDrag {
  projectId: string;
  pointerId: number;
  startX: number;
  startY: number;
  element: HTMLElement;
  active: boolean;
}

function clampMenuPosition(left: number, top: number, width = PROJECT_MENU_WIDTH, height = PROJECT_MENU_HEIGHT) {
  if (typeof window === 'undefined') return { left, top };
  return {
    left: Math.min(Math.max(8, left), Math.max(8, window.innerWidth - width - 8)),
    top: Math.min(Math.max(8, top), Math.max(8, window.innerHeight - height - 8)),
  };
}

export function ProjectList({
  projects,
  activeProjectId,
  activeTaskId,
  activeBranch,
  compact,
  expandedProjectIds = [],
  onSelectProject,
  onToggleProjectExpanded,
  onSelectTask,
  onCreateConversation,
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
}: ProjectListProps) {
  const [contextMenu, setContextMenu] = useState<{
    project: WorkbenchProject;
    left: number;
    top: number;
  } | null>(null);
  const [taskContextMenu, setTaskContextMenu] = useState<{
    project: WorkbenchProject;
    task: WorkbenchProject['tasks'][number];
    left: number;
    top: number;
  } | null>(null);
  const [taskHoverCard, setTaskHoverCard] = useState<{
    project: WorkbenchProject;
    task: WorkbenchProject['tasks'][number];
    detail: string;
    left: number;
    top: number;
  } | null>(null);
  const [expandedTaskProjectIds, setExpandedTaskProjectIds] = useState<string[]>([]);
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null);
  const [projectDropTarget, setProjectDropTarget] = useState<ProjectDropTarget | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const taskContextMenuRef = useRef<HTMLDivElement>(null);
  const taskHoverCloseTimerRef = useRef<number | null>(null);
  const draggingProjectIdRef = useRef<string | null>(null);
  const projectDropTargetRef = useRef<ProjectDropTarget | null>(null);
  const projectPointerDragRef = useRef<ProjectPointerDrag | null>(null);
  const projectDragTimerRef = useRef<number | null>(null);
  const suppressProjectClickRef = useRef(false);
  const contextMenuStyle: CSSProperties | undefined = contextMenu
    ? { left: contextMenu.left, top: contextMenu.top }
    : undefined;
  const taskContextMenuStyle: CSSProperties | undefined = taskContextMenu
    ? { left: taskContextMenu.left, top: taskContextMenu.top }
    : undefined;
  const taskHoverCardStyle: CSSProperties | undefined = taskHoverCard
    ? { left: taskHoverCard.left, top: taskHoverCard.top }
    : undefined;

  function clearTaskHoverCloseTimer() {
    if (taskHoverCloseTimerRef.current === null) return;
    window.clearTimeout(taskHoverCloseTimerRef.current);
    taskHoverCloseTimerRef.current = null;
  }

  function closeTaskHoverCard() {
    clearTaskHoverCloseTimer();
    setTaskHoverCard(null);
  }

  function scheduleCloseTaskHoverCard() {
    clearTaskHoverCloseTimer();
    taskHoverCloseTimerRef.current = window.setTimeout(() => {
      setTaskHoverCard(null);
      taskHoverCloseTimerRef.current = null;
    }, 120);
  }

  function clearProjectDragTimer() {
    if (projectDragTimerRef.current === null) return;
    window.clearTimeout(projectDragTimerRef.current);
    projectDragTimerRef.current = null;
  }

  function taskHoverDetail(project: WorkbenchProject, task: WorkbenchProject['tasks'][number]) {
    if (project.id === activeProjectId && activeBranch) return activeBranch;
    return project.rootPath || task.redouCodexThreadId || task.runtime;
  }

  function openTaskHoverCard(event: MouseEvent<HTMLElement>, project: WorkbenchProject, task: WorkbenchProject['tasks'][number]) {
    if (taskContextMenu?.task.id === task.id) return;
    clearTaskHoverCloseTimer();
    const rect = event.currentTarget.getBoundingClientRect();
    const rightSide = rect.right + 8;
    const leftSide = rect.left - TASK_HOVER_CARD_WIDTH - 8;
    const preferredLeft = rightSide + TASK_HOVER_CARD_WIDTH <= window.innerWidth - 8 ? rightSide : leftSide;
    const { left, top } = clampMenuPosition(preferredLeft, rect.top - 8, TASK_HOVER_CARD_WIDTH, TASK_HOVER_CARD_HEIGHT);
    setTaskHoverCard({
      project,
      task,
      detail: taskHoverDetail(project, task),
      left,
      top,
    });
  }

  useEffect(() => {
    if (!contextMenu && !taskContextMenu) return undefined;
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target as Node;
      if (contextMenuRef.current?.contains(target)) return;
      if (taskContextMenuRef.current?.contains(target)) return;
      setContextMenu(null);
      setTaskContextMenu(null);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setContextMenu(null);
        setTaskContextMenu(null);
      }
    }
    function closeOnWindowChange() {
      setContextMenu(null);
      setTaskContextMenu(null);
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
  }, [contextMenu, taskContextMenu]);

  useEffect(() => () => {
    clearTaskHoverCloseTimer();
    clearProjectDragTimer();
  }, []);

  useEffect(() => {
    if (!taskHoverCard) return undefined;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') closeTaskHoverCard();
    }
    function closeOnWindowChange() {
      closeTaskHoverCard();
    }
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeOnWindowChange);
    window.addEventListener('scroll', closeOnWindowChange, true);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeOnWindowChange);
      window.removeEventListener('scroll', closeOnWindowChange, true);
    };
  }, [taskHoverCard]);

  function openProjectMenu(event: MouseEvent<HTMLElement>, project: WorkbenchProject, mode: 'button' | 'context') {
    event.preventDefault();
    event.stopPropagation();
    setTaskContextMenu(null);
    closeTaskHoverCard();
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

  function openTaskMenu(event: MouseEvent<HTMLElement>, project: WorkbenchProject, task: WorkbenchProject['tasks'][number]) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(null);
    closeTaskHoverCard();
    setTaskContextMenu({
      project,
      task,
      ...clampMenuPosition(event.clientX, event.clientY, TASK_MENU_WIDTH, TASK_MENU_HEIGHT),
    });
  }

  async function runProjectAction(action?: (projectId: string) => void | Promise<void>) {
    const projectId = contextMenu?.project.id;
    setContextMenu(null);
    if (!projectId || !action) return;
    await action(projectId);
  }

  async function runTaskAction(action?: (taskId: string) => void | Promise<void>) {
    const taskId = taskContextMenu?.task.id;
    setTaskContextMenu(null);
    if (!taskId || !action) return;
    await action(taskId);
  }

  async function runHoverTaskAction(taskId: string, action?: (taskId: string) => void | Promise<void>) {
    closeTaskHoverCard();
    if (!action) return;
    await action(taskId);
  }

  function toggleTaskListExpanded(projectId: string) {
    setExpandedTaskProjectIds((projectIds) => (
      projectIds.includes(projectId)
        ? projectIds.filter((id) => id !== projectId)
        : [...projectIds, projectId]
    ));
  }

  function canDragProjects() {
    return Boolean(onReorderProjects) && projects.length > 1;
  }

  function setProjectDropTargetState(target: ProjectDropTarget | null) {
    const current = projectDropTargetRef.current;
    if (current?.projectId === target?.projectId && current?.position === target?.position) return;
    projectDropTargetRef.current = target;
    setProjectDropTarget(target);
  }

  function getProjectDropPosition(clientY: number, element: HTMLElement): ProjectDropTarget['position'] {
    const rect = element.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  }

  function getProjectDropTargetFromPoint(clientX: number, clientY: number) {
    const element = document.elementFromPoint(clientX, clientY);
    const row = element instanceof HTMLElement
      ? element.closest<HTMLElement>('.redou-project-row[data-project-id]')
      : null;
    const projectId = row?.dataset.projectId;
    if (!row || !projectId || projectId === draggingProjectIdRef.current) return null;
    return { projectId, position: getProjectDropPosition(clientY, row) };
  }

  async function applyProjectReorder(draggedProjectId: string, target: ProjectDropTarget | null) {
    if (!target || draggedProjectId === target.projectId || !onReorderProjects) return;
    const orderedProjectIds = projects.map((project) => project.id).filter((id) => id !== draggedProjectId);
    const targetIndex = orderedProjectIds.indexOf(target.projectId);
    if (targetIndex === -1) return;
    orderedProjectIds.splice(target.position === 'after' ? targetIndex + 1 : targetIndex, 0, draggedProjectId);
    await onReorderProjects(orderedProjectIds);
  }

  function activateProjectDrag(drag: ProjectPointerDrag) {
    if (drag.active || projectPointerDragRef.current !== drag) return;
    drag.active = true;
    draggingProjectIdRef.current = drag.projectId;
    setDraggingProjectId(drag.projectId);
    setContextMenu(null);
    setTaskContextMenu(null);
    closeTaskHoverCard();
    try {
      if (!drag.element.hasPointerCapture(drag.pointerId)) {
        drag.element.setPointerCapture(drag.pointerId);
      }
    } catch {
      // Pointer capture is best-effort; the row can still reorder while events arrive.
    }
  }

  function handleProjectPointerDown(event: ReactPointerEvent<HTMLElement>, projectId: string) {
    if (!canDragProjects() || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('.redou-project-row-actions')) return;
    clearProjectDragTimer();
    const drag: ProjectPointerDrag = {
      projectId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      element: event.currentTarget,
      active: false,
    };
    projectPointerDragRef.current = drag;
    projectDragTimerRef.current = window.setTimeout(() => {
      projectDragTimerRef.current = null;
      activateProjectDrag(drag);
    }, PROJECT_DRAG_LONG_PRESS_MS);
  }

  function handleProjectPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const drag = projectPointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.active) {
      if (distance > PROJECT_DRAG_THRESHOLD) {
        clearProjectDragTimer();
        projectPointerDragRef.current = null;
      }
      return;
    }
    event.preventDefault();
    setProjectDropTargetState(getProjectDropTargetFromPoint(event.clientX, event.clientY));
  }

  async function handleProjectPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const drag = projectPointerDragRef.current;
    clearProjectDragTimer();
    if (!drag || drag.pointerId !== event.pointerId) return;
    projectPointerDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag.active) return;
    event.preventDefault();
    suppressProjectClickRef.current = true;
    window.setTimeout(() => {
      suppressProjectClickRef.current = false;
    }, 120);
    const target = getProjectDropTargetFromPoint(event.clientX, event.clientY) || projectDropTargetRef.current;
    setProjectDropTargetState(null);
    draggingProjectIdRef.current = null;
    setDraggingProjectId(null);
    await applyProjectReorder(drag.projectId, target);
  }

  function handleProjectPointerCancel(event: ReactPointerEvent<HTMLElement>) {
    const drag = projectPointerDragRef.current;
    clearProjectDragTimer();
    if (!drag || drag.pointerId !== event.pointerId) return;
    projectPointerDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setProjectDropTargetState(null);
    draggingProjectIdRef.current = null;
    setDraggingProjectId(null);
  }

  function handleProjectClick(project: WorkbenchProject) {
    if (suppressProjectClickRef.current) {
      suppressProjectClickRef.current = false;
      return;
    }
    const shouldToggleExpanded = !compact && project.tasks.length > 0 && project.id === activeProjectId;
    if (shouldToggleExpanded) {
      onToggleProjectExpanded?.(project.id);
      return;
    }
    onSelectProject?.(project.id);
  }

  return (
    <div className="redou-project-list" data-compact={compact ? 'true' : 'false'}>
      {projects.map((project) => {
        const active = project.id === activeProjectId;
        const expanded = expandedProjectIds.includes(project.id);
        const showTasks = !compact && expanded && project.tasks.length > 0;
        const hasTaskOverflow = project.tasks.length > MAX_VISIBLE_TASKS;
        const taskListExpanded = expandedTaskProjectIds.includes(project.id);
        const visibleTasks = hasTaskOverflow && !taskListExpanded
          ? project.tasks.slice(0, MAX_VISIBLE_TASKS)
          : project.tasks;
        const projectMenuOpen = contextMenu?.project.id === project.id;
        const projectDragEnabled = canDragProjects();
        const dropPosition = projectDropTarget?.projectId === project.id ? projectDropTarget.position : undefined;

        return (
          <div className="redou-project-block" data-dragging={draggingProjectId === project.id ? 'true' : 'false'} key={project.id}>
            <div
              className="redou-project-row"
              data-active={active ? 'true' : 'false'}
              data-can-reorder={projectDragEnabled ? 'true' : 'false'}
              data-drag-over={dropPosition}
              data-menu-open={projectMenuOpen ? 'true' : 'false'}
              data-project-id={project.id}
              onContextMenu={(event) => openProjectMenu(event, project, 'context')}
              onPointerDown={(event) => handleProjectPointerDown(event, project.id)}
              onPointerMove={handleProjectPointerMove}
              onPointerUp={(event) => void handleProjectPointerUp(event)}
              onPointerCancel={handleProjectPointerCancel}
            >
              <button
                className="redou-project-main"
                type="button"
                aria-expanded={!compact && project.tasks.length > 0 ? expanded : undefined}
                onClick={() => handleProjectClick(project)}
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
                {visibleTasks.map((task) => (
                  <div
                    className="redou-task-row"
                    data-active={task.id === activeTaskId ? 'true' : 'false'}
                    data-status={task.status}
                    data-menu-open={taskContextMenu?.task.id === task.id ? 'true' : 'false'}
                    data-unread={task.unread ? 'true' : 'false'}
                    key={task.id}
                    onContextMenu={(event) => openTaskMenu(event, project, task)}
                    onMouseEnter={(event) => openTaskHoverCard(event, project, task)}
                    onMouseLeave={scheduleCloseTaskHoverCard}
                  >
                    <button
                      className="redou-task-main"
                      type="button"
                      onClick={() => onSelectTask?.(task.id)}
                      onFocus={(event) => openTaskHoverCard(event, project, task)}
                      onBlur={scheduleCloseTaskHoverCard}
                    >
                      <span className="redou-task-title">{task.title}</span>
                      {task.status === 'running' ? <Loader2 className="redou-task-state-icon" size={13} aria-hidden="true" /> : null}
                      {task.status === 'error' || task.status === 'failed' || task.status === 'waiting_approval' || task.status === 'degraded' ? (
                        <AlertCircle className="redou-task-state-icon" size={13} aria-hidden="true" />
                      ) : null}
                      {task.status !== 'running' && task.status !== 'error' && task.status !== 'failed' && task.status !== 'waiting_approval' && task.status !== 'degraded' && task.unread ? (
                        <span className="redou-task-unread-dot" aria-hidden="true" />
                      ) : null}
                      {task.status !== 'running' && task.status !== 'error' && task.status !== 'failed' && task.status !== 'waiting_approval' && task.status !== 'degraded' && !task.unread && task.updatedAt ? <em>{task.updatedAt}</em> : null}
                    </button>
                    <div className="redou-task-inline-actions" aria-label="任务快捷操作">
                      <button
                        type="button"
                        aria-label={task.pinned ? '取消置顶' : '置顶'}
                        title={task.pinned ? '取消置顶' : '置顶'}
                        onClick={(event) => {
                          event.stopPropagation();
                          void runHoverTaskAction(task.id, onToggleTaskPinned);
                        }}
                      >
                        {task.pinned ? <PinOff size={15} /> : <Pin size={15} />}
                      </button>
                      <button
                        type="button"
                        aria-label="归档"
                        title="归档"
                        onClick={(event) => {
                          event.stopPropagation();
                          void runHoverTaskAction(task.id, onArchiveTaskConversation);
                        }}
                      >
                        <Archive size={15} />
                      </button>
                    </div>
                  </div>
                ))}
                {hasTaskOverflow ? (
                  <button
                    className="redou-show-more"
                    type="button"
                    aria-expanded={taskListExpanded ? 'true' : 'false'}
                    onClick={() => toggleTaskListExpanded(project.id)}
                  >
                    {taskListExpanded ? '折叠显示' : '展开显示'}
                  </button>
                ) : null}
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
      {taskContextMenu ? (
        <div
          ref={taskContextMenuRef}
          className="redou-project-context-menu redou-task-context-menu"
          role="menu"
          style={taskContextMenuStyle}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" role="menuitem" onClick={() => void runTaskAction(onToggleTaskPinned)}>
            {taskContextMenu.task.pinned ? <PinOff size={17} /> : <Pin size={17} />}
            <span>{taskContextMenu.task.pinned ? '取消置顶对话' : '置顶对话'}</span>
          </button>
          <button type="button" role="menuitem" onClick={() => void runTaskAction(onRenameTaskConversation)}>
            <Pencil size={17} />
            <span>重命名对话</span>
          </button>
          <button type="button" role="menuitem" onClick={() => void runTaskAction(onArchiveTaskConversation)}>
            <Archive size={17} />
            <span>归档对话</span>
          </button>
          <button type="button" role="menuitem" onClick={() => void runTaskAction(onToggleTaskUnread)}>
            {taskContextMenu.task.unread ? <MailOpen size={17} /> : <Mail size={17} />}
            <span>{taskContextMenu.task.unread ? '标记为已读' : '标记为未读'}</span>
          </button>
          <div className="redou-project-menu-separator" />
          <button
            type="button"
            role="menuitem"
            disabled={!taskContextMenu.project.rootPath}
            onClick={() => void runTaskAction(onOpenTaskWorkspace)}
          >
            <FolderOpen size={17} />
            <span>在资源管理器中打开</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!taskContextMenu.project.rootPath}
            onClick={() => void runTaskAction(onCopyTaskWorkspace)}
          >
            <Copy size={17} />
            <span>复制工作目录</span>
          </button>
          <button type="button" role="menuitem" onClick={() => void runTaskAction(onCopyTaskConversationId)}>
            <Copy size={17} />
            <span>复制会话 ID</span>
          </button>
          <button type="button" role="menuitem" onClick={() => void runTaskAction(onCopyTaskDeepLink)}>
            <Copy size={17} />
            <span>复制深度链接</span>
          </button>
          <div className="redou-project-menu-separator" />
          <button
            type="button"
            role="menuitem"
            disabled={!taskContextMenu.task.redouCodexThreadId}
            onClick={() => void runTaskAction(onForkTaskToLocal)}
          >
            <GitFork size={17} />
            <span>派生到本地</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!taskContextMenu.task.redouCodexThreadId || !taskContextMenu.project.rootPath}
            onClick={() => void runTaskAction(onForkTaskToNewWorktree)}
          >
            <GitBranchPlus size={17} />
            <span>派生到新工作树</span>
          </button>
          <div className="redou-project-menu-separator" />
          <button type="button" role="menuitem" onClick={() => void runTaskAction(onOpenTaskInNewWindow)}>
            <ExternalLink size={17} />
            <span>在新窗口中打开</span>
          </button>
        </div>
      ) : null}
      {taskHoverCard ? (
        <div
          className="redou-task-hover-card"
          role="group"
          aria-label="任务详情"
          style={taskHoverCardStyle}
          onMouseEnter={clearTaskHoverCloseTimer}
          onMouseLeave={scheduleCloseTaskHoverCard}
          onFocus={clearTaskHoverCloseTimer}
          onBlur={scheduleCloseTaskHoverCard}
        >
          <div className="redou-task-hover-content">
            <div className="redou-task-hover-title">
              <strong>任务：</strong>
              <span>{taskHoverCard.task.title}</span>
            </div>
            <div className="redou-task-hover-detail">
              <GitBranch size={16} />
              <span>{taskHoverCard.detail}</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
