import { Button } from "@nous-research/ui/ui/components/button";
import { Input } from "@/components/ui/input";
import { api, type ChatProject, type ChatTask } from "@/lib/api";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  BookOpenText,
  CheckCircle2,
  Circle,
  FileText,
  Folder,
  FolderGit2,
  FolderPlus,
  HardDrive,
  MessageSquare,
  Pin,
  Plus,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  channel: string;
  selectedProjectId: string | null;
  selectedTaskId: string | null;
  onSelect(project: ChatProject, task: ChatTask): void;
}

interface RpcEnvelope {
  method?: string;
  params?: {
    payload?: unknown;
    session_id?: string;
    type?: string;
  };
  session_id?: string;
}

type ContextEditorTarget =
  | { scope: "project"; projectId: string; kind: "rules" | "memory"; title: string }
  | {
      scope: "task";
      projectId: string;
      taskId: string;
      kind: "rules" | "summary";
      title: string;
    };

interface ContextEditorState {
  content: string;
  error: string | null;
  loading: boolean;
  path: string;
  saving: boolean;
  target: ContextEditorTarget | null;
}

function ContextFileEditorDialog({
  editor,
  onChange,
  onClose,
  onSave,
}: {
  editor: ContextEditorState;
  onChange(value: string): void;
  onClose(): void;
  onSave(): void;
}) {
  const open = Boolean(editor.target);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, open]);

  if (!open || !editor.target) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="context-editor-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-md border border-border bg-card shadow-2xl">
        <div className="flex min-w-0 items-center gap-3 border-b border-border px-4 py-3">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h2 id="context-editor-title" className="truncate text-sm font-semibold text-midground">
              {editor.target.title}
            </h2>
            <div className="truncate text-xs text-muted-foreground" title={editor.path}>
              {editor.path}
            </div>
          </div>
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-background/40 hover:text-midground"
            title="Close"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {editor.error && (
          <div className="border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive">
            {editor.error}
          </div>
        )}

        <textarea
          value={editor.loading ? "Loading..." : editor.content}
          onChange={(event) => onChange(event.target.value)}
          disabled={editor.loading || editor.saving}
          spellCheck={false}
          className="min-h-[24rem] flex-1 resize-none bg-background/35 p-4 font-mono text-sm leading-6 text-midground outline-none placeholder:text-muted-foreground disabled:opacity-70"
        />

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" outlined onClick={onClose} disabled={editor.saving}>
            Cancel
          </Button>
          <Button
            type="button"
            prefix={<Save />}
            onClick={onSave}
            disabled={editor.loading || editor.saving}
          >
            {editor.saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function payloadSessionId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as { hermesSessionId?: unknown; session_id?: unknown };
  for (const value of [data.hermesSessionId, data.session_id]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function eventSessionId(frame: RpcEnvelope): string | null {
  const payloadSid = payloadSessionId(frame.params?.payload);
  if (payloadSid) return payloadSid;
  const paramsSid = frame.params?.session_id;
  if (typeof paramsSid === "string" && paramsSid.trim()) return paramsSid;
  const frameSid = frame.session_id;
  if (typeof frameSid === "string" && frameSid.trim()) return frameSid;
  return null;
}

function compactPath(path: string, max = 36): string {
  if (!path) return "No local workspace";
  if (path.length <= max) return path;
  return `...${path.slice(Math.max(0, path.length - max + 3))}`;
}

const COPY = {
  zh: {
    projects: "项目",
    pinned: "置顶",
    noWorkspace: "未选择本地空间",
    refresh: "刷新项目",
    newProject: "新建项目",
    projectName: "项目名称",
    workspacePath: "本地空间路径",
    browse: "浏览",
    create: "创建",
    choose: "选择",
    save: "保存",
    newTask: "新建任务",
    add: "添加",
    pickerMissing: "桌面目录选择器不可用，请直接粘贴路径。",
    justNow: "刚刚",
    yesterday: "昨天",
    minutesAgo: (value: number) => `${value} 分钟前`,
    hoursAgo: (value: number) => `${value} 小时前`,
    daysAgo: (value: number) => `${value} 天前`,
  },
  en: {
    projects: "Projects",
    pinned: "Pinned",
    noWorkspace: "No local workspace",
    refresh: "Refresh projects",
    newProject: "New project",
    projectName: "Project name",
    workspacePath: "Workspace path",
    browse: "browse",
    create: "create",
    choose: "choose",
    save: "save",
    newTask: "New task",
    add: "add",
    pickerMissing: "Desktop directory picker is unavailable. Paste a path instead.",
    justNow: "just now",
    yesterday: "yesterday",
    minutesAgo: (value: number) => `${value}m ago`,
    hoursAgo: (value: number) => `${value}h ago`,
    daysAgo: (value: number) => `${value}d ago`,
  },
} as const;

function relativeTime(ts: number, copy: (typeof COPY)["zh"] | (typeof COPY)["en"]): string {
  const delta = Date.now() / 1000 - ts;
  if (delta < 60) return copy.justNow;
  if (delta < 3600) return copy.minutesAgo(Math.floor(delta / 60));
  if (delta < 86400) return copy.hoursAgo(Math.floor(delta / 3600));
  if (delta < 172800) return copy.yesterday;
  return copy.daysAgo(Math.floor(delta / 86400));
}

function inputClass(className?: string): string {
  return cn(
    "h-8 rounded-md border-border bg-background/40 px-2 text-sm text-midground",
    "placeholder:text-muted-foreground focus-visible:border-foreground/25 focus-visible:ring-foreground/30",
    className,
  );
}

export function ProjectTaskPanel({
  channel,
  onSelect,
  selectedProjectId,
  selectedTaskId,
}: Props) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const [projects, setProjects] = useState<ChatProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceDraft, setWorkspaceDraft] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [editor, setEditor] = useState<ContextEditorState>({
    content: "",
    error: null,
    loading: false,
    path: "",
    saving: false,
    target: null,
  });
  const selectedRef = useRef({ projectId: selectedProjectId, taskId: selectedTaskId });
  const projectsRef = useRef<ChatProject[]>([]);
  const boundSessionRef = useRef<string | null>(null);

  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ??
    projects[0] ??
    null;
  const selectedTask =
    selectedProject?.tasks.find((task) => task.id === selectedTaskId) ??
    selectedProject?.tasks[0] ??
    null;
  const pinnedProject = selectedProject ?? projects[0] ?? null;

  useEffect(() => {
    selectedRef.current = { projectId: selectedProjectId, taskId: selectedTaskId };
  }, [selectedProjectId, selectedTaskId]);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    setWorkspaceDraft(selectedProject?.workspace_path ?? "");
  }, [selectedProject?.id, selectedProject?.workspace_path]);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getChatProjects();
      setProjects(data.projects);

      const nextProject =
        data.projects.find((project) => project.id === selectedProjectId) ??
        data.projects.find((project) => project.id === data.current_project_id) ??
        data.projects[0] ??
        null;
      const nextTask =
        nextProject?.tasks.find((task) => task.id === selectedTaskId) ??
        nextProject?.tasks.find((task) => task.id === data.current_task_id) ??
        nextProject?.tasks[0] ??
        null;

      if (nextProject && nextTask) {
        onSelect(nextProject, nextTask);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [onSelect, selectedProjectId, selectedTaskId]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    const token = window.__HERMES_SESSION_TOKEN__;
    if (!token || !channel) return;

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const qs = new URLSearchParams({ token, channel });
    const ws = new WebSocket(`${proto}//${window.location.host}/api/events?${qs.toString()}`);
    let unmounting = false;

    ws.addEventListener("message", (ev) => {
      let frame: RpcEnvelope;
      try {
        frame = JSON.parse(ev.data);
      } catch {
        return;
      }

      if (frame.method !== "event" || frame.params?.type !== "session.info") {
        return;
      }

      const sessionId = eventSessionId(frame);
      const { projectId, taskId } = selectedRef.current;
      if (!sessionId || !projectId || !taskId) return;

      const project = projectsRef.current.find((item) => item.id === projectId);
      const task = project?.tasks.find((item) => item.id === taskId);
      if (!task || (task.session_id === sessionId && task.hermesSessionId === sessionId)) {
        return;
      }

      const key = `${projectId}:${taskId}:${sessionId}`;
      if (boundSessionRef.current === key) return;
      boundSessionRef.current = key;

      api
        .updateChatTask(projectId, taskId, { session_id: sessionId })
        .then((result) => {
          if (unmounting) return;
          setProjects((prev) =>
            prev.map((item) =>
              item.id === result.project.id ? result.project : item,
            ),
          );
        })
        .catch(() => {
          boundSessionRef.current = null;
        });
    });

    return () => {
      unmounting = true;
      ws.close();
    };
  }, [channel]);

  const pickDirectory = useCallback(async (setter: (path: string) => void) => {
    const picker = window.redouDesktop?.pickDirectory;
    if (!picker) {
      setError(copy.pickerMissing);
      return;
    }
    const picked = await picker();
    if (picked) setter(picked);
  }, []);

  const createProject = useCallback(async () => {
    const result = await api.createChatProject({
      name: projectName.trim() || copy.newProject,
      workspace_path: workspacePath.trim() || null,
    });
    setProjects((prev) => [result.project, ...prev]);
    const task = result.project.tasks[0];
    if (task) onSelect(result.project, task);
    setProjectFormOpen(false);
    setProjectName("");
    setWorkspacePath("");
  }, [onSelect, projectName, workspacePath]);

  const updateWorkspace = useCallback(async () => {
    if (!selectedProject) return;
    const result = await api.updateChatProject(selectedProject.id, {
      workspace_path: workspaceDraft.trim() || null,
    });
    setProjects((prev) =>
      prev.map((project) =>
        project.id === result.project.id ? result.project : project,
      ),
    );
  }, [selectedProject, workspaceDraft]);

  const createTask = useCallback(async () => {
    if (!selectedProject) return;
    const result = await api.createChatTask(selectedProject.id, {
      title: taskTitle.trim() || copy.newTask,
    });
    setProjects((prev) =>
      prev.map((project) =>
        project.id === result.project.id ? result.project : project,
      ),
    );
    onSelect(result.project, result.task);
    setTaskTitle("");
  }, [onSelect, selectedProject, taskTitle]);

  const selectProject = useCallback(
    (project: ChatProject) => {
      const task =
        project.tasks.find((item) => item.id === selectedTaskId) ??
        project.tasks[0];
      if (task) onSelect(project, task);
    },
    [onSelect, selectedTaskId],
  );

  const openContextEditor = useCallback((target: ContextEditorTarget) => {
    setEditor({
      content: "",
      error: null,
      loading: true,
      path: "",
      saving: false,
      target,
    });

    const request =
      target.scope === "project"
        ? api.getProjectContextFile(target.projectId, target.kind)
        : api.getTaskContextFile(target.projectId, target.taskId, target.kind);

    request
      .then((result) => {
        setEditor((current) =>
          current.target === target
            ? {
                ...current,
                content: result.content,
                loading: false,
                path: result.path,
              }
            : current,
        );
      })
      .catch((e) => {
        setEditor((current) =>
          current.target === target
            ? {
                ...current,
                error: e instanceof Error ? e.message : String(e),
                loading: false,
              }
            : current,
        );
      });
  }, []);

  const closeContextEditor = useCallback(() => {
    setEditor((current) => ({ ...current, target: null }));
  }, []);

  const saveContextEditor = useCallback(() => {
    const target = editor.target;
    if (!target) return;

    setEditor((current) => ({ ...current, error: null, saving: true }));
    const request =
      target.scope === "project"
        ? api.updateProjectContextFile(target.projectId, target.kind, editor.content)
        : api.updateTaskContextFile(
            target.projectId,
            target.taskId,
            target.kind,
            editor.content,
          );

    request
      .then((result) => {
        setEditor((current) => ({
          ...current,
          content: result.content,
          path: result.path,
          saving: false,
          target: null,
        }));
      })
      .catch((e) => {
        setEditor((current) => ({
          ...current,
          error: e instanceof Error ? e.message : String(e),
          saving: false,
        }));
      });
  }, [editor.content, editor.target]);

  return (
    <>
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-border bg-background-base/70 py-3 text-midground shadow-[0_18px_48px_rgba(0,0,0,0.28)] normal-case">
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {copy.projects}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-card/60 hover:text-midground"
            title={copy.refresh}
            aria-label={copy.refresh}
            onClick={() => void loadProjects()}
            disabled={loading}
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-card/60 hover:text-midground"
            title={copy.newProject}
            aria-label={copy.newProject}
            onClick={() => setProjectFormOpen((value) => !value)}
          >
            <FolderPlus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-3 mb-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {projectFormOpen && (
        <div className="mx-3 mb-3 space-y-2 rounded-lg border border-border bg-card/50 p-2 shadow-sm">
          <Input
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder={copy.projectName}
            className={inputClass()}
          />
          <div className="flex min-w-0 gap-1.5">
            <Input
              value={workspacePath}
              onChange={(event) => setWorkspacePath(event.target.value)}
              placeholder={copy.workspacePath}
              className={inputClass("min-w-0")}
            />
            <Button
              size="sm"
              outlined
              className="h-8 shrink-0 border-border bg-card/40 px-2 text-midground"
              onClick={() => void pickDirectory(setWorkspacePath)}
            >
              {copy.browse}
            </Button>
          </div>
          <Button
            size="sm"
            prefix={<Plus />}
            className="h-8 bg-midground text-background-base"
            onClick={() => void createProject()}
          >
            {copy.create}
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3">
        <div className="px-2 pb-2 pt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {copy.pinned}
        </div>

        {pinnedProject && (
          <button
            type="button"
            onClick={() => selectProject(pinnedProject)}
            className="mb-6 flex h-10 w-full min-w-0 items-center gap-3 rounded-md px-2 text-left text-muted-foreground transition-colors hover:bg-card/60 hover:text-midground"
          >
            <FolderGit2 className="h-5 w-5 shrink-0" />
            <span className="truncate text-sm font-medium">{pinnedProject.name}</span>
          </button>
        )}

        <div className="px-2 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {copy.projects}
        </div>

        <div className="space-y-1">
          {projects.map((project) => {
            const activeProject = project.id === selectedProject?.id;
            const tasks = project.tasks;

            return (
              <div key={project.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => selectProject(project)}
                  className={cn(
                    "flex h-10 w-full min-w-0 items-center gap-3 rounded-md px-2 text-left transition-colors",
                    activeProject
                      ? "bg-card/45 text-midground"
                      : "text-muted-foreground hover:bg-card/60 hover:text-midground",
                  )}
                >
                  <Folder className="h-5 w-5 shrink-0" />
                  <span className="truncate text-sm font-medium">{project.name}</span>
                </button>

                {activeProject && (
                  <div className="pb-3">
                    <div className="mx-2 mt-1 flex min-w-0 items-center gap-2 rounded-md border border-border/60 bg-background/25 px-2 py-1.5 text-xs text-muted-foreground">
                      <HardDrive className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate" title={project.workspace_path}>
                        {project.workspace_path
                          ? compactPath(project.workspace_path)
                          : copy.noWorkspace}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 rounded px-1.5 py-0.5 text-midground/70 transition-colors hover:bg-card/60 hover:text-midground"
                        onClick={() => void pickDirectory(setWorkspaceDraft)}
                      >
                        {copy.choose}
                      </button>
                      {workspaceDraft !== project.workspace_path && (
                        <button
                          type="button"
                          className="shrink-0 rounded bg-midground px-1.5 py-0.5 text-background-base"
                          onClick={() => void updateWorkspace()}
                        >
                          {copy.save}
                        </button>
                      )}
                    </div>

                    <div className="mx-2 my-1 flex min-w-0 items-center gap-1.5">
                      <button
                        type="button"
                        className="inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border border-border/60 bg-background/25 px-2 text-xs text-muted-foreground transition-colors hover:bg-card/60 hover:text-midground"
                        title="PROJECT_RULES.md"
                        onClick={() =>
                          openContextEditor({
                            scope: "project",
                            projectId: project.id,
                            kind: "rules",
                            title: "PROJECT_RULES.md",
                          })
                        }
                      >
                        <BookOpenText className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">Rules</span>
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border border-border/60 bg-background/25 px-2 text-xs text-muted-foreground transition-colors hover:bg-card/60 hover:text-midground"
                        title="PROJECT_MEMORY.md"
                        onClick={() =>
                          openContextEditor({
                            scope: "project",
                            projectId: project.id,
                            kind: "memory",
                            title: "PROJECT_MEMORY.md",
                          })
                        }
                      >
                        <FileText className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">Memory</span>
                      </button>
                    </div>

                    <div className="mx-2 mb-1 flex items-center gap-1.5 rounded-md border border-border/60 bg-background/30 px-2 py-1">
                      <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <input
                        value={taskTitle}
                        onChange={(event) => setTaskTitle(event.target.value)}
                        placeholder={copy.newTask}
                        className="h-7 min-w-0 flex-1 bg-transparent text-sm text-midground outline-none placeholder:text-muted-foreground"
                      />
                      <button
                        type="button"
                        className="rounded px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-card/60 hover:text-midground"
                        onClick={() => void createTask()}
                      >
                        {copy.add}
                      </button>
                    </div>

                    <div className="space-y-0.5">
                      {tasks.map((task) => {
                        const activeTask = task.id === selectedTask?.id;
                        return (
                          <div
                            key={task.id}
                            className={cn(
                              "group flex min-h-9 w-full min-w-0 items-center gap-1 rounded-md px-2 py-1.5 transition-colors",
                              activeTask
                                ? "border border-success/35 bg-success/[0.07] text-midground"
                                : "text-midground/75 hover:bg-card/55 hover:text-midground",
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => onSelect(project, task)}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            >
                              {activeTask ? (
                                <Pin className="h-4 w-4 shrink-0 text-success" />
                              ) : task.session_id ? (
                                <CheckCircle2 className="h-4 w-4 shrink-0 text-success/80" />
                              ) : (
                                <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                              )}
                              <span className="min-w-0 flex-1 truncate text-[0.95rem]">
                                {task.title}
                              </span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {relativeTime(task.updated_at, copy)}
                              </span>
                              {activeTask && (
                                <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
                              )}
                            </button>
                            <button
                              type="button"
                              className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-card/70 hover:text-midground"
                              title="TASK_RULES.md"
                              aria-label="TASK_RULES.md"
                              onClick={() =>
                                openContextEditor({
                                  scope: "task",
                                  projectId: project.id,
                                  taskId: task.id,
                                  kind: "rules",
                                  title: "TASK_RULES.md",
                                })
                              }
                            >
                              <BookOpenText className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-card/70 hover:text-midground"
                              title="SUMMARY.md"
                              aria-label="SUMMARY.md"
                              onClick={() =>
                                openContextEditor({
                                  scope: "task",
                                  projectId: project.id,
                                  taskId: task.id,
                                  kind: "summary",
                                  title: "SUMMARY.md",
                                })
                              }
                            >
                              <FileText className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
    <ContextFileEditorDialog
      editor={editor}
      onChange={(value) =>
        setEditor((current) => ({
          ...current,
          content: value,
        }))
      }
      onClose={closeContextEditor}
      onSave={saveContextEditor}
    />
    </>
  );
}
