import { Button } from "@nous-research/ui/ui/components/button";
import { Badge } from "@nous-research/ui/ui/components/badge";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Circle,
  Clock3,
  FileCode2,
  GitBranch,
  HardDrive,
  ListChecks,
  MessageSquare,
  Play,
  RefreshCw,
  RotateCw,
  Sparkles,
  Terminal,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { usePageHeader } from "@/contexts/usePageHeader";
import { useSystemActions } from "@/contexts/useSystemActions";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import type {
  AnalyticsResponse,
  ChatProject,
  ChatTask,
  ModelInfoResponse,
  SessionMessage,
  SessionInfo,
  StatusResponse,
} from "@/lib/api";
import { formatTokenCount } from "@/lib/format";
import { cn, timeAgo } from "@/lib/utils";

const CHAT_DRAFT_KEY = "redou-agent-chat-draft";

const COPY = {
  zh: {
    active: "活跃",
    apiConnected: "API 已连接",
    apiUnavailable: "API 不可用",
    chat: "工作",
    codeCanvas: "代码画布",
    config: "配置",
    defaultDraft: "请查看这个项目，解释当前架构。\n建议一个安全的下一步修改。",
    draft: "草稿",
    draftHandoff: "带草稿进入",
    failed: "失败",
    files: "文件",
    fileStates: {
      added: "新增",
      draft: "草稿",
      route: "路由",
    },
    gateway: "网关",
    gatewayIdle: "空闲",
    gatewayRunning: "运行中",
    idle: "空闲",
    last7Days: "最近 7 天",
    local: "本地",
    messages: "消息",
    missionControl: "任务控制台",
    modelNotLoaded: "未加载",
    modelUnset: "模型未设置",
    noRecentRuns: "暂无最近运行",
    pageTitle: "Redou 控制台",
    patchPreview: "补丁预览",
    recentRuns: "最近运行",
    refresh: "刷新",
    refreshWorkspace: "刷新控制台",
    restartGateway: "重启网关",
    runs: "运行",
    startChat: "开始工作",
    stored: "已保存",
    sync: "同步",
    taskDraft: "任务草稿",
    taskDraftPlaceholder: "让 Redou Agent 检查、编辑、测试或解释...",
    terminal: "终端",
    tokens: "Token",
    tools: "工具",
    visibleCalls: "可见调用",
    visibleRuns: "可见运行",
    waitingForSessions: "等待运行记录",
    workspace: "控制台",
    stage: {
      brief: "简报",
      plan: "计划",
      patch: "修改",
      verify: "验证",
      captured: "已捕获",
      waiting: "等待中",
      updated: "已更新",
      ready: "就绪",
      checked: "已检查",
      error: "错误",
      active: "活跃",
      briefEmpty: "还没有任务简报",
      briefStart: "开始工作以捕获任务简报",
      latestAssistant: "最新助手回复",
      draftReady: "草稿已准备发送",
      noRunSelected: "未选择运行",
      openChatPlan: "打开工作以生成计划",
      toolsLatest: "最近运行使用的工具",
      noPatchCalls: "还没有修改类工具调用",
      waitingEdits: "等待编辑",
      toolCalls: "工具调用",
    },
    run: {
      live: "在线",
      msgs: "消息",
      stored: "已保存",
      tools: "工具",
      untitled: "未命名运行",
    },
    taskBoard: {
      active: "运行中",
      activeProgress: "活跃进展",
      allClear: "当前没有需要处理的任务",
      allTasks: "全部任务",
      attention: "需要处理",
      attentionHint: "错误、停滞或等待确认的任务会出现在这里",
      done: "已完成",
      idle: "空闲",
      more: (count: number) => `还有 ${count} 个任务`,
      noActive: "暂无活跃任务",
      noOutput: "还没有最近产出",
      noTasks: "暂无任务",
      output: "最近产出",
      overview: "任务总览",
      projectLegend: "项目颜色",
      queued: "排队",
      recently: "最近",
      stale: "可能停滞",
      status: "状态",
      waiting: "等待开始",
      waitingConfirm: "等待确认",
    },
  },
  en: {
    active: "Active",
    apiConnected: "API connected",
    apiUnavailable: "API unavailable",
    chat: "Work",
    codeCanvas: "Code Canvas",
    config: "config",
    defaultDraft: "Review this project, explain the current architecture.\nSuggest a safe next patch.",
    draft: "draft",
    draftHandoff: "draft handoff",
    failed: "Failed",
    files: "Files",
    fileStates: {
      added: "added",
      draft: "draft",
      route: "route",
    },
    gateway: "gateway",
    gatewayIdle: "Idle",
    gatewayRunning: "Running",
    idle: "Idle",
    last7Days: "last 7 days",
    local: "local",
    messages: "Messages",
    missionControl: "Mission Control",
    modelNotLoaded: "not loaded",
    modelUnset: "model unset",
    noRecentRuns: "No recent runs",
    pageTitle: "Redou Console",
    patchPreview: "Patch Preview",
    recentRuns: "recent runs",
    refresh: "Refresh",
    refreshWorkspace: "Refresh console",
    restartGateway: "Restart gateway",
    runs: "Runs",
    startChat: "Start work",
    stored: "stored",
    sync: "sync",
    taskDraft: "Task draft",
    taskDraftPlaceholder: "Ask Redou Agent to inspect, edit, test, or explain...",
    terminal: "Terminal",
    tokens: "Tokens",
    tools: "Tools",
    visibleCalls: "visible calls",
    visibleRuns: "visible runs",
    waitingForSessions: "Waiting for runs",
    workspace: "console",
    stage: {
      brief: "Brief",
      plan: "Plan",
      patch: "Patch",
      verify: "Verify",
      captured: "captured",
      waiting: "waiting",
      updated: "updated",
      ready: "ready",
      checked: "checked",
      error: "error",
      active: "active",
      briefEmpty: "No task brief yet",
      briefStart: "Start work to capture the task brief",
      latestAssistant: "Latest assistant response",
      draftReady: "Draft is ready to send",
      noRunSelected: "No run selected",
      openChatPlan: "Open Work to generate a plan",
      toolsLatest: "Tools used in latest run",
      noPatchCalls: "No patch tool calls yet",
      waitingEdits: "waiting for edits",
      toolCalls: "Tool calls",
    },
    run: {
      live: "live",
      msgs: "msgs",
      stored: "stored",
      tools: "tools",
      untitled: "Untitled run",
    },
    taskBoard: {
      active: "Running",
      activeProgress: "Active Progress",
      allClear: "No tasks need attention right now",
      allTasks: "All tasks",
      attention: "Needs Attention",
      attentionHint: "Errors, stale runs, and confirmation waits appear here",
      done: "Completed",
      idle: "Idle",
      more: (count: number) => `${count} more task${count === 1 ? "" : "s"}`,
      noActive: "No active tasks",
      noOutput: "No recent output yet",
      noTasks: "No tasks yet",
      output: "Recent Output",
      overview: "Task Overview",
      projectLegend: "Project colors",
      queued: "Queued",
      recently: "Recently",
      stale: "Possibly stale",
      status: "Status",
      waiting: "Waiting to start",
      waitingConfirm: "Waiting for confirmation",
    },
  },
} as const;

