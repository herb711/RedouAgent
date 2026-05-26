import { useEffect, useMemo, useRef, useState } from 'react';
import { hasRealRedouApi, redouApi, type ArtifactSnapshot, type ContextSelectionItem, type ContextSelectionKind, type GitDiffSnapshot, type RuntimeSnapshot } from '../api/redouApi';
import {
  createPermissionPolicy,
  defaultComposerPermissionMode,
  getPermissionModeOption,
  isComposerPermissionModeId,
} from '../components/composer/composerOptions';
import { mockWorkbenchData } from './mockWorkbenchData';
import type {
  AgentThreadMessage,
  AppSettingsSnapshot,
  ArtifactData,
  ChangeFileData,
  ComposerEditTarget,
  ContextItemData,
  RedouCodexPlanProjection,
  ComposerPermissionModeId,
  ComposerSubmitOptions,
  ModelConfigSelection,
  ModelConfigSnapshot,
  ModelProbeResult,
  LogEntryData,
  ProgressStepStatus,
  RightPanelId,
  RuntimeStatusData,
  RuntimeId,
  WorkbenchMockData,
  WorkbenchProject,
  WorkbenchTask,
  WorkbenchTaskStatus,
  WorkbenchView,
} from '../types';

export interface WorkbenchState {
  data: WorkbenchMockData;
  selectedTask: WorkbenchTask | null;
  composerInput: string;
  composerEditTarget: ComposerEditTarget | null;
  conversationDrafts: Record<string, ConversationDraft>;
  activeView: WorkbenchView;
  redouCodexPlan: RedouCodexPlanProjection[];
  activeRightPanel: RightPanelId | null;
  rightPanelOpen: boolean;
  expandedProjectIds: string[];
  apiMode: 'ipc' | 'mock';
  runtimeAvailability: unknown;
  runtimeError: string | null;
  modelConfig: ModelConfigSnapshot;
  appSettings: AppSettingsSnapshot;
  archivedTasks: WorkbenchTask[];
}

export interface WorkbenchActions {
  selectView: (view: WorkbenchView) => void;
  selectProject: (projectId: string) => void;
  selectTask: (taskId: string) => void;
  selectRightPanel: (panel: RightPanelId) => void;
  closeRightPanel: () => void;
  collapseAllProjects: () => void;
  toggleProjectExpanded: (projectId: string) => void;
  createBlankProject: (name?: string) => Promise<void>;
  createConversationInProject: (projectId: string) => Promise<void>;
  createProjectFromFolder: () => Promise<void>;
  toggleProjectPinned: (projectId: string) => Promise<void>;
  reorderProjects: (orderedProjectIds: string[]) => Promise<void>;
  openProjectFolder: (projectId: string) => Promise<void>;
  renameProject: (projectId: string) => Promise<void>;
  archiveProjectConversation: (projectId: string) => Promise<void>;
  reloadArchivedTasks: () => Promise<void>;
  restoreArchivedTask: (taskId: string) => Promise<void>;
  deleteArchivedTask: (taskId: string) => Promise<void>;
  deleteAllArchivedTasks: () => Promise<void>;
  removeProject: (projectId: string) => Promise<void>;
  toggleTaskPinned: (taskId: string) => Promise<void>;
  renameTaskConversation: (taskId: string) => Promise<void>;
  archiveTaskConversation: (taskId: string) => Promise<void>;
  toggleTaskUnread: (taskId: string) => Promise<void>;
  openTaskWorkspace: (taskId: string) => Promise<void>;
  copyTaskWorkspace: (taskId: string) => Promise<void>;
  copyTaskConversationId: (taskId: string) => Promise<void>;
  copyTaskDeepLink: (taskId: string) => Promise<void>;
  forkTaskToLocal: (taskId: string) => Promise<void>;
  forkTaskToNewWorktree: (taskId: string) => Promise<void>;
  openTaskInNewWindow: (taskId: string) => Promise<void>;
  setComposerPermissionMode: (mode: ComposerPermissionModeId) => void;
  reloadModelConfigs: () => Promise<void>;
  selectConfiguredModel: (selection: ModelConfigSelection) => Promise<void>;
  probeModelProvider: (input: unknown) => Promise<ModelProbeResult | null>;
  saveModelProvider: (input: unknown) => Promise<void>;
  removeModelProvider: (providerId: string) => Promise<void>;
  selectContextItems: (kind: ContextSelectionKind) => Promise<void>;
  addDroppedContextFiles: (files: FileList | File[]) => Promise<void>;
  removeContextItem: (path: string) => void;
  clearContext: () => void;
  setComposerInput: (input: string) => void;
  startComposerEdit: (target: ComposerEditTarget) => void;
  cancelComposerEdit: () => void;
  generateImageArtifact: (prompt: string) => Promise<void>;
  captureScreenshotComment: (comment: string) => Promise<void>;
  openArtifact: (artifact: ArtifactData) => Promise<void>;
  revealArtifact: (artifact: ArtifactData) => Promise<void>;
  popoutArtifact: (artifact: ArtifactData) => Promise<void>;
  setBrowserUrl: (url: string) => void;
  openBrowserExternal: (url?: string) => Promise<void>;
  popoutBrowser: (url?: string) => Promise<void>;
  notifyDesktop: (title: string, body: string) => Promise<void>;
  updateAppSettings: (patch: Record<string, unknown>) => Promise<void>;
  submitComposer: (input: string, options: ComposerSubmitOptions) => Promise<boolean | void>;
  stopActiveTask: () => Promise<void>;
  guideQueuedMessage: (message: AgentThreadMessage) => Promise<void>;
  deleteQueuedMessage: (message: AgentThreadMessage) => Promise<void>;
  stageGitFile: (file: ChangeFileData) => Promise<void>;
  unstageGitFile: (file: ChangeFileData) => Promise<void>;
  revertGitFile: (file: ChangeFileData) => Promise<void>;
  stageGitHunk: (file: ChangeFileData, hunkIndex: number) => Promise<void>;
  revertGitHunk: (file: ChangeFileData, hunkIndex: number) => Promise<void>;
  commitGitChanges: () => Promise<void>;
  pushGitBranch: () => Promise<void>;
  createPullRequest: () => Promise<void>;
}

const emptyModelConfig: ModelConfigSnapshot = {
  catalog: [],
  providers: [],
  selected: null,
};

const defaultAppSettings: AppSettingsSnapshot = {
  general: {
    language: 'zh-CN',
    startupView: 'thread',
    autoUpdate: true,
  },
  appearance: {
    theme: 'light',
    density: 'comfortable',
    inspectorSide: 'right',
  },
  desktop: {
    notifications: true,
    preventSleep: false,
    screenshotComments: true,
    popoutBehavior: 'window',
  },
  browser: {
    enabled: true,
    homeUrl: 'https://github.com/herb711/RedouAgent',
    allowPopouts: true,
  },
  media: {
    voiceInput: true,
    imageInput: true,
    imageGeneration: true,
  },
  connections: {
    artifactPreview: true,
    inAppBrowser: true,
    screenshotCapture: true,
  },
  composer: {
    permissionMode: defaultComposerPermissionMode,
  },
  automation: {
    allowModelCreate: false,
    exposeToolToModel: false,
  },
};

const EMPTY_CONTEXT_SUMMARY = 'No context selected.';
const COMPOSER_PERMISSION_MODE_STORAGE_KEY = 'redou.composer.permissionMode';

function readStoredComposerPermissionMode(): ComposerPermissionModeId | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(COMPOSER_PERMISSION_MODE_STORAGE_KEY);
    return isComposerPermissionModeId(stored) ? stored : null;
  } catch {
    return null;
  }
}

function writeStoredComposerPermissionMode(mode: ComposerPermissionModeId) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(COMPOSER_PERMISSION_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore storage errors; the in-memory state still reflects the user's choice.
  }
}

function resolveComposerPermissionMode(settings?: AppSettingsSnapshot | null): ComposerPermissionModeId {
  return readStoredComposerPermissionMode()
    || (isComposerPermissionModeId(settings?.composer?.permissionMode) ? settings.composer.permissionMode : null)
    || defaultComposerPermissionMode;
}

function applyComposerPermissionModeToData(data: WorkbenchMockData, mode: ComposerPermissionModeId): WorkbenchMockData {
  const option = getPermissionModeOption(mode);
  return {
    ...data,
    composer: {
      ...data.composer,
      permission: option.label,
      permissionMode: mode,
    },
  };
}

export interface ConversationDraft {
  input: string;
  contextItems: ContextItemData[];
  selectedFiles: string[];
  selectedDirectories: string[];
  attachments: string[];
}

function conversationDraftKey(projectId?: string | null, taskId?: string | null) {
  return `${projectId || 'no-project'}::${taskId || 'no-task'}`;
}

function initialRouteSelection() {
  if (typeof window === 'undefined') return { projectId: '', taskId: '' };
  const params = new URLSearchParams(window.location.search);
  return {
    projectId: params.get('projectId') || '',
    taskId: params.get('taskId') || '',
  };
}

function taskDraftKey(projectId: string | undefined, task?: Pick<WorkbenchTask, 'id' | 'projectId'> | null) {
  return conversationDraftKey(task?.projectId || projectId, task?.id || null);
}

function activeConversationDraftKey(state: Pick<WorkbenchState, 'data' | 'selectedTask'>) {
  return taskDraftKey(state.data.activeProjectId, state.selectedTask || state.data.activeTask);
}

function emptyConversationDraft(input = ''): ConversationDraft {
  return {
    input,
    contextItems: [],
    selectedFiles: [],
    selectedDirectories: [],
    attachments: [],
  };
}

function conversationDraftFromData(data: WorkbenchMockData, input = ''): ConversationDraft {
  return {
    input,
    contextItems: data.contextItems || [],
    selectedFiles: uniqueStrings(data.mockContext.selectedFiles || []),
    selectedDirectories: uniqueStrings(data.mockContext.selectedDirectories || []),
    attachments: uniqueStrings(data.mockContext.attachments || []),
  };
}

function contextSummary(total: number) {
  return total
    ? `${total} context item${total === 1 ? '' : 's'} selected for the next turn.`
    : EMPTY_CONTEXT_SUMMARY;
}

function applyConversationDraftToData(data: WorkbenchMockData, draft: ConversationDraft = emptyConversationDraft()): WorkbenchMockData {
  const selectedFiles = uniqueStrings(draft.selectedFiles);
  const selectedDirectories = uniqueStrings(draft.selectedDirectories);
  const attachments = uniqueStrings(draft.attachments);
  const total = selectedFiles.length + selectedDirectories.length + attachments.length;
  return {
    ...data,
    contextItems: draft.contextItems || [],
    mockContext: {
      ...data.mockContext,
      summary: contextSummary(total),
      selectedFiles,
      selectedDirectories,
      attachments,
    },
  };
}

function updateActiveConversationDraft(state: WorkbenchState, data: WorkbenchMockData, input = state.composerInput) {
  const key = activeConversationDraftKey(state);
  return {
    ...state.conversationDrafts,
    [key]: conversationDraftFromData(data, input),
  };
}

function activateConversationData(data: WorkbenchMockData, draft?: ConversationDraft) {
  return applyConversationDraftToData(resetThreadProjection(data), draft || emptyConversationDraft());
}

const initialComposerPermissionMode = resolveComposerPermissionMode();
const initialWorkbenchData = applyComposerPermissionModeToData(mockWorkbenchData, initialComposerPermissionMode);
const initialAppSettings: AppSettingsSnapshot = {
  ...defaultAppSettings,
  composer: {
    ...defaultAppSettings.composer,
    permissionMode: initialComposerPermissionMode,
  },
};

export const initialWorkbenchState: WorkbenchState = {
  data: initialWorkbenchData,
  selectedTask: initialWorkbenchData.activeTask,
  composerInput: '',
  composerEditTarget: null,
  conversationDrafts: {
    [conversationDraftKey(initialWorkbenchData.activeProjectId, initialWorkbenchData.activeTask.id)]: conversationDraftFromData(initialWorkbenchData, ''),
  },
  activeView: 'thread',
  redouCodexPlan: [],
  activeRightPanel: 'progress',
  rightPanelOpen: true,
  expandedProjectIds: [initialWorkbenchData.activeProjectId],
  apiMode: hasRealRedouApi() ? 'ipc' : 'mock',
  runtimeAvailability: null,
  runtimeError: null,
  modelConfig: emptyModelConfig,
  appSettings: initialAppSettings,
  archivedTasks: [],
};

