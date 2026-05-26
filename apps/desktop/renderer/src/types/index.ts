import type {
  AppSettingsSnapshot,
  AutomationMessageMetadata,
  ArtifactPreview,
  ConfiguredModelProvider,
  ModelConfigSelection,
  ModelConfigSnapshot,
  ModelProbeResult,
  ModelProviderPreset,
} from '../api/redouApi';

export type RuntimeId = 'redou-codex' | 'hermes' | 'pi' | 'custom';

export type WorkbenchTaskStatus = 'created' | 'running' | 'blocked' | 'waiting_approval' | 'failed' | 'error' | 'degraded' | 'completed' | 'interrupted';

export type ProgressStepStatus = 'completed' | 'active' | 'pending' | 'error';

export type WorkbenchView = 'thread' | 'diffReview' | 'artifactPreview' | 'browser' | 'settings' | 'extensions';

export type RightPanelId =
  | 'progress'
  | 'codeReview'
  | 'fileExplorer'
  | 'changes'
  | 'logs'
  | 'artifacts'
  | 'rules'
  | 'context'
  | 'terminal'
  | 'worktrees'
  | 'automations'
  | 'skills'
  | 'mcp';

export interface WorkbenchTask {
  id: string;
  title: string;
  status: WorkbenchTaskStatus;
  runtime: RuntimeId;
  userPrompt?: string;
  projectId?: string;
  updatedAt?: string;
  unread?: boolean;
  pinned?: boolean;
  archived?: boolean;
  archivedAt?: string | null;
  redouCodexThreadId?: string | null;
  queueDepth?: number;
}

export interface WorkbenchProject {
  id: string;
  name: string;
  rootPath?: string;
  pinned?: boolean;
  sortOrder?: number;
  tasks: WorkbenchTask[];
}

export interface RedouCodexPlanProjection {
  id: string;
  title: string;
  status: string;
}

export interface TodoProjectionEntry {
  id: string;
  title: string;
  status: string;
}

export interface ApprovalRequestProjection {
  id: string;
  taskId?: string | null;
  kind: string;
  title: string;
  description: string;
  status: string;
  payload?: unknown;
}

export interface CommandRunData {
  id: string;
  command: string;
  output?: string;
  lifecycle?: string;
  level?: 'info' | 'warn' | 'debug' | 'error';
  timestamp?: string;
}

export interface CommandRunSummaryData {
  count: number;
  label: string;
  commands?: CommandRunData[];
}

export interface AgentThreadMessage {
  id: string;
  role?: 'assistant' | 'user' | 'system';
  kind?: 'message' | 'command_summary';
  body: string;
  timestamp?: string;
  processedDurationMs?: number;
  processedStatus?: string;
  deliveryMode?: string;
  status?: string;
  queueId?: string | null;
  queueState?: string | null;
  sourceEventId?: string;
  turnId?: string | null;
  source?: string | null;
  automation?: AutomationMessageMetadata | null;
  commandSummary?: CommandRunSummaryData;
  contextItems?: ContextItemData[];
}

export interface ProgressStepData {
  id: string;
  label: string;
  status: ProgressStepStatus;
}

export interface EnvironmentInfo {
  changes: string;
  mode: string;
  runtime: string;
  branch: string;
  commit: string;
  pullRequest: string;
  source: string;
  threadId?: string | null;
  turnId?: string | null;
}

