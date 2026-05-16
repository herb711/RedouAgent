// The dashboard can be served either at the root of its host (e.g.
// https://kanban.tilos.com/) or under a URL prefix when reverse-proxied
// (e.g. https://mission-control.tilos.com/hermes/). The Python backend
// injects ``window.__HERMES_BASE_PATH__`` into index.html based on the
// incoming ``X-Forwarded-Prefix`` header so the SPA can address its own
// ``/api/...`` and ``/dashboard-plugins/...`` URLs correctly without a
// rebuild. Empty string means "served at root".
function readBasePath(): string {
  if (typeof window === "undefined") return "";
  const raw = window.__HERMES_BASE_PATH__ ?? "";
  if (!raw) return "";
  // Normalise: ensure leading slash, strip trailing slash.
  const withLead = raw.startsWith("/") ? raw : `/${raw}`;
  return withLead.replace(/\/+$/, "");
}

export const HERMES_BASE_PATH = readBasePath();
const BASE = HERMES_BASE_PATH;
export const MODEL_OPTIONS_CHANGED_EVENT = "redou:model-options-changed";
export const CHAT_PROJECTS_CHANGED_EVENT = "redou:chat-projects-changed";

import type { DashboardTheme } from "@/themes/types";

export function notifyModelOptionsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MODEL_OPTIONS_CHANGED_EVENT));
}

export function notifyChatProjectsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHAT_PROJECTS_CHANGED_EVENT));
}

// Ephemeral session token for protected endpoints.
// Injected into index.html by the server — never fetched via API.
declare global {
  interface Window {
    __HERMES_SESSION_TOKEN__?: string;
    __HERMES_BASE_PATH__?: string;
    redouDesktop?: {
      pickDirectory?: () => Promise<string | null>;
      pickFiles?: () => Promise<string[]>;
      getFilePath?: (file: File) => string;
      openLocalPath?: (
        targetPath: string,
      ) => Promise<{ ok: boolean; path?: string; message?: string }>;
      getStatus?: () => Promise<StatusResponse>;
      getConfig?: () => Promise<Record<string, unknown>>;
      getConfigDefaults?: () => Promise<Record<string, unknown>>;
      getConfigSchema?: () => Promise<{ fields: Record<string, unknown>; category_order: string[] }>;
      saveConfig?: (config: Record<string, unknown>) => Promise<{ ok: boolean }>;
      getConfigRaw?: () => Promise<{ yaml: string }>;
      saveConfigRaw?: (yamlText: string) => Promise<{ ok: boolean }>;
      getSkills?: () => Promise<SkillInfo[]>;
      toggleSkill?: (
        name: string,
        enabled: boolean,
        scope?: SkillToggleScope,
      ) => Promise<{ ok: boolean }>;
      deleteSkill?: (skill: SkillDeleteInput) => Promise<SkillDeleteResponse>;
      mergeSkills?: (skills: SkillMergeInput[]) => Promise<SkillMergeResponse>;
      getToolsets?: () => Promise<ToolsetInfo[]>;
      getModelInfo?: () => Promise<ModelInfoResponse>;
      getModelSetupCatalog?: () => Promise<ModelSetupCatalogResponse>;
      getModelOptions?: () => Promise<ModelOptionsResponse>;
      getAuxiliaryModels?: () => Promise<AuxiliaryModelsResponse>;
      setModelAssignment?: (body: ModelAssignmentRequest) => Promise<ModelAssignmentResponse>;
      refreshModelSetupModels?: (body: ModelSetupRefreshRequest) => Promise<ModelSetupRefreshResponse>;
      setupMainModel?: (body: ModelSetupRequest) => Promise<ModelSetupResponse>;
      getModelsAnalytics?: (days: number) => Promise<ModelsAnalyticsResponse>;
      getAnalysisBenchmarks?: () => Promise<AnalysisBenchmarksResponse>;
      startAnalysisBenchmarks?: (
        body: AnalysisBenchmarkStartRequest,
      ) => Promise<AnalysisBenchmarkStartResponse>;
      getAnalytics?: (days: number) => Promise<AnalyticsResponse>;
      getChatProjects?: () => Promise<ChatProjectsResponse>;
      createChatProject?: (body: ChatProjectCreateRequest) => Promise<ChatProjectMutationResponse>;
      updateChatProject?: (
        projectId: string,
        body: ChatProjectUpdateRequest,
      ) => Promise<ChatProjectMutationResponse>;
      deleteChatProject?: (
        projectId: string,
      ) => Promise<ChatProjectDeleteResponse>;
      createChatTask?: (
        projectId: string,
        body: ChatTaskCreateRequest,
      ) => Promise<ChatTaskMutationResponse>;
      updateChatTask?: (
        projectId: string,
        taskId: string,
        body: ChatTaskUpdateRequest,
      ) => Promise<ChatTaskMutationResponse>;
      deleteChatTask?: (
        projectId: string,
        taskId: string,
      ) => Promise<ChatTaskDeleteResponse>;
      setActiveChatTask?: (
        projectId: string,
        taskId: string,
      ) => Promise<ChatTaskMutationResponse>;
      getChatTaskMessages?: (
        projectId: string,
        taskId: string,
      ) => Promise<ChatTaskMessagesResponse>;
      packageTaskSkill?: (
        projectId: string,
        taskId: string,
      ) => Promise<PackageTaskSkillResponse>;
      extractTaskRules?: (
        projectId: string,
        taskId: string,
        target: RuleExtractionTarget,
      ) => Promise<ExtractTaskRulesResponse>;
      getSessions?: (
        limit?: number,
        offset?: number,
      ) => Promise<PaginatedSessions>;
      getSessionMessages?: (
        sessionId: string,
      ) => Promise<SessionMessagesResponse>;
      copyTaskAttachments?: (
        projectId: string,
        taskId: string,
        filePaths: string[],
      ) => Promise<CopyTaskAttachmentsResponse>;
      getGlobalContextFile?: (
        kind: GlobalContextFileKind,
      ) => Promise<ContextFileResponse>;
      updateGlobalContextFile?: (
        kind: GlobalContextFileKind,
        content: string,
      ) => Promise<ContextFileUpdateResponse>;
      getProjectContextFile?: (
        projectId: string,
        kind: ProjectContextFileKind,
      ) => Promise<ContextFileResponse>;
      updateProjectContextFile?: (
        projectId: string,
        kind: ProjectContextFileKind,
        content: string,
      ) => Promise<ContextFileUpdateResponse>;
      getTaskContextFile?: (
        projectId: string,
        taskId: string,
        kind: TaskContextFileKind,
      ) => Promise<ContextFileResponse>;
      updateTaskContextFile?: (
        projectId: string,
        taskId: string,
        kind: TaskContextFileKind,
        content: string,
      ) => Promise<ContextFileUpdateResponse>;
      buildTaskContext?: (input: BuildContextInput) => Promise<BuiltContext>;
      sendMessage?: (input: SendMessageInput) => Promise<SendMessageResponse>;
      stopRun?: (runId: string) => Promise<{ ok: boolean; message?: string }>;
      stopTaskRun?: (projectId: string, taskId: string) => Promise<{ ok: boolean; message?: string }>;
      onAgentEvent?: (
        callback: (payload: AgentEventEnvelope) => void,
      ) => () => void;
      onAnalysisEvent?: (
        callback: (payload: AnalysisBenchmarkEvent) => void,
      ) => () => void;
    };
  }
}
let _sessionToken: string | null = null;
const SESSION_HEADER = "X-Hermes-Session-Token";