function mapProgressStatus(status: string): ProgressStepStatus {
  if (status === 'completed') return 'completed';
  if (status === 'inProgress' || status === 'in_progress' || status === 'active' || status === 'running' || status === 'started' || status === 'updated' || status === 'waiting_approval') return 'active';
  if (status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled' || status === 'interrupted' || status === 'degraded') return 'error';
  return 'pending';
}

function mapLogLevel(level: string): LogEntryData['level'] {
  if (level === 'warn' || level === 'debug' || level === 'error') return level;
  return 'info';
}

function mapTaskStatus(status?: string): WorkbenchTaskStatus {
  if (
    status === 'running'
    || status === 'blocked'
    || status === 'waiting_approval'
    || status === 'failed'
    || status === 'error'
    || status === 'degraded'
    || status === 'completed'
    || status === 'interrupted'
  ) return status;
  if (status === 'cancelled' || status === 'canceled') return 'interrupted';
  if (status === 'idle') return 'completed';
  return 'created';
}

function mapRuntimeId(runtime?: string): RuntimeId {
  if (runtime === 'redou-codex') return 'redou-codex';
  if (runtime === 'hermes' || runtime === 'pi' || runtime === 'custom') return runtime;
  return 'redou-codex';
}

function normalizeRuntimeStatus(input: unknown): RuntimeStatusData | null {
  if (!input || typeof input !== 'object') return null;
  const status = input as RuntimeStatusData;
  const lastError = status.lastError && typeof status.lastError === 'object'
    ? {
        code: status.lastError.code ? String(status.lastError.code) : null,
        title: status.lastError.title ? String(status.lastError.title) : null,
        message: status.lastError.message ? String(status.lastError.message) : null,
      }
    : null;
  return {
    runtime: status.runtime ? String(status.runtime) : null,
    threadStatus: status.threadStatus ? String(status.threadStatus) : null,
    turnStatus: status.turnStatus ? String(status.turnStatus) : null,
    rawTurnStatus: status.rawTurnStatus ? String(status.rawTurnStatus) : null,
    activeTurnId: status.activeTurnId ? String(status.activeTurnId) : null,
    activeItem: status.activeItem
      ? {
          id: status.activeItem.id ? String(status.activeItem.id) : null,
          title: status.activeItem.title ? String(status.activeItem.title) : null,
          status: status.activeItem.status ? String(status.activeItem.status) : null,
          source: status.activeItem.source ? String(status.activeItem.source) : null,
        }
      : null,
    usage: status.usage && typeof status.usage === 'object' ? status.usage : null,
    needsAttention: Boolean(status.needsAttention),
    degraded: Boolean(status.degraded),
    stopReason: status.stopReason && typeof status.stopReason === 'object'
      ? {
          status: status.stopReason.status ? String(status.stopReason.status) : null,
          code: status.stopReason.code ? String(status.stopReason.code) : null,
          message: status.stopReason.message ? String(status.stopReason.message) : null,
          details: status.stopReason.details,
        }
      : null,
    continuation: status.continuation && typeof status.continuation === 'object'
      ? {
          recommended: Boolean(status.continuation.recommended),
          automatic: Boolean(status.continuation.automatic),
          reason: status.continuation.reason ? String(status.continuation.reason) : null,
          message: status.continuation.message ? String(status.continuation.message) : null,
        }
      : null,
    lastError,
  };
}

function queueDepthFromTask(task: Record<string, unknown>) {
  const metadata = (task.metadata || {}) as { queueDepth?: unknown; queuedTurns?: unknown[] };
  const explicit = Number(metadata.queueDepth);
  if (Number.isFinite(explicit)) return explicit;
  return Array.isArray(metadata.queuedTurns)
    ? metadata.queuedTurns.filter((item) => (item as { status?: string })?.status === 'pending').length
    : 0;
}

function normalizeModelConfigSnapshot(input: unknown): ModelConfigSnapshot {
  const snapshot = (input || {}) as Partial<ModelConfigSnapshot>;
  return {
    catalog: Array.isArray(snapshot.catalog) ? snapshot.catalog : [],
    providers: Array.isArray(snapshot.providers) ? snapshot.providers : [],
    selected: snapshot.selected && snapshot.selected.providerId && snapshot.selected.modelId
      ? {
          providerId: String(snapshot.selected.providerId),
          modelId: String(snapshot.selected.modelId),
        }
      : null,
  };
}

function normalizeAppSettingsSnapshot(input: unknown): AppSettingsSnapshot {
  const snapshot = (input || {}) as Partial<AppSettingsSnapshot>;
  const composerPermissionMode = isComposerPermissionModeId(snapshot.composer?.permissionMode)
    ? snapshot.composer.permissionMode
    : defaultAppSettings.composer.permissionMode;
  return {
    ...defaultAppSettings,
    ...snapshot,
    general: { ...defaultAppSettings.general, ...(snapshot.general || {}) },
    appearance: { ...defaultAppSettings.appearance, ...(snapshot.appearance || {}) },
    desktop: { ...defaultAppSettings.desktop, ...(snapshot.desktop || {}) },
    browser: { ...defaultAppSettings.browser, ...(snapshot.browser || {}) },
    media: { ...defaultAppSettings.media, ...(snapshot.media || {}) },
    connections: { ...defaultAppSettings.connections, ...(snapshot.connections || {}) },
    composer: { ...defaultAppSettings.composer, ...(snapshot.composer || {}), permissionMode: composerPermissionMode },
    automation: { ...defaultAppSettings.automation, ...(snapshot.automation || {}) },
  };
}

function normalizeArtifactSnapshot(input: ArtifactSnapshot): ArtifactData {
  return {
    id: String(input.id || ''),
    taskId: input.taskId ?? null,
    projectId: input.projectId ?? null,
    name: String(input.name || input.path || 'Untitled artifact'),
    type: String(input.type || 'file'),
    status: String(input.status || 'ready'),
    path: input.path ?? null,
    mimeType: input.mimeType ?? null,
    size: Number(input.size || 0),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    content: input.content ?? null,
    uri: input.uri ?? null,
    metadata: input.metadata || {},
    preview: input.preview,
  };
}

function selectedModelFromConfig(snapshot: ModelConfigSnapshot) {
  const provider = snapshot.selected
    ? snapshot.providers.find((item) => item.id === snapshot.selected?.providerId)
    : snapshot.providers[0] || null;
  const modelId = snapshot.selected?.modelId || provider?.selectedModel || provider?.defaultModel || provider?.models[0] || '';
  if (!provider || !modelId) return null;
  return {
    modelId,
    providerId: provider.id,
    label: `${provider.label} / ${modelId}`,
  };
}

function applyModelConfigToData(data: WorkbenchMockData, snapshot: ModelConfigSnapshot): WorkbenchMockData {
  const selected = selectedModelFromConfig(snapshot);
  if (!selected) {
    return {
      ...data,
      composer: {
        ...data.composer,
        model: snapshot.providers.length ? data.composer.model : '配置模型',
        modelSelection: null,
      },
    };
  }
  return {
    ...data,
    composer: {
      ...data.composer,
      model: selected.label,
      modelId: selected.modelId,
      modelSelection: {
        providerId: selected.providerId,
        modelId: selected.modelId,
      },
    },
  };
}

function mapTask(task: Record<string, unknown>): WorkbenchTask {
  const metadata = (task.metadata || {}) as { unread?: unknown; pinned?: unknown; archived?: unknown; archivedAt?: unknown };
  return {
    id: String(task.id || ''),
    projectId: task.projectId ? String(task.projectId) : undefined,
    title: String(task.title || task.userInput || 'Untitled task'),
    status: mapTaskStatus(String(task.status || 'created')),
    runtime: mapRuntimeId(String(task.runtime || 'redou-codex')),
    userPrompt: String(task.userInput || ''),
    updatedAt: task.updatedAt ? String(task.updatedAt) : undefined,
    unread: Boolean(metadata.unread),
    pinned: Boolean(metadata.pinned),
    archived: Boolean(metadata.archived),
    archivedAt: metadata.archivedAt ? String(metadata.archivedAt) : null,
    redouCodexThreadId: task.redouCodexThreadId ? String(task.redouCodexThreadId) : null,
    queueDepth: queueDepthFromTask(task),
  };
}

function compareTasks(left: WorkbenchTask, right: WorkbenchTask) {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
}

function projectSortOrder(value: unknown) {
  const order = Number(value);
  return Number.isFinite(order) ? order : undefined;
}

function mapProject(project: Record<string, unknown>, tasks: WorkbenchTask[]): WorkbenchProject {
  const projectId = String(project.id || 'default-workspace');
  const metadata = (project.metadata || {}) as { pinned?: boolean; sortOrder?: unknown };
  return {
    id: projectId,
    name: String(project.name || 'RedouAgent'),
    rootPath: project.rootPath ? String(project.rootPath) : undefined,
    pinned: metadata.pinned === undefined ? projectId === 'default-workspace' : Boolean(metadata.pinned),
    sortOrder: projectSortOrder(metadata.sortOrder),
    tasks: tasks.filter((task) => !task.projectId || task.projectId === projectId).sort(compareTasks),
  };
}

function createEmptyTask(projectId?: string): WorkbenchTask {
  return {
    id: 'new-redou-codex-task',
    projectId,
    title: 'New redou-codex task',
    status: 'created',
    runtime: 'redou-codex',
    userPrompt: '',
  };
}

function createNewConversationTask(projectId?: string): WorkbenchTask {
  return {
    id: `task:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    projectId,
    title: '新对话',
    status: 'created',
    runtime: 'redou-codex',
    userPrompt: '',
    updatedAt: '刚刚',
  };
}

function runtimeResultError(result: { ok: boolean; error?: { message?: string } | null; data?: unknown }, fallback: string) {
  if (!result.ok) return result.error?.message || fallback;
  const data = result.data as { status?: string; error?: string; details?: { reason?: { message?: string } } } | null;
  if (data && (data.status === 'unavailable' || data.status === 'error')) {
    return data.error || data.details?.reason?.message || fallback;
  }
  return null;
}

function actionResultError(result: { ok: boolean; error?: { message?: string } | null; data?: unknown }, fallback: string) {
  if (!result.ok) return result.error?.message || fallback;
  const data = result.data as { ok?: boolean; message?: string; error?: string; status?: string } | null;
  if (data && data.ok === false) return data.message || data.error || fallback;
  if (data && (data.status === 'unavailable' || data.status === 'error' || data.status === 'failed')) {
    return data.error || data.message || fallback;
  }
  return null;
}

function formatChangeCount(fileCount: number) {
  return fileCount > 0 ? `${fileCount} 个文件` : '无变更';
}

function gitChangeLabel(diff: GitDiffSnapshot | null) {
  if (!diff) return 'No Git data';
  if (!diff.isRepository) return 'No Git repo';
  if (diff.isClean) return 'No changes';
  return `${diff.files.length} files`;
}

function gitSourceLabel(diff: GitDiffSnapshot, fallback: string) {
  if (!diff.isRepository) return diff.error || fallback;
  if (diff.lastAction?.type === 'commit') return `Committed ${diff.lastAction.sha || 'HEAD'}`;
  if (diff.lastAction?.type === 'push') return 'Pushed current branch';
  return 'Git working tree';
}

function applyGitDiffToData(data: WorkbenchMockData, diff: GitDiffSnapshot | null): WorkbenchMockData {
  if (!diff) return data;
  const files = Array.isArray(diff.files) ? diff.files : [];
  const diffSummary = diff.isRepository
    ? (diff.stat || diff.patch || (diff.isClean ? 'Working tree is clean.' : 'Git working tree has changes.'))
    : (diff.error || 'Current project is not a Git repository.');
  return {
    ...data,
    mockChanges: {
      ...data.mockChanges,
      insertions: Number(diff.insertions || 0),
      deletions: Number(diff.deletions || 0),
      diffSummary,
      patch: diff.patch || '',
      stat: diff.stat || '',
      files: files.map((file) => ({
        id: file.id || file.path,
        path: file.path,
        status: file.staged && !file.unstaged && !file.untracked ? 'staged' : 'unstaged',
        insertions: Number(file.insertions || 0),
        deletions: Number(file.deletions || 0),
        gitStatus: file.status,
        indexStatus: file.indexStatus,
        worktreeStatus: file.worktreeStatus,
        staged: file.staged,
        unstaged: file.unstaged,
        untracked: file.untracked,
        binary: file.binary,
        patch: file.patch || '',
      })),
    },
    environment: {
      ...data.environment,
      changes: gitChangeLabel(diff),
      branch: diff.branch || data.environment.branch,
      source: gitSourceLabel(diff, diffSummary),
    },
  };
}

function gitProjectActionPayload(state: WorkbenchState, extra: Record<string, unknown> = {}) {
  return {
    projectId: state.selectedTask?.projectId || state.data.activeProjectId,
    ...extra,
  };
}

function gitFileActionPayload(state: WorkbenchState, file: ChangeFileData, extra: Record<string, unknown> = {}) {
  return {
    ...gitProjectActionPayload(state),
    path: file.path,
    ...extra,
  };
}

function artifactActionPayload(state: WorkbenchState, extra: Record<string, unknown> = {}) {
  return {
    projectId: state.selectedTask?.projectId || state.data.activeProjectId,
    taskId: state.selectedTask?.id || state.data.activeTask.id,
    ...extra,
  };
}

function appendArtifactToData(data: WorkbenchMockData, artifact: ArtifactData): WorkbenchMockData {
  return {
    ...data,
    mockArtifacts: [artifact, ...data.mockArtifacts.filter((item) => item.id !== artifact.id)],
  };
}

function uniqueStrings(values: Array<string | undefined | null>) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function contextKindForPath(path: string, fallback: ContextSelectionKind = 'file'): ContextSelectionKind {
  if (fallback === 'directory') return 'directory';
  if (/\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(path)) return 'image';
  return fallback;
}

function normalizeContextItem(item: ContextSelectionItem): ContextItemData | null {
  const itemPath = String(item.path || '').trim();
  if (!itemPath) return null;
  return {
    path: itemPath,
    name: String(item.name || itemPath.split(/[\\/]/).pop() || itemPath),
    kind: contextKindForPath(itemPath, item.kind),
  };
}

function mergeContextItems(current: ContextItemData[], incoming: ContextSelectionItem[]) {
  const byPath = new Map(current.map((item) => [item.path, item]));
  for (const item of incoming) {
    const normalized = normalizeContextItem(item);
    if (normalized) byPath.set(normalized.path, normalized);
  }
  return Array.from(byPath.values());
}

function addContextItemsToData(data: WorkbenchMockData, items: ContextSelectionItem[]): WorkbenchMockData {
  if (!items.length) return data;
  const selectedFiles = [...data.mockContext.selectedFiles];
  const selectedDirectories = [...(data.mockContext.selectedDirectories || [])];
  const attachments = [...data.mockContext.attachments];

  for (const item of items) {
    const itemPath = String(item.path || '').trim();
    if (!itemPath) continue;
    const kind = contextKindForPath(itemPath, item.kind);
    if (kind === 'image') attachments.push(itemPath);
    else if (kind === 'directory') selectedDirectories.push(itemPath);
    else selectedFiles.push(itemPath);
  }

  const nextFiles = uniqueStrings(selectedFiles);
  const nextDirectories = uniqueStrings(selectedDirectories);
  const nextAttachments = uniqueStrings(attachments);
  const total = nextFiles.length + nextDirectories.length + nextAttachments.length;

  return {
    ...data,
    contextItems: mergeContextItems(data.contextItems || [], items),
    mockContext: {
      ...data.mockContext,
      summary: contextSummary(total),
      selectedFiles: nextFiles,
      selectedDirectories: nextDirectories,
      attachments: nextAttachments,
    },
  };
}

function removeContextItemFromData(data: WorkbenchMockData, itemPath: string): WorkbenchMockData {
  const nextFiles = data.mockContext.selectedFiles.filter((path) => path !== itemPath);
  const nextDirectories = (data.mockContext.selectedDirectories || []).filter((path) => path !== itemPath);
  const nextAttachments = data.mockContext.attachments.filter((path) => path !== itemPath);
  const total = nextFiles.length + nextDirectories.length + nextAttachments.length;
  return {
    ...data,
    contextItems: (data.contextItems || []).filter((item) => item.path !== itemPath),
    mockContext: {
      ...data.mockContext,
      summary: contextSummary(total),
      selectedFiles: nextFiles,
      selectedDirectories: nextDirectories,
      attachments: nextAttachments,
    },
  };
}

function clearContextFromData(data: WorkbenchMockData): WorkbenchMockData {
  return {
    ...data,
    contextItems: [],
    mockContext: {
      ...data.mockContext,
      summary: EMPTY_CONTEXT_SUMMARY,
      selectedFiles: [],
      selectedDirectories: [],
      attachments: [],
    },
  };
}

function droppedContextItems(files: FileList | File[]): ContextSelectionItem[] {
  return Array.from(files || []).map((file) => {
    const path = redouApi.pathForDroppedFile(file);
    const kind = contextKindForPath(path, file.type.startsWith('image/') ? 'image' : 'file');
    return {
      path,
      name: file.name,
      kind,
    };
  }).filter((item) => item.path);
}

async function buildContextPackageForTurn(state: WorkbenchState, userInput: string) {
  const project = state.data.projects.find((item) => item.id === state.data.activeProjectId);
  const selectedFiles = uniqueStrings([
    ...state.data.mockContext.selectedFiles,
    ...(state.data.mockContext.selectedDirectories || []),
  ]);
  const attachments = uniqueStrings(state.data.mockContext.attachments);
  const recentMessages = state.data.agentMessages.slice(-8).map((message) => `${message.role || 'assistant'}: ${message.body}`);
  const input = {
    projectId: state.data.activeProjectId,
    taskId: state.selectedTask?.id || state.data.activeTask.id,
    workspaceRoot: project?.rootPath,
    userInput,
    recentMessages,
    selectedFiles,
    attachments,
    environment: {
      cwd: project?.rootPath,
      runtime: state.data.activeTask.runtime,
    },
    metadata: {
      source: 'renderer-composer',
      contextItems: state.data.contextItems || [],
      selectedFiles: state.data.mockContext.selectedFiles || [],
      selectedDirectories: state.data.mockContext.selectedDirectories || [],
      attachments: state.data.mockContext.attachments || [],
    },
  };
  const result = await redouApi.previewContext(input);
  return result.ok && result.data ? result.data : input;
}

export function applyRuntimeSnapshotToData(data: WorkbenchMockData, snapshot: RuntimeSnapshot | null): WorkbenchMockData {
  if (!snapshot) return data;
  const hasMessages = Array.isArray(snapshot.messages);
  const hasProgressSteps = Array.isArray(snapshot.progressSteps);
  const hasPlanEntries = Array.isArray(snapshot.planEntries);
  const hasTodoProjectionEntries = Array.isArray(snapshot.todoProjectionEntries);
  const hasApprovalRequests = Array.isArray(snapshot.approvalRequests);
  const hasLogs = Array.isArray(snapshot.logs);
  const hasArtifacts = Array.isArray(snapshot.artifacts);
  const hasChangedFiles = Array.isArray(snapshot.changedFiles);
  const snapshotChangedFiles = hasChangedFiles ? snapshot.changedFiles || [] : null;
  const runtimeStatus = normalizeRuntimeStatus(snapshot.runtimeStatus);
  const projectedTaskStatus = runtimeStatus?.turnStatus ? mapTaskStatus(runtimeStatus.turnStatus) : null;
  return {
    ...data,
    activeTask: projectedTaskStatus
      ? { ...data.activeTask, status: projectedTaskStatus }
      : data.activeTask,
    projects: projectedTaskStatus
      ? data.projects.map((project) => ({
          ...project,
          tasks: project.tasks.map((task) => task.id === data.activeTask.id ? { ...task, status: projectedTaskStatus } : task),
        }))
      : data.projects,
    agentMessages: hasMessages
      ? snapshot.messages.filter((message) => message.role === 'user' || message.status === 'error' || String(message.body || '').trim()).map((message) => ({
          id: message.id,
          role: message.role === 'user' || message.role === 'system' ? message.role : 'assistant',
          body: message.body,
          timestamp: message.timestamp,
          processedDurationMs: typeof message.processedDurationMs === 'number' ? message.processedDurationMs : undefined,
          processedStatus: message.processedStatus,
          deliveryMode: message.deliveryMode,
          status: message.status,
          queueId: message.queueId ?? null,
          queueState: message.queueState ?? null,
          source: message.source ?? null,
          sourceEventId: message.sourceEventId,
          turnId: message.turnId ?? null,
          automation: message.automation ?? null,
          contextItems: Array.isArray(message.contextItems)
            ? message.contextItems
                .map((item) => normalizeContextItem(item as ContextSelectionItem))
                .filter((item): item is ContextItemData => Boolean(item))
            : [],
        }))
      : data.agentMessages,
    progressSteps: hasProgressSteps
      ? snapshot.progressSteps.map((step) => ({
          id: step.id,
          label: step.label,
          status: mapProgressStatus(step.status),
        }))
      : data.progressSteps,
    planEntries: hasPlanEntries
      ? snapshot.planEntries.map((entry) => ({
          id: entry.id,
          title: entry.title || entry.step || '',
          status: entry.status,
        }))
      : data.planEntries,
    todoProjectionEntries: hasTodoProjectionEntries
      ? snapshot.todoProjectionEntries
      : data.todoProjectionEntries,
    approvalRequests: hasApprovalRequests
      ? snapshot.approvalRequests.map((approval) => {
          const item = approval as { id?: string; taskId?: string | null; kind?: string; title?: string; description?: string; status?: string; payload?: unknown };
          return {
            id: item.id || '',
            taskId: item.taskId || null,
            kind: item.kind || 'unknown',
            title: item.title || 'Approval required',
            description: item.description || '',
            status: item.status || 'pending',
            payload: item.payload,
          };
        })
      : data.approvalRequests,
    mockChanges: snapshotChangedFiles !== null || snapshot.diffSummary !== undefined
      ? {
          ...data.mockChanges,
          insertions: 0,
          deletions: 0,
          diffSummary: snapshot.diffSummary || '',
          files: (snapshotChangedFiles || []).map((file) => ({
            id: file.id,
            path: file.path,
            status: file.status === 'completed' ? 'staged' : 'unstaged',
            insertions: 0,
            deletions: 0,
          })),
        }
      : data.mockChanges,
    mockLogs: hasLogs
      ? snapshot.logs.map((log) => ({
          id: log.id,
          level: mapLogLevel(log.level),
          time: log.time,
          message: log.message,
          kind: log.kind,
          lifecycle: log.lifecycle,
          command: log.command,
          output: log.output,
        }))
      : data.mockLogs,
    mockArtifacts: hasArtifacts ? (snapshot.artifacts || []).map(normalizeArtifactSnapshot) : data.mockArtifacts,
    runtimeStatus: runtimeStatus || data.runtimeStatus || null,
    environment: snapshot.environmentInfo
      ? {
          ...data.environment,
          changes: snapshotChangedFiles !== null ? formatChangeCount(snapshotChangedFiles.length) : data.environment.changes,
          runtime: String(snapshot.environmentInfo.runtime || data.environment.runtime),
          source: String(snapshot.environmentInfo.source || data.environment.source),
          threadId: snapshot.environmentInfo.threadId ? String(snapshot.environmentInfo.threadId) : data.environment.threadId,
          turnId: snapshot.environmentInfo.turnId ? String(snapshot.environmentInfo.turnId) : data.environment.turnId,
        }
      : data.environment,
  };
}

function appendRuntimeErrorLog(data: WorkbenchMockData, message: string): WorkbenchMockData {
  return {
    ...data,
    environment: { ...data.environment, mode: 'Unavailable', source: message },
    mockLogs: [
      ...data.mockLogs,
      {
        id: `runtime-error-${Date.now()}`,
        level: 'warn',
        time: new Date().toLocaleTimeString(),
        message,
      },
    ],
  };
}

function appendRuntimeErrorMessage(data: WorkbenchMockData, message: string): WorkbenchMockData {
  const id = `runtime-error-message-${Date.now()}`;
  if (data.agentMessages.some((item) => item.status === 'error' && item.body === message)) return data;
  return {
    ...data,
    agentMessages: [
      ...data.agentMessages,
      {
        id,
        role: 'system',
        body: message,
        status: 'error',
      },
    ],
  };
}

function appendRuntimeErrorFeedback(data: WorkbenchMockData, message: string): WorkbenchMockData {
  return appendRuntimeErrorMessage(appendRuntimeErrorLog(data, message), message);
}

function resetThreadProjection(data: WorkbenchMockData): WorkbenchMockData {
  return {
    ...data,
    agentMessages: [],
    progressSteps: [],
    planEntries: [],
    todoProjectionEntries: [],
    approvalRequests: [],
    mockLogs: [],
    mockArtifacts: [],
    mockContext: { ...data.mockContext, recentMessages: [] },
    mockChanges: { ...data.mockChanges, files: [], insertions: 0, deletions: 0, diffSummary: '' },
    environment: { ...data.environment, changes: '无变更' },
    runtimeStatus: null,
  };
}

function projectResultError(result: { ok: boolean; error?: { message?: string } | null }, fallback: string) {
  return result.ok ? null : result.error?.message || fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function runtimeEventFromSubscription(payload: unknown): Record<string, unknown> | null {
  const envelope = asRecord(payload);
  const event = Object.prototype.hasOwnProperty.call(envelope, 'data') ? envelope.data : payload;
  if (!event || typeof event !== 'object') return null;
  return event as Record<string, unknown>;
}

function runtimeEventTaskId(event: Record<string, unknown> | null): string {
  if (!event) return '';
  const payload = asRecord(event.payload);
  const metadata = asRecord(event.metadata);
  return String(event.taskId || payload.taskId || metadata.taskId || '');
}

function runtimeEventProjectedTaskStatus(event: Record<string, unknown> | null): WorkbenchTaskStatus | null {
  if (!event) return null;
  const payload = asRecord(event.payload);
  const metadata = asRecord(event.metadata);
  const turn = asRecord(payload.turn);
  const compatibility = asRecord(payload.compatibility);
  const stopReason = asRecord(payload.stopReason);
  const method = String(metadata.redouCodexMethod || '');
  const type = String(event.type || '');

  if (method === 'turn/started') return 'running';
  if (method === 'turn/completed') {
    const compatibilityStatus = String(metadata.redouCodexStopStatus || compatibility.status || stopReason.status || '');
    if (compatibilityStatus === 'waiting_approval') return 'waiting_approval';
    if (compatibilityStatus === 'incomplete') return 'degraded';
    return mapTaskStatus(String(turn.status || payload.status || event.message || 'completed'));
  }
  if (type === 'runtime_error') return 'error';
  if (type === 'queue_update') {
    const queueState = String(metadata.queueState || payload.queueState || '');
    if (queueState === 'started') return 'running';
  }
  return null;
}

function mergeRuntimeTaskRefresh(
  state: WorkbenchState,
  refreshedTask: WorkbenchTask,
  projectedStatus: WorkbenchTaskStatus | null,
  markUnread: boolean,
): WorkbenchState {
  const taskId = refreshedTask.id;
  const location = findTaskLocation(state.data.projects, taskId);
  const isOpen = state.selectedTask?.id === taskId || state.data.activeTask.id === taskId;
  const nextTask: WorkbenchTask = {
    ...(location?.task || {}),
    ...refreshedTask,
    ...(projectedStatus ? { status: projectedStatus } : {}),
    unread: isOpen ? false : markUnread ? true : Boolean(location?.task.unread || refreshedTask.unread),
  };
  const data = location
    ? updateTaskProjection(state.data, nextTask)
    : { ...state.data, projects: insertTaskIntoProjects(state.data.projects, nextTask) };
  return {
    ...state,
    selectedTask: state.selectedTask?.id === taskId ? nextTask : state.selectedTask,
    data,
  };
}

function shouldMarkRuntimeTaskUnread(state: WorkbenchState, taskId: string, status: WorkbenchTaskStatus | null) {
  if (status !== 'completed') return false;
  if (state.selectedTask?.id === taskId || state.data.activeTask.id === taskId) return false;
  const location = findTaskLocation(state.data.projects, taskId);
  return !location?.task.unread;
}

function upsertProject(projects: WorkbenchProject[], project: WorkbenchProject) {
  const index = projects.findIndex((item) => item.id === project.id);
  if (index === -1) return [project, ...projects];
  return projects.map((item) => (item.id === project.id ? { ...project, tasks: project.tasks.length ? project.tasks : item.tasks } : item));
}

function replaceProject(projects: WorkbenchProject[], projectId: string, updater: (project: WorkbenchProject) => WorkbenchProject) {
  return projects.map((project) => (project.id === projectId ? updater(project) : project));
}

function reorderProjectsByIds(projects: WorkbenchProject[], orderedProjectIds: string[]) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const scopedIds = orderedProjectIds.filter((projectId, index, list) => (
    projectById.has(projectId) && list.indexOf(projectId) === index
  ));
  if (scopedIds.length < 2) return projects;
  const scopedSet = new Set(scopedIds);
  const nextScopedIds = [...scopedIds];
  const nextProjects = projects.map((project) => (
    scopedSet.has(project.id) ? projectById.get(nextScopedIds.shift() || project.id) || project : project
  ));
  return nextProjects.map((project, index) => ({ ...project, sortOrder: index }));
}

function projectIdsChanged(left: WorkbenchProject[], right: WorkbenchProject[]) {
  if (left.length !== right.length) return true;
  return left.some((project, index) => project.id !== right[index]?.id);
}

function findTaskLocation(projects: WorkbenchProject[], taskId: string) {
  for (const project of projects) {
    const task = project.tasks.find((item) => item.id === taskId);
    if (task) return { project, task };
  }
  return null;
}

function replaceTask(projects: WorkbenchProject[], taskId: string, updater: (task: WorkbenchTask, project: WorkbenchProject) => WorkbenchTask) {
  return projects.map((project) => ({
    ...project,
    tasks: project.tasks.map((task) => (task.id === taskId ? updater(task, project) : task)).sort(compareTasks),
  }));
}

function insertTaskIntoProjects(projects: WorkbenchProject[], task: WorkbenchTask) {
  const projectId = task.projectId || projects[0]?.id || 'default-workspace';
  const restoredTask = { ...task, projectId, archived: false, archivedAt: null };
  let matched = false;
  const nextProjects = projects.map((project) => {
    if (project.id !== projectId) return project;
    matched = true;
    const tasks = project.tasks.some((item) => item.id === task.id)
      ? project.tasks.map((item) => (item.id === task.id ? restoredTask : item))
      : [restoredTask, ...project.tasks];
    return { ...project, tasks: tasks.sort(compareTasks) };
  });
  if (matched) return nextProjects;
  return [
    {
      id: projectId,
      name: projectId,
      tasks: [restoredTask],
    },
    ...nextProjects,
  ];
}

function updateTaskProjection(data: WorkbenchMockData, updatedTask: WorkbenchTask): WorkbenchMockData {
  return {
    ...data,
    activeTask: data.activeTask.id === updatedTask.id ? { ...data.activeTask, ...updatedTask } : data.activeTask,
    projects: data.projects.map((project) => ({
      ...project,
      tasks: project.tasks.map((task) => (task.id === updatedTask.id ? { ...task, ...updatedTask } : task)).sort(compareTasks),
    })),
  };
}

function updateTaskUnreadProjection(data: WorkbenchMockData, taskId: string, unread: boolean): WorkbenchMockData {
  return {
    ...data,
    activeTask: data.activeTask.id === taskId ? { ...data.activeTask, unread } : data.activeTask,
    projects: replaceTask(data.projects, taskId, (task) => ({ ...task, unread })),
  };
}

function updateQueuedMessageProjection(
  data: WorkbenchMockData,
  queueId: string,
  updater: (message: AgentThreadMessage) => AgentThreadMessage | null,
): WorkbenchMockData {
  return {
    ...data,
    agentMessages: data.agentMessages.flatMap((message) => {
      if (message.queueId !== queueId && message.id !== queueId) return [message];
      const next = updater(message);
      return next ? [next] : [];
    }),
  };
}

function updateEditedUserPromptProjection(data: WorkbenchMockData, target: ComposerEditTarget, prompt: string): WorkbenchMockData {
  const taskId = target.taskId || data.activeTask.id;
  const updateTask = (task: WorkbenchTask) => ({
    ...task,
    userPrompt: prompt,
    title: target.isInitialPrompt || shouldReplaceBlankTitle(task) ? titleFromPrompt(prompt) : task.title,
  });
  return {
    ...data,
    activeTask: data.activeTask.id === taskId ? updateTask(data.activeTask) : data.activeTask,
    agentMessages: data.agentMessages.map((message) => (
      message.id === target.messageId ? { ...message, body: prompt } : message
    )),
    projects: data.projects.map((project) => ({
      ...project,
      tasks: project.tasks.map((task) => (task.id === taskId ? updateTask(task) : task)).sort(compareTasks),
    })),
  };
}

function firstProjectTask(project?: WorkbenchProject | null) {
  return project?.tasks[0] || null;
}

function titleFromPrompt(input: string) {
  const title = input.trim().replace(/\s+/g, ' ');
  return title ? title.slice(0, 80) : '新对话';
}

function shouldReplaceBlankTitle(task: WorkbenchTask) {
  return !task.userPrompt && (!task.title || task.title === '新对话' || task.title === 'Untitled task' || task.title === 'New redou-codex task');
}

function taskForProject(state: WorkbenchState, projectId: string) {
  if (state.selectedTask?.projectId === projectId) return state.selectedTask;
  const project = state.data.projects.find((item) => item.id === projectId);
  return project?.tasks.find((task) => task.id === state.data.activeTask.id) || project?.tasks[0] || null;
}

function taskConversationId(task: WorkbenchTask) {
  return task.redouCodexThreadId || task.id;
}

function taskDeepLink(project: WorkbenchProject, task: WorkbenchTask) {
  const params = new URLSearchParams({
    projectId: project.id,
    taskId: task.id,
  });
  return `redou-agent://thread/${encodeURIComponent(taskConversationId(task))}?${params.toString()}`;
}

function branchSlug(input: string) {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/\/+/g, '/')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned || `conversation-${Date.now()}`;
}

async function writeClipboardText(text: string) {
  const result = await redouApi.copyText(text);
  if (result.ok) return null;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return null;
  }
  return result.error?.message || 'Failed to copy text';
}

