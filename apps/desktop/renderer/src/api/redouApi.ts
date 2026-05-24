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
  activeTurnId?: string | null;
  activeItem?: {
    id?: string | null;
    title?: string | null;
    status?: string | null;
    source?: string | null;
  } | null;
  usage?: Record<string, unknown> | null;
  lastError?: {
    code?: string | null;
    title?: string | null;
    message?: string | null;
  } | null;
}

export interface RuntimeSnapshot {
  messages?: Array<{ id: string; role?: string; body: string; deliveryMode?: string; status?: string; queueId?: string | null; queueState?: string | null; sourceEventId?: string; turnId?: string | null }>;
  progressSteps?: Array<{ id: string; label: string; status: string }>;
  planEntries?: Array<{ id: string; title?: string; step?: string; status: string }>;
  todoProjectionEntries?: Array<{ id: string; title: string; status: string }>;
  approvalRequests?: unknown[];
  diffSummary?: string | null;
  changedFiles?: Array<{ id: string; path: string; status?: string; diff?: string }>;
  logs?: Array<{ id: string; level: string; message: string; time: string }>;
  artifacts?: Array<{ id: string; name: string; type: string; status: string }>;
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

interface ElectronRedouApi {
  runtimes: {
    list: () => Promise<IpcResult>;
    get: (id: string) => Promise<IpcResult>;
    availability: (id?: string) => Promise<IpcResult>;
    setDefault: (id: string) => Promise<IpcResult>;
  };
  tasks: {
    list: (projectId?: string) => Promise<IpcResult>;
    get: (taskId: string) => Promise<IpcResult>;
    create: (input: unknown) => Promise<IpcResult>;
    update: (input: unknown) => Promise<IpcResult>;
    archive: (taskId: string) => Promise<IpcResult>;
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
    respond: (approvalId: string, decision: unknown) => Promise<IpcResult>;
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
  listTasks: (projectId?: string) => electronApi()?.tasks.list(projectId) ?? fallback([]),
  getTask: (taskId: string) => electronApi()?.tasks.get(taskId) ?? fallback(null),
  createTask: (input: unknown) => electronApi()?.tasks.create(input) ?? fallback(null),
  updateTask: (input: unknown) => electronApi()?.tasks.update(input) ?? fallback(null),
  archiveTask: (taskId: string) => electronApi()?.tasks.archive(taskId) ?? fallback(null),
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
  respondApproval: (approvalId: string, decision: unknown) => electronApi()?.approvals.respond(approvalId, decision) ?? fallback(null),
  getRules: (projectId?: string, taskId?: string) => electronApi()?.rules.get(projectId, taskId) ?? fallback(null),
  updateRules: (input: unknown) => electronApi()?.rules.update(input) ?? fallback(null),
  previewContext: (input: unknown) => electronApi()?.context.preview(input) ?? fallback(null),
  listModelConfigs: () => electronApi()?.modelConfigs.list() ?? fallback<ModelConfigSnapshot>({ catalog: [], providers: [], selected: null }),
  probeModelProvider: (input: unknown) => electronApi()?.modelConfigs.probe(input) ?? fallback<ModelProbeResult>(null),
  saveModelProvider: (input: unknown) => electronApi()?.modelConfigs.saveProvider(input) ?? fallback<ModelConfigSnapshot>({ catalog: [], providers: [], selected: null }),
  selectConfiguredModel: (input: unknown) => electronApi()?.modelConfigs.selectModel(input) ?? fallback<ModelConfigSnapshot>({ catalog: [], providers: [], selected: null }),
  removeModelProvider: (providerId: string) => electronApi()?.modelConfigs.removeProvider(providerId) ?? fallback<ModelConfigSnapshot>({ catalog: [], providers: [], selected: null }),
};

export const redouRendererApiStatus = {
  phase: 'rewrite-phase-4',
  mode: hasRealRedouApi() ? 'ipc-preload' : 'mock-fallback',
  codexAppServer: 'via-runtime-ipc',
} as const;
