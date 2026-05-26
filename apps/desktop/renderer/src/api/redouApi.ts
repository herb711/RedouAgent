export interface IpcResult<T = unknown> {
  ok: boolean;
  data: T | null;
  error: { code?: string; message: string; details?: unknown } | null;
  warnings: string[];
}

export interface RuntimeStatusSnapshot {
  runtime?: string | null;
  threadStatus?: string | null;
  turnStatus?: string | null;
  rawTurnStatus?: string | null;
  activeTurnId?: string | null;
  activeItem?: {
    id?: string | null;
    title?: string | null;
    status?: string | null;
    source?: string | null;
  } | null;
  usage?: Record<string, unknown> | null;
  needsAttention?: boolean;
  degraded?: boolean;
  stopReason?: {
    status?: string | null;
    code?: string | null;
    message?: string | null;
    details?: unknown;
  } | null;
  continuation?: {
    recommended?: boolean;
    automatic?: boolean;
    reason?: string | null;
    message?: string | null;
  } | null;
  lastError?: {
    code?: string | null;
    title?: string | null;
    message?: string | null;
  } | null;
}

export interface RuntimeSnapshot {
  messages?: Array<{ id: string; role?: string; body: string; timestamp?: string; processedDurationMs?: number; processedStatus?: string; deliveryMode?: string; status?: string; queueId?: string | null; queueState?: string | null; source?: string | null; sourceEventId?: string; turnId?: string | null; automation?: AutomationMessageMetadata | null; contextItems?: Array<{ path: string; name?: string; kind?: string }> }>;
  progressSteps?: Array<{ id: string; label: string; status: string }>;
  planEntries?: Array<{ id: string; title?: string; step?: string; status: string }>;
  todoProjectionEntries?: Array<{ id: string; title: string; status: string }>;
  approvalRequests?: unknown[];
  diffSummary?: string | null;
  changedFiles?: Array<{ id: string; path: string; status?: string; diff?: string }>;
  logs?: Array<{
    id: string;
    level: string;
    message: string;
    time: string;
    kind?: string;
    lifecycle?: string;
    command?: string;
    output?: string;
  }>;
  artifacts?: ArtifactSnapshot[];
  runtimeStatus?: RuntimeStatusSnapshot;
  environmentInfo?: Record<string, unknown>;
}

export interface ModelProviderPreset {
  id: string;
  label: string;
  description?: string;
  baseUrl: string;
  apiKeyEnv?: string;
  models: string[];
  defaultModel?: string;
  region?: string;
  tags?: string[];
  apiKeyOptional?: boolean;
}