export function getNextRightPanelState(
  state: Pick<WorkbenchState, 'activeRightPanel' | 'rightPanelOpen'>,
  panel: RightPanelId,
): Pick<WorkbenchState, 'activeRightPanel' | 'rightPanelOpen'> {
  if (state.activeRightPanel === panel) {
    return {
      activeRightPanel: panel,
      rightPanelOpen: !state.rightPanelOpen,
    };
  }

  return {
    activeRightPanel: panel,
    rightPanelOpen: true,
  };
}

export function useWorkbenchStore(): { state: WorkbenchState; actions: WorkbenchActions } {
  const [state, setState] = useState<WorkbenchState>(initialWorkbenchState);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  function persistTaskUnread(taskId: string, unread: boolean) {
    if (!hasRealRedouApi()) return;
    void redouApi.updateTask({ id: taskId, metadata: { unread } }).then((result) => {
      const error = projectResultError(result, 'Failed to update read status');
      if (!error) return;
      setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
    });
  }

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      if (!hasRealRedouApi()) return;
      try {
        const [runtimes, availability, projectsResult, modelConfigResult, appSettingsResult, archivedTasksResult] = await Promise.all([
          redouApi.listRuntimes(),
          redouApi.getRuntimeAvailability('redou-codex'),
          redouApi.listProjects(),
          redouApi.listModelConfigs(),
          redouApi.getAppSettings(),
          redouApi.listArchivedTasks(),
        ]);
        const projects = (projectsResult.data || []) as Array<Record<string, unknown>>;
        const normalizedProjects = projects.length ? projects : [{ id: 'default-workspace', name: 'Default workspace' }];
        const projectTasks = await Promise.all(normalizedProjects.map(async (project) => {
          const tasksResult = await redouApi.listTasks(String(project.id || ''));
          return ((tasksResult.data || []) as Array<Record<string, unknown>>).map(mapTask);
        }));
        const route = initialRouteSelection();
        const routeTaskProjectIndex = route.taskId
          ? projectTasks.findIndex((tasks) => tasks.some((task) => task.id === route.taskId))
          : -1;
        const routeProjectIndex = route.projectId
          ? normalizedProjects.findIndex((project) => String(project.id || '') === route.projectId)
          : -1;
        const activeProjectIndex = routeTaskProjectIndex >= 0
          ? routeTaskProjectIndex
          : routeProjectIndex >= 0
            ? routeProjectIndex
            : 0;
        const activeProject = normalizedProjects[activeProjectIndex] || normalizedProjects[0];
        const tasks = projectTasks[activeProjectIndex] || projectTasks[0] || [];
        const activeTask = route.taskId ? tasks.find((task) => task.id === route.taskId) || tasks[0] || null : tasks[0] || null;
        const openedActiveTask = activeTask?.unread ? { ...activeTask, unread: false } : activeTask;
        if (cancelled) return;
        const runtimeList = Array.isArray(runtimes.data) ? runtimes.data as Array<{ id?: string }> : [];
        const redouCodexDescriptor = runtimeList.find((runtime) => runtime.id === 'redou-codex') || null;
        const availabilityData = (availability.data || redouCodexDescriptor) as { available?: boolean; lastError?: { message?: string } } | null;
        const availabilityError = availabilityData?.lastError?.message || (!availability.ok ? availability.error?.message : null) || null;
        const activeProjectId = String(activeProject.id || 'default-workspace');
        const displayTask = openedActiveTask || createEmptyTask(activeProjectId);
        let mappedProjects = normalizedProjects.map((project, index) => mapProject(project, projectTasks[index] || []));
        if (activeTask?.unread) {
          mappedProjects = updateTaskUnreadProjection({ ...initialWorkbenchData, projects: mappedProjects }, activeTask.id, false).projects;
          persistTaskUnread(activeTask.id, false);
        }
        const archivedTasks = ((archivedTasksResult.data || []) as Array<Record<string, unknown>>).map(mapTask);
        const modelConfig = normalizeModelConfigSnapshot(modelConfigResult.data);
        const appSettings = normalizeAppSettingsSnapshot(appSettingsResult.data);
        const [gitDiffResult, artifactsResult] = await Promise.all([
          redouApi.getGitDiff({ projectId: activeProjectId }),
          redouApi.listArtifacts({ projectId: activeProjectId, taskId: activeTask?.id }),
        ]);
        const gitDiff = gitDiffResult.ok && gitDiffResult.data ? gitDiffResult.data : null;
        const artifacts = artifactsResult.ok && artifactsResult.data ? artifactsResult.data.map(normalizeArtifactSnapshot) : [];
        if (cancelled) return;
        const preferredPermissionMode = resolveComposerPermissionMode(appSettings);
        writeStoredComposerPermissionMode(preferredPermissionMode);
        setState((current) => {
          const nextData: WorkbenchMockData = {
            ...current.data,
            projects: mappedProjects,
            activeProjectId,
            activeTask: displayTask,
            agentMessages: [],
            progressSteps: [],
            planEntries: [],
            todoProjectionEntries: [],
            approvalRequests: [],
            mockLogs: [],
            mockArtifacts: artifacts,
            mockChanges: { ...current.data.mockChanges, files: [], insertions: 0, deletions: 0, diffSummary: '' },
            runtimeStatus: null,
            browser: {
              ...current.data.browser,
              homeUrl: appSettings.browser.homeUrl,
              url: current.data.browser.url || appSettings.browser.homeUrl,
            },
            environment: {
              ...current.data.environment,
              changes: '无变更',
              mode: availabilityError ? 'Unavailable' : 'Local',
              runtime: 'redou-codex',
              source: availabilityError || 'redou-codex app-server',
            },
          };
          const draftKey = taskDraftKey(activeProjectId, activeTask || displayTask);
          const draft = current.conversationDrafts[draftKey] || emptyConversationDraft();
          const dataWithModelConfig = applyConversationDraftToData(
            applyGitDiffToData(applyModelConfigToData(applyComposerPermissionModeToData(nextData, preferredPermissionMode), modelConfig), gitDiff),
            draft,
          );
          return {
            ...current,
            apiMode: 'ipc',
            runtimeAvailability: availability.data || redouCodexDescriptor,
            runtimeError: availabilityError,
            modelConfig,
            appSettings: {
              ...appSettings,
              composer: {
                ...appSettings.composer,
                permissionMode: preferredPermissionMode,
              },
            },
            archivedTasks,
            selectedTask: openedActiveTask,
            composerInput: draft.input,
            composerEditTarget: null,
            conversationDrafts: {
              ...current.conversationDrafts,
              [draftKey]: draft,
            },
            expandedProjectIds: activeProjectId ? [activeProjectId] : [],
            data: availabilityError ? appendRuntimeErrorLog(dataWithModelConfig, availabilityError) : dataWithModelConfig,
          };
        });
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setState((current) => ({
          ...current,
          apiMode: 'ipc',
          runtimeError: message,
          selectedTask: null,
          composerInput: '',
          composerEditTarget: null,
          data: applyConversationDraftToData(appendRuntimeErrorLog({
            ...current.data,
            activeTask: createEmptyTask(current.data.activeProjectId),
          }, message), emptyConversationDraft()),
        }));
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasRealRedouApi() || !state.selectedTask?.id) return undefined;
    let cancelled = false;
    const taskId = state.selectedTask.id;
    const projectId = state.selectedTask.projectId || state.data.activeProjectId;
    const pullSnapshot = async () => {
      const [result, taskResult, gitDiffResult, artifactsResult] = await Promise.all([
        redouApi.getSnapshot(taskId),
        redouApi.getTask(taskId),
        redouApi.getGitDiff({ projectId }),
        redouApi.listArtifacts({ projectId, taskId }),
      ]);
      if (cancelled || !result.data) return;
      const runtimeStatus = normalizeRuntimeStatus(result.data.runtimeStatus);
      const projectedTaskStatus = runtimeStatus?.turnStatus ? mapTaskStatus(runtimeStatus.turnStatus) : null;
      const snapshotError = runtimeStatus?.lastError?.message || null;
      const refreshedTask = taskResult.ok && taskResult.data ? mapTask(taskResult.data as Record<string, unknown>) : null;
      const projectedRefreshedTask = refreshedTask && projectedTaskStatus
        ? { ...refreshedTask, status: projectedTaskStatus }
        : refreshedTask;
      const openedRefreshedTask = projectedRefreshedTask ? { ...projectedRefreshedTask, unread: false } : null;
      if (projectedRefreshedTask?.unread) persistTaskUnread(taskId, false);
      const gitDiff = gitDiffResult.ok && gitDiffResult.data ? gitDiffResult.data : null;
      const artifacts = artifactsResult.ok && artifactsResult.data ? artifactsResult.data.map(normalizeArtifactSnapshot) : null;
      setState((current) => ({
        ...current,
        selectedTask: openedRefreshedTask && current.selectedTask?.id === taskId ? openedRefreshedTask : current.selectedTask,
        data: (() => {
          const taskData = openedRefreshedTask && current.data.activeTask.id === taskId
            ? updateTaskProjection(current.data, openedRefreshedTask)
            : current.data;
          const runtimeData = applyRuntimeSnapshotToData(taskData, result.data);
          const artifactData = artifacts ? { ...runtimeData, mockArtifacts: artifacts } : runtimeData;
          return applyGitDiffToData(artifactData, gitDiff);
        })(),
        runtimeError: snapshotError,
        redouCodexPlan: (result.data?.planEntries || []).map((entry) => ({
          id: entry.id,
          title: entry.title || entry.step || '',
          status: entry.status,
        })),
      }));
    };
    pullSnapshot();
    const timer = window.setInterval(pullSnapshot, 1000);
    const unsubscribe = redouApi.subscribeEvents(taskId, (event) => {
      const eventTaskId = runtimeEventTaskId(runtimeEventFromSubscription(event));
      if (!eventTaskId || eventTaskId === taskId) void pullSnapshot();
    });
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [state.selectedTask?.id, state.selectedTask?.projectId, state.data.activeProjectId]);

  useEffect(() => {
    if (!hasRealRedouApi()) return undefined;
    let cancelled = false;
    let timer: number | null = null;
    const pendingTaskStatuses = new Map<string, WorkbenchTaskStatus | null>();

    async function refreshPendingTasks() {
      const entries = Array.from(pendingTaskStatuses.entries());
      pendingTaskStatuses.clear();
      await Promise.all(entries.map(async ([taskId, projectedStatus]) => {
        const result = await redouApi.getTask(taskId);
        if (cancelled || !result.ok || !result.data) return;
        const refreshedTask = mapTask(result.data as Record<string, unknown>);
        const status = projectedStatus || refreshedTask.status;
        const current = stateRef.current;
        const markUnread = shouldMarkRuntimeTaskUnread(current, taskId, status);
        const shouldClearOpenUnread = Boolean((current.selectedTask?.id === taskId || current.data.activeTask.id === taskId) && refreshedTask.unread);
        setState((snapshot) => mergeRuntimeTaskRefresh(snapshot, refreshedTask, projectedStatus, markUnread));
        if (markUnread) persistTaskUnread(taskId, true);
        if (shouldClearOpenUnread) persistTaskUnread(taskId, false);
      }));
    }

    function scheduleTaskRefresh(taskId: string, projectedStatus: WorkbenchTaskStatus | null) {
      pendingTaskStatuses.set(taskId, projectedStatus || pendingTaskStatuses.get(taskId) || null);
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void refreshPendingTasks();
      }, 180);
    }

    const unsubscribe = redouApi.subscribeEvents(undefined, (payload) => {
      const event = runtimeEventFromSubscription(payload);
      const taskId = runtimeEventTaskId(event);
      if (!taskId) return;
      scheduleTaskRefresh(taskId, runtimeEventProjectedTaskStatus(event));
    });
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  const actions = useMemo<WorkbenchActions>(
    () => ({
      selectRightPanel(panel) {
        setState((current) => ({
          ...current,
          ...getNextRightPanelState(current, panel),
        }));
      },
      selectView(view) {
        setState((current) => ({
          ...current,
          activeView: view,
        }));
      },
      selectProject(projectId) {
        const projectLocation = state.data.projects.find((item) => item.id === projectId);
        const taskToMarkRead = projectLocation?.tasks[0];
        if (taskToMarkRead?.unread) persistTaskUnread(taskToMarkRead.id, false);
        setState((current) => {
          const project = current.data.projects.find((item) => item.id === projectId);
          const task = project?.tasks[0] || null;
          const openedTask = task?.unread ? { ...task, unread: false } : task;
          const displayTask = openedTask || createEmptyTask(projectId);
          const nextDrafts = updateActiveConversationDraft(current, current.data, current.composerInput);
          const targetDraftKey = taskDraftKey(projectId, openedTask || displayTask);
          const targetDraft = nextDrafts[targetDraftKey] || emptyConversationDraft();
          return {
            ...current,
            activeView: 'thread',
            selectedTask: openedTask,
            composerInput: targetDraft.input,
            composerEditTarget: null,
            conversationDrafts: {
              ...nextDrafts,
              [targetDraftKey]: targetDraft,
            },
            expandedProjectIds: Array.from(new Set([...current.expandedProjectIds, projectId])),
            data: activateConversationData({
              ...current.data,
              projects: task?.unread ? updateTaskUnreadProjection(current.data, task.id, false).projects : current.data.projects,
              activeProjectId: projectId,
              activeTask: displayTask,
              composer: {
                ...current.data.composer,
                workspace: project?.name || current.data.composer.workspace,
              },
            }, targetDraft),
          };
        });
      },
      selectTask(taskId) {
        const taskToMarkRead = findTaskLocation(state.data.projects, taskId)?.task;
        if (taskToMarkRead?.unread) persistTaskUnread(taskId, false);
        setState((current) => {
          for (const project of current.data.projects) {
            const task = project.tasks.find((item) => item.id === taskId);
            if (task) {
              const openedTask = task.unread ? { ...task, unread: false } : task;
              const nextDrafts = updateActiveConversationDraft(current, current.data, current.composerInput);
              const targetDraftKey = taskDraftKey(project.id, openedTask);
              const targetDraft = nextDrafts[targetDraftKey] || emptyConversationDraft();
              return {
                ...current,
                activeView: 'thread',
                selectedTask: openedTask,
                composerInput: targetDraft.input,
                composerEditTarget: null,
                conversationDrafts: {
                  ...nextDrafts,
                  [targetDraftKey]: targetDraft,
                },
                expandedProjectIds: Array.from(new Set([...current.expandedProjectIds, project.id])),
                data: activateConversationData({
                  ...current.data,
                  projects: task.unread ? updateTaskUnreadProjection(current.data, task.id, false).projects : current.data.projects,
                  activeProjectId: project.id,
                  activeTask: openedTask,
                  composer: {
                    ...current.data.composer,
                    workspace: project.name,
                  },
                }, targetDraft),
              };
            }
          }
          return current;
        });
      },
      closeRightPanel() {
        setState((current) => ({
          ...current,
          rightPanelOpen: false,
        }));
      },
      collapseAllProjects() {
        setState((current) => ({
          ...current,
          expandedProjectIds: [],
        }));
      },
      toggleProjectExpanded(projectId) {
        setState((current) => ({
          ...current,
          expandedProjectIds: current.expandedProjectIds.includes(projectId)
            ? current.expandedProjectIds.filter((id) => id !== projectId)
            : Array.from(new Set([...current.expandedProjectIds, projectId])),
        }));
      },
      async createConversationInProject(projectId) {
        const localProject = state.data.projects.find((project) => project.id === projectId);
        if (!localProject) return;
        if (!hasRealRedouApi()) {
          const task = createNewConversationTask(projectId);
          setState((current) => ({
            ...current,
            activeView: 'thread',
            selectedTask: task,
            composerInput: '',
            conversationDrafts: {
              ...updateActiveConversationDraft(current, current.data, current.composerInput),
              [taskDraftKey(projectId, task)]: emptyConversationDraft(),
            },
            runtimeError: null,
            expandedProjectIds: Array.from(new Set([...current.expandedProjectIds, projectId])),
            data: activateConversationData({
              ...current.data,
              activeProjectId: projectId,
              activeTask: task,
              projects: replaceProject(current.data.projects, projectId, (project) => ({
                ...project,
                tasks: [task, ...project.tasks],
              })),
              composer: {
                ...current.data.composer,
                workspace: localProject.name,
              },
            }),
          }));
          return;
        }

        const created = await redouApi.createTask({
          projectId,
          title: '新对话',
          userInput: '',
          runtime: 'redou-codex',
          metadata: { createdFrom: 'project-new-conversation' },
        });
        if (!created.ok || !created.data) {
          const error = created.error?.message || 'Failed to create conversation';
          setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
          return;
        }
        const task = mapTask(created.data as Record<string, unknown>);
        setState((current) => {
          const project = current.data.projects.find((item) => item.id === projectId);
          const targetDraftKey = taskDraftKey(projectId, task);
          const targetDraft = emptyConversationDraft();
          return {
            ...current,
            activeView: 'thread',
            selectedTask: task,
            composerInput: '',
            conversationDrafts: {
              ...updateActiveConversationDraft(current, current.data, current.composerInput),
              [targetDraftKey]: targetDraft,
            },
            runtimeError: null,
            expandedProjectIds: Array.from(new Set([...current.expandedProjectIds, projectId])),
            data: activateConversationData({
              ...current.data,
              activeProjectId: projectId,
              activeTask: task,
              projects: replaceProject(current.data.projects, projectId, (item) => ({
                ...item,
                tasks: [task, ...item.tasks.filter((existing) => existing.id !== task.id)],
              })),
              composer: {
                ...current.data.composer,
                workspace: project?.name || localProject.name,
              },
            }, targetDraft),
          };
        });
      },
      async createBlankProject(name) {
        const result = await redouApi.createBlankProject({ name });
        const error = projectResultError(result, 'Failed to create blank project');
        if (error || !result.data) {
          setState((current) => ({ ...current, runtimeError: error || 'Failed to create blank project', data: appendRuntimeErrorLog(current.data, error || 'Failed to create blank project') }));
          return;
        }
        const project = mapProject(result.data as Record<string, unknown>, []);
        const displayTask = createEmptyTask(project.id);
        setState((current) => ({
          ...current,
          activeView: 'thread',
          selectedTask: null,
          composerInput: '',
          conversationDrafts: {
            ...updateActiveConversationDraft(current, current.data, current.composerInput),
            [taskDraftKey(project.id, displayTask)]: emptyConversationDraft(),
          },
          runtimeError: null,
          expandedProjectIds: Array.from(new Set([project.id, ...current.expandedProjectIds])),
          data: activateConversationData({
            ...current.data,
            projects: upsertProject(current.data.projects, project),
            activeProjectId: project.id,
            activeTask: displayTask,
            composer: {
              ...current.data.composer,
              workspace: project.name,
            },
          }),
        }));
      },
      async createProjectFromFolder() {
        const result = await redouApi.selectProjectFolder();
        const error = projectResultError(result, 'Failed to select project folder');
        if (error) {
          setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
          return;
        }
        if (!result.data) return;
        const project = mapProject(result.data as Record<string, unknown>, []);
        const displayTask = project.tasks[0] || createEmptyTask(project.id);
        const targetDraftKey = taskDraftKey(project.id, project.tasks[0] || displayTask);
        const targetDraft = emptyConversationDraft();
        setState((current) => ({
          ...current,
          activeView: 'thread',
          selectedTask: project.tasks[0] || null,
          composerInput: targetDraft.input,
          conversationDrafts: {
            ...updateActiveConversationDraft(current, current.data, current.composerInput),
            [targetDraftKey]: targetDraft,
          },
          runtimeError: null,
          expandedProjectIds: Array.from(new Set([project.id, ...current.expandedProjectIds])),
          data: activateConversationData({
            ...current.data,
            projects: upsertProject(current.data.projects, project),
            activeProjectId: project.id,
            activeTask: displayTask,
            composer: {
              ...current.data.composer,
              workspace: project.name,
            },
          }, targetDraft),
        }));
      },
      async toggleProjectPinned(projectId) {
        const project = state.data.projects.find((item) => item.id === projectId);
        if (!project) return;
        const pinned = !project.pinned;
        if (hasRealRedouApi()) {
          const result = await redouApi.updateProject({ id: projectId, metadata: { pinned } });
          const error = projectResultError(result, 'Failed to update project');
          if (error) {
            setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
            return;
          }
        }
        setState((current) => ({
          ...current,
          data: {
            ...current.data,
            projects: replaceProject(current.data.projects, projectId, (item) => ({ ...item, pinned })),
          },
        }));
      },
      async reorderProjects(orderedProjectIds) {
        const nextProjects = reorderProjectsByIds(state.data.projects, orderedProjectIds);
        if (!projectIdsChanged(state.data.projects, nextProjects)) return;
        setState((current) => ({
          ...current,
          data: {
            ...current.data,
            projects: reorderProjectsByIds(current.data.projects, orderedProjectIds),
          },
        }));
        if (!hasRealRedouApi()) return;
        const results = await Promise.all(nextProjects.map((project, index) => (
          redouApi.updateProject({ id: project.id, metadata: { sortOrder: index } })
        )));
        const failed = results.find((result) => !result.ok);
        if (failed) {
          const error = projectResultError(failed, 'Failed to reorder projects');
          if (error) setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
        }
      },
      async openProjectFolder(projectId) {
        const project = state.data.projects.find((item) => item.id === projectId);
        if (!project?.rootPath) return;
        const result = await redouApi.openProjectFolder(projectId);
        const error = projectResultError(result, 'Failed to open project folder');
        if (error) {
          setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
        }
      },
      async renameProject(projectId) {
        const project = state.data.projects.find((item) => item.id === projectId);
        if (!project) return;
        const name = window.prompt('项目名称', project.name);
        if (name === null) return;
        const trimmed = name.trim();
        if (!trimmed || trimmed === project.name) return;
        if (hasRealRedouApi()) {
          const result = await redouApi.updateProject({ id: projectId, name: trimmed });
          const error = projectResultError(result, 'Failed to rename project');
          if (error) {
            setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
            return;
          }
        }
        setState((current) => ({
          ...current,
          data: {
            ...current.data,
            activeProjectId: current.data.activeProjectId,
            projects: replaceProject(current.data.projects, projectId, (item) => ({ ...item, name: trimmed })),
            composer: current.data.activeProjectId === projectId
              ? { ...current.data.composer, workspace: trimmed }
              : current.data.composer,
          },
        }));
      },
      async archiveProjectConversation(projectId) {
        const task = taskForProject(state, projectId);
        if (!task || task.id === 'new-redou-codex-task') return;
        if (hasRealRedouApi()) {
          const result = await redouApi.archiveTask(task.id);
          const error = projectResultError(result, 'Failed to archive conversation');
          if (error) {
            setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
            return;
          }
        }
        setState((current) => {
          const currentProject = current.data.projects.find((project) => project.id === projectId);
          const remainingTasks = (currentProject?.tasks || []).filter((item) => item.id !== task.id);
          const archivedSelectedTask = current.selectedTask?.id === task.id;
          const nextTask = archivedSelectedTask ? firstProjectTask({ ...currentProject, tasks: remainingTasks }) : current.selectedTask;
          const activeTask = current.data.activeTask.id === task.id
            ? nextTask || createEmptyTask(projectId)
            : current.data.activeTask;
          const nextDrafts = updateActiveConversationDraft(current, current.data, current.composerInput);
          const targetDraftKey = taskDraftKey(projectId, nextTask || activeTask);
          const targetDraft = nextDrafts[targetDraftKey] || emptyConversationDraft();
          return {
            ...current,
            selectedTask: archivedSelectedTask ? nextTask : current.selectedTask,
            composerInput: targetDraft.input,
            conversationDrafts: {
              ...nextDrafts,
              [targetDraftKey]: targetDraft,
            },
            data: activateConversationData({
              ...current.data,
              activeTask,
              projects: replaceProject(current.data.projects, projectId, (project) => ({
                ...project,
                tasks: project.tasks.filter((item) => item.id !== task.id),
              })),
            }, targetDraft),
          };
        });
      },
      async toggleTaskPinned(taskId) {
        const location = findTaskLocation(state.data.projects, taskId);
        if (!location) return;
        const pinned = !location.task.pinned;
        if (hasRealRedouApi()) {
          const result = await redouApi.updateTask({ id: taskId, metadata: { pinned } });
          const error = projectResultError(result, 'Failed to update conversation');
          if (error) {
            setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
            return;
          }
        }
        setState((current) => ({
          ...current,
          selectedTask: current.selectedTask?.id === taskId ? { ...current.selectedTask, pinned } : current.selectedTask,
          data: {
            ...current.data,
            activeTask: current.data.activeTask.id === taskId ? { ...current.data.activeTask, pinned } : current.data.activeTask,
            projects: replaceTask(current.data.projects, taskId, (task) => ({ ...task, pinned })),
          },
        }));
      },
      async renameTaskConversation(taskId) {
        const location = findTaskLocation(state.data.projects, taskId);
        if (!location) return;
        const name = window.prompt('对话名称', location.task.title);
        if (name === null) return;
        const trimmed = name.trim();
        if (!trimmed || trimmed === location.task.title) return;
        if (hasRealRedouApi()) {
          const result = await redouApi.updateTask({ id: taskId, title: trimmed });
          const error = projectResultError(result, 'Failed to rename conversation');
          if (error) {
            setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
            return;
          }
        }
        setState((current) => ({
          ...current,
          selectedTask: current.selectedTask?.id === taskId ? { ...current.selectedTask, title: trimmed } : current.selectedTask,
          data: updateTaskProjection(current.data, { ...location.task, title: trimmed }),
        }));
      },
      async archiveTaskConversation(taskId) {
        const location = findTaskLocation(state.data.projects, taskId);
        if (!location) return;
        if (hasRealRedouApi()) {
          const result = await redouApi.archiveTask(taskId);
          const error = projectResultError(result, 'Failed to archive conversation');
          if (error) {
            setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
            return;
          }
        }
        setState((current) => {
          const currentProject = current.data.projects.find((project) => project.tasks.some((task) => task.id === taskId));
          if (!currentProject) return current;
          const remainingTasks = currentProject.tasks.filter((item) => item.id !== taskId);
          const archivedSelectedTask = current.selectedTask?.id === taskId;
          const nextTask = archivedSelectedTask ? firstProjectTask({ ...currentProject, tasks: remainingTasks }) : current.selectedTask;
          const activeTask = current.data.activeTask.id === taskId
            ? nextTask || createEmptyTask(currentProject.id)
            : current.data.activeTask;
          const nextDrafts = updateActiveConversationDraft(current, current.data, current.composerInput);
          const targetDraftKey = taskDraftKey(currentProject.id, nextTask || activeTask);
          const targetDraft = nextDrafts[targetDraftKey] || emptyConversationDraft();
          return {
            ...current,
            selectedTask: archivedSelectedTask ? nextTask : current.selectedTask,
            composerInput: targetDraft.input,
            conversationDrafts: {
              ...nextDrafts,
              [targetDraftKey]: targetDraft,
            },
            data: activateConversationData({
              ...current.data,
              activeTask,
              projects: replaceProject(current.data.projects, currentProject.id, (project) => ({
                ...project,
                tasks: project.tasks.filter((item) => item.id !== taskId),
              })),
            }, targetDraft),
          };
        });
      },
      async reloadArchivedTasks() {
        if (!hasRealRedouApi()) return;
        const result = await redouApi.listArchivedTasks();
        if (!result.ok) {
          const error = result.error?.message || 'Failed to load archived conversations';
          setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
          return;
        }
        const archivedTasks = ((result.data || []) as Array<Record<string, unknown>>).map(mapTask);
        setState((current) => ({ ...current, archivedTasks }));
      },
      async restoreArchivedTask(taskId) {
        const archivedTask = state.archivedTasks.find((task) => task.id === taskId);
        if (!archivedTask) return;
        let restoredTask = { ...archivedTask, archived: false, archivedAt: null };
        if (hasRealRedouApi()) {
          const result = await redouApi.restoreTask(taskId);
          const error = projectResultError(result, 'Failed to restore conversation');
          if (error) {
            setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
            return;
          }
          if (result.data) restoredTask = mapTask(result.data as Record<string, unknown>);
        }
        setState((current) => ({
          ...current,
          archivedTasks: current.archivedTasks.filter((task) => task.id !== taskId),
          expandedProjectIds: Array.from(new Set([...current.expandedProjectIds, restoredTask.projectId || current.data.activeProjectId])),
          data: {
            ...current.data,
            projects: insertTaskIntoProjects(current.data.projects, restoredTask),
          },
        }));
      },
      async deleteArchivedTask(taskId) {
        const archivedTask = state.archivedTasks.find((task) => task.id === taskId);
        if (!archivedTask) return;
        const confirmed = window.confirm(`永久删除已归档对话“${archivedTask.title}”？此操作不可撤销。`);
        if (!confirmed) return;
        if (hasRealRedouApi()) {
          const result = await redouApi.removeTask(taskId);
          const error = projectResultError(result, 'Failed to delete archived conversation');
          if (error) {
            setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
            return;
          }
        }
        setState((current) => ({
          ...current,
          archivedTasks: current.archivedTasks.filter((task) => task.id !== taskId),
        }));
      },
      async deleteAllArchivedTasks() {
        if (!state.archivedTasks.length) return;
        const confirmed = window.confirm(`永久删除 ${state.archivedTasks.length} 个已归档对话？此操作不可撤销。`);
        if (!confirmed) return;
        if (hasRealRedouApi()) {
          for (const task of state.archivedTasks) {
            const result = await redouApi.removeTask(task.id);
            const error = projectResultError(result, 'Failed to delete archived conversations');
            if (error) {
              setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
              return;
            }
          }
        }
        setState((current) => ({ ...current, archivedTasks: [] }));
      },
      async toggleTaskUnread(taskId) {
        const location = findTaskLocation(state.data.projects, taskId);
        if (!location) return;
        const unread = !location.task.unread;
        if (hasRealRedouApi()) {
          const result = await redouApi.updateTask({ id: taskId, metadata: { unread } });
          const error = projectResultError(result, 'Failed to update read status');
          if (error) {
            setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
            return;
          }
        }
        setState((current) => ({
          ...current,
          selectedTask: current.selectedTask?.id === taskId ? { ...current.selectedTask, unread } : current.selectedTask,
          data: {
            ...current.data,
            activeTask: current.data.activeTask.id === taskId ? { ...current.data.activeTask, unread } : current.data.activeTask,
            projects: replaceTask(current.data.projects, taskId, (task) => ({ ...task, unread })),
          },
        }));
      },
      async openTaskWorkspace(taskId) {
        const location = findTaskLocation(state.data.projects, taskId);
        if (!location?.project.rootPath) return;
        const result = await redouApi.openProjectFolder(location.project.id);
        const error = projectResultError(result, 'Failed to open project folder');
        if (error) {
          setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
        }
      },
      async copyTaskWorkspace(taskId) {
        const location = findTaskLocation(state.data.projects, taskId);
        const rootPath = location?.project.rootPath || '';
        if (!rootPath) return;
        const error = await writeClipboardText(rootPath);
        if (error) setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
      },
      async copyTaskConversationId(taskId) {
        const location = findTaskLocation(state.data.projects, taskId);
        if (!location) return;
        const error = await writeClipboardText(taskConversationId(location.task));
        if (error) setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
      },
      async copyTaskDeepLink(taskId) {
        const location = findTaskLocation(state.data.projects, taskId);
        if (!location) return;
        const error = await writeClipboardText(taskDeepLink(location.project, location.task));
        if (error) setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
      },
      async forkTaskToLocal(taskId) {
        const location = findTaskLocation(state.data.projects, taskId);
        if (!location) return;
        const result = await redouApi.forkTask({
          taskId,
          projectId: location.project.id,
          cwd: location.project.rootPath,
          mode: 'local',
        });
        const error = actionResultError(result, 'Failed to fork conversation');
        if (error || !result.data) {
          setState((current) => ({ ...current, runtimeError: error || 'Failed to fork conversation', data: appendRuntimeErrorLog(current.data, error || 'Failed to fork conversation') }));
          return;
        }
        const task = mapTask((result.data as { task?: Record<string, unknown> }).task || (result.data as Record<string, unknown>));
        setState((current) => {
          const targetDraftKey = taskDraftKey(location.project.id, task);
          const targetDraft = emptyConversationDraft();
          return {
            ...current,
            activeView: 'thread',
            selectedTask: task,
            composerInput: '',
            conversationDrafts: {
              ...updateActiveConversationDraft(current, current.data, current.composerInput),
              [targetDraftKey]: targetDraft,
            },
            runtimeError: null,
            expandedProjectIds: Array.from(new Set([...current.expandedProjectIds, location.project.id])),
            data: activateConversationData({
              ...current.data,
              activeProjectId: location.project.id,
              activeTask: task,
              projects: replaceProject(current.data.projects, location.project.id, (project) => ({
                ...project,
                tasks: [task, ...project.tasks.filter((existing) => existing.id !== task.id)].sort(compareTasks),
              })),
              composer: {
                ...current.data.composer,
                workspace: location.project.name,
              },
            }, targetDraft),
          };
        });
      },
      async forkTaskToNewWorktree(taskId) {
        const location = findTaskLocation(state.data.projects, taskId);
        if (!location?.project.rootPath) return;
        const defaultBranch = `codex/${branchSlug(location.task.title)}`;
        const branchName = window.prompt('新工作树分支名', defaultBranch)?.trim();
        if (!branchName) return;
        const worktreeResult = await redouApi.createWorktree({
          projectId: location.project.id,
          branchName,
          base: 'HEAD',
        });
        const worktreeError = actionResultError(worktreeResult, 'Failed to create worktree');
        if (worktreeError || !worktreeResult.data) {
          setState((current) => ({ ...current, runtimeError: worktreeError || 'Failed to create worktree', data: appendRuntimeErrorLog(current.data, worktreeError || 'Failed to create worktree') }));
          return;
        }
        const created = (worktreeResult.data as { created?: { path?: string; project?: Record<string, unknown> } }).created || {};
        const project = created.project ? mapProject(created.project, []) : {
          ...location.project,
          id: `${location.project.id}:${branchName}`,
          name: branchName,
          rootPath: created.path || location.project.rootPath,
          tasks: [],
        };
        const forkResult = await redouApi.forkTask({
          taskId,
          projectId: project.id,
          cwd: project.rootPath,
          mode: 'worktree',
          metadata: { worktreeBranch: branchName },
        });
        const forkError = actionResultError(forkResult, 'Failed to fork conversation into worktree');
        if (forkError || !forkResult.data) {
          setState((current) => ({
            ...current,
            runtimeError: forkError || 'Failed to fork conversation into worktree',
            data: appendRuntimeErrorLog({ ...current.data, projects: upsertProject(current.data.projects, project) }, forkError || 'Failed to fork conversation into worktree'),
          }));
          return;
        }
        const task = mapTask((forkResult.data as { task?: Record<string, unknown> }).task || (forkResult.data as Record<string, unknown>));
        const projectWithTask = { ...project, tasks: [task] };
        setState((current) => {
          const targetDraftKey = taskDraftKey(project.id, task);
          const targetDraft = emptyConversationDraft();
          return {
            ...current,
            activeView: 'thread',
            selectedTask: task,
            composerInput: '',
            conversationDrafts: {
              ...updateActiveConversationDraft(current, current.data, current.composerInput),
              [targetDraftKey]: targetDraft,
            },
            runtimeError: null,
            expandedProjectIds: Array.from(new Set([project.id, ...current.expandedProjectIds])),
            data: activateConversationData({
              ...current.data,
              projects: upsertProject(current.data.projects, projectWithTask),
              activeProjectId: project.id,
              activeTask: task,
              composer: {
                ...current.data.composer,
                workspace: project.name,
              },
            }, targetDraft),
          };
        });
      },
      async openTaskInNewWindow(taskId) {
        const location = findTaskLocation(state.data.projects, taskId);
        if (!location) return;
        const result = await redouApi.openAppWindow({ projectId: location.project.id, taskId });
        const error = actionResultError(result, 'Failed to open conversation in a new window');
        if (error) setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
      },
      async removeProject(projectId) {
        const project = state.data.projects.find((item) => item.id === projectId);
        if (!project) return;
        const confirmed = window.confirm(`从 Redou 中移除“${project.name}”？本地文件不会被删除。`);
        if (!confirmed) return;
        if (hasRealRedouApi()) {
          const result = await redouApi.removeProject(projectId);
          const error = projectResultError(result, 'Failed to remove project');
          if (error) {
            setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
            return;
          }
        }
        setState((current) => {
          const projects = current.data.projects.filter((item) => item.id !== projectId);
          const removedActiveProject = current.data.activeProjectId === projectId;
          const nextProject = removedActiveProject ? projects[0] || null : current.data.projects.find((item) => item.id === current.data.activeProjectId) || null;
          const nextTask = removedActiveProject ? firstProjectTask(nextProject) : current.selectedTask;
          const activeTask = nextTask || createEmptyTask(nextProject?.id);
          const nextDrafts = updateActiveConversationDraft(current, current.data, current.composerInput);
          const targetDraftKey = taskDraftKey(nextProject?.id, nextTask || activeTask);
          const targetDraft = nextDrafts[targetDraftKey] || emptyConversationDraft();
          return {
            ...current,
            selectedTask: nextTask,
            composerInput: targetDraft.input,
            conversationDrafts: {
              ...nextDrafts,
              [targetDraftKey]: targetDraft,
            },
            expandedProjectIds: current.expandedProjectIds.filter((id) => id !== projectId),
            data: activateConversationData({
              ...current.data,
              projects,
              activeProjectId: nextProject?.id || '',
              activeTask,
              composer: {
                ...current.data.composer,
                workspace: nextProject?.name || current.data.composer.workspace,
              },
            }, targetDraft),
          };
        });
      },
      setComposerPermissionMode(mode) {
        const option = getPermissionModeOption(mode);
        writeStoredComposerPermissionMode(mode);
        setState((current) => ({
          ...current,
          appSettings: {
            ...current.appSettings,
            composer: {
              ...current.appSettings.composer,
              permissionMode: mode,
            },
          },
          data: {
            ...current.data,
            composer: {
              ...current.data.composer,
              permission: option.label,
              permissionMode: mode,
            },
          },
        }));
        if (hasRealRedouApi()) {
          void redouApi.updateAppSettings({ patch: { composer: { permissionMode: mode } } }).then((result) => {
            if (result.ok) return;
            const error = result.error?.message || 'Failed to save permission preference';
            setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
          });
        }
      },
      async reloadModelConfigs() {
        const result = await redouApi.listModelConfigs();
        if (!result.ok || !result.data) {
          const error = result.error?.message || 'Failed to load model configuration';
          setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
          return;
        }
        const modelConfig = normalizeModelConfigSnapshot(result.data);
        setState((current) => ({
          ...current,
          modelConfig,
          data: applyModelConfigToData(current.data, modelConfig),
        }));
      },
      async selectConfiguredModel(selection) {
        if (!selection.providerId || !selection.modelId) return;
        const applyLocalSelection = (snapshot: ModelConfigSnapshot): ModelConfigSnapshot => ({
          ...snapshot,
          providers: snapshot.providers.map((provider) => provider.id === selection.providerId
            ? {
                ...provider,
                selectedModel: selection.modelId,
                models: Array.from(new Set([selection.modelId, ...provider.models])),
              }
            : provider),
          selected: selection,
        });
        if (!hasRealRedouApi()) {
          setState((current) => {
            const modelConfig = applyLocalSelection(current.modelConfig);
            return { ...current, modelConfig, data: applyModelConfigToData(current.data, modelConfig) };
          });
          return;
        }
        const result = await redouApi.selectConfiguredModel(selection);
        if (!result.ok || !result.data) {
          const error = result.error?.message || 'Failed to select model';
          setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
          return;
        }
        const modelConfig = normalizeModelConfigSnapshot(result.data);
        setState((current) => ({
          ...current,
          modelConfig,
          data: applyModelConfigToData(current.data, modelConfig),
        }));
      },
      async probeModelProvider(input) {
        const result = await redouApi.probeModelProvider(input);
        if (!result.ok || !result.data) {
          const error = result.error?.message || 'Failed to connect to provider';
          setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
          return null;
        }
        return result.data;
      },
      async saveModelProvider(input) {
        const result = await redouApi.saveModelProvider(input);
        if (!result.ok || !result.data) {
          const error = result.error?.message || 'Failed to save model provider';
          setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
          return;
        }
        const modelConfig = normalizeModelConfigSnapshot(result.data);
        setState((current) => ({
          ...current,
          modelConfig,
          data: applyModelConfigToData(current.data, modelConfig),
        }));
      },
      async removeModelProvider(providerId) {
        const result = await redouApi.removeModelProvider(providerId);
        if (!result.ok || !result.data) {
          const error = result.error?.message || 'Failed to remove model provider';
          setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
          return;
        }
        const modelConfig = normalizeModelConfigSnapshot(result.data);
        setState((current) => ({
          ...current,
          modelConfig,
          data: applyModelConfigToData(current.data, modelConfig),
        }));
      },
      async selectContextItems(kind) {
        const result = await redouApi.selectContextItems({ kind });
        if (!result.ok || !result.data) {
          const error = result.error?.message || 'Failed to add context';
          setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
          return;
        }
        if (result.data.canceled || !result.data.items.length) return;
        setState((current) => {
          const nextData = addContextItemsToData(current.data, result.data?.items || []);
          return {
            ...current,
            runtimeError: null,
            activeRightPanel: 'context',
            rightPanelOpen: true,
            conversationDrafts: updateActiveConversationDraft(current, nextData, current.composerInput),
            data: nextData,
          };
        });
      },
      async addDroppedContextFiles(files) {
        const items = droppedContextItems(files);
        if (!items.length) return;
        setState((current) => {
          const nextData = addContextItemsToData(current.data, items);
          return {
            ...current,
            activeRightPanel: 'context',
            rightPanelOpen: true,
            conversationDrafts: updateActiveConversationDraft(current, nextData, current.composerInput),
            data: nextData,
          };
        });
      },
      removeContextItem(path) {
        setState((current) => {
          const nextData = removeContextItemFromData(current.data, path);
          return {
            ...current,
            conversationDrafts: updateActiveConversationDraft(current, nextData, current.composerInput),
            data: nextData,
          };
        });
      },
      clearContext() {
        setState((current) => {
          const nextData = clearContextFromData(current.data);
          return {
            ...current,
            conversationDrafts: updateActiveConversationDraft(current, nextData, current.composerInput),
            data: nextData,
          };
        });
      },
      setComposerInput(input) {
        setState((current) => ({
          ...current,
          composerInput: input,
          conversationDrafts: {
            ...current.conversationDrafts,
            [activeConversationDraftKey(current)]: conversationDraftFromData(current.data, input),
          },
        }));
      },
      startComposerEdit(target) {
        setState((current) => ({
          ...current,
          composerInput: target.prompt,
          composerEditTarget: {
            ...target,
            taskId: target.taskId || current.selectedTask?.id || current.data.activeTask.id,
          },
          conversationDrafts: {
            ...current.conversationDrafts,
            [activeConversationDraftKey(current)]: conversationDraftFromData(current.data, target.prompt),
          },
        }));
        window.dispatchEvent(new CustomEvent('redou:focus-composer'));
      },
      cancelComposerEdit() {
        setState((current) => ({
          ...current,
          composerInput: '',
          composerEditTarget: null,
          conversationDrafts: {
            ...current.conversationDrafts,
            [activeConversationDraftKey(current)]: conversationDraftFromData(current.data, ''),
          },
        }));
      },
      async generateImageArtifact(prompt) {
        const trimmed = prompt.trim();
        if (!trimmed) return;
        const result = await redouApi.generateImageArtifact(artifactActionPayload(state, { prompt: trimmed }));
        if (!result.ok || !result.data) {
          const error = result.error?.message || 'Failed to generate image artifact';
          setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
          return;
        }
        const artifact = normalizeArtifactSnapshot(result.data);
        setState((current) => ({
          ...current,
          activeView: 'artifactPreview',
          activeRightPanel: 'artifacts',
          rightPanelOpen: true,
          data: appendArtifactToData(current.data, artifact),
        }));
      },
      async captureScreenshotComment(comment) {
        const result = await redouApi.captureScreenshotArtifact(artifactActionPayload(state, {
          comment,
          metadata: { view: state.activeView },
        }));
        if (!result.ok || !result.data) {
          const error = result.error?.message || 'Failed to capture screenshot';
          setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
          return;
        }
        const artifact = normalizeArtifactSnapshot(result.data);
        setState((current) => ({
          ...current,
          activeRightPanel: 'artifacts',
          rightPanelOpen: true,
          data: appendArtifactToData(current.data, artifact),
        }));
      },
      async openArtifact(artifact) {
        const result = await redouApi.openArtifact({ id: artifact.id, taskId: artifact.taskId || state.selectedTask?.id });
        if (!result.ok) {
          const error = result.error?.message || 'Failed to open artifact';
          setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
        }
      },
      async revealArtifact(artifact) {
        const result = await redouApi.revealArtifact({ id: artifact.id, taskId: artifact.taskId || state.selectedTask?.id });
        if (!result.ok) {
          const error = result.error?.message || 'Failed to reveal artifact';
          setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
        }
      },
      async popoutArtifact(artifact) {
        const result = await redouApi.popoutWindow(artifact.uri
          ? { url: artifact.uri, title: artifact.name }
          : artifact.path
            ? { filePath: artifact.path, title: artifact.name }
            : { title: artifact.name, content: artifact.preview?.content || artifact.content || artifact.name });
        if (!result.ok) {
          const error = result.error?.message || 'Failed to pop out artifact';
          setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
        }
      },
      setBrowserUrl(url) {
        setState((current) => ({
          ...current,
          activeView: 'browser',
          data: {
            ...current.data,
            browser: {
              ...current.data.browser,
              url: url || current.appSettings.browser.homeUrl,
              status: 'loading',
            },
          },
        }));
      },
      async openBrowserExternal(url) {
        const target = url || state.data.browser.url || state.appSettings.browser.homeUrl;
        const result = await redouApi.openExternalUrl(target);
        if (!result.ok) {
          const error = result.error?.message || 'Failed to open external browser';
          setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
        }
      },
      async popoutBrowser(url) {
        const target = url || state.data.browser.url || state.appSettings.browser.homeUrl;
        const result = await redouApi.popoutWindow({ url: target, title: 'Redou browser' });
        if (!result.ok) {
          const error = result.error?.message || 'Failed to pop out browser';
          setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
        }
      },
      async notifyDesktop(title, body) {
        const result = await redouApi.notifyDesktop({ title, body });
        if (!result.ok) {
          const error = result.error?.message || 'Failed to show notification';
          setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
        }
      },
      async updateAppSettings(patch) {
        const result = await redouApi.updateAppSettings({ patch });
        if (!result.ok || !result.data) {
          const error = result.error?.message || 'Failed to update settings';
          setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorLog(current.data, error) }));
          return;
        }
        const appSettings = normalizeAppSettingsSnapshot(result.data);
        setState((current) => ({
          ...current,
          appSettings,
          data: {
            ...current.data,
            browser: {
              ...current.data.browser,
              homeUrl: appSettings.browser.homeUrl,
            },
          },
        }));
      },
      async submitComposer(input, options) {
        const trimmed = input.trim();
        if (!trimmed) return;
        const permissionMode = options?.permissionMode || state.data.composer.permissionMode || defaultComposerPermissionMode;
        const permissionPolicy = options?.permissionPolicy || createPermissionPolicy(permissionMode);
        const modelSelection = options?.modelSelection || state.data.composer.modelSelection || state.modelConfig.selected || null;
        const reasoningEffort = options?.reasoningEffort || state.data.composer.reasoningEffort;
        const deliveryMode = options?.deliveryMode || 'auto';
        const editTarget = options?.editTarget || state.composerEditTarget;
        const contextPackage = await buildContextPackageForTurn(state, trimmed);
        const turnOptions = { permissionMode, permissionPolicy, modelSelection, reasoningEffort, contextPackage };
        if (!hasRealRedouApi()) {
          setState((current) => ({
            ...current,
            runtimeError: 'Electron preload API is not available.',
            data: appendRuntimeErrorFeedback(current.data, 'Electron preload API is not available.'),
          }));
          return false;
        }
        const currentTask = state.selectedTask;
        if (!currentTask) {
          const projectId = state.data.activeProjectId;
          const created = await redouApi.createTask({
            projectId,
            title: trimmed.slice(0, 80),
            userInput: trimmed,
            runtime: 'redou-codex',
            metadata: { permissionMode, modelSelection, reasoningEffort },
          });
          if (!created.ok || !created.data) {
            setState((current) => ({ ...current, runtimeError: created.error?.message || 'Failed to create task', data: appendRuntimeErrorFeedback(current.data, created.error?.message || 'Failed to create task') }));
            return;
          }
          const task = mapTask(created.data as Record<string, unknown>);
          setState((current) => ({
            ...current,
            selectedTask: task,
            composerInput: current.composerInput,
            conversationDrafts: {
              ...updateActiveConversationDraft(current, current.data, current.composerInput),
              [taskDraftKey(projectId, task)]: conversationDraftFromData(current.data, current.composerInput),
            },
            expandedProjectIds: Array.from(new Set([...current.expandedProjectIds, projectId])),
            data: activateConversationData({
              ...current.data,
              activeTask: task,
              projects: current.data.projects.map((project) => project.id === projectId ? { ...project, tasks: [task, ...project.tasks] } : project),
            }, conversationDraftFromData(current.data, current.composerInput)),
          }));
          const started = await redouApi.startTask(task.id, { userInput: trimmed, ...turnOptions });
          const startError = runtimeResultError(started, 'Failed to start task');
          setState((current) => ({
            ...current,
            selectedTask: { ...task, status: startError ? 'error' : 'running' },
            expandedProjectIds: Array.from(new Set([...current.expandedProjectIds, projectId])),
            data: {
              ...current.data,
              activeTask: { ...task, status: startError ? 'error' : 'running' },
              projects: current.data.projects.map((project) => project.id === projectId
                ? { ...project, tasks: project.tasks.map((item) => item.id === task.id ? { ...task, status: startError ? 'error' : 'running' } : item) }
                : project),
            },
          }));
          if (startError) {
            setState((current) => ({ ...current, runtimeError: startError, data: appendRuntimeErrorFeedback(current.data, startError) }));
          }
          return;
        }
        const isEditingCurrentTask = Boolean(editTarget && (!editTarget.taskId || editTarget.taskId === currentTask.id));
        if (editTarget && !isEditingCurrentTask) {
          const error = 'Cannot edit a message from another conversation.';
          setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorFeedback(current.data, error) }));
          return false;
        }
        if (isEditingCurrentTask && currentTask.status === 'running') {
          const error = '正在执行时不能编辑已发送消息，请先停止当前任务。';
          setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorFeedback(current.data, error) }));
          return false;
        }

        let baseTask = currentTask;
        if (isEditingCurrentTask && editTarget) {
          const title = editTarget.isInitialPrompt || shouldReplaceBlankTitle(currentTask) ? titleFromPrompt(trimmed) : currentTask.title;
          const editedAt = new Date().toISOString();
          const updateResult = await redouApi.updateTask({
            id: currentTask.id,
            userInput: trimmed,
            title,
            metadata: {
              editedUserMessageId: editTarget.messageId,
              editedSourceEventId: editTarget.sourceEventId || null,
              editedTurnId: editTarget.turnId || null,
              editedAt,
            },
          });
          const updateError = actionResultError(updateResult, 'Failed to edit message');
          if (updateError || !updateResult.data) {
            const error = updateError || 'Failed to edit message';
            setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorFeedback(current.data, error) }));
            return false;
          }
          baseTask = mapTask(updateResult.data as Record<string, unknown>);
        }

        const taskWithInput = baseTask.status === 'running'
          ? baseTask
          : {
              ...baseTask,
              title: shouldReplaceBlankTitle(baseTask) ? titleFromPrompt(trimmed) : baseTask.title,
              userPrompt: isEditingCurrentTask ? trimmed : baseTask.userPrompt || trimmed,
            };
        const startPayload = {
          userInput: trimmed,
          ...turnOptions,
          ...(isEditingCurrentTask && editTarget
            ? { userMessageId: editTarget.messageId, deliveryMode: 'new_turn' }
            : {}),
        };
        const result = baseTask.status === 'running'
          ? deliveryMode === 'guide'
            ? await redouApi.steerTask(baseTask.id, trimmed, turnOptions)
            : await redouApi.queueTask(baseTask.id, trimmed, turnOptions)
          : await redouApi.startTask(baseTask.id, startPayload);
        const runtimeError = runtimeResultError(result, 'Runtime request failed');
        if (runtimeError) {
          const erroredTask = { ...taskWithInput, status: 'error' as WorkbenchTaskStatus };
          setState((current) => ({
            ...current,
            runtimeError,
            selectedTask: current.selectedTask?.id === baseTask.id ? erroredTask : current.selectedTask,
            data: appendRuntimeErrorFeedback(updateTaskProjection(
              isEditingCurrentTask && editTarget ? updateEditedUserPromptProjection(current.data, editTarget, trimmed) : current.data,
              erroredTask,
            ), runtimeError),
          }));
          if (isEditingCurrentTask) return false;
        } else if (baseTask.status === 'running' && deliveryMode !== 'guide') {
          const queueDepth = Number((result.data as { queueDepth?: number } | null)?.queueDepth || baseTask.queueDepth || 0);
          const queuedTask = { ...baseTask, queueDepth };
          setState((current) => ({
            ...current,
            selectedTask: current.selectedTask?.id === baseTask.id ? queuedTask : current.selectedTask,
            data: updateTaskProjection(current.data, queuedTask),
          }));
        } else if (baseTask.status !== 'running') {
          const runningTask = { ...taskWithInput, status: 'running' as WorkbenchTaskStatus };
          setState((current) => ({
            ...current,
            composerEditTarget: null,
            selectedTask: runningTask,
            data: updateTaskProjection(
              isEditingCurrentTask && editTarget ? updateEditedUserPromptProjection(current.data, editTarget, trimmed) : current.data,
              runningTask,
            ),
          }));
        }
      },
      async stopActiveTask() {
        const currentTask = state.selectedTask || state.data.activeTask;
        if (!currentTask || currentTask.status !== 'running') return;
        if (!hasRealRedouApi()) {
          const error = 'Electron preload API is not available.';
          setState((current) => ({
            ...current,
            runtimeError: error,
            data: appendRuntimeErrorFeedback(current.data, error),
          }));
          return;
        }
        const result = await redouApi.interruptTask(currentTask.id);
        const error = actionResultError(result, 'Failed to stop task');
        if (error) {
          setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorFeedback(current.data, error) }));
          return;
        }
        const stoppedTask = { ...currentTask, status: 'interrupted' as WorkbenchTaskStatus };
        setState((current) => ({
          ...current,
          runtimeError: null,
          selectedTask: current.selectedTask?.id === currentTask.id ? { ...current.selectedTask, status: 'interrupted' } : current.selectedTask,
          data: updateTaskProjection({
            ...current.data,
            runtimeStatus: current.data.activeTask.id === currentTask.id
              ? {
                  ...(current.data.runtimeStatus || {}),
                  turnStatus: 'interrupted',
                  rawTurnStatus: 'interrupted',
                  stopReason: {
                    ...(current.data.runtimeStatus?.stopReason || {}),
                    status: 'interrupted',
                    message: 'Stopped by user.',
                  },
                }
              : current.data.runtimeStatus,
          }, stoppedTask),
        }));
      },
      async guideQueuedMessage(message) {
        const taskId = state.selectedTask?.id || state.data.activeTask.id;
        const queueId = message.queueId || message.id;
        if (!taskId || !queueId) return;
        const result = await redouApi.updateQueuedTask(taskId, queueId, 'guide');
        const error = actionResultError(result, 'Failed to guide queued message');
        if (error) {
          setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorFeedback(current.data, error) }));
          return;
        }
        const resultData = result.data as { queueDepth?: number; started?: boolean } | null;
        const queueDepth = Number(resultData?.queueDepth || 0);
        const started = Boolean(resultData?.started);
        setState((current) => {
          const nextStatus = started ? 'running' as WorkbenchTaskStatus : undefined;
          const nextSelectedTask = current.selectedTask?.id === taskId
            ? { ...current.selectedTask, queueDepth, ...(nextStatus ? { status: nextStatus } : {}) }
            : current.selectedTask;
          const nextActiveTask = current.data.activeTask.id === taskId
            ? { ...current.data.activeTask, queueDepth, ...(nextStatus ? { status: nextStatus } : {}) }
            : current.data.activeTask;
          return {
            ...current,
            selectedTask: nextSelectedTask,
            data: updateTaskProjection(updateQueuedMessageProjection({
              ...current.data,
              activeTask: nextActiveTask,
            }, queueId, (item) => started
              ? { ...item, deliveryMode: 'queue', status: 'consumed', queueState: 'started' }
              : { ...item, deliveryMode: 'guide', status: 'completed', queueState: 'guided' }), nextActiveTask),
          };
        });
      },
      async deleteQueuedMessage(message) {
        const taskId = state.selectedTask?.id || state.data.activeTask.id;
        const queueId = message.queueId || message.id;
        if (!taskId || !queueId) return;
        const result = await redouApi.updateQueuedTask(taskId, queueId, 'delete');
        const error = actionResultError(result, 'Failed to delete queued message');
        if (error) {
          setState((current) => ({ ...current, runtimeError: error, data: appendRuntimeErrorFeedback(current.data, error) }));
          return;
        }
        const queueDepth = Number((result.data as { queueDepth?: number } | null)?.queueDepth || 0);
        setState((current) => {
          const nextSelectedTask = current.selectedTask?.id === taskId ? { ...current.selectedTask, queueDepth } : current.selectedTask;
          const nextActiveTask = current.data.activeTask.id === taskId ? { ...current.data.activeTask, queueDepth } : current.data.activeTask;
          return {
            ...current,
            selectedTask: nextSelectedTask,
            data: updateTaskProjection(updateQueuedMessageProjection({
              ...current.data,
              activeTask: nextActiveTask,
            }, queueId, () => null), nextActiveTask),
          };
        });
      },
      async stageGitFile(file) {
        if (!file.path) return;
        const result = await redouApi.stageGitFile(gitFileActionPayload(state, file));
        const error = actionResultError(result, 'Failed to stage file');
        if (error || !result.data) {
          setState((current) => ({
            ...current,
            runtimeError: error || 'Failed to stage file',
            data: appendRuntimeErrorLog(current.data, error || 'Failed to stage file'),
          }));
          return;
        }
        setState((current) => ({
          ...current,
          runtimeError: null,
          data: applyGitDiffToData(current.data, result.data),
        }));
      },
      async unstageGitFile(file) {
        if (!file.path) return;
        const result = await redouApi.unstageGitFile(gitFileActionPayload(state, file));
        const error = actionResultError(result, 'Failed to unstage file');
        if (error || !result.data) {
          setState((current) => ({
            ...current,
            runtimeError: error || 'Failed to unstage file',
            data: appendRuntimeErrorLog(current.data, error || 'Failed to unstage file'),
          }));
          return;
        }
        setState((current) => ({
          ...current,
          runtimeError: null,
          data: applyGitDiffToData(current.data, result.data),
        }));
      },
      async revertGitFile(file) {
        if (!file.path) return;
        const result = await redouApi.revertGitFile(gitFileActionPayload(state, file, { allowUntrackedDelete: Boolean(file.untracked) }));
        const error = actionResultError(result, 'Failed to revert file');
        if (error || !result.data) {
          setState((current) => ({
            ...current,
            runtimeError: error || 'Failed to revert file',
            data: appendRuntimeErrorLog(current.data, error || 'Failed to revert file'),
          }));
          return;
        }
        setState((current) => ({
          ...current,
          runtimeError: null,
          data: applyGitDiffToData(current.data, result.data),
        }));
      },
      async stageGitHunk(file, hunkIndex) {
        if (!file.path) return;
        const result = await redouApi.stageGitHunk(gitFileActionPayload(state, file, { hunkIndex }));
        const error = actionResultError(result, 'Failed to stage hunk');
        if (error || !result.data) {
          setState((current) => ({
            ...current,
            runtimeError: error || 'Failed to stage hunk',
            data: appendRuntimeErrorLog(current.data, error || 'Failed to stage hunk'),
          }));
          return;
        }
        setState((current) => ({
          ...current,
          runtimeError: null,
          data: applyGitDiffToData(current.data, result.data),
        }));
      },
      async revertGitHunk(file, hunkIndex) {
        if (!file.path) return;
        const result = await redouApi.revertGitHunk(gitFileActionPayload(state, file, { hunkIndex, staged: Boolean(file.staged && !file.unstaged) }));
        const error = actionResultError(result, 'Failed to revert hunk');
        if (error || !result.data) {
          setState((current) => ({
            ...current,
            runtimeError: error || 'Failed to revert hunk',
            data: appendRuntimeErrorLog(current.data, error || 'Failed to revert hunk'),
          }));
          return;
        }
        setState((current) => ({
          ...current,
          runtimeError: null,
          data: applyGitDiffToData(current.data, result.data),
        }));
      },
      async commitGitChanges() {
        const message = window.prompt('Commit message');
        const trimmed = message?.trim();
        if (!trimmed) return;
        const result = await redouApi.commitGitChanges(gitProjectActionPayload(state, { message: trimmed }));
        const error = actionResultError(result, 'Failed to commit changes');
        if (error || !result.data) {
          setState((current) => ({
            ...current,
            runtimeError: error || 'Failed to commit changes',
            data: appendRuntimeErrorLog(current.data, error || 'Failed to commit changes'),
          }));
          return;
        }
        setState((current) => ({
          ...current,
          runtimeError: null,
          data: applyGitDiffToData(current.data, result.data),
        }));
      },
      async pushGitBranch() {
        const confirmed = window.confirm('Push the current branch to its configured upstream?');
        if (!confirmed) return;
        const result = await redouApi.pushGitBranch(gitProjectActionPayload(state));
        const error = actionResultError(result, 'Failed to push branch');
        if (error || !result.data) {
          setState((current) => ({
            ...current,
            runtimeError: error || 'Failed to push branch',
            data: appendRuntimeErrorLog(current.data, error || 'Failed to push branch'),
          }));
          return;
        }
        setState((current) => ({
          ...current,
          runtimeError: null,
          data: applyGitDiffToData(current.data, result.data),
        }));
      },
      async createPullRequest() {
        const title = window.prompt('Pull request title', state.data.activeTask.title || state.data.environment.branch);
        const trimmedTitle = title?.trim();
        if (!trimmedTitle) return;
        const body = window.prompt('Pull request body', `Created from Redou Agent for ${state.data.activeTask.title}.`) || '';
        const base = window.prompt('Base branch (leave empty for repository default)', '') || '';
        const pushFirst = window.confirm('Push this branch before creating the pull request?');
        const result = await redouApi.createPullRequest(gitProjectActionPayload(state, {
          title: trimmedTitle,
          body,
          base: base.trim() || undefined,
          pushFirst,
        }));
        const error = actionResultError(result, 'Failed to create pull request');
        if (error || !result.data) {
          setState((current) => ({
            ...current,
            runtimeError: error || 'Failed to create pull request',
            data: appendRuntimeErrorLog(current.data, error || 'Failed to create pull request'),
          }));
          return;
        }
        const pullRequestUrl = result.data.pullRequest?.url || 'Pull request created';
        setState((current) => ({
          ...current,
          runtimeError: null,
          data: {
            ...applyGitDiffToData(current.data, result.data),
            environment: {
              ...applyGitDiffToData(current.data, result.data).environment,
              pullRequest: pullRequestUrl,
              source: pullRequestUrl,
            },
          },
        }));
        if (pullRequestUrl.startsWith('http')) window.open(pullRequestUrl, '_blank', 'noopener,noreferrer');
      },
    }),
    [state],
  );

  return { state, actions };
}
