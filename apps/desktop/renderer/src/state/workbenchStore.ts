import { useEffect, useMemo, useState } from 'react';
import { hasRealRedouApi, redouApi, type RuntimeSnapshot } from '../api/redouApi';
import { createPermissionPolicy, getPermissionModeOption } from '../components/composer/composerOptions';
import { mockWorkbenchData } from './mockWorkbenchData';
import type {
  AgentThreadMessage,
  CodexPlanProjection,
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
  activeView: WorkbenchView;
  codexPlan: CodexPlanProjection[];
  activeRightPanel: RightPanelId | null;
  rightPanelOpen: boolean;
  expandedProjectIds: string[];
  apiMode: 'ipc' | 'mock';
  runtimeAvailability: unknown;
  runtimeError: string | null;
  modelConfig: ModelConfigSnapshot;
}

export interface WorkbenchActions {
  selectView: (view: WorkbenchView) => void;
  selectProject: (projectId: string) => void;
  selectTask: (taskId: string) => void;
  selectRightPanel: (panel: RightPanelId) => void;
  closeRightPanel: () => void;
  collapseAllProjects: () => void;
  createBlankProject: (name?: string) => Promise<void>;
  createConversationInProject: (projectId: string) => Promise<void>;
  createProjectFromFolder: () => Promise<void>;
  toggleProjectPinned: (projectId: string) => Promise<void>;
  openProjectFolder: (projectId: string) => Promise<void>;
  renameProject: (projectId: string) => Promise<void>;
  archiveProjectConversation: (projectId: string) => Promise<void>;
  removeProject: (projectId: string) => Promise<void>;
  setComposerPermissionMode: (mode: ComposerPermissionModeId) => void;
  reloadModelConfigs: () => Promise<void>;
  selectConfiguredModel: (selection: ModelConfigSelection) => Promise<void>;
  probeModelProvider: (input: unknown) => Promise<ModelProbeResult | null>;
  saveModelProvider: (input: unknown) => Promise<void>;
  removeModelProvider: (providerId: string) => Promise<void>;
  submitComposer: (input: string, options: ComposerSubmitOptions) => Promise<void>;
  guideQueuedMessage: (message: AgentThreadMessage) => Promise<void>;
  deleteQueuedMessage: (message: AgentThreadMessage) => Promise<void>;
}

const emptyModelConfig: ModelConfigSnapshot = {
  catalog: [],
  providers: [],
  selected: null,
};

export const initialWorkbenchState: WorkbenchState = {
  data: mockWorkbenchData,
  selectedTask: mockWorkbenchData.activeTask,
  activeView: 'thread',
  codexPlan: [],
  activeRightPanel: 'progress',
  rightPanelOpen: true,
  expandedProjectIds: [mockWorkbenchData.activeProjectId],
  apiMode: hasRealRedouApi() ? 'ipc' : 'mock',
  runtimeAvailability: null,
  runtimeError: null,
  modelConfig: emptyModelConfig,
};

