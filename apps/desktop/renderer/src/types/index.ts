import type {
  ConfiguredModelProvider,
  ModelConfigSelection,
  ModelConfigSnapshot,
  ModelProbeResult,
  ModelProviderPreset,
} from '../api/redouApi';

export type RuntimeId = 'redou-codex' | 'codex' | 'hermes' | 'pi' | 'custom';

export type WorkbenchTaskStatus = 'created' | 'running' | 'blocked' | 'error' | 'completed';

export type ProgressStepStatus = 'completed' | 'active' | 'pending' | 'error';

export type WorkbenchView = 'thread' | 'diffReview' | 'artifactPreview' | 'settings';

export type RightPanelId =
  | 'progress'
  | 'codeReview'
  | 'fileExplorer'
  | 'changes'
  | 'logs'
  | 'artifacts'
  | 'rules'
  | 'context';

export interface WorkbenchTask {
  id: string;
  title: string;
  status: WorkbenchTaskStatus;
  runtime: RuntimeId;
  userPrompt?: string;
  projectId?: string;
  updatedAt?: string;
  unread?: boolean;
  queueDepth?: number;
}

export interface WorkbenchProject {
  id: string;
  name: string;
  rootPath?: string;
  pinned?: boolean;
  tasks: WorkbenchTask[];
}

export interface CodexPlanProjection {
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
  kind: string;
  title: string;
  description: string;
  status: string;
}

export interface CommandRunSummaryData {
  count: number;
  label: string;
}

export interface AgentThreadMessage {
  id: string;
  role?: 'assistant' | 'user' | 'system';
  body: string;
  deliveryMode?: string;
  status?: string;
  queueId?: string | null;
  queueState?: string | null;
  sourceEventId?: string;
  turnId?: string | null;
  commandSummary?: CommandRunSummaryData;
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

export type ComposerPermissionModeId = 'default' | 'auto-review' | 'full-access';

export type ComposerReasoningEffortId = 'auto' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ComposerPermissionPolicy {
  sandboxMode: 'workspace-write' | 'danger-full-access';
  approvalMode: 'on-request';
  approvalsReviewer: 'user' | 'auto_review';
  networkPermission: 'restricted' | 'enabled';
}

export interface ComposerSubmitOptions {
  permissionMode: ComposerPermissionModeId;
  permissionPolicy: ComposerPermissionPolicy;
  deliveryMode?: 'auto' | 'new_turn' | 'queue' | 'guide';
  modelSelection?: ModelConfigSelection | null;
  reasoningEffort?: ComposerReasoningEffortId;
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
}

export interface ChangesData {
  files: ChangeFileData[];
  insertions: number;
  deletions: number;
  diffSummary: string;
}

export interface LogEntryData {
  id: string;
  level: 'info' | 'warn' | 'debug' | 'error';
  message: string;
  time: string;
}

export interface ArtifactData {
  id: string;
  name: string;
  type: string;
  status: string;
}

export interface RulesData {
  projectRules: string[];
  taskRules: string[];
}

export interface ContextPackageData {
  summary: string;
  recentMessages: string[];
  selectedFiles: string[];
  attachments: string[];
  environment: string[];
}

export interface WorkbenchMockData {
  projects: WorkbenchProject[];
  activeProjectId: string;
  activeTask: WorkbenchTask;
  agentMessages: AgentThreadMessage[];
  progressSteps: ProgressStepData[];
  environment: EnvironmentInfo;
  composer: ComposerState;
  planEntries: CodexPlanProjection[];
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
  runtimeStatus?: RuntimeStatusData | null;
}
