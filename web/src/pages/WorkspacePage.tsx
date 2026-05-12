import { Button } from "@nous-research/ui/ui/components/button";
import { Badge } from "@nous-research/ui/ui/components/badge";
import {
  Activity,
  ArrowRight,
  Bot,
  CheckCircle2,
  Circle,
  Clock3,
  Code2,
  FileCode2,
  GitBranch,
  HardDrive,
  MessageSquare,
  Play,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Sparkles,
  Terminal,
  Workflow,
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
import { api } from "@/lib/api";
import type {
  AnalyticsResponse,
  ModelInfoResponse,
  SessionMessage,
  SessionInfo,
  StatusResponse,
} from "@/lib/api";
import { formatTokenCount } from "@/lib/format";
import { cn, timeAgo } from "@/lib/utils";

const CHAT_DRAFT_KEY = "redou-agent-chat-draft";

type LoadState = {
  analytics: AnalyticsResponse | null;
  error: string | null;
  loading: boolean;
  model: ModelInfoResponse | null;
  latestMessages: SessionMessage[];
  sessions: SessionInfo[];
  status: StatusResponse | null;
};

type Tone = "default" | "success" | "warning" | "danger";

const STAGE_ICONS = {
  Brief: MessageSquare,
  Plan: Workflow,
  Patch: Code2,
  Verify: ShieldCheck,
};

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
  { sign: "+", text: "const workspace = await redou.agent.open(project);" },
  { sign: "+", text: "workspace.plan('inspect, patch, verify');" },
  { sign: "+", text: "workspace.surface({ sessions, terminal, diff });" },
  { sign: " ", text: "" },
  { sign: "-", text: "return <Navigate to=\"/sessions\" replace />;" },
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

function latestMessageContent(
  messages: SessionMessage[],
  role: SessionMessage["role"],
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === role && message.content?.trim()) {
      return message.content;
    }
  }
  return null;
}