export interface RuntimeStatusData {
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

export type ComposerPermissionModeId = 'default' | 'auto-review' | 'full-access';

export type ComposerReasoningEffortId = 'auto' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ComposerPermissionPolicy {
  sandboxMode: 'workspace-write' | 'danger-full-access';
  approvalMode: 'on-request';
  approvalsReviewer: 'user' | 'auto_review';
  networkPermission: 'restricted' | 'enabled';
  redouCodexPermissionProfile: ':workspace' | ':danger-full-access';
}

export interface ComposerSubmitOptions {
  permissionMode: ComposerPermissionModeId;
  permissionPolicy: ComposerPermissionPolicy;
  deliveryMode?: 'auto' | 'new_turn' | 'queue' | 'guide';
  modelSelection?: ModelConfigSelection | null;
  reasoningEffort?: ComposerReasoningEffortId;
  contextItems?: ContextItemData[];
  editTarget?: ComposerEditTarget | null;
}

export interface ComposerEditTarget {
  taskId?: string | null;
  messageId: string;
  prompt: string;
  timestamp?: string;
  sourceEventId?: string;
  turnId?: string | null;
  isInitialPrompt?: boolean;
}

export interface ComposerState {
  placeholder: string;
  permission: string;
  permissionMode: ComposerPermissionModeId;
  model: string;
  modelId?: string;
  modelSelection?: ModelConfigSelection | null;
  reasoningEffort?: ComposerReasoningEffortId;
  runtime: string;
  workspace?: string;
  mode?: string;
  branch?: string;
}

export type {
  AppSettingsSnapshot,
  AutomationMessageMetadata,
  ArtifactPreview,
  ConfiguredModelProvider,
  ModelConfigSelection,
  ModelConfigSnapshot,
  ModelProbeResult,
  ModelProviderPreset,
};

export interface RightPanelDefinition {
  id: RightPanelId;
  label: string;
  description: string;
}

export interface CodeReviewFinding {
  id: string;
  file: string;
  line: number;
  severity: 'low' | 'medium' | 'high';
  message: string;
}

export interface CodeReviewData {
  summary: string;
  changedFiles: number;
  riskLevel: 'low' | 'medium' | 'high';
  findings: CodeReviewFinding[];
}

export interface FileTreeNode {
  id: string;
  name: string;
  type: 'folder' | 'file';
  selected?: boolean;
  defaultExpanded?: boolean;
  children?: FileTreeNode[];
}

export interface ChangeFileData {
  id: string;
  path: string;
  status: 'staged' | 'unstaged';
  insertions: number;
  deletions: number;
  gitStatus?: string;
  indexStatus?: string;
  worktreeStatus?: string;
  staged?: boolean;
  unstaged?: boolean;
  untracked?: boolean;
  binary?: boolean;
  patch?: string;
}

export interface ChangesData {
  files: ChangeFileData[];
  insertions: number;
  deletions: number;
  diffSummary: string;
  patch?: string;
  stat?: string;
}

export interface LogEntryData {
  id: string;
  level: 'info' | 'warn' | 'debug' | 'error';
  message: string;
  time: string;
  kind?: string;
  lifecycle?: string;
  command?: string;
  output?: string;
}

export interface ArtifactData {
  id: string;
  taskId?: string | null;
  projectId?: string | null;
  name: string;
  type: string;
  status: string;
  path?: string | null;
  mimeType?: string | null;
  size?: number;
  createdAt?: string;
  updatedAt?: string;
  content?: string | null;
  uri?: string | null;
  metadata?: Record<string, unknown>;
  preview?: ArtifactPreview;
}

export interface RulesData {
  projectRules: string[];
  taskRules: string[];
}

export interface ContextPackageData {
  summary: string;
  recentMessages: string[];
  selectedFiles: string[];
  selectedDirectories?: string[];
  attachments: string[];
  environment: string[];
}

export type ContextItemKind = 'file' | 'image' | 'directory';

export interface ContextItemData {
  path: string;
  name: string;
  kind: ContextItemKind;
}

export interface BrowserData {
  url: string;
  homeUrl: string;
  title?: string;
  status?: string;
}

export interface WorkbenchMockData {
  projects: WorkbenchProject[];
  activeProjectId: string;
  activeTask: WorkbenchTask;
  agentMessages: AgentThreadMessage[];
  progressSteps: ProgressStepData[];
  environment: EnvironmentInfo;
  composer: ComposerState;
  planEntries: RedouCodexPlanProjection[];
  todoProjectionEntries: TodoProjectionEntry[];
  approvalRequests: ApprovalRequestProjection[];
  rightPanels: RightPanelDefinition[];
  mockFileTree: FileTreeNode[];
  mockCodeReview: CodeReviewData;
  mockChanges: ChangesData;
  mockLogs: LogEntryData[];
  mockArtifacts: ArtifactData[];
  mockRules: RulesData;
  mockContext: ContextPackageData;
  contextItems: ContextItemData[];
  browser: BrowserData;
  runtimeStatus?: RuntimeStatusData | null;
}
