import type { WorkbenchMockData } from '../types';

const activeTask = {
  id: 'rewrite-workbench-ui',
  projectId: 'redou-agent',
  title: '继续执行 Redou Workbench Rewrite Phase 1',
  status: 'running' as const,
  runtime: 'redou-codex' as const,
  updatedAt: '13 分',
  unread: true,
  userPrompt:
    '实现一个 Codex-like 的 RedouAgent 桌面端基线版本：左侧项目和任务，中间任务线程，右侧进度与环境信息，底部固定输入框，并补齐 diff review、artifact preview、settings 的页面结构。',
};

export const mockWorkbenchData: WorkbenchMockData = {
  projects: [
    {
      id: 'kt-swu-dissertation',
      name: 'kt-swu-dissertation',
      pinned: true,
      tasks: [
        {
          id: 'db-choice',
          projectId: 'kt-swu-dissertation',
          title: '这个数据库用哪一个更合适',
          status: 'completed',
          runtime: 'redou-codex',
          updatedAt: '21 小时',
        },
      ],
    },
    { id: 'studio-site', name: '工作室网站', pinned: false, tasks: [] },
    { id: 'zhusy-mov', name: 'zhusy_mov', pinned: false, tasks: [] },
    {
      id: 'redou-agent',
      name: 'RedouAgent',
      pinned: true,
      tasks: [
        activeTask,
        {
          id: 'runtime-registry',
          projectId: 'redou-agent',
          title: '继续执行 Redou Workbench Runtime Registry',
          status: 'error',
          runtime: 'redou-codex',
          updatedAt: '18 分',
          unread: true,
        },
        {
          id: 'rewrite-phase-0',
          projectId: 'redou-agent',
          title: '继续执行 Redou Workbench Phase 0',
          status: 'completed',
          runtime: 'redou-codex',
          updatedAt: '1 小时',
        },
        {
          id: 'rewrite-phase-1',
          projectId: 'redou-agent',
          title: '现在先执行 Rewrite Phase 1',
          status: 'completed',
          runtime: 'redou-codex',
          updatedAt: '1 小时',
        },
        {
          id: 'local-redou',
          projectId: 'redou-agent',
          title: '你在本地 RedouAgent 仓库中继续',
          status: 'created',
          runtime: 'redou-codex',
          updatedAt: '2 小时',
        },
      ],
    },
    { id: 'remote-control', name: 'RemoteControl', tasks: [] },
    { id: 'c-code-switch', name: 'c-code-switch', tasks: [] },
    { id: 'llm-unc-dynamics', name: 'llm-unc-dynamics', tasks: [] },
  ],
  activeProjectId: 'redou-agent',
  activeTask,
  agentMessages: [
    {
      id: 'agent-1',
      body:
        '我会先把 RedouAgent 的工作台做成 Codex-like 基线：左侧负责项目和任务，中间负责线程与执行过程，右侧负责进度、环境、变更和交付动作。',
      commandSummary: {
        count: 4,
        label: '已检查项目结构并读取前端入口',
      },
    },
    {
      id: 'agent-2',
      body:
        '当前 renderer 已经有 Workbench 组件雏形，但 mock 数据和部分文案需要清理。下一步会把 UI 结构补到第一阶段可用状态，并保留后续接真实 IPC 数据的位置。',
      commandSummary: {
        count: 3,
        label: '已编辑 UI shell 组件',
      },
    },
    {
      id: 'agent-3',
      body:
        '文件变更会集中展示在右侧环境信息和底部变更条里。用户可以直接进入 diff review，也可以继续输入新的要求。',
    },
  ],
  progressSteps: [
    { id: 'inspect', label: 'Inspect current renderer, store, IPC and runtime snapshot shape', status: 'completed' },
    { id: 'layout', label: 'Patch Codex-like app shell, sidebar, thread and composer layout', status: 'completed' },
    { id: 'panels', label: 'Patch right progress, environment, changes and artifacts panels', status: 'active' },
    { id: 'views', label: 'Add diff review, artifact preview and settings views', status: 'pending' },
    { id: 'verify', label: 'Build renderer and verify desktop/mobile framing', status: 'pending' },
  ],
  environment: {
    changes: '+404 -69',
    mode: '本地',
    runtime: 'redou-codex',
    branch: 'refactor/runtime-registry-codex-workbench',
    commit: '提交',
    pullRequest: '创建拉取请求',
    source: 'Redou runtime snapshot',
  },
  composer: {
    placeholder: '\u8981\u6c42\u540e\u7eed\u53d8\u66f4',
    permission: '\u5b8c\u5168\u8bbf\u95ee\u6743\u9650',
    permissionMode: 'full-access',
    model: '5.5 \u8d85\u9ad8',
    modelId: 'GPT-5.5',
    reasoningEffort: 'xhigh',
    runtime: 'redou-codex',
    workspace: 'RedouAgent',
    mode: '本地模式',
    branch: 'refactor/runtime-regis...',
  },
  planEntries: [
    { id: 'plan-1', title: '复刻整体页面布局和侧边栏结构', status: 'completed' },
    { id: 'plan-2', title: '补齐 agent 执行过程和文件变更展示', status: 'active' },
    { id: 'plan-3', title: '接入 diff review、artifact preview、settings 页面', status: 'pending' },
  ],
  todoProjectionEntries: [
    { id: 'todo-1', title: '主线程区可滚动，输入框固定在底部', status: 'completed' },
    { id: 'todo-2', title: '右侧状态面板可折叠和切换', status: 'active' },
    { id: 'todo-3', title: '设置页按能力域组织', status: 'pending' },
  ],
  approvalRequests: [
    {
      id: 'approval-1',
      kind: 'shell',
      title: '需要运行构建检查',
      description: '允许 RedouAgent 在本地运行 renderer build，以确认 UI 变更没有破坏前端构建。',
      status: 'pending',
    },
  ],
  rightPanels: [
    { id: 'progress', label: '进度', description: '任务计划、当前状态和环境信息' },
    { id: 'changes', label: '变更', description: '文件变更和 diff 摘要' },
    { id: 'artifacts', label: '交付物', description: '任务生成的可预览产物' },
    { id: 'logs', label: '终端', description: '命令和工具调用输出' },
    { id: 'fileExplorer', label: '文件', description: '项目文件树' },
    { id: 'codeReview', label: '审查', description: '代码审查摘要' },
    { id: 'rules', label: '规则', description: '项目规则和任务约束' },
    { id: 'context', label: '上下文', description: '输入材料与上下文包' },
  ],
  mockFileTree: [
    {
      id: 'apps',
      name: 'apps',
      type: 'folder',
      defaultExpanded: true,
      children: [
        {
          id: 'desktop',
          name: 'desktop',
          type: 'folder',
          defaultExpanded: true,
          children: [
            { id: 'src', name: 'src', type: 'folder' },
            { id: 'renderer', name: 'renderer', type: 'folder', selected: true },
          ],
        },
      ],
    },
    {
      id: 'docs',
      name: 'docs',
      type: 'folder',
      children: [{ id: 'architecture', name: 'architecture', type: 'folder' }],
    },
  ],
  mockCodeReview: {
    summary: '当前变更主要集中在 renderer shell、侧边栏、线程区、右侧状态面板和第一阶段页面结构，风险集中在布局响应式和真实 IPC 数据映射。',
    changedFiles: 19,
    riskLevel: 'medium',
    findings: [
      {
        id: 'finding-1',
        file: 'apps/desktop/renderer/src/state/workbenchStore.ts',
        line: 34,
        severity: 'medium',
        message: '真实 IPC 数据为空时需要保留可读的空状态，否则首页会缺少 Codex-like 的任务输入入口。',
      },
      {
        id: 'finding-2',
        file: 'apps/desktop/renderer/src/components/layout/AppShell.tsx',
        line: 18,
        severity: 'low',
        message: '视图切换应保持主 shell 不重挂载，避免丢失输入框状态。',
      },
    ],
  },
  mockChanges: {
    insertions: 404,
    deletions: 69,
    diffSummary:
      'Codex-like RedouAgent UI 基线：新增项目/任务 sidebar、线程工作台、右侧进度和环境面板、diff review、artifact preview、settings 信息架构。',
    files: [
      { id: 'change-1', path: 'apps/desktop/renderer/src/state/mockWorkbenchData.ts', status: 'unstaged', insertions: 180, deletions: 110 },
      { id: 'change-2', path: 'apps/desktop/renderer/src/components/layout/AppShell.tsx', status: 'unstaged', insertions: 64, deletions: 16 },
      { id: 'change-3', path: 'apps/desktop/renderer/src/styles/workbench.css', status: 'unstaged', insertions: 160, deletions: 24 },
      { id: 'change-4', path: 'apps/desktop/renderer/src/components/sidebar/ProjectList.tsx', status: 'unstaged', insertions: 42, deletions: 8 },
    ],
  },
  mockLogs: [
    { id: 'log-1', level: 'info', time: '22:12', message: 'Renderer shell loaded with Redou mock snapshot.' },
    { id: 'log-2', level: 'debug', time: '22:14', message: 'Right panel selected: progress.' },
    { id: 'log-3', level: 'warn', time: '22:17', message: 'Using mock fallback when Electron preload API is unavailable.' },
  ],
  mockArtifacts: [
    { id: 'artifact-1', name: 'redou-workbench-ui-plan.md', type: 'Markdown', status: 'ready' },
    { id: 'artifact-2', name: 'runtime-snapshot.json', type: 'Snapshot', status: 'mock' },
    { id: 'artifact-3', name: 'diff-review-preview.html', type: 'Preview', status: 'draft' },
  ],
  mockRules: {
    projectRules: ['先复刻 Codex-like 工作台结构，再接 RedouAgent 数据。', '不复制 OpenAI/Codex 品牌、Logo、专有图标和文案。'],
    taskRules: ['本阶段只做 UI 基线，不重构后端任务执行逻辑。', '优先展示 agent 正在做什么、改了哪些文件、是否需要确认。'],
  },
  mockContext: {
    summary: '上下文包来自用户提供的 Codex desktop app 截图分析，以及 RedouAgent 当前 renderer 结构。',
    recentMessages: ['用户要求先做 Codex UI 构成分析。', '用户随后要求直接实现 UI。'],
    selectedFiles: ['apps/desktop/renderer/src/App.tsx', 'apps/desktop/renderer/src/components/layout/AppShell.tsx'],
    attachments: ['Codex desktop app 界面截图'],
    environment: ['runtime: Codex-compatible', 'mode: 本地', 'branch: refactor/runtime-registry-codex-workbench'],
  },
};
