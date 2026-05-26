import {
  Archive,
  ArrowLeft,
  Bell,
  Bot,
  Camera,
  CalendarClock,
  Check,
  ChevronDown,
  CircleAlert,
  FileText,
  Globe2,
  KeyRound,
  Loader2,
  Monitor,
  Moon,
  Plus,
  Power,
  RotateCcw,
  Server,
  Settings,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type {
  AppSettingsSnapshot,
  ConfiguredModelProvider,
  ModelConfigSelection,
  ModelConfigSnapshot,
  ModelProbeResult,
  ModelProviderPreset,
  WorkbenchProject,
  WorkbenchTask,
} from '../types';

interface SettingsPageProps {
  appSettings: AppSettingsSnapshot;
  projects: WorkbenchProject[];
  archivedTasks: WorkbenchTask[];
  modelConfig: ModelConfigSnapshot;
  onBack: () => void;
  onSelectModel: (selection: ModelConfigSelection) => Promise<void>;
  onProbeModelProvider: (input: unknown) => Promise<ModelProbeResult | null>;
  onSaveModelProvider: (input: unknown) => Promise<void>;
  onRemoveModelProvider: (providerId: string) => Promise<void>;
  onUpdateAppSettings: (patch: Record<string, unknown>) => Promise<void>;
  onNotifyDesktop: (title: string, body: string) => Promise<void>;
  onReloadArchivedTasks: () => Promise<void>;
  onRestoreArchivedTask: (taskId: string) => Promise<void>;
  onDeleteArchivedTask: (taskId: string) => Promise<void>;
  onDeleteAllArchivedTasks: () => Promise<void>;
  onOpenExtensions: (kind?: 'plugin' | 'skill' | 'mcp') => void;
}

interface DraftState {
  provider: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  selectedModel: string;
  models: string[];
  custom: boolean;
  connected: boolean;
  warning: string;
}

const customPreset: ModelProviderPreset = {
  id: 'custom',
  label: '自定义模型',
  description: '手动填写 OpenAI-compatible endpoint。',
  baseUrl: '',
  models: [],
  defaultModel: '',
  region: 'Custom',
  tags: ['custom'],
  apiKeyOptional: true,
};

type SettingsSectionId = 'models' | 'general' | 'appearance' | 'connections' | 'automation' | 'archived';

const navItems: Array<{ id: SettingsSectionId; icon: LucideIcon; label: string }> = [
  { id: 'models', icon: Bot, label: '模型' },
  { id: 'general', icon: Settings, label: '常规' },
  { id: 'appearance', icon: SlidersHorizontal, label: '外观' },
  { id: 'connections', icon: Server, label: '连接' },
  { id: 'automation', icon: CalendarClock, label: 'Automation' },
  { id: 'archived', icon: Archive, label: '已归档对话' },
];

function createDraft(preset: ModelProviderPreset): DraftState {
  return {
    provider: preset.id,
    label: preset.label,
    baseUrl: preset.baseUrl,
    apiKey: '',
    selectedModel: preset.defaultModel || preset.models[0] || '',
    models: preset.models || [],
    custom: preset.id === 'custom',
    connected: false,
    warning: '',
  };
}

function selectedProvider(snapshot: ModelConfigSnapshot) {
  return snapshot.selected
    ? snapshot.providers.find((provider) => provider.id === snapshot.selected?.providerId) || null
    : null;
}

function cleanApiKeyInput(value: string) {
  return value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/[\s\u0000-\u001f\u007f-\u009f\u200b-\u200d\u2060\ufeff]+/g, '')
    .replace(/^["'`]+|["'`]+$/g, '');
}

export function SettingsPage({
  appSettings,
  projects,
  archivedTasks,
  modelConfig,
  onBack,
  onSelectModel,
  onProbeModelProvider,
  onSaveModelProvider,
  onRemoveModelProvider,
  onUpdateAppSettings,
  onNotifyDesktop,
  onReloadArchivedTasks,
  onRestoreArchivedTask,
  onDeleteArchivedTask,
  onDeleteAllArchivedTasks,
  onOpenExtensions,
}: SettingsPageProps) {
  const presets = useMemo(() => [customPreset, ...modelConfig.catalog], [modelConfig.catalog]);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('models');
  const [activePresetId, setActivePresetId] = useState('custom');
  const activePreset = presets.find((preset) => preset.id === activePresetId) || customPreset;
  const [draft, setDraft] = useState<DraftState>(() => createDraft(activePreset));
  const [manualModel, setManualModel] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const activeConfiguredProvider = selectedProvider(modelConfig);

  function choosePreset(preset: ModelProviderPreset) {
    setActivePresetId(preset.id);
    setDraft(createDraft(preset));
    setManualModel('');
    setMessage('');
  }

  function choosePresetById(presetId: string) {
    choosePreset(presets.find((preset) => preset.id === presetId) || customPreset);
  }

  async function connectProvider() {
    setConnecting(true);
    setMessage('');
    const result = await onProbeModelProvider({
      provider: draft.provider,
      label: draft.label,
      baseUrl: draft.baseUrl,
      apiKey: draft.apiKey,
      selectedModel: draft.selectedModel,
      models: draft.models,
      custom: draft.custom,
      apiKeyOptional: activePreset.apiKeyOptional,
    }).finally(() => setConnecting(false));
    if (!result) {
      setMessage('连接失败，请检查 URL 和 API Key。');
      return;
    }
    setDraft((current) => ({
      ...current,
      baseUrl: result.baseUrl || current.baseUrl,
      models: result.models,
      selectedModel: result.defaultModel || result.models[0] || current.selectedModel,
      connected: true,
      warning: result.warning || '',
    }));
    setMessage(result.refreshed ? '连接成功，已刷新可用模型。' : '已使用预置模型列表，可继续保存。');
  }

  async function saveProvider() {
    setSaving(true);
    setMessage('');
    await onSaveModelProvider({
      provider: draft.provider,
      label: draft.label,
      baseUrl: draft.baseUrl,
      apiKey: draft.apiKey,
      models: draft.models,
      selectedModel: draft.selectedModel,
      custom: draft.custom,
      apiKeyOptional: activePreset.apiKeyOptional,
      select: true,
    }).finally(() => setSaving(false));
    setDraft((current) => ({ ...current, apiKey: '', connected: false }));
    setMessage('模型配置已保存并设为当前模型。');
  }

  const canConnect = Boolean(draft.baseUrl && (draft.apiKey || activePreset.apiKeyOptional));
  const canSave = Boolean(draft.baseUrl && draft.selectedModel && draft.models.length && (draft.apiKey || activePreset.apiKeyOptional));

  return (
    <main className="redou-settings-page redou-settings-page-full" aria-label="Settings">
      <aside className="redou-settings-sidebar" aria-label="Settings navigation">
        <button className="redou-settings-back" type="button" onClick={onBack}>
          <ArrowLeft size={16} />
          <span>返回应用</span>
        </button>
        <span className="redou-settings-group-label">设置</span>
        {navItems.map(({ id, icon: Icon, label }) => (
          <button
            className="redou-settings-nav-row"
            data-active={activeSection === id ? 'true' : 'false'}
            type="button"
            key={id}
            onClick={() => setActiveSection(id)}
          >
            <Icon size={17} />
            <span>{label}</span>
          </button>
        ))}
      </aside>

      {activeSection === 'models' ? (
      <section className="redou-model-settings-content" aria-label="Model settings">
        <header className="redou-model-settings-header">
          <div>
            <span className="redou-settings-kicker">模型配置</span>
            <h1>API Key 与可用模型</h1>
          </div>
          <div className="redou-model-settings-summary">
            <strong>{modelConfig.providers.length}</strong>
            <span>已配置厂商</span>
          </div>
        </header>

        <div className="redou-model-settings-grid">
          <section className="redou-settings-panel redou-configured-models" aria-label="Configured models">
            <div className="redou-panel-heading">
              <div>
                <h2>已配置</h2>
                <p>{activeConfiguredProvider ? `当前使用 ${activeConfiguredProvider.label}` : '保存后会出现在对话框下方。'}</p>
              </div>
            </div>

            {modelConfig.providers.length ? (
              <div className="redou-configured-provider-list">
                {modelConfig.providers.map((provider) => (
                  <ConfiguredProvider
                    key={provider.id}
                    provider={provider}
                    selected={modelConfig.selected}
                    onSelectModel={onSelectModel}
                    onRemove={onRemoveModelProvider}
                  />
                ))}
              </div>
            ) : (
              <div className="redou-settings-empty-state">
                <KeyRound size={24} />
                <strong>还没有可用模型</strong>
                <span>选择一个常见厂商，填入 API Key，连接后保存。</span>
              </div>
            )}
          </section>

          <section className="redou-settings-panel redou-add-model-panel" aria-label="Add model">
            <div className="redou-panel-heading">
              <div>
                <h2>新增</h2>
                <p>从下拉菜单选择厂商，必要时手动补充 Base URL、API Key 和模型 ID。</p>
              </div>
              <Plus size={18} />
            </div>

            <div className="redou-provider-select-row">
              <label className="redou-provider-select-label">
                <span>模型厂商</span>
                <select
                  className="redou-provider-select"
                  value={activePresetId}
                  onChange={(event) => choosePresetById(event.target.value)}
                >
                  {presets.map((preset) => (
                    <option value={preset.id} key={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="redou-provider-select-meta">
                <strong>{activePreset.region || 'Custom'}</strong>
                <span>{activePreset.description}</span>
              </div>
            </div>

            <div className="redou-model-form">
              <label>
                <span>厂商名称</span>
                <input
                  value={draft.label}
                  onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value, custom: current.custom || current.provider === 'custom' }))}
                />
              </label>
              <label>
                <span>Base URL</span>
                <input
                  value={draft.baseUrl}
                  placeholder="https://api.example.com/v1"
                  onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))}
                />
              </label>
              <label>
                <span>API Key</span>
                <input
                  value={draft.apiKey}
                  type="password"
                  placeholder={activePreset.apiKeyOptional ? '本地或免鉴权服务可留空' : '只在本机保存'}
                  onChange={(event) => setDraft((current) => ({ ...current, apiKey: cleanApiKeyInput(event.target.value) }))}
                />
              </label>
              <label>
                <span>手动添加模型名</span>
                <div className="redou-inline-model-input">
                  <input
                    value={manualModel}
                    placeholder="例如 deepseek-v4-pro 或 provider/model"
                    onChange={(event) => setManualModel(event.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const value = manualModel.trim();
                      if (!value) return;
                      setDraft((current) => ({
                        ...current,
                        models: Array.from(new Set([value, ...current.models])),
                        selectedModel: value,
                        connected: true,
                      }));
                      setManualModel('');
                    }}
                  >
                    添加
                  </button>
                </div>
              </label>

              <div className="redou-model-form-actions">
                <button className="redou-primary-button" type="button" disabled={!canConnect || connecting} onClick={() => void connectProvider()}>
                  {connecting ? <Loader2 size={16} className="redou-spin-icon" /> : <Server size={16} />}
                  <span>连接</span>
                </button>
                <button className="redou-secondary-button" type="button" disabled={!canSave || saving} onClick={() => void saveProvider()}>
                  {saving ? <Loader2 size={16} className="redou-spin-icon" /> : <Check size={16} />}
                  <span>保存</span>
                </button>
              </div>

              {message || draft.warning ? (
                <div className="redou-model-form-message" data-warning={draft.warning ? 'true' : 'false'}>
                  {draft.warning ? <CircleAlert size={16} /> : <Check size={16} />}
                  <span>{draft.warning || message}</span>
                </div>
              ) : null}

              <div className="redou-model-result-list">
                <div className="redou-result-heading">
                  <span>可用模型</span>
                  <strong>{draft.models.length}</strong>
                </div>
                {draft.models.length ? (
                  <div className="redou-model-chip-list">
                    {draft.models.map((model) => (
                      <button
                        type="button"
                        className="redou-model-chip"
                        data-active={draft.selectedModel === model ? 'true' : 'false'}
                        key={model}
                        onClick={() => setDraft((current) => ({ ...current, selectedModel: model }))}
                      >
                        {model}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="redou-model-list-placeholder">连接后显示模型列表</span>
                )}
              </div>
            </div>
          </section>
        </div>
      </section>
      ) : activeSection === 'archived' ? (
        <ArchivedConversationsPage
          archivedTasks={archivedTasks}
          projects={projects}
          onReload={onReloadArchivedTasks}
          onRestore={onRestoreArchivedTask}
          onDelete={onDeleteArchivedTask}
          onDeleteAll={onDeleteAllArchivedTasks}
        />
      ) : (
        <SettingsCapabilityPage
          section={activeSection}
          settings={appSettings}
          onUpdate={onUpdateAppSettings}
          onNotifyDesktop={onNotifyDesktop}
          onOpenExtensions={onOpenExtensions}
        />
      )}
    </main>
  );
}

function ArchivedConversationsPage({
  archivedTasks,
  projects,
  onReload,
  onRestore,
  onDelete,
  onDeleteAll,
}: {
  archivedTasks: WorkbenchTask[];
  projects: WorkbenchProject[];
  onReload: () => Promise<void>;
  onRestore: (taskId: string) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
  onDeleteAll: () => Promise<void>;
}) {
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);

  useEffect(() => {
    setRefreshing(true);
    void onReload().finally(() => setRefreshing(false));
  }, []);

  async function restoreTask(taskId: string) {
    setBusyTaskId(taskId);
    await onRestore(taskId).finally(() => setBusyTaskId(null));
  }

  async function deleteTask(taskId: string) {
    setBusyTaskId(taskId);
    await onDelete(taskId).finally(() => setBusyTaskId(null));
  }

  async function deleteAll() {
    setBusyTaskId('__all__');
    await onDeleteAll().finally(() => setBusyTaskId(null));
  }

  return (
    <section className="redou-settings-content redou-archived-settings-content" aria-label="Archived conversations">
      <div className="redou-archived-header">
        <div>
          <span className="redou-settings-kicker">对话管理</span>
          <h2>已归档对话</h2>
        </div>
        <button
          className="redou-archived-delete-all"
          type="button"
          disabled={!archivedTasks.length || busyTaskId === '__all__'}
          onClick={() => void deleteAll()}
        >
          <Trash2 size={15} />
          <span>全部删除</span>
        </button>
      </div>

      <div className="redou-archived-panel">
        {archivedTasks.length ? (
          <div className="redou-archived-list">
            {archivedTasks.map((task) => {
              const busy = busyTaskId === task.id;
              return (
                <article className="redou-archived-row" key={task.id}>
                  <div className="redou-archived-row-main">
                    <strong>{task.title || task.userPrompt || '未命名对话'}</strong>
                    <span>{formatArchivedTaskTime(task.archivedAt || task.updatedAt)} · {projectNames.get(task.projectId || '') || task.projectId || '未归属项目'}</span>
                  </div>
                  <div className="redou-archived-row-actions">
                    <button
                      className="redou-archived-icon-action"
                      type="button"
                      aria-label="删除已归档对话"
                      title="删除已归档对话"
                      disabled={busy}
                      onClick={() => void deleteTask(task.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                    <button
                      className="redou-secondary-button redou-archived-restore"
                      type="button"
                      disabled={busy}
                      onClick={() => void restoreTask(task.id)}
                    >
                      <RotateCcw size={15} />
                      <span>取消归档</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="redou-settings-empty-state">
            <Archive size={24} />
            <strong>{refreshing ? '正在加载' : '没有已归档对话'}</strong>
          </div>
        )}
      </div>
    </section>
  );
}

function formatArchivedTaskTime(value?: string | null) {
  if (!value) return '时间未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function SettingsCapabilityPage({
  section,
  settings,
  onUpdate,
  onNotifyDesktop,
  onOpenExtensions,
}: {
  section: Exclude<SettingsSectionId, 'models' | 'archived'>;
  settings: AppSettingsSnapshot;
  onUpdate: (patch: Record<string, unknown>) => Promise<void>;
  onNotifyDesktop: (title: string, body: string) => Promise<void>;
  onOpenExtensions: (kind?: 'plugin' | 'skill' | 'mcp') => void;
}) {
  if (section === 'appearance') {
    return (
      <section className="redou-settings-content" aria-label="Appearance settings">
        <h2>外观</h2>
        <SettingsCard title="主题" description="窗口主题和信息密度">
          <SegmentedSetting
            label="主题"
            value={settings.appearance.theme}
            options={[['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']]}
            onChange={(theme) => onUpdate({ appearance: { theme } })}
          />
          <SegmentedSetting
            label="密度"
            value={settings.appearance.density}
            options={[['comfortable', '舒适'], ['compact', '紧凑']]}
            onChange={(density) => onUpdate({ appearance: { density } })}
          />
          <SettingRow icon={Moon} title="检查器位置" detail="右侧状态栏和活动面板">
            <select value={settings.appearance.inspectorSide} onChange={(event) => void onUpdate({ appearance: { inspectorSide: event.target.value } })}>
              <option value="right">右侧</option>
              <option value="hidden">默认隐藏</option>
            </select>
          </SettingRow>
        </SettingsCard>
      </section>
    );
  }

  if (section === 'connections') {
    return (
      <section className="redou-settings-content" aria-label="Connection settings">
        <h2>连接</h2>
        <SettingsCard title="浏览器与交付物" description="内置浏览器、预览和截图能力">
          <ToggleSetting icon={Globe2} title="内置浏览器" detail={settings.browser.homeUrl} enabled={settings.browser.enabled} onToggle={() => onUpdate({ browser: { enabled: !settings.browser.enabled }, connections: { inAppBrowser: !settings.browser.enabled } })} />
          <SettingRow icon={Globe2} title="浏览器主页" detail="新浏览器视图默认地址">
            <input value={settings.browser.homeUrl} onChange={(event) => void onUpdate({ browser: { homeUrl: event.target.value } })} />
          </SettingRow>
          <ToggleSetting icon={FileIcon} title="Artifact preview" detail="从真实 artifact store 读取预览" enabled={settings.connections.artifactPreview} onToggle={() => onUpdate({ connections: { artifactPreview: !settings.connections.artifactPreview } })} />
          <ToggleSetting icon={Camera} title="截图评论" detail="将截图和评论保存为 artifact" enabled={settings.connections.screenshotCapture} onToggle={() => onUpdate({ connections: { screenshotCapture: !settings.connections.screenshotCapture } })} />
        </SettingsCard>
        <SettingsCard title="媒体" description="语音输入、图片输入和本地图片生成">
          <ToggleSetting icon={Monitor} title="语音输入" detail="使用系统 Web Speech 能力" enabled={settings.media.voiceInput} onToggle={() => onUpdate({ media: { voiceInput: !settings.media.voiceInput } })} />
          <ToggleSetting icon={Camera} title="图片输入" detail="文件选择与拖拽图片上下文" enabled={settings.media.imageInput} onToggle={() => onUpdate({ media: { imageInput: !settings.media.imageInput } })} />
          <ToggleSetting icon={Globe2} title="图片生成" detail="生成图片 artifact 并进入预览" enabled={settings.media.imageGeneration} onToggle={() => onUpdate({ media: { imageGeneration: !settings.media.imageGeneration } })} />
        </SettingsCard>
        <SettingsCard title="MCP 服务器" description="MCP 服务器已移至插件中心统一管理">
          <SettingRow icon={Server} title="统一入口" detail="MCP 服务器已移至 插件中心 > MCP 统一管理。">
            <button className="redou-secondary-button" type="button" onClick={() => onOpenExtensions('mcp')}>前往插件中心 &gt; MCP</button>
          </SettingRow>
        </SettingsCard>
      </section>
    );
  }

  if (section === 'automation') {
    return (
      <section className="redou-settings-content" aria-label="Automation settings">
        <h2>Automation</h2>
        <SettingsCard title="模型自动化权限" description="控制对话中的模型是否能看到并调用 automation.create">
          <ToggleSetting
            icon={CalendarClock}
            title="允许模型创建自动化任务"
            detail="关闭后，即使模型请求创建提醒或定时任务，也不会写入 Automation store。"
            enabled={settings.automation.allowModelCreate}
            onToggle={() => onUpdate({ automation: { allowModelCreate: !settings.automation.allowModelCreate } })}
          />
          <ToggleSetting
            icon={Bot}
            title="向模型暴露 Automation 工具"
            detail="开启后，新对话的模型工具列表才会包含 automation.create。"
            enabled={settings.automation.exposeToolToModel}
            onToggle={() => onUpdate({ automation: { exposeToolToModel: !settings.automation.exposeToolToModel } })}
          />
        </SettingsCard>
        <SettingsCard title="执行结果" description="模型创建的自动化默认绑定当前对话并回写结果">
          <SettingRow icon={CalendarClock} title="对话绑定" detail="由模型创建的任务会保存 conversationId、projectId、source message 和 source model。">
            <span className="redou-settings-inline-status">Always on for model-created automations</span>
          </SettingRow>
        </SettingsCard>
      </section>
    );
  }

  return (
    <section className="redou-settings-content" aria-label="General settings">
      <h2>常规</h2>
      <SettingsCard title="桌面行为" description="通知、防睡眠和启动偏好">
        <ToggleSetting icon={Bell} title="桌面通知" detail="任务结束、失败和测试通知" enabled={settings.desktop.notifications} onToggle={() => onUpdate({ desktop: { notifications: !settings.desktop.notifications } })} />
        <ToggleSetting icon={Power} title="阻止睡眠" detail="长任务运行时保持显示器唤醒" enabled={settings.desktop.preventSleep} onToggle={() => onUpdate({ desktop: { preventSleep: !settings.desktop.preventSleep } })} />
        <ToggleSetting icon={Monitor} title="自动更新" detail="保留桌面更新检查入口" enabled={settings.general.autoUpdate} onToggle={() => onUpdate({ general: { autoUpdate: !settings.general.autoUpdate } })} />
        <SettingRow icon={Settings} title="启动视图" detail="打开 Redou Agent 时进入的页面">
          <select value={settings.general.startupView} onChange={(event) => void onUpdate({ general: { startupView: event.target.value } })}>
            <option value="thread">线程</option>
            <option value="browser">浏览器</option>
            <option value="artifactPreview">交付物</option>
          </select>
        </SettingRow>
        <SettingRow icon={Bell} title="通知测试" detail="发送一条本机通知">
          <button className="redou-secondary-button" type="button" onClick={() => void onNotifyDesktop('Redou Agent', '桌面通知已接通。')}>发送测试</button>
        </SettingRow>
      </SettingsCard>
    </section>
  );
}

function SettingsCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="redou-settings-card">
      <div className="redou-settings-card-title">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function SettingRow({
  icon: Icon,
  title,
  detail,
  children,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <div className="redou-settings-row">
      <div>
        <strong><Icon size={16} /> {title}</strong>
        <span>{detail}</span>
      </div>
      {children}
    </div>
  );
}

function ToggleSetting({
  icon,
  title,
  detail,
  enabled,
  onToggle,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  enabled: boolean;
  onToggle: () => void | Promise<void>;
}) {
  return (
    <SettingRow icon={icon} title={title} detail={detail}>
      <button className="redou-toggle" type="button" data-enabled={enabled ? 'true' : 'false'} aria-pressed={enabled} onClick={() => void onToggle()} />
    </SettingRow>
  );
}

function SegmentedSetting({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void | Promise<void>;
}) {
  return (
    <div className="redou-settings-row">
      <div>
        <strong>{label}</strong>
        <span>{value}</span>
      </div>
      <div className="redou-segmented-control">
        {options.map(([id, text]) => (
          <button type="button" data-active={value === id ? 'true' : 'false'} key={id} onClick={() => void onChange(id)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

const FileIcon = FileText;

function ConfiguredProvider({
  provider,
  selected,
  onSelectModel,
  onRemove,
}: {
  provider: ConfiguredModelProvider;
  selected: ModelConfigSelection | null;
  onSelectModel: (selection: ModelConfigSelection) => Promise<void>;
  onRemove: (providerId: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <article className="redou-configured-provider">
      <div className="redou-configured-provider-top">
        <button type="button" className="redou-configured-provider-title" onClick={() => setExpanded((value) => !value)}>
          <ChevronDown size={16} />
          <div>
            <strong>{provider.label}</strong>
            <span>{provider.baseUrl}</span>
          </div>
        </button>
        <div className="redou-configured-provider-actions">
          <span className="redou-status-pill" data-active={provider.apiKeySet ? 'true' : 'false'}>
            {provider.apiKeySet || provider.apiKeyOptional ? '已连接' : '缺少 Key'}
          </span>
          <button type="button" aria-label="删除配置" title="删除配置" onClick={() => void onRemove(provider.id)}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {expanded ? (
        <div className="redou-configured-model-grid">
          {provider.models.map((model) => {
            const active = selected?.providerId === provider.id && selected?.modelId === model;
            return (
              <button
                type="button"
                className="redou-configured-model"
                data-active={active ? 'true' : 'false'}
                key={model}
                onClick={() => void onSelectModel({ providerId: provider.id, modelId: model })}
              >
                <span>{model}</span>
                {active ? <Check size={15} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}