export interface ConfiguredModelProvider {
  id: string;
  runtimeProviderId?: string;
  provider: string;
  label: string;
  description?: string;
  baseUrl: string;
  apiKeySet: boolean;
  apiKeyOptional?: boolean;
  apiKeyEnv?: string;
  models: string[];
  defaultModel?: string;
  selectedModel?: string;
  region?: string;
  tags?: string[];
  custom?: boolean;
  connectedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ModelConfigSelection {
  providerId: string;
  modelId: string;
}

export interface ModelConfigSnapshot {
  catalog: ModelProviderPreset[];
  providers: ConfiguredModelProvider[];
  selected: ModelConfigSelection | null;
}

export interface ModelProbeResult {
  provider: string;
  baseUrl: string;
  models: string[];
  defaultModel: string;
  modelCount: number;
  refreshed: boolean;
  warning?: string;
  probedUrl?: string;
}

export interface GitFileChange {
  id?: string;
  path: string;
  originalPath?: string | null;
  status?: string;
  indexStatus?: string;
  worktreeStatus?: string;
  staged?: boolean;
  unstaged?: boolean;
  untracked?: boolean;
  insertions?: number;
  deletions?: number;
  binary?: boolean;
  patch?: string;
}

export interface GitStatusSnapshot {
  cwd: string;
  rootPath?: string | null;
  isRepository: boolean;
  isClean: boolean;
  branch?: string | null;
  upstream?: string | null;
  ahead?: number;
  behind?: number;
  files: GitFileChange[];
  changedFileCount: number;
  stagedFileCount: number;
  unstagedFileCount: number;
  raw?: string;
  error?: string;
}

export interface GitDiffSnapshot extends GitStatusSnapshot {
  patch: string;
  stat: string;
  insertions: number;
  deletions: number;
  pullRequest?: {
    url?: string;
    title?: string;
    branch?: string;
    stdout?: string;
    stderr?: string;
  };
  lastAction?: {
    type?: string;
    message?: string;
    sha?: string | null;
    stdout?: string;
    stderr?: string;
  };
}

export type ContextSelectionKind = 'file' | 'image' | 'directory';

export interface ContextSelectionItem {
  path: string;
  name: string;
  kind: ContextSelectionKind;
}

export interface ContextSelectionResult {
  canceled: boolean;
  items: ContextSelectionItem[];
}

export type ArtifactPreviewKind = 'text' | 'html' | 'image' | 'directory' | 'diff' | 'binary' | 'empty';

export interface ArtifactPreview {
  kind: ArtifactPreviewKind;
  content?: string;
  dataUrl?: string;
  entries?: string[];
  truncated?: boolean;
  mimeType?: string;
  message?: string;
}

export interface ArtifactSnapshot {
  id: string;
  taskId?: string | null;
  projectId?: string | null;
  type: string;
  name: string;
  path?: string | null;
  mimeType?: string | null;
  size?: number;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  content?: string | null;
  uri?: string | null;
  metadata?: Record<string, unknown>;
  preview?: ArtifactPreview;
}

export interface AppSettingsSnapshot {
  general: {
    language: string;
    startupView: string;
    autoUpdate: boolean;
  };
  appearance: {
    theme: string;
    density: string;
    inspectorSide: string;
  };
  desktop: {
    notifications: boolean;
    preventSleep: boolean;
    screenshotComments: boolean;
    popoutBehavior: string;
  };
  browser: {
    enabled: boolean;
    homeUrl: string;
    allowPopouts: boolean;
  };
  media: {
    voiceInput: boolean;
    imageInput: boolean;
    imageGeneration: boolean;
  };
  connections: {
    artifactPreview: boolean;
    inAppBrowser: boolean;
    screenshotCapture: boolean;
  };
  composer: {
    permissionMode: 'default' | 'auto-review' | 'full-access';
  };
  automation: {
    allowModelCreate: boolean;
    exposeToolToModel: boolean;
  };
}

export interface AutomationMessageMetadata {
  id?: string | null;
  runId?: string | null;
  title?: string | null;
  scheduleType?: string | null;
  scheduleText?: string | null;
  triggeredAt?: string | null;
  createdBy?: string | null;
}

export interface AutomationSnapshot {
  id: string;
  title: string;
  name?: string;
  description?: string;
  prompt: string;
  enabled: boolean;
  status: 'ACTIVE' | 'PAUSED';
  scheduleType: 'once' | 'daily' | 'weekly' | 'monthly' | 'interval' | 'rrule' | 'condition_watch';
  scheduleText?: string;
  schedule?: string;
  rrule?: string | null;
  startAt?: string | null;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  timezone?: string;
  createdBy: 'user' | 'model';
  createdFrom: string;
  projectId?: string | null;
  conversationId?: string | null;
  replyTarget: 'bound_conversation' | 'automation_log_only' | 'system_notification';
  exposeResultInConversation: boolean;
  requireConfirmationBeforeRun: boolean;
  maxRetries: number;
  retryCount?: number;
  lastTaskId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRunSnapshot {
  id: string;
  automationId: string;
  status: string;
  trigger?: string;
  startedAt?: string;
  finishedAt?: string | null;
  taskId?: string | null;
  conversationId?: string | null;
  turnId?: string | null;
  error?: string | null;
  retryAttempt?: number;
}

export type ExtensionKind = 'plugin' | 'skill' | 'mcp' | 'app';
export type ExtensionSource = 'system' | 'bundled' | 'user' | 'project' | 'git' | 'market' | 'community';
export type ExtensionStatus = 'ready' | 'disabled' | 'error' | 'missing-config' | 'testing';

export interface ExtensionItem {
  id: string;
  kind: ExtensionKind;
  name: string;
  title: string;
  description: string;
  source: ExtensionSource;
  installed: boolean;
  enabled: boolean;
  category?: string;
  tags?: string[];
  icon?: string;
  path?: string;
  configPath?: string;
  authRequired?: boolean;
  canRemove?: boolean;
  canUpdate?: boolean;
  status?: ExtensionStatus;
  statusMessage?: string;
  raw?: unknown;
}

export interface McpServerConfig {
  name: string;
  displayName?: string;
  transport?: 'stdio' | 'http' | 'streamable_http';
  command?: string;
  args?: string[] | string;
  env?: Record<string, string>;
  inheritEnv?: boolean;
  url?: string;
  enabled?: boolean;
  startupTimeoutSec?: number;
  toolTimeoutSec?: number;
  configPath?: string;
  raw?: Record<string, unknown>;
}

export interface MiniMaxPluginConfig {
  enabled: boolean;
  provider: 'minimax';
  driver: 'direct_http';
  region: 'cn' | 'global' | 'advanced';
  host: string;
  outputDir: string;
  absoluteOutputDir?: string;
  apiKey?: string;
  apiKeySet?: boolean;
  apiKeyMask?: string;
  defaults: {
    ttsModel: string;
    voiceId: string;
    audioFormat: string;
    imageModel: string;
    imageAspectRatio: string;
  };
}

export interface MiniMaxToolResult {
  ok: boolean;
  provider?: 'minimax';
  driver?: 'direct_http';
  tool?: string;
  code?: string;
  message?: string;
  hint?: string;
  model?: string;
  filePath?: string;
  files?: string[];
  outputDir?: string;
  mimeType?: string;
  previews?: Array<{ filePath: string; dataUrl: string }>;
  raw?: unknown;
}

interface ElectronRedouApi {
  runtimes: {
    list: () => Promise<IpcResult>;
    get: (id: string) => Promise<IpcResult>;
    availability: (id?: string) => Promise<IpcResult>;
    setDefault: (id: string) => Promise<IpcResult>;
  };
  tasks: {
    list: (projectId?: string, options?: unknown) => Promise<IpcResult>;
    get: (taskId: string) => Promise<IpcResult>;
    create: (input: unknown) => Promise<IpcResult>;
    update: (input: unknown) => Promise<IpcResult>;
    archive: (taskId: string) => Promise<IpcResult>;
    restore: (taskId: string) => Promise<IpcResult>;
    fork: (input: unknown) => Promise<IpcResult>;
    remove: (taskId: string) => Promise<IpcResult>;
    start: (taskId: string, options?: unknown) => Promise<IpcResult>;
    queue: (taskId: string, input: string, options?: unknown) => Promise<IpcResult>;
    updateQueue: (taskId: string, queueId: string, action: 'delete' | 'guide') => Promise<IpcResult>;
    steer: (taskId: string, input: string, options?: unknown) => Promise<IpcResult>;
    interrupt: (taskId: string) => Promise<IpcResult>;
  };
  events: {
    list: (taskId?: string) => Promise<IpcResult>;
    snapshot: (taskId?: string) => Promise<IpcResult<RuntimeSnapshot>>;
    subscribe?: (taskId: string | undefined, callback: (event: IpcResult) => void) => () => void;
  };
  approvals: {
    list: (taskId?: string) => Promise<IpcResult>;
    respond: (approvalId: string, decision: unknown, taskId?: string | null) => Promise<IpcResult>;
  };
  git?: {
    status: (input?: unknown) => Promise<IpcResult<GitStatusSnapshot>>;
    diff: (input?: unknown) => Promise<IpcResult<GitDiffSnapshot>>;
    stage: (input?: unknown) => Promise<IpcResult<GitDiffSnapshot>>;
    unstage: (input?: unknown) => Promise<IpcResult<GitDiffSnapshot>>;
    revert: (input?: unknown) => Promise<IpcResult<GitDiffSnapshot>>;
    stageHunk: (input?: unknown) => Promise<IpcResult<GitDiffSnapshot>>;
    revertHunk: (input?: unknown) => Promise<IpcResult<GitDiffSnapshot>>;
    commit: (input?: unknown) => Promise<IpcResult<GitDiffSnapshot>>;
    push: (input?: unknown) => Promise<IpcResult<GitDiffSnapshot>>;
    createPullRequest: (input?: unknown) => Promise<IpcResult<GitDiffSnapshot>>;
  };
  terminal?: {
    run: (input?: unknown) => Promise<IpcResult>;
  };
  worktrees?: {
    list: (input?: unknown) => Promise<IpcResult>;
    create: (input?: unknown) => Promise<IpcResult>;
    remove: (input?: unknown) => Promise<IpcResult>;
    open: (input?: unknown) => Promise<IpcResult>;
  };
  automations?: {
    list: (input?: unknown) => Promise<IpcResult>;
    get: (input?: unknown) => Promise<IpcResult>;
    create: (input?: unknown) => Promise<IpcResult>;
    update: (input?: unknown) => Promise<IpcResult>;
    delete: (input?: unknown) => Promise<IpcResult>;
    run: (input?: unknown) => Promise<IpcResult>;
    runs: (input?: unknown) => Promise<IpcResult>;
  };
  extensions?: {
    list: (input?: { kind?: ExtensionKind; mode?: 'explore' | 'manage' }) => Promise<IpcResult<ExtensionItem[]>>;
    catalog: (input?: { kind?: ExtensionKind }) => Promise<IpcResult<ExtensionItem[]>>;
    refresh: (input?: { kind?: ExtensionKind }) => Promise<IpcResult<ExtensionItem[]>>;
    enable: (id: string) => Promise<IpcResult>;
    disable: (id: string) => Promise<IpcResult>;
    remove: (id: string) => Promise<IpcResult>;
    get: (id: string) => Promise<IpcResult<ExtensionItem>>;
  };
  minimax?: {
    getConfig: () => Promise<IpcResult<MiniMaxPluginConfig>>;
    saveConfig: (input?: unknown) => Promise<IpcResult<MiniMaxPluginConfig>>;
    testConnection: (input?: unknown) => Promise<IpcResult<MiniMaxToolResult>>;
    textToAudio: (input?: unknown) => Promise<IpcResult<MiniMaxToolResult>>;
    textToImage: (input?: unknown) => Promise<IpcResult<MiniMaxToolResult>>;
    openOutputDir: (input?: unknown) => Promise<IpcResult>;
  };
  skills?: {
    list: (input?: unknown) => Promise<IpcResult>;
    rescan: (input?: unknown) => Promise<IpcResult>;
    toggle: (input?: unknown) => Promise<IpcResult>;
    enable: (id: string) => Promise<IpcResult>;
    disable: (id: string) => Promise<IpcResult>;
    create: (input?: unknown) => Promise<IpcResult>;
  };
  mcp?: {
    list: (input?: unknown) => Promise<IpcResult>;
    add: (input?: unknown) => Promise<IpcResult>;
    update: (id: string, config: unknown) => Promise<IpcResult>;
    toggle: (id: string, enabled: boolean) => Promise<IpcResult>;
    install: (input?: unknown) => Promise<IpcResult>;
    remove: (input?: unknown) => Promise<IpcResult>;
    test: (input?: unknown) => Promise<IpcResult>;
  };
  plugins?: {
    list: (input?: unknown) => Promise<IpcResult>;
    enable: (id: string) => Promise<IpcResult>;
    disable: (id: string) => Promise<IpcResult>;
    create: (input?: unknown) => Promise<IpcResult>;
    remove: (id: string) => Promise<IpcResult>;
  };
  projects: {
    list: () => Promise<IpcResult>;
    get: (projectId: string) => Promise<IpcResult>;
    create: (input: unknown) => Promise<IpcResult>;
    createBlank: (input: unknown) => Promise<IpcResult>;
    selectFolder: () => Promise<IpcResult>;
    update: (input: unknown) => Promise<IpcResult>;
    remove: (projectId: string) => Promise<IpcResult>;
    openFolder: (projectId: string) => Promise<IpcResult>;
  };
  rules: {
    get: (projectId?: string, taskId?: string) => Promise<IpcResult>;
    update: (input: unknown) => Promise<IpcResult>;
  };
  context: {
    preview: (input: unknown) => Promise<IpcResult>;
    select: (input: unknown) => Promise<IpcResult<ContextSelectionResult>>;
    pathForFile?: (file: File) => string;
  };
  artifacts?: {
    list: (input?: unknown) => Promise<IpcResult<ArtifactSnapshot[]>>;
    get: (input?: unknown) => Promise<IpcResult<ArtifactSnapshot>>;
    createText: (input?: unknown) => Promise<IpcResult<ArtifactSnapshot>>;
    generateImage: (input?: unknown) => Promise<IpcResult<ArtifactSnapshot>>;
    captureScreenshot: (input?: unknown) => Promise<IpcResult<ArtifactSnapshot>>;
    open: (input?: unknown) => Promise<IpcResult>;
    reveal: (input?: unknown) => Promise<IpcResult>;
  };
  desktop?: {
    getSettings: () => Promise<IpcResult<AppSettingsSnapshot>>;
    updateSettings: (input?: unknown) => Promise<IpcResult<AppSettingsSnapshot>>;
    notify: (input?: unknown) => Promise<IpcResult>;
    setPreventSleep: (enabled: boolean) => Promise<IpcResult>;
    popout: (input?: unknown) => Promise<IpcResult>;
    openExternal: (url: string) => Promise<IpcResult>;
    copyText: (text: string) => Promise<IpcResult>;
    openAppWindow: (input?: unknown) => Promise<IpcResult>;
  };
  modelConfigs: {
    list: () => Promise<IpcResult<ModelConfigSnapshot>>;
    probe: (input: unknown) => Promise<IpcResult<ModelProbeResult>>;
    saveProvider: (input: unknown) => Promise<IpcResult<ModelConfigSnapshot>>;
    selectModel: (input: unknown) => Promise<IpcResult<ModelConfigSnapshot>>;
    removeProvider: (providerId: string) => Promise<IpcResult<ModelConfigSnapshot>>;
  };
}

declare global {
  interface Window {
    redouApi?: ElectronRedouApi;
  }
}

function fallback<T = unknown>(data: T | null = null): Promise<IpcResult<T>> {
  return Promise.resolve({
    ok: false,
    data,
    error: { code: 'MOCK_FALLBACK', message: 'Electron preload API is not available.' },
    warnings: ['Using mock fallback data.'],
  });
}

function electronApi(): ElectronRedouApi | null {
  return typeof window !== 'undefined' && window.redouApi ? window.redouApi : null;
}

export function hasRealRedouApi() {
  return Boolean(electronApi());
}

export const redouApi = {
  listRuntimes: () => electronApi()?.runtimes.list() ?? fallback([]),
  getRuntime: (id: string) => electronApi()?.runtimes.get(id) ?? fallback(null),
  getRuntimeAvailability: (id?: string) => electronApi()?.runtimes.availability(id) ?? fallback(null),
  setDefaultRuntime: (id: string) => electronApi()?.runtimes.setDefault(id) ?? fallback(null),
  listProjects: () => electronApi()?.projects.list() ?? fallback([]),
  getProject: (projectId: string) => electronApi()?.projects.get(projectId) ?? fallback(null),
  createProject: (input: unknown) => electronApi()?.projects.create(input) ?? fallback(null),
  createBlankProject: (input: unknown) => electronApi()?.projects.createBlank(input) ?? fallback(null),
  selectProjectFolder: () => electronApi()?.projects.selectFolder() ?? fallback(null),
  updateProject: (input: unknown) => electronApi()?.projects.update(input) ?? fallback(null),
  removeProject: (projectId: string) => electronApi()?.projects.remove(projectId) ?? fallback(null),
  openProjectFolder: (projectId: string) => electronApi()?.projects.openFolder(projectId) ?? fallback(null),
  listTasks: (projectId?: string, options?: unknown) => electronApi()?.tasks.list(projectId, options) ?? fallback([]),
  listArchivedTasks: () => electronApi()?.tasks.list(undefined, { includeArchived: true, archivedOnly: true }) ?? fallback([]),
  getTask: (taskId: string) => electronApi()?.tasks.get(taskId) ?? fallback(null),
  createTask: (input: unknown) => electronApi()?.tasks.create(input) ?? fallback(null),
  updateTask: (input: unknown) => electronApi()?.tasks.update(input) ?? fallback(null),
  archiveTask: (taskId: string) => electronApi()?.tasks.archive(taskId) ?? fallback(null),
  restoreTask: (taskId: string) => electronApi()?.tasks.restore(taskId) ?? fallback(null),
  forkTask: (input: unknown) => electronApi()?.tasks.fork(input) ?? fallback(null),
  removeTask: (taskId: string) => electronApi()?.tasks.remove(taskId) ?? fallback(null),
  startTask: (taskId: string, options?: unknown) => electronApi()?.tasks.start(taskId, options) ?? fallback(null),
  queueTask: (taskId: string, input: string, options?: unknown) => electronApi()?.tasks.queue(taskId, input, options) ?? fallback(null),
  updateQueuedTask: (taskId: string, queueId: string, action: 'delete' | 'guide') => electronApi()?.tasks.updateQueue(taskId, queueId, action) ?? fallback(null),
  steerTask: (taskId: string, input: string, options?: unknown) => electronApi()?.tasks.steer(taskId, input, options) ?? fallback(null),
  interruptTask: (taskId: string) => electronApi()?.tasks.interrupt(taskId) ?? fallback(null),
  listEvents: (taskId?: string) => electronApi()?.events.list(taskId) ?? fallback([]),
  getSnapshot: (taskId?: string) => electronApi()?.events.snapshot(taskId) ?? fallback<RuntimeSnapshot>(null),
  subscribeEvents(taskId: string | undefined, callback: (event: IpcResult) => void) {
    return electronApi()?.events.subscribe?.(taskId, callback) ?? (() => {});
  },
  listApprovals: (taskId?: string) => electronApi()?.approvals.list(taskId) ?? fallback([]),
  respondApproval: (approvalId: string, decision: unknown, taskId?: string | null) => electronApi()?.approvals.respond(approvalId, decision, taskId) ?? fallback(null),
  getGitStatus: (input?: unknown) => electronApi()?.git?.status(input) ?? fallback<GitStatusSnapshot>(null),
  getGitDiff: (input?: unknown) => electronApi()?.git?.diff(input) ?? fallback<GitDiffSnapshot>(null),
  stageGitFile: (input?: unknown) => electronApi()?.git?.stage(input) ?? fallback<GitDiffSnapshot>(null),
  unstageGitFile: (input?: unknown) => electronApi()?.git?.unstage(input) ?? fallback<GitDiffSnapshot>(null),
  revertGitFile: (input?: unknown) => electronApi()?.git?.revert(input) ?? fallback<GitDiffSnapshot>(null),
  stageGitHunk: (input?: unknown) => electronApi()?.git?.stageHunk(input) ?? fallback<GitDiffSnapshot>(null),
  revertGitHunk: (input?: unknown) => electronApi()?.git?.revertHunk(input) ?? fallback<GitDiffSnapshot>(null),
  commitGitChanges: (input?: unknown) => electronApi()?.git?.commit(input) ?? fallback<GitDiffSnapshot>(null),
  pushGitBranch: (input?: unknown) => electronApi()?.git?.push(input) ?? fallback<GitDiffSnapshot>(null),
  createPullRequest: (input?: unknown) => electronApi()?.git?.createPullRequest(input) ?? fallback<GitDiffSnapshot>(null),
  runTerminalCommand: (input?: unknown) => electronApi()?.terminal?.run(input) ?? fallback(null),
  listWorktrees: (input?: unknown) => electronApi()?.worktrees?.list(input) ?? fallback(null),
  createWorktree: (input?: unknown) => electronApi()?.worktrees?.create(input) ?? fallback(null),
  removeWorktree: (input?: unknown) => electronApi()?.worktrees?.remove(input) ?? fallback(null),
  openWorktree: (input?: unknown) => electronApi()?.worktrees?.open(input) ?? fallback(null),
  listAutomations: (input?: unknown) => electronApi()?.automations?.list(input) ?? fallback(null),
  getAutomation: (input?: unknown) => electronApi()?.automations?.get(input) ?? fallback(null),
  createAutomation: (input?: unknown) => electronApi()?.automations?.create(input) ?? fallback(null),
  updateAutomation: (input?: unknown) => electronApi()?.automations?.update(input) ?? fallback(null),
  deleteAutomation: (input?: unknown) => electronApi()?.automations?.delete(input) ?? fallback(null),
  runAutomation: (input?: unknown) => electronApi()?.automations?.run(input) ?? fallback(null),
  listAutomationRuns: (input?: unknown) => electronApi()?.automations?.runs(input) ?? fallback(null),
  listExtensions: (input?: { kind?: ExtensionKind; mode?: 'explore' | 'manage' }) => electronApi()?.extensions?.list(input) ?? fallback<ExtensionItem[]>([]),
  listExtensionCatalog: (input?: { kind?: ExtensionKind }) => electronApi()?.extensions?.catalog(input) ?? fallback<ExtensionItem[]>([]),
  refreshExtensions: (input?: { kind?: ExtensionKind }) => electronApi()?.extensions?.refresh(input) ?? fallback<ExtensionItem[]>([]),
  enableExtension: (id: string) => electronApi()?.extensions?.enable(id) ?? fallback(null),
  disableExtension: (id: string) => electronApi()?.extensions?.disable(id) ?? fallback(null),
  removeExtension: (id: string) => electronApi()?.extensions?.remove(id) ?? fallback(null),
  getExtension: (id: string) => electronApi()?.extensions?.get(id) ?? fallback<ExtensionItem>(null),
  getMiniMaxConfig: () => electronApi()?.minimax?.getConfig() ?? fallback<MiniMaxPluginConfig>(null),
  saveMiniMaxConfig: (input?: unknown) => electronApi()?.minimax?.saveConfig(input) ?? fallback<MiniMaxPluginConfig>(null),
  testMiniMaxConnection: (input?: unknown) => electronApi()?.minimax?.testConnection(input) ?? fallback<MiniMaxToolResult>(null),
  miniMaxTextToAudio: (input?: unknown) => electronApi()?.minimax?.textToAudio(input) ?? fallback<MiniMaxToolResult>(null),
  miniMaxTextToImage: (input?: unknown) => electronApi()?.minimax?.textToImage(input) ?? fallback<MiniMaxToolResult>(null),
  openMiniMaxOutputDir: (input?: unknown) => electronApi()?.minimax?.openOutputDir(input) ?? fallback(null),
  listSkills: (input?: unknown) => electronApi()?.skills?.list(input) ?? fallback(null),
  rescanSkills: (input?: unknown) => electronApi()?.skills?.rescan(input) ?? fallback(null),
  toggleSkill: (input?: unknown) => electronApi()?.skills?.toggle(input) ?? fallback(null),
  enableSkill: (id: string) => electronApi()?.skills?.enable(id) ?? fallback(null),
  disableSkill: (id: string) => electronApi()?.skills?.disable(id) ?? fallback(null),
  createSkill: (input?: unknown) => electronApi()?.skills?.create(input) ?? fallback(null),
  listMcpServers: (input?: unknown) => electronApi()?.mcp?.list(input) ?? fallback(null),
  addMcpServer: (input?: unknown) => electronApi()?.mcp?.add(input) ?? fallback(null),
  updateMcpServer: (id: string, config: unknown) => electronApi()?.mcp?.update(id, config) ?? fallback(null),
  toggleMcpServer: (id: string, enabled: boolean) => electronApi()?.mcp?.toggle(id, enabled) ?? fallback(null),
  installMcpServer: (input?: unknown) => electronApi()?.mcp?.install(input) ?? fallback(null),
  removeMcpServer: (input?: unknown) => electronApi()?.mcp?.remove(input) ?? fallback(null),
  testMcpServer: (input?: unknown) => electronApi()?.mcp?.test(input) ?? fallback(null),
  listPlugins: (input?: unknown) => electronApi()?.plugins?.list(input) ?? fallback(null),
  enablePlugin: (id: string) => electronApi()?.plugins?.enable(id) ?? fallback(null),
  disablePlugin: (id: string) => electronApi()?.plugins?.disable(id) ?? fallback(null),
  createPlugin: (input?: unknown) => electronApi()?.plugins?.create(input) ?? fallback(null),
  removePlugin: (id: string) => electronApi()?.plugins?.remove(id) ?? fallback(null),
  getRules: (projectId?: string, taskId?: string) => electronApi()?.rules.get(projectId, taskId) ?? fallback(null),
  updateRules: (input: unknown) => electronApi()?.rules.update(input) ?? fallback(null),
  previewContext: (input: unknown) => electronApi()?.context.preview(input) ?? fallback(null),
  selectContextItems: (input: unknown) => electronApi()?.context.select(input) ?? fallback<ContextSelectionResult>({ canceled: true, items: [] }),
  pathForDroppedFile: (file: File) => electronApi()?.context.pathForFile?.(file) || ((file as File & { path?: string }).path || file.name || ''),
  listArtifacts: (input?: unknown) => electronApi()?.artifacts?.list(input) ?? fallback<ArtifactSnapshot[]>([]),
  getArtifact: (input?: unknown) => electronApi()?.artifacts?.get(input) ?? fallback<ArtifactSnapshot>(null),
  createTextArtifact: (input?: unknown) => electronApi()?.artifacts?.createText(input) ?? fallback<ArtifactSnapshot>(null),
  generateImageArtifact: (input?: unknown) => electronApi()?.artifacts?.generateImage(input) ?? fallback<ArtifactSnapshot>(null),
  captureScreenshotArtifact: (input?: unknown) => electronApi()?.artifacts?.captureScreenshot(input) ?? fallback<ArtifactSnapshot>(null),
  openArtifact: (input?: unknown) => electronApi()?.artifacts?.open(input) ?? fallback(null),
  revealArtifact: (input?: unknown) => electronApi()?.artifacts?.reveal(input) ?? fallback(null),
  getAppSettings: () => electronApi()?.desktop?.getSettings() ?? fallback<AppSettingsSnapshot>(null),
  updateAppSettings: (input?: unknown) => electronApi()?.desktop?.updateSettings(input) ?? fallback<AppSettingsSnapshot>(null),
  notifyDesktop: (input?: unknown) => electronApi()?.desktop?.notify(input) ?? fallback(null),
  setPreventSleep: (enabled: boolean) => electronApi()?.desktop?.setPreventSleep(enabled) ?? fallback(null),
  popoutWindow: (input?: unknown) => electronApi()?.desktop?.popout(input) ?? fallback(null),
  openExternalUrl: (url: string) => electronApi()?.desktop?.openExternal(url) ?? fallback(null),
  copyText: (text: string) => electronApi()?.desktop?.copyText(text) ?? fallback(null),
  openAppWindow: (input?: unknown) => electronApi()?.desktop?.openAppWindow(input) ?? fallback(null),
  listModelConfigs: () => electronApi()?.modelConfigs.list() ?? fallback<ModelConfigSnapshot>({ catalog: [], providers: [], selected: null }),
  probeModelProvider: (input: unknown) => electronApi()?.modelConfigs.probe(input) ?? fallback<ModelProbeResult>(null),
  saveModelProvider: (input: unknown) => electronApi()?.modelConfigs.saveProvider(input) ?? fallback<ModelConfigSnapshot>({ catalog: [], providers: [], selected: null }),
  selectConfiguredModel: (input: unknown) => electronApi()?.modelConfigs.selectModel(input) ?? fallback<ModelConfigSnapshot>({ catalog: [], providers: [], selected: null }),
  removeModelProvider: (providerId: string) => electronApi()?.modelConfigs.removeProvider(providerId) ?? fallback<ModelConfigSnapshot>({ catalog: [], providers: [], selected: null }),
};

export const redouRendererApiStatus = {
  phase: 'rewrite-phase-4',
  mode: hasRealRedouApi() ? 'ipc-preload' : 'mock-fallback',
  redouCodexAppServer: 'via-runtime-ipc',
} as const;