export default function WorkspacePage() {
  const navigate = useNavigate();
  const { setEnd, setTitle } = usePageHeader();
  const { isBusy, runAction } = useSystemActions();
  const [draft, setDraft] = useState(
    "Review this project, explain the current architecture.\nSuggest a safe next patch.",
  );
  const [state, setState] = useState<LoadState>({
    analytics: null,
    error: null,
    latestMessages: [],
    loading: true,
    model: null,
    sessions: [],
    status: null,
  });

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    const [statusResult, sessionsResult, analyticsResult, modelResult] =
      await Promise.allSettled([
        api.getStatus(),
        api.getSessions(12),
        api.getAnalytics(7),
        api.getModelInfo(),
      ]);

    const failures = [
      statusResult,
      sessionsResult,
      analyticsResult,
      modelResult,
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
      sessions,
      status: statusResult.status === "fulfilled" ? statusResult.value : null,
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openChat = useCallback(() => {
    const cleanDraft = draft.trim().replace(/\s+/g, " ");
    if (cleanDraft && typeof window !== "undefined") {
      window.sessionStorage.setItem(CHAT_DRAFT_KEY, cleanDraft);
    }
    navigate("/chat");
  }, [draft, navigate]);

  useLayoutEffect(() => {
    setTitle("Redou Workspace");
    setEnd(
      <div className="hidden min-w-0 items-center justify-end gap-1.5 sm:flex">
        <Button
          outlined
          size="icon"
          onClick={() => void refresh()}
          aria-label="Refresh workspace"
          title="Refresh"
          disabled={state.loading}
        >
          <RefreshCw className={cn(state.loading && "animate-spin")} />
        </Button>
        <Button
          outlined
          size="icon"
          onClick={() => void runAction("restart")}
          aria-label="Restart gateway"
          title="Restart gateway"
          disabled={isBusy}
        >
          <RotateCw className={cn(isBusy && "animate-spin")} />
        </Button>
        <Button onClick={openChat} className="gap-1.5 px-2.5 text-xs">
          <Terminal className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Chat</span>
        </Button>
      </div>,
    );

    return () => {
      setTitle(null);
      setEnd(null);
    };
  }, [isBusy, openChat, refresh, runAction, setEnd, setTitle, state.loading]);

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
    ? "Running"
    : state.status?.gateway_state === "startup_failed"
      ? "Failed"
      : "Idle";
  const weeklyTokens =
    (state.analytics?.totals.total_input ?? 0) +
    (state.analytics?.totals.total_output ?? 0);
  const latestSession = recentSessions[0] ?? null;
  const latestUserMessage = latestMessageContent(state.latestMessages, "user");
  const latestAssistantMessage = latestMessageContent(
    state.latestMessages,
    "assistant",
  );
  const latestToolNames = Array.from(
    new Set(
      state.latestMessages.flatMap((message) => [
        ...(message.tool_calls ?? []).map((call) => call.function.name),
        ...(message.tool_name ? [message.tool_name] : []),
      ]),
    ),
  ).filter(Boolean);
  const modelLabel = state.model
    ? `${state.model.provider}/${state.model.model}`
    : (latestSession?.model ?? "model unset");
  const apiConnected = state.error === null;
  const stageTiles = [
    {
      complete: recentSessions.length > 0,
      detail: latestSession
        ? `${latestSession.source ?? "local"} · ${timeAgo(latestSession.last_active)}`
        : "Start a chat to capture the task brief",
      icon: STAGE_ICONS.Brief,
      items: [
        `${recentSessions.length} recent runs`,
        `${formatTokenCount(totalMessages)} visible messages`,
      ],
      label: "Brief",
      status: latestSession ? "captured" : "waiting",
      tone: latestSession ? "success" : "warning",
      value: compactText(
        latestUserMessage ?? latestSession?.preview ?? latestSession?.title,
        "No task brief yet",
        110,
      ),
    },
    {
      complete: Boolean(latestAssistantMessage || draft.trim()),
      detail: latestAssistantMessage
        ? "Latest assistant response"
        : "Draft is ready to send",
      icon: STAGE_ICONS.Plan,
      items: [
        latestSession
          ? `${latestSession.message_count} messages in latest run`
          : "No run selected",
        modelLabel,
      ],
      label: "Plan",
      status: latestAssistantMessage ? "updated" : "draft",
      tone: latestAssistantMessage ? "success" : "warning",
      value: compactText(
        latestAssistantMessage ?? draft,
        "Open chat to generate a plan",
        110,
      ),
    },
    {
      complete: latestToolNames.length > 0 || totalTools > 0,
      detail:
        latestToolNames.length > 0
          ? "Tools used in latest run"
          : "No patch tool calls yet",
      icon: STAGE_ICONS.Patch,
      items:
        latestToolNames.length > 0
          ? latestToolNames.slice(0, 2)
          : [`${formatTokenCount(totalTools)} visible tool calls`, "waiting for edits"],
      label: "Patch",
      status: latestToolNames.length > 0 ? "active" : "ready",
      tone: latestToolNames.length > 0 || totalTools > 0 ? "success" : "default",
      value:
        latestToolNames.length > 0
          ? compactText(latestToolNames.join(", "), "Tool calls", 90)
          : `${formatTokenCount(totalTools)} tool calls`,
    },
    {
      complete: apiConnected && Boolean(state.model),
      detail: state.error ?? modelLabel,
      icon: STAGE_ICONS.Verify,
      items: [
        `gateway ${gatewayLabel.toLowerCase()}`,
        `config v${state.status?.config_version ?? "?"}`,
      ],
      label: "Verify",
      status: apiConnected ? "checked" : "error",
      tone: apiConnected && state.model ? "success" : "danger",
      value: apiConnected ? "API connected" : "API unavailable",
    },
  ] satisfies Array<{
    complete: boolean;
    detail: string;
    icon: ComponentType<{ className?: string }>;
    items: string[];
    label: string;
    status: string;
    tone: Tone;
    value: string;
  }>;

  const terminalLines = useMemo(
    () => [
      "$ redou workspace status",
      `gateway: ${gatewayLabel.toLowerCase()}${state.status?.gateway_pid ? ` pid ${state.status.gateway_pid}` : ""}`,
      `model: ${state.model ? `${state.model.provider}/${state.model.model}` : "not loaded"}`,
      `sessions: ${state.sessions.length} recent, ${activeSessions.length} active`,
      `tools: ${totalTools} calls across visible runs`,
      state.error ? `api: ${state.error}` : "api: connected",
      state.status?.config_path
        ? `config: ${state.status.config_path}`
        : "config: waiting",
    ],
    [
      activeSessions.length,
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
                  Mission Control
                </h2>
              </div>
              <StatusPill tone={gatewayTone} label={gatewayLabel} />
            </div>

            <div className="grid min-w-0 gap-2 sm:grid-cols-2 2xl:grid-cols-4">
              <Metric
                icon={Activity}
                label="Active"
                value={String(activeSessions.length)}
                detail={`${state.sessions.length} visible runs`}
                tone="success"
              />
              <Metric
                icon={MessageSquare}
                label="Messages"
                value={formatTokenCount(totalMessages)}
                detail="recent sessions"
              />
              <Metric
                icon={Sparkles}
                label="Tokens"
                value={formatTokenCount(weeklyTokens)}
                detail="last 7 days"
                tone="warning"
              />
              <Metric
                icon={HardDrive}
                label="Tools"
                value={formatTokenCount(totalTools)}
                detail="visible calls"
              />
            </div>

            <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_14rem]">
              <label className="flex min-h-32 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-black/20">
                <span className="border-b border-border px-3 py-2 font-mono-ui text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  Task draft
                </span>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  className="min-h-28 w-full flex-1 resize-none bg-transparent px-3 py-2 text-sm leading-relaxed text-midground outline-none placeholder:text-muted-foreground/60"
                  placeholder="Ask Redou Agent to inspect, edit, test, or explain..."
                  wrap="soft"
                />
              </label>

              <div className="grid grid-rows-2 gap-2">
                <button
                  type="button"
                  onClick={openChat}
                  className="group flex items-center justify-between rounded-lg border border-success/35 bg-success/10 px-3 py-2 text-left transition-colors hover:bg-success/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-success"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="text-sm font-medium text-success">
                      Start chat
                    </span>
                    <span className="truncate text-xs text-success/70">
                      draft handoff
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
                </button>

                <button
                  type="button"
                  onClick={() => navigate("/sessions")}
                  className="group flex items-center justify-between rounded-lg border border-border bg-card/50 px-3 py-2 text-left transition-colors hover:bg-card/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-midground/50"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="text-sm font-medium">Sessions</span>
                    <span className="truncate text-xs text-muted-foreground">
                      transcript index
                    </span>
                  </span>
                  <MessageSquare className="h-4 w-4 shrink-0 opacity-70" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="grid min-w-0 gap-3 lg:grid-cols-4">
          {stageTiles.map((step) => (
            <StepTile key={step.label} {...step} />
          ))}
        </div>
      </section>

      <section className="grid min-h-0 min-w-0 flex-1 gap-3 xl:grid-cols-[minmax(260px,0.82fr)_minmax(360px,1.18fr)_minmax(300px,0.9fr)]">
        <Panel
          title="Runs"
          icon={GitBranch}
          end={
            state.loading ? (
              <Badge tone="outline" className="text-[10px]">
                sync
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
              <EmptyLine label="No recent runs" detail={state.error ?? "Waiting for sessions"} />
            ) : (
              recentSessions.map((session) => (
                <RunRow key={session.id} session={session} />
              ))
            )}
          </div>
        </Panel>

        <Panel title="Code Canvas" icon={FileCode2}>
          <div className="grid min-h-0 min-w-0 gap-3 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
            <div className="min-h-0 min-w-0 overflow-hidden rounded-lg border border-border bg-black/20">
              <div className="border-b border-border px-3 py-2 font-mono-ui text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Files
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
                      {file.state}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="min-h-0 min-w-0 overflow-hidden rounded-lg border border-border bg-[#071414]/85">
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <span className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  Patch Preview
                </span>
                <Badge tone="outline" className="text-[10px]">
                  workspace
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

        <Panel title="Terminal" icon={Terminal}>
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

function StepTile({
  complete,
  detail,
  icon: Icon,
  items,
  label,
  status,
  tone,
  value,
}: {
  complete: boolean;
  detail: string;
  icon: ComponentType<{ className?: string }>;
  items: string[];
  label: string;
  status: string;
  tone: Tone;
  value: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-48 min-w-0 flex-col justify-between rounded-lg border bg-card/50 p-3",
        tone === "success" && "border-success/25",
        tone === "warning" && "border-warning/25",
        tone === "danger" && "border-destructive/30",
        tone === "default" && "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Icon
          className={cn(
            "h-4 w-4",
            tone === "success" && "text-success",
            tone === "warning" && "text-warning",
            tone === "danger" && "text-destructive",
            tone === "default" && "text-muted-foreground",
          )}
        />
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "truncate font-mono-ui text-[10px] uppercase tracking-[0.14em]",
              tone === "success" && "text-success",
              tone === "warning" && "text-warning",
              tone === "danger" && "text-destructive",
              tone === "default" && "text-muted-foreground",
            )}
          >
            {status}
          </span>
          {complete ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
          ) : (
            <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
        </div>
      </div>

      <div className="mt-6 min-w-0">
        <div className="font-expanded text-sm font-bold uppercase tracking-[0.1em]">
          {label}
        </div>
        <div className="mt-2 line-clamp-3 break-words text-sm leading-relaxed text-midground">
          {value}
        </div>
        <div className="mt-2 truncate font-mono-ui text-[11px] text-muted-foreground">
          {detail}
        </div>
      </div>

      <div className="mt-4 space-y-1 border-t border-border/60 pt-2">
        {items.map((item) => (
          <div
            key={item}
            className="flex min-w-0 items-center gap-2 font-mono-ui text-[11px] text-muted-foreground"
          >
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                tone === "success" && "bg-success",
                tone === "warning" && "bg-warning",
                tone === "danger" && "bg-destructive",
                tone === "default" && "bg-muted-foreground",
              )}
            />
            <span className="truncate">{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RunRow({ session }: { session: SessionInfo }) {
  const source = session.source ?? "local";
  const label =
    session.title && session.title !== "Untitled"
      ? session.title
      : session.preview || "Untitled run";

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
            <span>{session.message_count} msgs</span>
            <span>{session.tool_call_count} tools</span>
            <span>{timeAgo(session.last_active)}</span>
          </div>
        </div>
        <Badge
          tone={session.is_active ? "success" : "outline"}
          className="shrink-0 text-[10px]"
        >
          {session.is_active ? "live" : "stored"}
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