function requireRedouDesktopApi() {
  const desktop = window.redouDesktop;
  if (!desktop) {
    throw new Error("Redou desktop IPC API is unavailable. This Chat view must run inside the Electron renderer.");
  }
  return desktop;
}

function requireRedouMethod<K extends keyof NonNullable<Window["redouDesktop"]>>(
  name: K,
): NonNullable<NonNullable<Window["redouDesktop"]>[K]> {
  const method = requireRedouDesktopApi()[name];
  if (typeof method !== "function") {
    throw new Error(`Redou desktop IPC method is unavailable: ${String(name)}`);
  }
  return method as NonNullable<NonNullable<Window["redouDesktop"]>[K]>;
}

function isRedouDesktop(): boolean {
  return typeof window !== "undefined" && Boolean(window.redouDesktop);
}

function setSessionHeader(headers: Headers, token: string): void {
  if (!headers.has(SESSION_HEADER)) {
    headers.set(SESSION_HEADER, token);
  }
}

export async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  if (isRedouDesktop() && url.startsWith("/api/")) {
    throw new Error(`Dashboard HTTP API is disabled in Redou Desktop: ${url}`);
  }
  // Inject the session token into all /api/ requests.
  const headers = new Headers(init?.headers);
  const token = window.__HERMES_SESSION_TOKEN__;
  if (token) {
    setSessionHeader(headers, token);
  }
  const res = await fetch(`${BASE}${url}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

async function getSessionToken(): Promise<string> {
  if (_sessionToken) return _sessionToken;
  const injected = window.__HERMES_SESSION_TOKEN__;
  if (injected) {
    _sessionToken = injected;
    return _sessionToken;
  }
  throw new Error("Session token not available — page must be served by the Hermes dashboard server");
}

export const api = {
  getStatus: () =>
    isRedouDesktop()
      ? requireRedouMethod("getStatus")()
      : fetchJSON<StatusResponse>("/api/status"),
  getSessions: (limit = 20, offset = 0) =>
    isRedouDesktop()
      ? requireRedouMethod("getSessions")(limit, offset)
      : fetchJSON<PaginatedSessions>(`/api/sessions?limit=${limit}&offset=${offset}`),
  getSessionMessages: (id: string) =>
    isRedouDesktop()
      ? requireRedouMethod("getSessionMessages")(id)
      : fetchJSON<SessionMessagesResponse>(`/api/sessions/${encodeURIComponent(id)}/messages`),
  getChatProjects: () =>
    requireRedouMethod("getChatProjects")(),
  createChatProject: (body: ChatProjectCreateRequest) =>
    requireRedouMethod("createChatProject")(body),
  updateChatProject: (projectId: string, body: ChatProjectUpdateRequest) =>
    requireRedouMethod("updateChatProject")(projectId, body),
  deleteChatProject: (projectId: string) =>
    requireRedouMethod("deleteChatProject")(projectId),
  createChatTask: (projectId: string, body: ChatTaskCreateRequest) =>
    requireRedouMethod("createChatTask")(projectId, body),
  updateChatTask: (projectId: string, taskId: string, body: ChatTaskUpdateRequest) =>
    requireRedouMethod("updateChatTask")(projectId, taskId, body),
  deleteChatTask: (projectId: string, taskId: string) =>
    requireRedouMethod("deleteChatTask")(projectId, taskId),
  setActiveChatTask: (projectId: string, taskId: string) =>
    requireRedouMethod("setActiveChatTask")(projectId, taskId),
  getChatTaskMessages: (projectId: string, taskId: string) =>
    requireRedouMethod("getChatTaskMessages")(projectId, taskId),
  packageTaskSkill: (projectId: string, taskId: string) =>
    requireRedouMethod("packageTaskSkill")(projectId, taskId),
  extractTaskRules: (
    projectId: string,
    taskId: string,
    target: RuleExtractionTarget,
  ) =>
    requireRedouMethod("extractTaskRules")(projectId, taskId, target),
  copyTaskAttachments: (projectId: string, taskId: string, filePaths: string[]) =>
    requireRedouMethod("copyTaskAttachments")(projectId, taskId, filePaths),
  openLocalPath: (targetPath: string) =>
    requireRedouMethod("openLocalPath")(targetPath),
  getGlobalContextFile: (kind: GlobalContextFileKind) =>
    requireRedouMethod("getGlobalContextFile")(kind),
  updateGlobalContextFile: (kind: GlobalContextFileKind, content: string) =>
    requireRedouMethod("updateGlobalContextFile")(kind, content),
  getProjectContextFile: (projectId: string, kind: ProjectContextFileKind) =>
    requireRedouMethod("getProjectContextFile")(projectId, kind),
  updateProjectContextFile: (
    projectId: string,
    kind: ProjectContextFileKind,
    content: string,
  ) =>
    requireRedouMethod("updateProjectContextFile")(projectId, kind, content),
  getTaskContextFile: (projectId: string, taskId: string, kind: TaskContextFileKind) =>
    requireRedouMethod("getTaskContextFile")(projectId, taskId, kind),
  updateTaskContextFile: (
    projectId: string,
    taskId: string,
    kind: TaskContextFileKind,
    content: string,
  ) =>
    requireRedouMethod("updateTaskContextFile")(projectId, taskId, kind, content),
  getLogs: (params: { file?: string; lines?: number; level?: string; component?: string }) => {
    const qs = new URLSearchParams();
    if (params.file) qs.set("file", params.file);
    if (params.lines) qs.set("lines", String(params.lines));
    if (params.level && params.level !== "ALL") qs.set("level", params.level);
    if (params.component && params.component !== "all") qs.set("component", params.component);
    return fetchJSON<LogsResponse>(`/api/logs?${qs.toString()}`);
  },
  getAnalytics: (days: number) =>
    isRedouDesktop()
      ? requireRedouMethod("getAnalytics")(days)
      : fetchJSON<AnalyticsResponse>(`/api/analytics/usage?days=${days}`),
  getModelsAnalytics: (days: number) =>
    isRedouDesktop()
      ? requireRedouMethod("getModelsAnalytics")(days)
      : fetchJSON<ModelsAnalyticsResponse>(`/api/analytics/models?days=${days}`),
  getAnalysisBenchmarks: () =>
    isRedouDesktop()
      ? requireRedouMethod("getAnalysisBenchmarks")()
      : Promise.resolve({
          version: 1,
          tasks: [],
          results: [],
          activeRunId: null,
          activeRunIds: [],
          queueDepth: 0,
        }),
  startAnalysisBenchmarks: (body: AnalysisBenchmarkStartRequest) =>
    requireRedouMethod("startAnalysisBenchmarks")(body),
  getConfig: () =>
    isRedouDesktop()
      ? requireRedouMethod("getConfig")()
      : fetchJSON<Record<string, unknown>>("/api/config"),
  getDefaults: () =>
    isRedouDesktop()
      ? requireRedouMethod("getConfigDefaults")()
      : fetchJSON<Record<string, unknown>>("/api/config/defaults"),
  getSchema: () =>
    isRedouDesktop()
      ? requireRedouMethod("getConfigSchema")()
      : fetchJSON<{ fields: Record<string, unknown>; category_order: string[] }>("/api/config/schema"),
  getModelInfo: () =>
    isRedouDesktop()
      ? requireRedouMethod("getModelInfo")()
      : fetchJSON<ModelInfoResponse>("/api/model/info"),
  getModelOptions: () =>
    isRedouDesktop()
      ? requireRedouMethod("getModelOptions")()
      : fetchJSON<ModelOptionsResponse>("/api/model/options"),
  getModelSetupCatalog: () =>
    isRedouDesktop()
      ? requireRedouMethod("getModelSetupCatalog")()
      : fetchJSON<ModelSetupCatalogResponse>("/api/model/setup-catalog"),
  getAuxiliaryModels: () =>
    isRedouDesktop()
      ? requireRedouMethod("getAuxiliaryModels")()
      : fetchJSON<AuxiliaryModelsResponse>("/api/model/auxiliary"),
  setupMainModel: (body: ModelSetupRequest) =>
    isRedouDesktop()
      ? requireRedouMethod("setupMainModel")(body)
      : fetchJSON<ModelSetupResponse>("/api/model/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  refreshModelSetupModels: (body: ModelSetupRefreshRequest) =>
    isRedouDesktop()
      ? requireRedouMethod("refreshModelSetupModels")(body)
      : fetchJSON<ModelSetupRefreshResponse>("/api/model/setup/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  setModelAssignment: (body: ModelAssignmentRequest) =>
    isRedouDesktop()
      ? requireRedouMethod("setModelAssignment")(body)
      : fetchJSON<ModelAssignmentResponse>("/api/model/set", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  saveConfig: (config: Record<string, unknown>) =>
    isRedouDesktop()
      ? requireRedouMethod("saveConfig")(config)
      : fetchJSON<{ ok: boolean }>("/api/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config }),
        }),
  getConfigRaw: () =>
    isRedouDesktop()
      ? requireRedouMethod("getConfigRaw")()
      : fetchJSON<{ yaml: string }>("/api/config/raw"),
  saveConfigRaw: (yaml_text: string) =>
    isRedouDesktop()
      ? requireRedouMethod("saveConfigRaw")(yaml_text)
      : fetchJSON<{ ok: boolean }>("/api/config/raw", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ yaml_text }),
        }),
  getEnvVars: () => fetchJSON<Record<string, EnvVarInfo>>("/api/env"),
  setEnvVar: (key: string, value: string) =>
    fetchJSON<{ ok: boolean }>("/api/env", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    }),
  deleteEnvVar: (key: string) =>
    fetchJSON<{ ok: boolean }>("/api/env", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    }),
  revealEnvVar: async (key: string) => {
    const token = await getSessionToken();
    return fetchJSON<{ key: string; value: string }>("/api/env/reveal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [SESSION_HEADER]: token,
      },
      body: JSON.stringify({ key }),
    });
  },

  // Cron jobs
  getCronJobs: () => fetchJSON<CronJob[]>("/api/cron/jobs"),
  createCronJob: (job: { prompt: string; schedule: string; name?: string; deliver?: string }) =>
    fetchJSON<CronJob>("/api/cron/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job),
    }),
  pauseCronJob: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/api/cron/jobs/${id}/pause`, { method: "POST" }),
  resumeCronJob: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/api/cron/jobs/${id}/resume`, { method: "POST" }),
  triggerCronJob: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/api/cron/jobs/${id}/trigger`, { method: "POST" }),
  deleteCronJob: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/api/cron/jobs/${id}`, { method: "DELETE" }),

  // Profiles (minimal)
  getProfiles: () =>
    fetchJSON<{ profiles: ProfileInfo[] }>("/api/profiles"),
  createProfile: (body: { name: string; clone_from_default: boolean }) =>
    fetchJSON<{ ok: boolean; name: string; path: string }>("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  renameProfile: (name: string, newName: string) =>
    fetchJSON<{ ok: boolean; name: string; path: string }>(
      `/api/profiles/${encodeURIComponent(name)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_name: newName }),
      },
    ),
  deleteProfile: (name: string) =>
    fetchJSON<{ ok: boolean }>(
      `/api/profiles/${encodeURIComponent(name)}`,
      { method: "DELETE" },
    ),
  getProfileSetupCommand: (name: string) =>
    fetchJSON<{ command: string }>(
      `/api/profiles/${encodeURIComponent(name)}/setup-command`,
    ),
  getProfileSoul: (name: string) =>
    fetchJSON<{ content: string; exists: boolean }>(
      `/api/profiles/${encodeURIComponent(name)}/soul`,
    ),
  updateProfileSoul: (name: string, content: string) =>
    fetchJSON<{ ok: boolean }>(
      `/api/profiles/${encodeURIComponent(name)}/soul`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      },
    ),

  // Skills & Toolsets
  getSkills: () =>
    isRedouDesktop()
      ? requireRedouMethod("getSkills")()
      : fetchJSON<SkillInfo[]>("/api/skills"),
  toggleSkill: (name: string, enabled: boolean, scope?: SkillToggleScope) =>
    isRedouDesktop()
      ? requireRedouMethod("toggleSkill")(name, enabled, scope)
      : fetchJSON<{ ok: boolean }>("/api/skills/toggle", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, enabled, ...(scope || {}) }),
        }),
  deleteSkill: (skill: SkillDeleteInput) =>
    isRedouDesktop()
      ? requireRedouMethod("deleteSkill")(skill)
      : fetchJSON<SkillDeleteResponse>("/api/skills/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(skill),
        }),
  mergeSkills: (skills: SkillMergeInput[]) =>
    isRedouDesktop()
      ? requireRedouMethod("mergeSkills")(skills)
      : fetchJSON<SkillMergeResponse>("/api/skills/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skills }),
        }),
  getToolsets: () =>
    isRedouDesktop()
      ? requireRedouMethod("getToolsets")()
      : fetchJSON<ToolsetInfo[]>("/api/tools/toolsets"),

  // OAuth provider management
  getOAuthProviders: () =>
    fetchJSON<OAuthProvidersResponse>("/api/providers/oauth"),
  disconnectOAuthProvider: async (providerId: string) => {
    const token = await getSessionToken();
    return fetchJSON<{ ok: boolean; provider: string }>(
      `/api/providers/oauth/${encodeURIComponent(providerId)}`,
      {
        method: "DELETE",
        headers: { [SESSION_HEADER]: token },
      },
    );
  },
  startOAuthLogin: async (providerId: string) => {
    const token = await getSessionToken();
    return fetchJSON<OAuthStartResponse>(
      `/api/providers/oauth/${encodeURIComponent(providerId)}/start`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [SESSION_HEADER]: token,
        },
        body: "{}",
      },
    );
  },
  submitOAuthCode: async (providerId: string, sessionId: string, code: string) => {
    const token = await getSessionToken();
    return fetchJSON<OAuthSubmitResponse>(
      `/api/providers/oauth/${encodeURIComponent(providerId)}/submit`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [SESSION_HEADER]: token,
        },
        body: JSON.stringify({ session_id: sessionId, code }),
      },
    );
  },
  pollOAuthSession: (providerId: string, sessionId: string) =>
    fetchJSON<OAuthPollResponse>(
      `/api/providers/oauth/${encodeURIComponent(providerId)}/poll/${encodeURIComponent(sessionId)}`,
    ),
  cancelOAuthSession: async (sessionId: string) => {
    const token = await getSessionToken();
    return fetchJSON<{ ok: boolean }>(
      `/api/providers/oauth/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "DELETE",
        headers: { [SESSION_HEADER]: token },
      },
    );
  },

  // Gateway / update actions
  restartGateway: () =>
    fetchJSON<ActionResponse>("/api/gateway/restart", { method: "POST" }),
  updateHermes: () =>
    fetchJSON<ActionResponse>("/api/hermes/update", { method: "POST" }),
  getActionStatus: (name: string, lines = 200) =>
    fetchJSON<ActionStatusResponse>(
      `/api/actions/${encodeURIComponent(name)}/status?lines=${lines}`,
    ),

  // Dashboard plugins
  getPlugins: () =>
    isRedouDesktop()
      ? Promise.resolve([])
      : fetchJSON<PluginManifestResponse[]>("/api/dashboard/plugins"),
  rescanPlugins: () =>
    isRedouDesktop()
      ? Promise.resolve({ ok: true, count: 0 })
      : fetchJSON<{ ok: boolean; count: number }>("/api/dashboard/plugins/rescan"),

  getPluginsHub: () =>
    fetchJSON<PluginsHubResponse>("/api/dashboard/plugins/hub"),

  installAgentPlugin: (body: AgentPluginInstallRequest) =>
    fetchJSON<AgentPluginInstallResponse>("/api/dashboard/agent-plugins/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body }),
    }),

  enableAgentPlugin: (name: string) =>
    fetchJSON<{ ok: boolean; name: string; unchanged?: boolean }>(
      `/api/dashboard/agent-plugins/${encodeURIComponent(name)}/enable`,
      { method: "POST" },
    ),

  disableAgentPlugin: (name: string) =>
    fetchJSON<{ ok: boolean; name: string; unchanged?: boolean }>(
      `/api/dashboard/agent-plugins/${encodeURIComponent(name)}/disable`,
      { method: "POST" },
    ),

  updateAgentPlugin: (name: string) =>
    fetchJSON<AgentPluginUpdateResponse>(
      `/api/dashboard/agent-plugins/${encodeURIComponent(name)}/update`,
      { method: "POST" },
    ),

  removeAgentPlugin: (name: string) =>
    fetchJSON<{ ok: boolean; name: string }>(
      `/api/dashboard/agent-plugins/${encodeURIComponent(name)}`,
      { method: "DELETE" },
    ),

  savePluginProviders: (body: PluginProvidersPutRequest) =>
    fetchJSON<{ ok: boolean }>("/api/dashboard/plugin-providers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  setPluginVisibility: (name: string, hidden: boolean) =>
    fetchJSON<{ ok: boolean; name: string; hidden: boolean }>(
      `/api/dashboard/plugins/${encodeURIComponent(name)}/visibility`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden }),
      },
    ),

  // Dashboard themes
  getThemes: () =>
    fetchJSON<DashboardThemesResponse>("/api/dashboard/themes"),
  setTheme: (name: string) =>
    fetchJSON<{ ok: boolean; theme: string }>("/api/dashboard/theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  buildTaskContext: (input: BuildContextInput) =>
    requireRedouMethod("buildTaskContext")(input),
  sendChatMessage: (input: SendMessageInput) =>
    requireRedouMethod("sendMessage")(input),
  stopChatRun: (runId: string) =>
    requireRedouMethod("stopRun")(runId),
  stopChatTask: (projectId: string, taskId: string) =>
    requireRedouMethod("stopTaskRun")(projectId, taskId),
  onAgentEvent: (callback: (payload: AgentEventEnvelope) => void) =>
    requireRedouMethod("onAgentEvent")(callback),
  onAnalysisEvent: (callback: (payload: AnalysisBenchmarkEvent) => void) =>
    requireRedouMethod("onAnalysisEvent")(callback),
};

export interface ActionResponse {
  name: string;
  ok: boolean;
  pid: number;
}

export interface ActionStatusResponse {
  exit_code: number | null;
  lines: string[];
  name: string;
  pid: number | null;
  running: boolean;
}

export interface PlatformStatus {
  error_code?: string;
  error_message?: string;
  state: string;
  updated_at: string;
}

export interface StatusResponse {
  active_sessions: number;
  config_path: string;
  config_version: number;
  env_path: string;
  gateway_exit_reason: string | null;
  gateway_health_url: string | null;
  gateway_pid: number | null;
  gateway_platforms: Record<string, PlatformStatus>;
  gateway_running: boolean;
  gateway_state: string | null;
  gateway_updated_at: string | null;
  hermes_home: string;
  latest_config_version: number;
  release_date: string;
  version: string;
}

export interface SessionInfo {
  id: string;
  source: string | null;
  model: string | null;
  title: string | null;
  started_at: number;
  ended_at: number | null;
  last_active: number;
  is_active: boolean;
  message_count: number;
  tool_call_count: number;
  input_tokens: number;
  output_tokens: number;
  preview: string | null;
  parent_session_id?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  queue_depth?: number;
  last_event_type?: string | null;
  run_started_at?: number | null;
}

export interface ChatTask {
  id: string;
  projectId: string;
  title: string;
  path?: string;
  session_id: string | null;
  hermesSessionId: string | null;
  model_provider: string;
  model: string;
  appDataPath: string;
  rulesPath: string;
  contextPath: string;
  messagesPath: string;
  uploadsPath?: string;
  createdAt?: string;
  updatedAt?: string;
  created_at: number;
  updated_at: number;
  is_active?: boolean;
  active_run_id?: string | null;
  queue_depth?: number;
  run_started_at?: number | null;
  last_active?: number | null;
  runtime_status?: "idle" | "queued" | "running" | "completed" | "failed" | "interrupted" | string;
}

export interface ChatProject {
  id: string;
  name: string;
  path: string;
  workspace_path: string;
  hermesProfile: string;
  hermesProfileWarning?: string;
  appDataPath: string;
  rulesPath: string;
  createdAt?: string;
  updatedAt?: string;
  created_at: number;
  updated_at: number;
  tasks: ChatTask[];
}

export interface ChatProjectsResponse {
  version: number;
  current_project_id: string;
  current_task_id: string;
  projects: ChatProject[];
}

export interface ChatProjectCreateRequest {
  name: string;
  workspace_path?: string | null;
}

export interface ChatProjectUpdateRequest {
  name?: string;
  workspace_path?: string | null;
}

export interface ChatTaskCreateRequest {
  title: string;
  model_provider?: string | null;
  model?: string | null;
}

export interface ChatTaskUpdateRequest {
  title?: string;
  session_id?: string | null;
  hermesSessionId?: string | null;
  model_provider?: string | null;
  model?: string | null;
}

export type ProjectContextFileKind = "rules";
export type TaskContextFileKind = "rules" | "context";
export type GlobalContextFileKind = "user" | "rules";

export interface ContextFileResponse {
  kind: string;
  path: string;
  content: string;
}

export interface ContextFileUpdateResponse extends ContextFileResponse {
  ok: boolean;
}

export interface ChatProjectMutationResponse {
  ok: boolean;
  project: ChatProject;
}

export interface ChatTaskMutationResponse {
  ok: boolean;
  project: ChatProject;
  task: ChatTask;
}

export interface RelatedPackagedSkill {
  name: string;
  description?: string;
  projectId?: string;
  taskId?: string;
  taskTitle?: string;
  skillPath: string;
  similarity: number;
}

export interface PackageTaskSkillResponse {
  ok: boolean;
  project: ChatProject;
  task: ChatTask;
  skillName: string;
  skillCategory: string;
  skillDir: string;
  skillPath: string;
  references: string[];
  relatedSkills: RelatedPackagedSkill[];
  warnings: string[];
}

export type RuleExtractionTarget = "task" | "project";

export interface ExtractTaskRulesResponse {
  ok: boolean;
  project: ChatProject;
  task: ChatTask;
  target: RuleExtractionTarget;
  targetPath: string;
  sourcePath: string;
  extractor: string;
  extractedRules: string[];
  rulesAdded: string[];
  warnings: string[];
}

export interface ChatProjectDeleteResponse {
  ok: boolean;
  deleted_project_id: string;
  deleted_task_ids: string[];
  current_project_id: string;
  current_task_id: string;
  projects: ChatProject[];
}

export interface ChatTaskDeleteResponse {
  ok: boolean;
  project: ChatProject;
  deleted_task_id: string;
  next_task: ChatTask | null;
  current_project_id: string;
  current_task_id: string;
}

export type ChatMessageRole = "user" | "assistant" | "system" | "tool" | "event";

export interface ChatTaskMessage {
  role: ChatMessageRole;
  content: string;
  createdAt: string;
  metadata: Record<string, unknown>;
  attachments: ChatAttachment[];
}

export interface ChatAttachment {
  id: string;
  name: string;
  storedPath?: string;
  relativePath?: string;
  originalPath?: string;
  size?: number;
  mimeType?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface CopyTaskAttachmentsResponse {
  ok: boolean;
  projectId: string;
  taskId: string;
  uploadsPath: string;
  attachments: ChatAttachment[];
  warnings: string[];
}

export interface ChatTaskMessagesResponse {
  projectId: string;
  taskId: string;
  messagesPath: string;
  hermesSessionId: string;
  messages: ChatTaskMessage[];
  warnings: string[];
  is_active?: boolean;
  active_run_id?: string | null;
  queue_depth?: number;
  run_started_at?: number | null;
  last_active?: number | null;
}

export type AgentEvent =
  | { type: "assistant_message"; content: string; metadata?: Record<string, unknown> }
  | { type: "assistant_delta"; content: string; metadata?: Record<string, unknown> }
  | { type: "command_start"; command: string; cwd?: string; metadata?: Record<string, unknown> }
  | { type: "command_output"; content: string; metadata?: Record<string, unknown> }
  | { type: "command_end"; exitCode?: number; success: boolean; metadata?: Record<string, unknown> }
  | { type: "tool_start"; name: string; input?: unknown; metadata?: Record<string, unknown> }
  | { type: "tool_output"; name: string; output?: unknown; metadata?: Record<string, unknown> }
  | { type: "tool_end"; name: string; success: boolean; metadata?: Record<string, unknown> }
  | { type: "file_changed"; path: string; changeType?: string; summary?: string; metadata?: Record<string, unknown> }
  | { type: "queue_update"; queued: number; message?: string; metadata?: Record<string, unknown> }
  | { type: "error"; message: string; details?: string; metadata?: Record<string, unknown> }
  | { type: "done"; metadata?: Record<string, unknown> }
  | { type: "raw_log"; content: string; metadata?: Record<string, unknown> };

export interface AgentEventEnvelope {
  runId: string;
  projectId: string;
  taskId: string;
  event: AgentEvent;
}

export interface BuildContextInput {
  projectId: string;
  taskId: string;
  userInput: string;
  attachments?: ChatAttachment[];
  maxRecentMessages?: number;
  preview?: boolean;
}

export interface BuiltContext {
  systemContext: string;
  userContext: string;
  metadata: {
    projectId: string;
    taskId: string;
    hermesProfile: string;
    includedFiles: string[];
    recentMessageCount: number;
    attachmentCount?: number;
    imageAttachmentCount?: number;
    contextLength: number;
    contextChars?: number;
    contextTokens?: number;
    modelContextTokens?: number;
    contextMaxTokens?: number;
    reservedOutputTokens?: number;
    safetyMarginTokens?: number;
    contextPercent?: number;
    contextCompressed?: boolean;
    contextCompression?: {
      triggered: boolean;
      succeeded?: boolean;
      beforeTokens: number;
      afterTokens: number;
      taskContextBeforeTokens?: number;
      taskContextAfterTokens?: number;
      modelContextTokens?: number;
      inputBudget?: number;
      reservedOutput?: number;
      safetyMargin?: number;
      thresholdRatio?: number;
      emergency?: boolean;
      reason?: string;
      fallbackTrimmed?: boolean;
      compressedSections?: Array<{
        title: string;
        beforeTokens: number;
        afterTokens: number;
      }>;
    };
    projectName?: string;
    taskTitle?: string;
    projectPath?: string;
    projectRulesPath?: string;
    taskRulesPath?: string;
    taskContextPath?: string;
    preview?: boolean;
  };
}

export interface SendMessageInput {
  projectId: string;
  taskId: string;
  userInput: string;
  deliveryMode?: "queue" | "guide" | "interrupt_replace";
  attachments?: ChatAttachment[];
  maxRecentMessages?: number;
  maxIterations?: number;
  riskConfirmed?: boolean;
}

export interface SendMessageResponse {
  ok: boolean;
  runId: string;
  warning?: string;
  queued?: boolean;
  guided?: boolean;
  queueDepth?: number;
  queueId?: string;
  context?: BuiltContext["metadata"];
}

export interface PaginatedSessions {
  sessions: SessionInfo[];
  total: number;
  limit: number;
  offset: number;
}

export interface EnvVarInfo {
  is_set: boolean;
  redacted_value: string | null;
  description: string;
  url: string | null;
  category: string;
  is_password: boolean;
  tools: string[];
  advanced: boolean;
}

export interface SessionMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    function: { name: string; arguments: string };
  }>;
  tool_name?: string;
  tool_call_id?: string;
  timestamp?: number;
}

export interface SessionMessagesResponse {
  session_id: string;
  messages: SessionMessage[];
}

export interface LogsResponse {
  file: string;
  lines: string[];
}

export interface AnalyticsDailyEntry {
  day: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  reasoning_tokens: number;
  estimated_cost: number;
  actual_cost: number;
  sessions: number;
  api_calls: number;
}

export interface AnalyticsModelEntry {
  model: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost: number;
  sessions: number;
  api_calls: number;
}

export interface AnalyticsSkillEntry {
  skill: string;
  view_count: number;
  manage_count: number;
  total_count: number;
  percentage: number;
  last_used_at: number | null;
}

export interface AnalyticsSkillsSummary {
  total_skill_loads: number;
  total_skill_edits: number;
  total_skill_actions: number;
  distinct_skills_used: number;
}

export interface AnalyticsResponse {
  daily: AnalyticsDailyEntry[];
  by_model: AnalyticsModelEntry[];
  totals: {
    total_input: number;
    total_output: number;
    total_cache_read: number;
    total_reasoning: number;
    total_estimated_cost: number;
    total_actual_cost: number;
    total_sessions: number;
    total_api_calls: number;
  };
  skills: {
    summary: AnalyticsSkillsSummary;
    top_skills: AnalyticsSkillEntry[];
  };
}

export interface ProfileInfo {
  name: string;
  path: string;
  is_default: boolean;
  model: string | null;
  provider: string | null;
  has_env: boolean;
  skill_count: number;
}

export interface ModelsAnalyticsModelEntry {
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  reasoning_tokens: number;
  estimated_cost: number;
  actual_cost: number;
  sessions: number;
  api_calls: number;
  tool_calls: number;
  last_used_at: number;
  avg_tokens_per_session: number;
  capabilities: {
    supports_tools?: boolean;
    supports_vision?: boolean;
    supports_reasoning?: boolean;
    context_window?: number;
    max_output_tokens?: number;
    model_family?: string;
  };
}

export interface ModelsAnalyticsResponse {
  models: ModelsAnalyticsModelEntry[];
  totals: {
    distinct_models: number;
    total_input: number;
    total_output: number;
    total_cache_read: number;
    total_reasoning: number;
    total_estimated_cost: number;
    total_actual_cost: number;
    total_sessions: number;
    total_api_calls: number;
  };
  period_days: number;
}

export interface AnalysisBenchmarkTaskMeta {
  id: string;
  file: string;
  title: string;
  capability: string;
}

export interface AnalysisBenchmarkSection {
  id: string;
  label: string;
  score: number;
  evidence: string;
}

export interface AnalysisBenchmarkTaskResult {
  id: string;
  title: string;
  capability: string;
  status: "pending" | "queued" | "running" | "completed" | "failed" | "interrupted" | string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  apiCalls: number;
  estimatedCostUsd: number;
  score: number;
  sections: AnalysisBenchmarkSection[];
  error: string | null;
  summary: string;
}

export interface AnalysisBenchmarkResult {
  id: string;
  key: string;
  runId: string;
  provider: string;
  model: string;
  agent: string;
  status: "queued" | "running" | "completed" | "failed" | "interrupted" | string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  workspacePath: string;
  summary: string;
  totals: {
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    reasoningTokens: number;
    apiCalls: number;
    estimatedCostUsd: number;
  };
  abilityScores: {
    environmentConstraints: number;
    projectDelivery: number;
    debugRepair: number;
    frameworkExtension: number;
    parsingEdgeCases: number;
    verificationIteration: number;
    researchProduct: number;
    documentationReproducibility: number;
  };
  tasks: AnalysisBenchmarkTaskResult[];
}

export interface AnalysisBenchmarksResponse {
  version: number;
  tasks: AnalysisBenchmarkTaskMeta[];
  results: AnalysisBenchmarkResult[];
  activeRunId: string | null;
  activeRunIds: string[];
  queueDepth: number;
}

export interface AnalysisBenchmarkStartRequest {
  models: Array<{ provider?: string; model?: string }>;
  maxIterations?: number;
}

export interface AnalysisBenchmarkStartResponse {
  ok: boolean;
  runIds: string[];
  queued: number;
  skipped: number;
}

export interface AnalysisBenchmarkEvent {
  type: string;
  runId?: string;
  taskId?: string;
  error?: string;
  updatedAt: string;
}

export interface CronJob {
  id: string;
  name?: string | null;
  prompt?: string | null;
  script?: string | null;
  schedule?: { kind?: string; expr?: string; display?: string };
  schedule_display?: string | null;
  enabled: boolean;
  state?: string | null;
  deliver?: string | null;
  last_run_at?: string | null;
  next_run_at?: string | null;
  last_error?: string | null;
}

export interface SkillInfo {
  id?: string;
  name: string;
  description: string;
  category: string | null;
  enabled: boolean;
  source?: "root" | "profile" | string;
  profile?: string | null;
  profileHome?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  path?: string;
}

export interface SkillToggleScope {
  profile?: string | null;
  profileHome?: string | null;
  path?: string | null;
}

export interface SkillDeleteInput {
  id?: string;
  name: string;
  source?: string;
  profile?: string | null;
  profileHome?: string | null;
  category?: string | null;
  path?: string;
}

export interface SkillDeleteResponse {
  ok: boolean;
  name: string;
  source?: string;
  profile?: string | null;
  path?: string;
  message?: string;
}

export interface SkillMergeInput {
  id?: string;
  name: string;
  source?: string;
  profile?: string | null;
  profileHome?: string | null;
  category?: string | null;
  path?: string;
}

export interface SkillMergeResponse {
  ok: boolean;
  mergedInto: {
    name: string;
    profile?: string | null;
    path: string;
  };
  archived: Array<{
    name: string;
    path: string;
  }>;
  copiedFiles?: Array<{
    name: string;
    paths: string[];
  }>;
  count: number;
}

export interface ToolsetInfo {
  name: string;
  label: string;
  description: string;
  enabled: boolean;
  configured: boolean;
  tools: string[];
}

// ── Model info types ──────────────────────────────────────────────────

export interface ModelInfoResponse {
  model: string;
  provider: string;
  auto_context_length: number;
  config_context_length: number;
  effective_context_length: number;
  capabilities: {
    supports_tools?: boolean;
    supports_vision?: boolean;
    supports_reasoning?: boolean;
    context_window?: number;
    max_output_tokens?: number;
    model_family?: string;
  };
}

// ── Model options / assignment types ──────────────────────────────────

export interface ModelOptionProvider {
  name: string;
  slug: string;
  models?: string[];
  total_models?: number;
  is_current?: boolean;
  is_user_defined?: boolean;
  source?: string;
  warning?: string;
}

export interface ModelOptionsResponse {
  model?: string;
  provider?: string;
  providers?: ModelOptionProvider[];
}

export interface ModelSetupProvider {
  provider: string;
  label: string;
  description: string;
  base_url: string;
  api_key_env: string;
  base_url_env?: string;
  models: string[];
  default_model: string;
  region?: string;
  tags?: string[];
  docs_url?: string;
  api_mode?: string;
  custom_provider_name?: string;
  api_key_optional?: boolean;
  api_key_set?: boolean;
  base_url_set?: boolean;
}

export interface ModelSetupCatalogResponse {
  providers: ModelSetupProvider[];
  current: {
    provider: string;
    model: string;
    base_url: string;
  };
}

export interface ModelSetupRequest {
  provider: string;
  model: string;
  base_url: string;
  api_key?: string;
  api_key_env?: string;
  base_url_env?: string;
  api_mode?: string;
  custom_provider_name?: string;
  models?: string[];
}

export interface ModelSetupRefreshRequest {
  provider: string;
  model?: string;
  base_url: string;
  api_key?: string;
  api_key_env?: string;
  base_url_env?: string;
  api_mode?: string;
  custom_provider_name?: string;
  models?: string[];
}

export interface ModelSetupRefreshResponse {
  ok: boolean;
  scope?: string;
  provider?: string;
  base_url?: string;
  api_key_env?: string;
  api_key_set?: boolean;
  base_url_set?: boolean;
  models?: string[];
  default_model?: string;
  model_count?: number;
  refreshed?: boolean;
  warning?: string;
  probed_url?: string | null;
}

export interface ModelSetupResponse {
  ok: boolean;
  scope?: string;
  provider?: string;
  model?: string;
  base_url?: string;
  api_key_env?: string;
}

export interface AuxiliaryTaskAssignment {
  task: string;
  provider: string;
  model: string;
  base_url: string;
}

export interface AuxiliaryModelsResponse {
  tasks: AuxiliaryTaskAssignment[];
  main: { provider: string; model: string };
}

export interface ModelAssignmentRequest {
  scope: "main" | "auxiliary";
  provider: string;
  model: string;
  /** For auxiliary: task slot name, "" for all, "__reset__" to reset all. */
  task?: string;
}

export interface ModelAssignmentResponse {
  ok: boolean;
  scope?: string;
  provider?: string;
  model?: string;
  tasks?: string[];
  reset?: boolean;
}

// ── OAuth provider types ────────────────────────────────────────────────

export interface OAuthProviderStatus {
  logged_in: boolean;
  source?: string | null;
  source_label?: string | null;
  token_preview?: string | null;
  expires_at?: string | null;
  has_refresh_token?: boolean;
  last_refresh?: string | null;
  error?: string;
}

export interface OAuthProvider {
  id: string;
  name: string;
  /** "pkce" (browser redirect + paste code), "device_code" (show code + URL),
   *  or "external" (delegated to a separate CLI like Claude Code or Qwen). */
  flow: "pkce" | "device_code" | "external";
  cli_command: string;
  docs_url: string;
  status: OAuthProviderStatus;
}

export interface OAuthProvidersResponse {
  providers: OAuthProvider[];
}

/** Discriminated union — the shape of /start depends on the flow. */
export type OAuthStartResponse =
  | {
      session_id: string;
      flow: "pkce";
      auth_url: string;
      expires_in: number;
    }
  | {
      session_id: string;
      flow: "device_code";
      user_code: string;
      verification_url: string;
      expires_in: number;
      poll_interval: number;
    };

export interface OAuthSubmitResponse {
  ok: boolean;
  status: "approved" | "error";
  message?: string;
}

export interface OAuthPollResponse {
  session_id: string;
  status: "pending" | "approved" | "denied" | "expired" | "error";
  error_message?: string | null;
  expires_at?: number | null;
}

// ── Dashboard theme types ──────────────────────────────────────────────

export interface DashboardThemeSummary {
  description: string;
  label: string;
  name: string;
  /** Full theme definition for user themes; undefined for built-ins
   *  (which the frontend already has locally). */
  definition?: DashboardTheme;
}

export interface DashboardThemesResponse {
  active: string;
  themes: DashboardThemeSummary[];
}

// ── Dashboard plugin types ─────────────────────────────────────────────

export interface PluginManifestResponse {
  name: string;
  label: string;
  description: string;
  icon: string;
  version: string;
  tab: {
    path: string;
    position?: string;
    override?: string;
    hidden?: boolean;
  };
  slots?: string[];
  entry: string;
  css?: string | null;
  has_api: boolean;
  source: string;
}

export interface HubAgentPluginRow {
  name: string;
  version: string;
  description: string;
  source: string;
  runtime_status: "disabled" | "enabled" | "inactive";
  has_dashboard_manifest: boolean;
  dashboard_manifest: PluginManifestResponse | null;
  path: string;
  can_remove: boolean;
  can_update_git: boolean;
  auth_required: boolean;
  auth_command: string;
  user_hidden: boolean;
}

export interface PluginsHubProviders {
  memory_provider: string;
  memory_options: Array<{ name: string; description: string }>;
  context_engine: string;
  context_options: Array<{ name: string; description: string }>;
}

export interface PluginsHubResponse {
  plugins: HubAgentPluginRow[];
  orphan_dashboard_plugins: PluginManifestResponse[];
  providers: PluginsHubProviders;
}

export interface AgentPluginInstallRequest {
  identifier: string;
  force?: boolean;
  enable?: boolean;
}

export interface AgentPluginInstallResponse {
  ok: boolean;
  plugin_name?: string;
  warnings?: string[];
  missing_env?: string[];
  after_install_path?: string | null;
  enabled?: boolean;
  error?: string;
}

export interface AgentPluginUpdateResponse {
  ok: boolean;
  name?: string;
  output?: string;
  unchanged?: boolean;
  error?: string;
}

export interface PluginProvidersPutRequest {
  memory_provider?: string;
  context_engine?: string;
}
