import { Badge } from "@nous-research/ui/ui/components/badge";
import { api, type ChatProject, type ChatTask, type ModelOptionProvider } from "@/lib/api";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { ToolEntry } from "@/components/ToolCall";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Layers3,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

interface Props {
  channel: string;
  selectedProjectId: string | null;
  selectedTaskId: string | null;
}

interface RpcEnvelope {
  method?: string;
  params?: { type?: string; payload?: unknown };
}

const TOOL_LIMIT = 12;

const COPY = {
  zh: {
    selectTask: "选择任务",
    noProject: "未选择项目",
    mainModel: "主模型",
    fromConfig: "使用配置",
    tools: "工具",
    idle: "空闲",
    running: (count: number) => `${count} 运行中`,
    calls: (count: number) => `${count} 次调用`,
    disconnected: "工具状态断开",
  },
  en: {
    selectTask: "Select a task",
    noProject: "No project selected",
    mainModel: "main model",
    fromConfig: "from config",
    tools: "tools",
    idle: "idle",
    running: (count: number) => `${count} running`,
    calls: (count: number) => `${count} calls`,
    disconnected: "tools feed disconnected",
  },
} as const;

function selectClass(className?: string): string {
  return cn(
    "h-8 min-w-0 rounded-md border border-border/80 bg-background/50 px-2 text-xs outline-none",
    "focus-visible:border-foreground/25 focus-visible:ring-1 focus-visible:ring-foreground/30",
    "disabled:cursor-not-allowed disabled:opacity-50",
    className,
  );
}