type WorkspaceCopy = (typeof COPY)["zh"] | (typeof COPY)["en"];

type LoadState = {
  analytics: AnalyticsResponse | null;
  error: string | null;
  loading: boolean;
  model: ModelInfoResponse | null;
  latestMessages: SessionMessage[];
  projects: ChatProject[];
  sessions: SessionInfo[];
  status: StatusResponse | null;
};

type Tone = "default" | "success" | "warning" | "danger";
type TaskStatus = "running" | "queued" | "attention" | "done" | "idle";

type TaskSummary = {
  color: string;
  lastActive: number;
  messageCount: number;
  phase: string;
  preview: string | null;
  project: ChatProject;
  queueDepth: number;
  session: SessionInfo | null;
  status: TaskStatus;
  statusLabel: string;
  task: ChatTask;
  toolCount: number;
};

const PROJECT_PALETTE = [
  "#22c55e",
  "#38bdf8",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
  "#14b8a6",
  "#ef4444",
  "#84cc16",
] as const;

const FILE_ROWS = [
  {
    path: "web/src/pages/WorkspacePage.tsx",
    state: "added",
    lines: "+362",
    tone: "success",
  },
  {
    path: "web/src/App.tsx",
    state: "route",
    lines: "+8",
    tone: "warning",
  },
  {
    path: "web/src/pages/ChatPage.tsx",
    state: "draft",
    lines: "+26",
    tone: "default",
  },
];

const PATCH_LINES = [
  { sign: "+", text: "const task = await redou.work.open(project);" },
  { sign: "+", text: "task.plan('inspect, patch, verify');" },
  { sign: "+", text: "task.surface({ messages, terminal, diff });" },
  { sign: " ", text: "" },
  { sign: "-", text: "return <Navigate to=\"/legacy\" replace />;" },
  { sign: "+", text: "return <Navigate to=\"/workspace\" replace />;" },
];