function mapProgressStatus(status: string): ProgressStepStatus {
  if (status === 'completed') return 'completed';
  if (status === 'inProgress' || status === 'in_progress' || status === 'active' || status === 'running' || status === 'started' || status === 'updated') return 'active';
  if (status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled') return 'error';
  return 'pending';
}

function mapLogLevel(level: string): LogEntryData['level'] {
  if (level === 'warn' || level === 'debug' || level === 'error') return level;
  return 'info';
}

function mapTaskStatus(status?: string): WorkbenchTaskStatus {
  if (status === 'running' || status === 'blocked' || status === 'error' || status === 'completed') return status;
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
  return {
    id: String(task.id || ''),
    projectId: task.projectId ? String(task.projectId) : undefined,
    title: String(task.title || task.userInput || 'Untitled task'),
    status: mapTaskStatus(String(task.status || 'created')),
    runtime: mapRuntimeId(String(task.runtime || 'redou-codex')),
    userPrompt: String(task.userInput || ''),
    updatedAt: task.updatedAt ? String(task.updatedAt) : undefined,
    queueDepth: queueDepthFromTask(task),
  };
}

function mapProject(project: Record<string, unknown>, tasks: WorkbenchTask[]): WorkbenchProject {
  const projectId = String(project.id || 'default-workspace');
  const metadata = (project.metadata || {}) as { pinned?: boolean };
  return {
    id: projectId,
    name: String(project.name || 'RedouAgent'),
    rootPath: project.rootPath ? String(project.rootPath) : undefined,
    pinned: metadata.pinned === undefined ? projectId === 'default-workspace' : Boolean(metadata.pinned),
    tasks: tasks.filter((task) => !task.projectId || task.projectId === projectId),
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
  return {
    ...data,
    agentMessages: hasMessages
      ? snapshot.messages.filter((message) => message.role === 'user' || message.status === 'error' || String(message.body || '').trim()).map((message) => ({
          id: message.id,
          role: message.role === 'user' || message.role === 'system' ? message.role : 'assistant',
          body: message.body,
          deliveryMode: message.deliveryMode,
          status: message.status,
          queueId: message.queueId ?? null,
          queueState: message.queueState ?? null,
          sourceEventId: message.sourceEventId,
          turnId: message.turnId ?? null,
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
          const item = approval as { id?: string; kind?: string; title?: string; description?: string; status?: string };
          return {
            id: item.id || '',
            kind: item.kind || 'unknown',
            title: item.title || 'Approval required',
            description: item.description || '',
            status: item.status || 'pending',
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
        }))
      : data.mockLogs,
    mockArtifacts: hasArtifacts ? snapshot.artifacts : data.mockArtifacts,
    runtimeStatus: normalizeRuntimeStatus(snapshot.runtimeStatus) || data.runtimeStatus || null,
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
    mockChanges: { ...data.mockChanges, files: [], insertions: 0, deletions: 0, diffSummary: '' },
    environment: { ...data.environment, changes: '无变更' },
    runtimeStatus: null,
  };
}

function projectResultError(result: { ok: boolean; error?: { message?: string } | null }, fallback: string) {
  return result.ok ? null : result.error?.message || fallback;
}

function upsertProject(projects: WorkbenchProject[], project: WorkbenchProject) {
  const index = projects.findIndex((item) => item.id === project.id);
  if (index === -1) return [project, ...projects];
  return projects.map((item) => (item.id === project.id ? { ...project, tasks: project.tasks.length ? project.tasks : item.tasks } : item));
}

function replaceProject(projects: WorkbenchProject[], projectId: string, updater: (project: WorkbenchProject) => WorkbenchProject) {
  return projects.map((project) => (project.id === projectId ? updater(project) : project));
}

function updateTaskProjection(data: WorkbenchMockData, updatedTask: WorkbenchTask): WorkbenchMockData {
  return {
    ...data,
    activeTask: data.activeTask.id === updatedTask.id ? { ...data.activeTask, ...updatedTask } : data.activeTask,
    projects: data.projects.map((project) => ({
      ...project,
      tasks: project.tasks.map((task) => (task.id === updatedTask.id ? { ...task, ...updatedTask } : task)),
    })),
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

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      if (!hasRealRedouApi()) return;
      try {
        const [runtimes, availability, projectsResult, modelConfigResult] = await Promise.all([
          redouApi.listRuntimes(),
          redouApi.getRuntimeAvailability('redou-codex'),
          redouApi.listProjects(),
          redouApi.listModelConfigs(),
        ]);
        const projects = (projectsResult.data || []) as Array<Record<string, unknown>>;
        const normalizedProjects = projects.length ? projects : [{ id: 'default-workspace', name: 'Default workspace' }];
        const projectTasks = await Promise.all(normalizedProjects.map(async (project) => {
          const tasksResult = await redouApi.listTasks(String(project.id || ''));
          return ((tasksResult.data || []) as Array<Record<string, unknown>>).map(mapTask);
        }));
        const activeProject = normalizedProjects[0];
        const tasks = projectTasks[0] || [];
        const activeTask = tasks[0] || null;
        if (cancelled) return;
        const runtimeList = Array.isArray(runtimes.data) ? runtimes.data as Array<{ id?: string }> : [];
        const codexDescriptor = runtimeList.find((runtime) => runtime.id === 'redou-codex') || null;
        const availabilityData = (availability.data || codexDescriptor) as { available?: boolean; lastError?: { message?: string } } | null;
        const availabilityError = availabilityData?.lastError?.message || (!availability.ok ? availability.error?.message : null) || null;
        const activeProjectId = String(activeProject.id || 'default-workspace');
        const displayTask = activeTask || createEmptyTask(activeProjectId);
        const mappedProjects = normalizedProjects.map((project, index) => mapProject(project, projectTasks[index] || []));
        const modelConfig = normalizeModelConfigSnapshot(modelConfigResult.data);
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
            mockArtifacts: [],
            mockChanges: { ...current.data.mockChanges, files: [], insertions: 0, deletions: 0, diffSummary: '' },
            runtimeStatus: null,
            environment: {
              ...current.data.environment,
              changes: '无变更',
              mode: availabilityError ? 'Unavailable' : 'Local',
              runtime: 'redou-codex',
              source: availabilityError || 'redou-codex app-server',
            },
          };
          const dataWithModelConfig = applyModelConfigToData(nextData, modelConfig);
          return {
            ...current,
            apiMode: 'ipc',
            runtimeAvailability: availability.data || codexDescriptor,
            runtimeError: availabilityError,
            modelConfig,
            selectedTask: activeTask,
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
          data: appendRuntimeErrorLog({
            ...current.data,
            activeTask: createEmptyTask(current.data.activeProjectId),
          }, message),
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
    const pullSnapshot = async () => {
      const [result, taskResult] = await Promise.all([
        redouApi.getSnapshot(taskId),
        redouApi.getTask(taskId),
      ]);
      if (cancelled || !result.data) return;
      const runtimeStatus = result.data.runtimeStatus as { lastError?: { message?: string } } | undefined;
      const snapshotError = runtimeStatus?.lastError?.message || null;
      const refreshedTask = taskResult.ok && taskResult.data ? mapTask(taskResult.data as Record<string, unknown>) : null;
      setState((current) => ({
        ...current,
        selectedTask: refreshedTask && current.selectedTask?.id === taskId ? refreshedTask : current.selectedTask,
        data: refreshedTask && current.data.activeTask.id === taskId
          ? updateTaskProjection(applyRuntimeSnapshotToData(current.data, result.data), refreshedTask)
          : applyRuntimeSnapshotToData(current.data, result.data),
        runtimeError: snapshotError,
        codexPlan: (result.data?.planEntries || []).map((entry) => ({
          id: entry.id,
          title: entry.title || entry.step || '',
          status: entry.status,
        })),
      }));
    };
    pullSnapshot();
    const timer = window.setInterval(pullSnapshot, 1000);
    const unsubscribe = redouApi.subscribeEvents(taskId, () => pullSnapshot());
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [state.selectedTask?.id]);

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
        setState((current) => {
          const project = current.data.projects.find((item) => item.id === projectId);
          const task = project?.tasks[0] || null;
          const displayTask = task || createEmptyTask(projectId);
          return {
            ...current,
            activeView: 'thread',
            selectedTask: task,
            expandedProjectIds: Array.from(new Set([...current.expandedProjectIds, projectId])),
            data: {
              ...current.data,
              activeProjectId: projectId,
              activeTask: displayTask,
              composer: {
                ...current.data.composer,
                workspace: project?.name || current.data.composer.workspace,
              },
            },
          };
        });
      },
      selectTask(taskId) {
        setState((current) => {
          for (const project of current.data.projects) {
            const task = project.tasks.find((item) => item.id === taskId);
            if (task) {
              return {
                ...current,
                activeView: 'thread',
                selectedTask: task,
                expandedProjectIds: Array.from(new Set([...current.expandedProjectIds, project.id])),
                data: {
                  ...current.data,
                  activeProjectId: project.id,
                  activeTask: task,
                  composer: {
                    ...current.data.composer,
                    workspace: project.name,
                  },
                },
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
      async createConversationInProject(projectId) {
        const localProject = state.data.projects.find((project) => project.id === projectId);
        if (!localProject) return;
        if (!hasRealRedouApi()) {
          const task = createNewConversationTask(projectId);
          setState((current) => ({
            ...current,
            activeView: 'thread',
            selectedTask: task,
            runtimeError: null,
            expandedProjectIds: Array.from(new Set([...current.expandedProjectIds, projectId])),
            data: resetThreadProjection({
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
          return {
            ...current,
            activeView: 'thread',
            selectedTask: task,
            runtimeError: null,
            expandedProjectIds: Array.from(new Set([...current.expandedProjectIds, projectId])),
            data: resetThreadProjection({
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
            }),
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
          runtimeError: null,
          expandedProjectIds: Array.from(new Set([project.id, ...current.expandedProjectIds])),
          data: {
            ...current.data,
            projects: upsertProject(current.data.projects, project),
            activeProjectId: project.id,
            activeTask: displayTask,
            composer: {
              ...current.data.composer,
              workspace: project.name,
            },
          },
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
        setState((current) => ({
          ...current,
          activeView: 'thread',
          selectedTask: project.tasks[0] || null,
          runtimeError: null,
          expandedProjectIds: Array.from(new Set([project.id, ...current.expandedProjectIds])),
          data: {
            ...current.data,
            projects: upsertProject(current.data.projects, project),
            activeProjectId: project.id,
            activeTask: displayTask,
            composer: {
              ...current.data.composer,
              workspace: project.name,
            },
          },
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
          return {
            ...current,
            selectedTask: archivedSelectedTask ? nextTask : current.selectedTask,
            data: resetThreadProjection({
              ...current.data,
              activeTask,
              projects: replaceProject(current.data.projects, projectId, (project) => ({
                ...project,
                tasks: project.tasks.filter((item) => item.id !== task.id),
              })),
            }),
          };
        });
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
          return {
            ...current,
            selectedTask: nextTask,
            expandedProjectIds: current.expandedProjectIds.filter((id) => id !== projectId),
            data: resetThreadProjection({
              ...current.data,
              projects,
              activeProjectId: nextProject?.id || '',
              activeTask: nextTask || createEmptyTask(nextProject?.id),
              composer: {
                ...current.data.composer,
                workspace: nextProject?.name || current.data.composer.workspace,
              },
            }),
          };
        });
      },
      setComposerPermissionMode(mode) {
        const option = getPermissionModeOption(mode);
        setState((current) => ({
          ...current,
          data: {
            ...current.data,
            composer: {
              ...current.data.composer,
              permission: option.label,
              permissionMode: mode,
            },
          },
        }));
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
      async submitComposer(input, options) {
        const trimmed = input.trim();
        if (!trimmed) return;
        const permissionMode = options?.permissionMode || state.data.composer.permissionMode || 'default';
        const permissionPolicy = options?.permissionPolicy || createPermissionPolicy(permissionMode);
        const modelSelection = options?.modelSelection || state.data.composer.modelSelection || state.modelConfig.selected || null;
        const reasoningEffort = options?.reasoningEffort || state.data.composer.reasoningEffort;
        const deliveryMode = options?.deliveryMode || 'auto';
        const turnOptions = { permissionPolicy, modelSelection, reasoningEffort };
        if (!hasRealRedouApi()) {
          setState((current) => ({
            ...current,
            runtimeError: 'Electron preload API is not available.',
            data: appendRuntimeErrorFeedback(current.data, 'Electron preload API is not available.'),
          }));
          return;
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
            expandedProjectIds: Array.from(new Set([...current.expandedProjectIds, projectId])),
            data: {
              ...current.data,
              activeTask: task,
              projects: current.data.projects.map((project) => project.id === projectId ? { ...project, tasks: [task, ...project.tasks] } : project),
            },
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
        const taskWithInput = currentTask.status === 'running'
          ? currentTask
          : {
              ...currentTask,
              title: shouldReplaceBlankTitle(currentTask) ? titleFromPrompt(trimmed) : currentTask.title,
              userPrompt: currentTask.userPrompt || trimmed,
            };
        const result = currentTask.status === 'running'
          ? deliveryMode === 'guide'
            ? await redouApi.steerTask(currentTask.id, trimmed, turnOptions)
            : await redouApi.queueTask(currentTask.id, trimmed, turnOptions)
          : await redouApi.startTask(currentTask.id, { userInput: trimmed, ...turnOptions });
        const runtimeError = runtimeResultError(result, 'Runtime request failed');
        if (runtimeError) {
          const erroredTask = { ...taskWithInput, status: 'error' as WorkbenchTaskStatus };
          setState((current) => ({
            ...current,
            runtimeError,
            selectedTask: current.selectedTask?.id === currentTask.id ? erroredTask : current.selectedTask,
            data: appendRuntimeErrorFeedback(updateTaskProjection({
              ...current.data,
              activeTask: current.data.activeTask.id === currentTask.id ? erroredTask : current.data.activeTask,
            }, erroredTask), runtimeError),
          }));
        } else if (currentTask.status === 'running' && deliveryMode !== 'guide') {
          const queueDepth = Number((result.data as { queueDepth?: number } | null)?.queueDepth || currentTask.queueDepth || 0);
          const queuedTask = { ...currentTask, queueDepth };
          setState((current) => ({
            ...current,
            selectedTask: current.selectedTask?.id === currentTask.id ? queuedTask : current.selectedTask,
            data: updateTaskProjection(current.data, queuedTask),
          }));
        } else if (currentTask.status !== 'running') {
          setState((current) => ({
            ...current,
            selectedTask: { ...taskWithInput, status: 'running' },
            data: {
              ...current.data,
              activeTask: { ...taskWithInput, status: 'running' },
              projects: current.data.projects.map((project) => ({
                ...project,
                tasks: project.tasks.map((task) => task.id === currentTask.id ? { ...taskWithInput, status: 'running' } : task),
              })),
            },
          }));
        }
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
            }, queueId, (item) => ({ ...item, deliveryMode: 'guide', status: 'completed', queueState: 'guided' })), nextActiveTask),
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
    }),
    [state],
  );

  return { state, actions };
}