function shortModel(provider: string, model: string, fallback: string): string {
  if (!provider || !model) return fallback;
  return `${provider}/${model}`.replace(/^minimax-cn\//, "minimax/");
}

export function ChatTaskToolbar({
  channel,
  selectedProjectId,
  selectedTaskId,
}: Props) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const [project, setProject] = useState<ChatProject | null>(null);
  const [task, setTask] = useState<ChatTask | null>(null);
  const [modelProviders, setModelProviders] = useState<ModelOptionProvider[]>([]);
  const [modelProviderDraft, setModelProviderDraft] = useState("");
  const [modelDraft, setModelDraft] = useState("");
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"model" | null>(null);

  const providerModels = useMemo(
    () =>
      modelProviders.find((provider) => provider.slug === modelProviderDraft)
        ?.models ?? [],
    [modelProviderDraft, modelProviders],
  );

  const loadContext = useCallback(async () => {
    if (!selectedProjectId || !selectedTaskId) {
      setProject(null);
      setTask(null);
      return;
    }

    try {
      const data = await api.getChatProjects();
      const nextProject =
        data.projects.find((item) => item.id === selectedProjectId) ?? null;
      const nextTask =
        nextProject?.tasks.find((item) => item.id === selectedTaskId) ?? null;
      setProject(nextProject);
      setTask(nextTask);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [selectedProjectId, selectedTaskId]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  useEffect(() => {
    setModelProviderDraft(task?.model_provider ?? "");
    setModelDraft(task?.model ?? "");
  }, [task?.id, task?.model, task?.model_provider]);

  useEffect(() => {
    let cancelled = false;
    api
      .getModelOptions()
      .then((result) => {
        if (cancelled) return;
        setModelProviders(
          (result.providers ?? []).filter(
            (provider) => (provider.models ?? []).length > 0,
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setModelProviders([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const token = window.__HERMES_SESSION_TOKEN__;
    setTools([]);
    if (!token || !channel) return;

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const qs = new URLSearchParams({ token, channel });
    const ws = new WebSocket(`${proto}//${window.location.host}/api/events?${qs.toString()}`);
    let unmounting = false;
    const disconnected = copy.disconnected;

    ws.addEventListener("error", () => {
      if (!unmounting) setError(disconnected);
    });
    ws.addEventListener("close", (ev) => {
      if (!unmounting && ev.code !== 1000) setError(disconnected);
    });
    ws.addEventListener("message", (ev) => {
      let frame: RpcEnvelope;
      try {
        frame = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (frame.method !== "event" || !frame.params) return;

      const { type, payload } = frame.params;
      if (type === "tool.start") {
        const p = payload as
          | { tool_id?: string; name?: string; context?: string }
          | undefined;
        const toolId = p?.tool_id;
        if (!toolId) return;
        setTools((prev) =>
          [
            ...prev,
            {
              kind: "tool" as const,
              id: `tool-${toolId}-${prev.length}`,
              tool_id: toolId,
              name: p.name ?? "tool",
              context: p.context,
              status: "running" as const,
              startedAt: Date.now(),
            },
          ].slice(-TOOL_LIMIT),
        );
      } else if (type === "tool.progress") {
        const p = payload as { name?: string; preview?: string } | undefined;
        if (!p?.name || !p.preview) return;
        setTools((prev) =>
          prev.map((tool) =>
            tool.status === "running" && tool.name === p.name
              ? { ...tool, preview: p.preview }
              : tool,
          ),
        );
      } else if (type === "tool.complete") {
        const p = payload as
          | {
              tool_id?: string;
              summary?: string;
              error?: string;
              inline_diff?: string;
            }
          | undefined;
        if (!p?.tool_id) return;
        setTools((prev) =>
          prev.map((tool) =>
            tool.tool_id === p.tool_id
              ? {
                  ...tool,
                  status: p.error ? "error" : "done",
                  summary: p.summary,
                  error: p.error,
                  inline_diff: p.inline_diff,
                  completedAt: Date.now(),
                }
              : tool,
          ),
        );
      }
    });

    return () => {
      unmounting = true;
      ws.close();
    };
  }, [channel, copy.disconnected]);

  const updateTaskModel = useCallback(
    async (provider: string, model: string) => {
      if (!project || !task) return;
      setSaving("model");
      setModelProviderDraft(provider);
      setModelDraft(model);
      try {
        const result = await api.updateChatTask(project.id, task.id, {
          model_provider: provider || null,
          model: provider && model ? model : null,
        });
        setProject(result.project);
        setTask(result.task);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(null);
      }
    },
    [project, task],
  );

  const runningTools = tools.filter((tool) => tool.status === "running").length;
  const recentTools = tools.slice(-3).reverse();

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-card/80 px-2 py-1.5 text-midground shadow-[0_8px_28px_rgba(0,0,0,0.16)] normal-case">
      <div className="flex min-w-[12rem] flex-1 items-center gap-2 overflow-hidden px-1">
        <Layers3 className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium leading-tight">
            {task?.title ?? copy.selectTask}
          </div>
          <div className="truncate text-[0.68rem] leading-tight text-muted-foreground">
            {project?.name ?? copy.noProject}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-border/60 bg-background/25 px-1.5 py-1">
        <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <select
          value={modelProviderDraft}
          disabled={!task || saving === "model"}
          onChange={(event) => {
            const provider = event.target.value;
            const firstModel =
              modelProviders.find((item) => item.slug === provider)?.models?.[0] ??
              "";
            void updateTaskModel(provider, provider ? firstModel : "");
          }}
          className={selectClass("w-32")}
          title={shortModel(modelProviderDraft, modelDraft, copy.mainModel)}
        >
          <option value="">{copy.mainModel}</option>
          {modelProviders.map((provider) => (
            <option key={provider.slug} value={provider.slug}>
              {provider.name || provider.slug}
            </option>
          ))}
        </select>

        <select
          value={modelDraft}
          disabled={!task || !modelProviderDraft || saving === "model"}
          onChange={(event) => void updateTaskModel(modelProviderDraft, event.target.value)}
          className={selectClass("w-44")}
          title={shortModel(modelProviderDraft, modelDraft, copy.mainModel)}
        >
          {!modelProviderDraft ? (
            <option value="">{copy.fromConfig}</option>
          ) : (
            providerModels.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))
          )}
        </select>
      </div>

      <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-border/60 bg-background/25 px-2 py-1">
        <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{copy.tools}</span>
        <Badge tone={runningTools > 0 ? "warning" : "outline"} className="h-6 text-[0.65rem]">
          {runningTools > 0 ? copy.running(runningTools) : copy.calls(tools.length)}
        </Badge>
        <div className="hidden max-w-[18rem] items-center gap-1 overflow-hidden xl:flex">
          {recentTools.length === 0 ? (
            <span className="truncate text-xs text-muted-foreground">
              {copy.idle}
            </span>
          ) : (
            recentTools.map((tool) => (
              <span
                key={tool.id}
                className={cn(
                  "inline-flex max-w-24 items-center gap-1 truncate rounded-md px-1.5 py-1 text-[0.68rem]",
                  tool.status === "error"
                    ? "bg-destructive/10 text-destructive"
                    : tool.status === "running"
                      ? "bg-warning/10 text-warning"
                      : "bg-muted/35 text-muted-foreground",
                )}
                title={tool.context ? `${tool.name} ${tool.context}` : tool.name}
              >
                {tool.status === "done" && <CheckCircle2 className="h-3 w-3 shrink-0" />}
                {tool.status === "error" && <AlertCircle className="h-3 w-3 shrink-0" />}
                <span className="truncate">{tool.name}</span>
              </span>
            ))
          )}
        </div>
      </div>

      {error && (
        <div className="flex min-w-0 items-center gap-1 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="max-w-[18rem] truncate">{error}</span>
        </div>
      )}
    </div>
  );
}