function redactSecrets(text: string): string {
  return text.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "sk-...redacted");
}

function compactText(
  value: string | null | undefined,
  fallback: string,
  maxLength = 120,
): string {
  const clean = redactSecrets(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return fallback;
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1).trimEnd()}...`;
}

function stableIndex(value: string, modulo: number): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash % modulo;
}

function projectColor(projectId: string): string {
  return PROJECT_PALETTE[stableIndex(projectId, PROJECT_PALETTE.length)];
}

function sessionTaskKey(session: SessionInfo): string | null {
  if (session.projectId && session.taskId) {
    return `${session.projectId}:${session.taskId}`;
  }
  const match = /^redou:([^:]+):([^:]+)$/.exec(session.id);
  return match ? `${match[1]}:${match[2]}` : null;
}

function taskKey(projectId: string, taskId: string): string {
  return `${projectId}:${taskId}`;
}

function includesAttentionCue(value: string | null | undefined): boolean {
  return /error|failed|failure|exception|blocked|confirm|confirmation|permission|api key|错误|失败|异常|阻塞|确认|权限|密钥/i.test(
    value ?? "",
  );
}

function eventPhase(
  eventType: string | null | undefined,
  copy: WorkspaceCopy,
): string {
  switch (eventType) {
    case "tool_start":
    case "tool_output":
    case "tool_end":
    case "command_start":
    case "command_output":
    case "command_end":
    case "file_changed":
      return copy.stage.patch;
    case "assistant_delta":
    case "assistant_message":
      return copy.stage.plan;
    case "queue_update":
      return copy.taskBoard.queued;
    case "done":
      return copy.taskBoard.done;
    default:
      return copy.taskBoard.active;
  }
}

function attentionPhase(
  eventType: string | null | undefined,
  preview: string | null,
  copy: WorkspaceCopy,
): string {
  if (eventType === "error" || /error|failed|failure|exception|错误|失败|异常/i.test(preview ?? "")) {
    return copy.stage.error;
  }
  if (/confirm|confirmation|确认/i.test(preview ?? "")) {
    return copy.taskBoard.waitingConfirm;
  }
  return copy.taskBoard.attention;
}

export default function WorkspacePage() {
  const navigate = useNavigate();
  const { setEnd, setTitle } = usePageHeader();
  const { isBusy, runAction } = useSystemActions();
  const { locale } = useI18n();
  const copy = COPY[locale];
  const [draft, setDraft] = useState<string>(copy.defaultDraft);
  const [state, setState] = useState<LoadState>({
    analytics: null,
    error: null,
    latestMessages: [],
    loading: true,
    model: null,
    projects: [],
    sessions: [],
    status: null,
  });

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setState((prev) => ({ ...prev, loading: true, error: null }));
    }
    const [statusResult, sessionsResult, analyticsResult, modelResult, projectsResult] =
      await Promise.allSettled([
        api.getStatus(),
        api.getSessions(100),
        api.getAnalytics(7),
        api.getModelInfo(),
        api.getChatProjects(),
      ]);

    const failures = [
      statusResult,
      sessionsResult,
      analyticsResult,
      modelResult,
      projectsResult,
    ].filter((result) => result.status === "rejected").length;
    const sessions =
      sessionsResult.status === "fulfilled" ? sessionsResult.value.sessions : [];
    let latestMessages: SessionMessage[] = [];
    if (sessions[0]) {
      try {
        const messagesResult = await api.getSessionMessages(sessions[0].id);
        latestMessages = messagesResult.messages;
      } catch {
        latestMessages = [];
      }
    }

    setState({
      analytics:
        analyticsResult.status === "fulfilled" ? analyticsResult.value : null,
      error: failures > 0 ? "Dashboard API is not connected." : null,
      latestMessages,
      loading: false,
      model: modelResult.status === "fulfilled" ? modelResult.value : null,
      projects:
        projectsResult.status === "fulfilled" ? projectsResult.value.projects : [],
      sessions,
      status: statusResult.status === "fulfilled" ? statusResult.value : null,
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const pollId = window.setInterval(() => {
      void refresh({ silent: true });
    }, 3_000);
    const offAgentEvent = window.redouDesktop?.onAgentEvent?.(() => {
      void refresh({ silent: true });
    });
    const offAnalysisEvent = window.redouDesktop?.onAnalysisEvent?.(() => {
      void refresh({ silent: true });
    });
    return () => {
      window.clearInterval(pollId);
      offAgentEvent?.();
      offAnalysisEvent?.();
    };
  }, [refresh]);

  const openChat = useCallback(() => {
    const cleanDraft = draft.trim().replace(/\s+/g, " ");
    if (cleanDraft && typeof window !== "undefined") {
      window.sessionStorage.setItem(CHAT_DRAFT_KEY, cleanDraft);
    }
    navigate("/chat");
  }, [draft, navigate]);

  useLayoutEffect(() => {
    setTitle(copy.pageTitle ?? "Redou Console");
    setEnd(
      <div className="hidden min-w-0 items-center justify-end gap-1.5 sm:flex">
        <Button
          outlined
          size="icon"
          onClick={() => void refresh()}
          aria-label={copy.refreshWorkspace}
          title={copy.refresh}
          disabled={state.loading}
        >
          <RefreshCw className={cn(state.loading && "animate-spin")} />
        </Button>
        <Button
          outlined
          size="icon"
          onClick={() => void runAction("restart")}
          aria-label={copy.restartGateway}
          title={copy.restartGateway}
          disabled={isBusy}
        >
          <RotateCw className={cn(isBusy && "animate-spin")} />
        </Button>
        <Button onClick={openChat} className="gap-1.5 px-2.5 text-xs">
          <Terminal className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{copy.chat}</span>
        </Button>
      </div>,
    );

    return () => {
      setTitle(null);
      setEnd(null);
    };
  }, [copy, isBusy, openChat, refresh, runAction, setEnd, setTitle, state.loading]);

  const activeSessions = useMemo(
    () => state.sessions.filter((session) => session.is_active),
    [state.sessions],
  );
  const recentSessions = state.sessions.slice(0, 5);
  const totalTools = state.sessions.reduce(
    (sum, session) => sum + session.tool_call_count,
    0,
  );
  const totalMessages = state.sessions.reduce(
    (sum, session) => sum + session.message_count,
    0,
  );
  const gatewayTone: Tone = state.status?.gateway_running
    ? "success"
    : state.status?.gateway_state === "startup_failed"
      ? "danger"
      : "warning";
  const gatewayLabel = state.status?.gateway_running
    ? copy.gatewayRunning
    : state.status?.gateway_state === "startup_failed"
      ? copy.failed
      : copy.gatewayIdle;
  const weeklyTokens =
    (state.analytics?.totals.total_input ?? 0) +
    (state.analytics?.totals.total_output ?? 0);
  const sessionByTask = useMemo(() => {
    const map = new Map<string, SessionInfo>();
    for (const session of state.sessions) {
      const key = sessionTaskKey(session);
      if (key) {
        map.set(key, session);
      }
    }
    return map;
  }, [state.sessions]);
  const taskRows = useMemo<TaskSummary[]>(() => {
    const nowSeconds = Date.now() / 1000;
    return state.projects.flatMap((project) =>
      project.tasks.map((task) => {
        const session = sessionByTask.get(taskKey(project.id, task.id)) ?? null;
        const queueDepth = Math.max(0, Number(session?.queue_depth ?? 0));
        const lastActive =
          session?.last_active ?? task.updated_at ?? task.created_at ?? project.updated_at ?? 0;
        const inactiveForSeconds = nowSeconds - Number(lastActive || 0);
        const staleActive = Boolean(session?.is_active && inactiveForSeconds > 5 * 60);
        const preview = session?.preview ?? null;
        const attentionCue =
          staleActive ||
          session?.last_event_type === "error" ||
          includesAttentionCue(preview);
        const status: TaskStatus = session?.is_active
          ? attentionCue
            ? "attention"
            : "running"
          : queueDepth > 0
            ? "queued"
            : attentionCue
              ? "attention"
              : (session?.message_count ?? 0) > 0 || (session?.tool_call_count ?? 0) > 0
                ? "done"
                : "idle";
        const statusLabel =
          status === "running"
            ? copy.taskBoard.active
            : status === "queued"
              ? copy.taskBoard.queued
              : status === "attention"
                ? staleActive
                  ? copy.taskBoard.stale
                  : copy.taskBoard.attention
                : status === "done"
                  ? copy.taskBoard.done
                  : copy.taskBoard.idle;
        const phase =
          status === "running"
            ? eventPhase(session?.last_event_type, copy)
            : status === "queued"
              ? `${queueDepth} ${copy.taskBoard.queued}`
              : status === "attention"
                ? attentionPhase(session?.last_event_type, preview, copy)
                : status === "done"
                  ? timeAgo(lastActive, locale)
                  : copy.taskBoard.waiting;
        return {
          color: projectColor(project.id),
          lastActive,
          messageCount: session?.message_count ?? 0,
          phase,
          preview,
          project,
          queueDepth,
          session,
          status,
          statusLabel,
          task,
          toolCount: session?.tool_call_count ?? 0,
        };
      }),
    );
  }, [copy, locale, sessionByTask, state.projects]);
  const activeTaskRows = taskRows.filter(
    (task) => task.status === "running" || task.status === "queued",
  );
  const attentionTaskRows = taskRows.filter((task) => task.status === "attention");
  const recentOutputTaskRows = [...taskRows]
    .filter((task) => task.messageCount > 0 || task.toolCount > 0 || task.status === "done")
    .sort((a, b) =>
      a.project.id === b.project.id ? b.lastActive - a.lastActive : 0,
    )
    .slice(0, 8);

  const terminalLines = useMemo(
    () => [
      "$ redou console status",
      `${copy.gateway}: ${gatewayLabel.toLowerCase()}${state.status?.gateway_pid ? ` pid ${state.status.gateway_pid}` : ""}`,
      `model: ${state.model ? `${state.model.provider}/${state.model.model}` : copy.modelNotLoaded}`,
      `${copy.runs}: ${state.sessions.length} ${copy.recentRuns}, ${activeSessions.length} ${copy.active}`,
      `${copy.tools}: ${totalTools} ${copy.visibleCalls}`,
      state.error ? `api: ${state.error}` : `api: ${copy.apiConnected}`,
      state.status?.config_path
        ? `${copy.config}: ${state.status.config_path}`
        : `${copy.config}: ${copy.stage.waiting}`,
    ],
    [
      activeSessions.length,
      copy,
      gatewayLabel,
      state.error,
      state.model,
      state.sessions.length,
      state.status,
      totalTools,
    ],
  );

  return (
    <div className="redou-workspace flex min-h-0 min-w-0 flex-1 flex-col gap-3 normal-case text-midground">
      <section className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,1.35fr)]">
        <div className="relative min-w-0 overflow-hidden rounded-lg border border-border bg-background-base/70 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.32)]">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-midground/60 to-transparent" />
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Bot className="h-4 w-4 text-success" />
                  <span className="font-mono-ui tracking-[0.14em]">
                    REDOU AGENT
                  </span>
                </div>
                <h2 className="break-words font-expanded text-2xl font-bold leading-none tracking-[0.04em] text-midground sm:text-4xl">
                  {copy.missionControl}
                </h2>
              </div>
              <StatusPill tone={gatewayTone} label={gatewayLabel} />
            </div>

            <div className="grid min-w-0 gap-2 sm:grid-cols-2 2xl:grid-cols-4">
              <Metric
                icon={Activity}
                label={copy.active}
                value={String(activeSessions.length)}
                detail={`${state.sessions.length} ${copy.visibleRuns}`}
                tone="success"
              />
              <Metric
                icon={MessageSquare}
                label={copy.messages}
                value={formatTokenCount(totalMessages)}
                detail={copy.recentRuns}
              />
              <Metric
                icon={Sparkles}
                label={copy.tokens}
                value={formatTokenCount(weeklyTokens)}
                detail={copy.last7Days}
                tone="warning"
              />
              <Metric
                icon={HardDrive}
                label={copy.tools}
                value={formatTokenCount(totalTools)}
                detail={copy.visibleCalls}
              />
            </div>

            <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_14rem]">
              <label className="flex min-h-32 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-black/20">
                <span className="border-b border-border px-3 py-2 font-mono-ui text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {copy.taskDraft}
                </span>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  className="min-h-28 w-full flex-1 resize-none bg-transparent px-3 py-2 text-sm leading-relaxed text-midground outline-none placeholder:text-muted-foreground/60"
                  placeholder={copy.taskDraftPlaceholder}
                  wrap="soft"
                />
              </label>

              <div className="grid">
                <button
                  type="button"
                  onClick={openChat}
                  className="group flex min-h-28 items-center justify-between rounded-lg border border-success/35 bg-success/10 px-3 py-2 text-left transition-colors hover:bg-success/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-success"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="text-sm font-medium text-success">
                      {copy.startChat}
                    </span>
                    <span className="truncate text-xs text-success/70">
                      {copy.draftHandoff}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="grid min-w-0 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
          <TaskStatusPanel
            title={copy.taskBoard.overview}
            icon={ListChecks}
            count={taskRows.length}
          >
            <ProjectLegend
              label={copy.taskBoard.projectLegend}
              tasks={taskRows}
            />
            <TaskRows
              rows={taskRows}
              emptyLabel={copy.taskBoard.noTasks}
              maxRows={8}
              mode="overview"
            />
          </TaskStatusPanel>

          <TaskStatusPanel
            title={copy.taskBoard.activeProgress}
            icon={Activity}
            count={activeTaskRows.length}
          >
            <TaskRows
              rows={activeTaskRows}
              emptyLabel={copy.taskBoard.noActive}
              maxRows={7}
              mode="progress"
            />
          </TaskStatusPanel>

          <TaskStatusPanel
            title={copy.taskBoard.attention}
            icon={AlertCircle}
            count={attentionTaskRows.length}
            tone={attentionTaskRows.length > 0 ? "danger" : "success"}
          >
            <TaskRows
              rows={attentionTaskRows}
              emptyDetail={copy.taskBoard.attentionHint}
              emptyLabel={copy.taskBoard.allClear}
              maxRows={6}
              mode="attention"
            />
          </TaskStatusPanel>

          <TaskStatusPanel
            title={copy.taskBoard.output}
            icon={CheckCircle2}
            count={recentOutputTaskRows.length}
          >
            <TaskRows
              rows={recentOutputTaskRows}
              emptyLabel={copy.taskBoard.noOutput}
              maxRows={7}
              mode="output"
            />
          </TaskStatusPanel>
        </div>
      </section>

      <section className="grid min-h-0 min-w-0 flex-1 gap-3 xl:grid-cols-[minmax(260px,0.82fr)_minmax(360px,1.18fr)_minmax(300px,0.9fr)]">
        <Panel
          title={copy.runs}
          icon={GitBranch}
          end={
            state.loading ? (
              <Badge tone="outline" className="text-[10px]">
                {copy.sync}
              </Badge>
            ) : (
              <Badge tone="secondary" className="text-[10px]">
                {recentSessions.length}
              </Badge>
            )
          }
        >
          <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-1">
            {recentSessions.length === 0 ? (
              <EmptyLine label={copy.noRecentRuns} detail={state.error ?? copy.waitingForSessions} />
            ) : (
              recentSessions.map((session) => (
                <RunRow key={session.id} session={session} />
              ))
            )}
          </div>
        </Panel>

        <Panel title={copy.codeCanvas} icon={FileCode2}>
          <div className="grid min-h-0 min-w-0 gap-3 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
            <div className="min-h-0 min-w-0 overflow-hidden rounded-lg border border-border bg-black/20">
              <div className="border-b border-border px-3 py-2 font-mono-ui text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                {copy.files}
              </div>
              <div className="flex flex-col">
                {FILE_ROWS.map((file) => (
                  <div
                    key={file.path}
                    className="grid grid-cols-[1fr_auto] gap-2 border-b border-border/60 px-3 py-2 last:border-b-0"
                  >
                    <span className="min-w-0 truncate font-mono-ui text-xs">
                      {file.path}
                    </span>
                    <span
                      className={cn(
                        "font-mono-ui text-xs",
                        file.tone === "success" && "text-success",
                        file.tone === "warning" && "text-warning",
                        file.tone === "default" && "text-muted-foreground",
                      )}
                    >
                      {file.lines}
                    </span>
                    <span className="col-span-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                      {copy.fileStates[file.state as keyof typeof copy.fileStates] ?? file.state}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="min-h-0 min-w-0 overflow-hidden rounded-lg border border-border bg-[#071414]/85">
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <span className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {copy.patchPreview}
                </span>
                <Badge tone="outline" className="text-[10px]">
                  {copy.workspace}
                </Badge>
              </div>
              <pre className="min-h-0 overflow-auto p-3 font-mono-ui text-xs leading-6">
                {PATCH_LINES.map((line, index) => (
                  <code
                    key={`${line.sign}-${index}`}
                    className={cn(
                      "block whitespace-pre-wrap break-words",
                      line.sign === "+" && "text-success",
                      line.sign === "-" && "text-destructive",
                      line.sign === " " && "text-muted-foreground",
                    )}
                  >
                    <span className="mr-2 inline-block w-3 text-muted-foreground">
                      {line.sign}
                    </span>
                    {line.text}
                  </code>
                ))}
              </pre>
            </div>
          </div>
        </Panel>

        <Panel title={copy.terminal} icon={Terminal}>
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-[#061111]">
            <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-3">
              <Circle className="h-2.5 w-2.5 fill-destructive text-destructive" />
              <Circle className="h-2.5 w-2.5 fill-warning text-warning" />
              <Circle className="h-2.5 w-2.5 fill-success text-success" />
              <span className="ml-2 truncate font-mono-ui text-[11px] text-muted-foreground">
                redou-agent
              </span>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono-ui text-xs leading-6 text-midground">
              {terminalLines.map((line) => (
                <code key={line} className="block whitespace-pre-wrap break-all">
                  {line}
                </code>
              ))}
            </pre>
          </div>
        </Panel>
      </section>
    </div>
  );
}

function Panel({
  children,
  end,
  icon: Icon,
  title,
}: {
  children: ReactNode;
  end?: ReactNode;
  icon: ComponentType<{ className?: string }>;
  title: string;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-background-base/62">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h3 className="truncate font-expanded text-xs font-bold uppercase tracking-[0.12em]">
            {title}
          </h3>
        </div>
        {end}
      </div>
      <div className="min-h-0 flex-1 p-3">{children}</div>
    </div>
  );
}

function Metric({
  detail,
  icon: Icon,
  label,
  tone = "default",
  value,
}: {
  detail: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  tone?: Tone;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card/50 px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="truncate text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            tone === "success" && "text-success",
            tone === "warning" && "text-warning",
            tone === "danger" && "text-destructive",
            tone === "default" && "text-muted-foreground",
          )}
        />
      </div>
      <div className="font-mono-ui text-2xl leading-none text-midground">
        {value}
      </div>
      <div className="mt-1 truncate text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  return (
    <div
      className={cn(
        "inline-flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
        tone === "success" && "border-success/35 bg-success/10 text-success",
        tone === "warning" && "border-warning/35 bg-warning/10 text-warning",
        tone === "danger" &&
          "border-destructive/35 bg-destructive/10 text-destructive",
        tone === "default" && "border-border bg-card/60",
      )}
    >
      <span className="relative flex h-2 w-2">
        <span
          className={cn(
            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
            tone === "success" && "bg-success",
            tone === "warning" && "bg-warning",
            tone === "danger" && "bg-destructive",
            tone === "default" && "bg-muted-foreground",
          )}
        />
        <span
          className={cn(
            "relative inline-flex h-2 w-2 rounded-full",
            tone === "success" && "bg-success",
            tone === "warning" && "bg-warning",
            tone === "danger" && "bg-destructive",
            tone === "default" && "bg-muted-foreground",
          )}
        />
      </span>
      <span className="font-mono-ui uppercase tracking-[0.14em]">{label}</span>
    </div>
  );
}

function TaskStatusPanel({
  children,
  count,
  icon: Icon,
  title,
  tone = "default",
}: {
  children: ReactNode;
  count: number;
  icon: ComponentType<{ className?: string }>;
  title: string;
  tone?: Tone;
}) {
  return (
    <div
      className={cn(
        "flex min-h-48 min-w-0 flex-col overflow-hidden rounded-lg border bg-card/50",
        tone === "success" && "border-success/25",
        tone === "warning" && "border-warning/25",
        tone === "danger" && "border-destructive/30",
        tone === "default" && "border-border",
      )}
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon
            className={cn(
              "h-4 w-4 shrink-0",
              tone === "success" && "text-success",
              tone === "warning" && "text-warning",
              tone === "danger" && "text-destructive",
              tone === "default" && "text-muted-foreground",
            )}
          />
          <h3 className="truncate font-expanded text-xs font-bold uppercase tracking-[0.1em]">
            {title}
          </h3>
        </div>
        <Badge tone={tone === "danger" ? "destructive" : "outline"} className="text-[10px]">
          {count}
        </Badge>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">{children}</div>
    </div>
  );
}

function ProjectLegend({ label, tasks }: { label: string; tasks: TaskSummary[] }) {
  const projects = Array.from(
    new Map(tasks.map((task) => [task.project.id, task])).values(),
  ).slice(0, 5);

  if (projects.length === 0) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/50 pb-2">
      <span className="shrink-0 font-mono-ui text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      {projects.map((task) => (
        <span
          key={task.project.id}
          className="inline-flex min-w-0 max-w-28 items-center gap-1.5 text-[11px] text-muted-foreground"
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: task.color }}
          />
          <span className="truncate">{task.project.name}</span>
        </span>
      ))}
    </div>
  );
}

function TaskRows({
  emptyDetail,
  emptyLabel,
  maxRows,
  mode,
  rows,
}: {
  emptyDetail?: string;
  emptyLabel: string;
  maxRows: number;
  mode: "overview" | "progress" | "attention" | "output";
  rows: TaskSummary[];
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const visibleRows = rows.slice(0, maxRows);
  const hiddenCount = Math.max(0, rows.length - visibleRows.length);

  if (rows.length === 0) {
    return <EmptyTaskLine detail={emptyDetail} label={emptyLabel} />;
  }

  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-1">
      {visibleRows.map((row) => (
        <TaskMiniRow
          key={`${row.project.id}:${row.task.id}`}
          copy={copy}
          locale={locale}
          mode={mode}
          row={row}
        />
      ))}
      {hiddenCount > 0 && (
        <div className="rounded-md border border-dashed border-border px-2 py-1 text-center text-xs text-muted-foreground">
          {copy.taskBoard.more(hiddenCount)}
        </div>
      )}
    </div>
  );
}

function TaskMiniRow({
  copy,
  locale,
  mode,
  row,
}: {
  copy: WorkspaceCopy;
  locale: "zh" | "en";
  mode: "overview" | "progress" | "attention" | "output";
  row: TaskSummary;
}) {
  const outputDetail = `${row.messageCount} ${copy.run.msgs} · ${row.toolCount} ${copy.run.tools} · ${timeAgo(row.lastActive, locale)}`;
  const detail =
    mode === "output"
      ? outputDetail
      : mode === "overview"
        ? `${row.statusLabel} · ${row.phase}`
        : row.preview
          ? compactText(row.preview, row.phase, 72)
          : row.phase;

  return (
    <div
      className="min-w-0 rounded-md border border-l-2 border-border/70 bg-black/15 px-2.5 py-2"
      style={{ borderLeftColor: row.color }}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
          style={{
            backgroundColor: row.color,
            boxShadow: `0 0 0 3px ${row.color}22`,
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="truncate text-sm font-medium">{row.task.title}</span>
            <span
              className={cn(
                "shrink-0 font-mono-ui text-[10px] uppercase tracking-[0.1em]",
                row.status === "running" && "text-success",
                row.status === "queued" && "text-warning",
                row.status === "attention" && "text-destructive",
                row.status === "done" && "text-muted-foreground",
                row.status === "idle" && "text-muted-foreground/70",
              )}
            >
              {row.statusLabel}
            </span>
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {row.status === "running" ? (
              <Activity className="h-3 w-3 shrink-0 text-success" />
            ) : row.status === "done" ? (
              <CheckCircle2 className="h-3 w-3 shrink-0 text-muted-foreground" />
            ) : (
              <Clock3 className="h-3 w-3 shrink-0" />
            )}
            <span className="truncate">{detail}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyTaskLine({ detail, label }: { detail?: string; label: string }) {
  return (
    <div className="flex min-h-28 min-w-0 flex-col items-center justify-center rounded-md border border-dashed border-border px-3 text-center">
      <Clock3 className="h-5 w-5 text-muted-foreground" />
      <div className="mt-2 text-sm font-medium">{label}</div>
      {detail && (
        <div className="mt-1 max-w-48 text-xs text-muted-foreground">{detail}</div>
      )}
    </div>
  );
}

function RunRow({ session }: { session: SessionInfo }) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const source = session.source ?? copy.local;
  const label =
    session.title && session.title !== "Untitled"
      ? session.title
      : session.preview || copy.run.untitled;

  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border px-3 py-2",
        session.is_active
          ? "border-success/35 bg-success/[0.06]"
          : "border-border bg-card/45",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{label}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="font-mono-ui">{source}</span>
            <span>{session.message_count} {copy.run.msgs}</span>
            <span>{session.tool_call_count} {copy.run.tools}</span>
            <span>{timeAgo(session.last_active, locale)}</span>
          </div>
        </div>
        <Badge
          tone={session.is_active ? "success" : "outline"}
          className="shrink-0 text-[10px]"
        >
          {session.is_active ? copy.run.live : copy.run.stored}
        </Badge>
      </div>
    </div>
  );
}

function EmptyLine({ detail, label }: { detail: string; label: string }) {
  return (
    <div className="flex min-h-28 min-w-0 flex-col items-center justify-center rounded-lg border border-dashed border-border px-3 text-center">
      <Play className="mb-2 h-5 w-5 text-muted-foreground" />
      <div className="text-sm font-medium">{label}</div>
      <div className="mt-1 max-w-48 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}
