import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  FileAudio,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  MoreHorizontal,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  Sparkles,
  TestTube2,
  Trash2,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { redouApi, type ExtensionItem, type ExtensionKind, type McpServerConfig, type MiniMaxPluginConfig, type MiniMaxToolResult } from '../api/redouApi';

type ExtensionActiveKind = 'plugin' | 'skill' | 'mcp';
type ExtensionMode = 'explore' | 'manage';
type CreateTarget = ExtensionActiveKind;
type SourceFilter = 'all' | 'redou' | 'community';
type SkillSourceFilter = 'all' | 'system' | 'user' | 'project';
type McpStatusFilter = 'all' | 'ready' | 'disabled' | 'missing-config' | 'error';

const ACTIVE_KIND_STORAGE_KEY = 'redou.extensions.activeKind';

const kindTabs: Array<{ id: ExtensionActiveKind; label: string }> = [
  { id: 'plugin', label: '插件' },
  { id: 'skill', label: '技能' },
  { id: 'mcp', label: 'MCP' },
];

const pluginCategories = ['全部', 'Coding', 'Productivity', 'App Connectors', 'Multimodal', 'System'];

function extensionKindFromStorage(): ExtensionActiveKind {
  if (typeof window === 'undefined') return 'plugin';
  const stored = window.localStorage.getItem(ACTIVE_KIND_STORAGE_KEY);
  return stored === 'skill' || stored === 'mcp' || stored === 'plugin' ? stored : 'plugin';
}

function sourceLabel(source?: string) {
  if (source === 'system') return '系统';
  if (source === 'bundled') return '内置';
  if (source === 'project') return '项目';
  if (source === 'market') return '市场';
  if (source === 'community') return '社区';
  return '个人';
}

function statusLabel(status?: string) {
  if (status === 'disabled') return 'disabled';
  if (status === 'missing-config') return 'missing-config';
  if (status === 'testing') return 'testing';
  if (status === 'error') return 'error';
  return 'ready';
}

type McpLastTest = {
  ok?: boolean;
  error?: string;
  stderr?: string;
  stdout?: string;
  status?: number;
  statusText?: string;
  toolCount?: number;
  tools?: Array<{ name?: string; description?: string }>;
};

function mcpTestMessage(lastTest?: McpLastTest | null) {
  if (lastTest?.ok) {
    if (typeof lastTest.toolCount === 'number') {
      const toolNames = (lastTest.tools || []).map((tool) => tool.name).filter(Boolean).slice(0, 3);
      return `测试通过，发现 ${lastTest.toolCount} 个工具${toolNames.length ? `：${toolNames.join('、')}` : ''}`;
    }
    return `测试通过${lastTest.status ? `：HTTP ${lastTest.status}` : ''}`;
  }
  return lastTest?.error || lastTest?.stderr || lastTest?.stdout || '测试未通过。';
}

function itemSearchText(item: ExtensionItem) {
  return `${item.name} ${item.title} ${item.description} ${item.category || ''} ${(item.tags || []).join(' ')}`.toLowerCase();
}

function matchesPluginSource(item: ExtensionItem, filter: SourceFilter) {
  if (filter === 'all') return true;
  if (filter === 'redou') return item.source === 'system' || item.source === 'bundled' || item.source === 'market';
  return item.source === 'community' || item.source === 'git' || item.source === 'user';
}

function mcpServerFromItem(item: ExtensionItem): McpServerConfig {
  const raw = (item.raw || {}) as Partial<McpServerConfig>;
  return {
    name: raw.name || item.name,
    displayName: raw.displayName || item.title || raw.name || item.name,
    transport: raw.transport || (raw.url ? 'streamable_http' : 'stdio'),
    command: raw.command || '',
    args: raw.args || [],
    env: raw.env || {},
    inheritEnv: raw.inheritEnv !== false,
    url: raw.url || '',
    enabled: raw.enabled ?? item.enabled,
    startupTimeoutSec: raw.startupTimeoutSec,
    toolTimeoutSec: raw.toolTimeoutSec,
    configPath: raw.configPath || item.configPath,
    raw: isRecord(raw.raw) ? raw.raw : isRecord(item.raw) ? item.raw as Record<string, unknown> : undefined,
  };
}

function isMiniMaxItem(item: ExtensionItem) {
  const raw = item.raw as { name?: string; provider?: string; raw?: { provider?: string } } | null;
  return item.kind === 'plugin' && (
    item.name === 'minimax'
    || item.id === 'plugin:minimax@redou'
    || raw?.provider === 'minimax'
    || raw?.raw?.provider === 'minimax'
  );
}

function miniMaxStatusText(item: ExtensionItem) {
  if (item.status === 'missing-config') return '未配置';
  if (item.status === 'error') return '鉴权失败';
  if (item.status === 'disabled') return '已停用';
  return item.enabled ? '可用' : '已配置';
}

function extensionIcon(item: ExtensionItem) {
  if (item.kind === 'skill') return <Sparkles size={18} />;
  if (item.kind === 'mcp') return <Server size={18} />;
  return <Plug size={18} />;
}

export function ExtensionsPage() {
  const [activeKind, setActiveKind] = useState<ExtensionActiveKind>(extensionKindFromStorage);
  const [mode, setMode] = useState<ExtensionMode>('explore');
  const [items, setItems] = useState<ExtensionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [pluginSource, setPluginSource] = useState<SourceFilter>('all');
  const [pluginCategory, setPluginCategory] = useState('全部');
  const [skillSource, setSkillSource] = useState<SkillSourceFilter>('all');
  const [mcpStatus, setMcpStatus] = useState<McpStatusFilter>('all');
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [createTarget, setCreateTarget] = useState<CreateTarget | null>(null);
  const [editingMcp, setEditingMcp] = useState<ExtensionItem | null>(null);
  const [configuringMiniMax, setConfiguringMiniMax] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [testingItemId, setTestingItemId] = useState<string | null>(null);
  const [testMessages, setTestMessages] = useState<Record<string, string>>({});
  const [mcpTestResults, setMcpTestResults] = useState<Record<string, McpLastTest>>({});
  const createMenuRef = useRef<HTMLDivElement>(null);

  async function load(nextMode = mode) {
    setLoading(true);
    setMessage('');
    const result = nextMode === 'explore'
      ? await redouApi.listExtensionCatalog({ kind: activeKind as ExtensionKind })
      : await redouApi.listExtensions({ kind: activeKind as ExtensionKind, mode: 'manage' });
    setLoading(false);
    if (!result.ok) {
      setMessage(result.error?.message || '加载插件中心失败。');
      return;
    }
    setItems(((result.data || []) as ExtensionItem[]).filter((item) => item.kind === activeKind));
  }

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_KIND_STORAGE_KEY, activeKind);
    void load();
  }, [activeKind, mode]);

  useEffect(() => {
    if (!createMenuOpen) return undefined;
    function close(event: PointerEvent) {
      if (createMenuRef.current?.contains(event.target as Node)) return;
      setCreateMenuOpen(false);
    }
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [createMenuOpen]);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (needle && !itemSearchText(item).includes(needle)) return false;
      if (activeKind === 'plugin') {
        if (!matchesPluginSource(item, pluginSource)) return false;
        if (pluginCategory !== '全部' && item.category !== pluginCategory) return false;
      }
      if (activeKind === 'skill' && skillSource !== 'all' && item.source !== skillSource) return false;
      if (activeKind === 'mcp' && mcpStatus !== 'all' && item.status !== mcpStatus) return false;
      return true;
    });
  }, [activeKind, items, mcpStatus, pluginCategory, pluginSource, query, skillSource]);

  const createEntries = useMemo(() => {
    const entries: Array<{ target: CreateTarget; label: string; icon: LucideIcon }> = [
      { target: 'plugin', label: '创建插件', icon: Plug },
      { target: 'skill', label: '创建技能', icon: Sparkles },
      { target: 'mcp', label: '添加 MCP 服务器', icon: Server },
    ];
    return entries.sort((left, right) => Number(right.target === activeKind) - Number(left.target === activeKind));
  }, [activeKind]);

  async function refresh() {
    setLoading(true);
    const result = await redouApi.refreshExtensions({ kind: activeKind as ExtensionKind });
    setLoading(false);
    if (!result.ok) {
      setMessage(result.error?.message || '刷新失败。');
      return;
    }
    await load();
  }

  async function toggleItem(item: ExtensionItem) {
    setBusyItemId(item.id);
    const result = item.enabled
      ? await redouApi.disableExtension(item.id)
      : await redouApi.enableExtension(item.id);
    setBusyItemId(null);
    if (!result.ok) {
      setMessage(result.error?.message || '状态更新失败。');
      return;
    }
    await load();
  }

  async function removeItem(item: ExtensionItem) {
    if (!window.confirm(`删除 ${item.title || item.name}？`)) return;
    setBusyItemId(item.id);
    const result = item.kind === 'mcp'
      ? await redouApi.removeMcpServer({ name: item.name })
      : await redouApi.removeExtension(item.id);
    setBusyItemId(null);
    if (!result.ok) {
      setMessage(result.error?.message || '删除失败。');
      return;
    }
    await load();
  }

  async function testMcp(item: ExtensionItem) {
    setTestingItemId(item.id);
    const result = await redouApi.testMcpServer({ name: item.name });
    setTestingItemId(null);
    if (!result.ok) {
      const failedTest = { ok: false, error: result.error?.message || '\u6d4b\u8bd5\u5931\u8d25\u3002' };
      setMcpTestResults((current) => ({ ...current, [item.id]: failedTest }));
      setTestMessages((current) => ({ ...current, [item.id]: failedTest.error || '\u6d4b\u8bd5\u5931\u8d25\u3002' }));
      return;
    }
    const lastTest = (result.data as { lastTest?: McpLastTest } | null)?.lastTest;
    if (lastTest) {
      setMcpTestResults((current) => ({ ...current, [item.id]: lastTest }));
      setItems((current) => current.map((entry) => entry.id === item.id
        ? { ...entry, raw: { ...((entry.raw || {}) as Record<string, unknown>), lastTest } }
        : entry));
    }
    setTestMessages((current) => ({ ...current, [item.id]: mcpTestMessage(lastTest) }));
  }

  async function testMiniMax(item: ExtensionItem) {
    setTestingItemId(item.id);
    const result = await redouApi.testMiniMaxConnection({}).finally(() => setTestingItemId(null));
    const payload = result.data as MiniMaxToolResult | null;
    const text = !result.ok
      ? result.error?.message || '测试失败。'
      : payload?.ok
        ? payload.message || '本地配置已通过。'
        : payload?.hint || payload?.message || '测试失败。';
    setTestMessages((current) => ({ ...current, [item.id]: text }));
    await load();
  }

  function openCreate(target: CreateTarget) {
    setCreateMenuOpen(false);
    setCreateTarget(target);
    setEditingMcp(null);
  }

  function openMcpEditor(item: ExtensionItem) {
    setEditingMcp(item);
    setCreateTarget('mcp');
  }

  return (
    <main className="redou-extensions-page" aria-label="插件中心">
      <header className="redou-extensions-topbar">
        <div className="redou-extension-tabs" role="tablist" aria-label="插件中心分类">
          {kindTabs.map((tab) => (
            <button
              type="button"
              role="tab"
              aria-selected={activeKind === tab.id}
              data-active={activeKind === tab.id ? 'true' : 'false'}
              key={tab.id}
              onClick={() => {
                setActiveKind(tab.id);
                setMode('explore');
                setQuery('');
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="redou-extension-actions">
          <button className="redou-extension-host" type="button" disabled>
            <span>本地</span>
            <ChevronDown size={14} />
          </button>
          <button
            className="redou-secondary-button"
            type="button"
            data-active={mode === 'manage' ? 'true' : 'false'}
            onClick={() => setMode((current) => current === 'manage' ? 'explore' : 'manage')}
          >
            <MoreHorizontal size={15} />
            <span>{mode === 'manage' ? '返回探索' : '管理'}</span>
          </button>
          <div className="redou-extension-create" ref={createMenuRef}>
            <button className="redou-secondary-button" type="button" aria-haspopup="menu" aria-expanded={createMenuOpen} onClick={() => setCreateMenuOpen((open) => !open)}>
              <Plus size={15} />
              <span>创建</span>
              <ChevronDown size={14} />
            </button>
            {createMenuOpen ? (
              <div className="redou-extension-create-menu" role="menu">
                {createEntries.map(({ target, label, icon: Icon }) => (
                  <button type="button" role="menuitem" key={target} onClick={() => openCreate(target)}>
                    <Icon size={16} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button className="redou-secondary-button" type="button" disabled={loading} onClick={() => void refresh()}>
            <RefreshCw size={15} className={loading ? 'redou-spin-icon' : undefined} />
            <span>刷新</span>
          </button>
        </div>
      </header>

      {message ? <div className="redou-extension-message">{message}</div> : null}

      {mode === 'manage' ? (
        <ManageView
          kind={activeKind}
          items={filteredItems}
          loading={loading}
          testMessages={testMessages}
          mcpTestResults={mcpTestResults}
          busyItemId={busyItemId}
          testingItemId={testingItemId}
          onToggle={toggleItem}
          onRemove={removeItem}
          onTestMcp={testMcp}
          onEditMcp={openMcpEditor}
          onConfigureMiniMax={() => setConfiguringMiniMax(true)}
          onTestMiniMax={testMiniMax}
        />
      ) : activeKind === 'plugin' ? (
        <PluginExplore
          items={filteredItems}
          query={query}
          source={pluginSource}
          category={pluginCategory}
          busyItemId={busyItemId}
          onQuery={setQuery}
          onSource={setPluginSource}
          onCategory={setPluginCategory}
          onToggle={toggleItem}
          testingItemId={testingItemId}
          testMessages={testMessages}
          onConfigureMiniMax={() => setConfiguringMiniMax(true)}
          onTestMiniMax={testMiniMax}
        />
      ) : activeKind === 'skill' ? (
        <SkillExplore
          items={filteredItems}
          query={query}
          source={skillSource}
          busyItemId={busyItemId}
          onQuery={setQuery}
          onSource={setSkillSource}
          onToggle={toggleItem}
        />
      ) : (
        <McpExplore
          items={filteredItems}
          query={query}
          status={mcpStatus}
          testMessages={testMessages}
          mcpTestResults={mcpTestResults}
          busyItemId={busyItemId}
          testingItemId={testingItemId}
          onQuery={setQuery}
          onStatus={setMcpStatus}
          onToggle={toggleItem}
          onTest={testMcp}
          onEdit={openMcpEditor}
          onRemove={removeItem}
          onAdd={() => openCreate('mcp')}
        />
      )}

      {createTarget === 'plugin' ? <PluginCreateDialog onClose={() => setCreateTarget(null)} onCreated={() => load()} /> : null}
      {createTarget === 'skill' ? <SkillCreateDialog onClose={() => setCreateTarget(null)} onCreated={() => load()} /> : null}
      {createTarget === 'mcp' ? (
        <McpServerDialog
          item={editingMcp}
          onClose={() => {
            setCreateTarget(null);
            setEditingMcp(null);
          }}
          onSaved={() => load()}
        />
      ) : null}
      {configuringMiniMax ? <MiniMaxConfigDialog onClose={() => setConfiguringMiniMax(false)} onSaved={() => load()} /> : null}
    </main>
  );
}

function ToolbarSearch({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (value: string) => void }) {
  return (
    <label className="redou-extension-search">
      <Search size={16} />
      <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function FilterButton({ active, children, onClick }: { active: boolean; children: string; onClick: () => void }) {
  return (
    <button type="button" data-active={active ? 'true' : 'false'} onClick={onClick}>
      {children}
    </button>
  );
}

function PluginExplore({
  items,
  query,
  source,
  category,
  busyItemId,
  testingItemId,
  testMessages,
  onQuery,
  onSource,
  onCategory,
  onToggle,
  onConfigureMiniMax,
  onTestMiniMax,
}: {
  items: ExtensionItem[];
  query: string;
  source: SourceFilter;
  category: string;
  busyItemId: string | null;
  testingItemId: string | null;
  testMessages: Record<string, string>;
  onQuery: (value: string) => void;
  onSource: (value: SourceFilter) => void;
  onCategory: (value: string) => void;
  onToggle: (item: ExtensionItem) => Promise<void>;
  onConfigureMiniMax: () => void;
  onTestMiniMax: (item: ExtensionItem) => Promise<void>;
}) {
  const featured = items.slice(0, 2);
  return (
    <section className="redou-extension-view">
      <div className="redou-extension-hero">
        <div>
          <span className="redou-panel-kicker">Plugin Center</span>
          <h1>让 RedouAgent 按你的方式工作</h1>
        </div>
        <ToolbarSearch value={query} placeholder="搜索插件" onChange={onQuery} />
      </div>
      <div className="redou-extension-filter-row">
        <div className="redou-extension-segment">
          <FilterButton active={source === 'redou'} onClick={() => onSource('redou')}>Built by Redou</FilterButton>
          <FilterButton active={source === 'community'} onClick={() => onSource('community')}>Community</FilterButton>
          <FilterButton active={source === 'all'} onClick={() => onSource('all')}>All</FilterButton>
        </div>
        <div className="redou-extension-segment">
          {pluginCategories.map((item) => (
            <FilterButton active={category === item} key={item} onClick={() => onCategory(item)}>{item}</FilterButton>
          ))}
        </div>
      </div>
      <ExtensionSection title="Featured" count={featured.length}>
        <div className="redou-extension-grid">
          {featured.map((item) => (
            <ExtensionCard
              item={item}
              key={`featured-${item.id}`}
              busy={busyItemId === item.id}
              testing={testingItemId === item.id}
              testMessage={testMessages[item.id]}
              onToggle={onToggle}
              onConfigureMiniMax={onConfigureMiniMax}
              onTestMiniMax={onTestMiniMax}
            />
          ))}
        </div>
      </ExtensionSection>
      <ExtensionSection title="全部插件" count={items.length}>
        <div className="redou-extension-grid">
          {items.map((item) => (
            <ExtensionCard
              item={item}
              key={item.id}
              busy={busyItemId === item.id}
              testing={testingItemId === item.id}
              testMessage={testMessages[item.id]}
              onToggle={onToggle}
              onConfigureMiniMax={onConfigureMiniMax}
              onTestMiniMax={onTestMiniMax}
            />
          ))}
          {!items.length ? <EmptyState text="没有找到匹配的插件。" /> : null}
        </div>
      </ExtensionSection>
    </section>
  );
}

function SkillExplore({
  items,
  query,
  source,
  busyItemId,
  onQuery,
  onSource,
  onToggle,
}: {
  items: ExtensionItem[];
  query: string;
  source: SkillSourceFilter;
  busyItemId: string | null;
  onQuery: (value: string) => void;
  onSource: (value: SkillSourceFilter) => void;
  onToggle: (item: ExtensionItem) => Promise<void>;
}) {
  const groups = [
    { id: 'system', title: '系统', items: items.filter((item) => item.source === 'system' || item.source === 'bundled') },
    { id: 'user', title: '个人', items: items.filter((item) => item.source === 'user') },
    { id: 'project', title: '项目', items: items.filter((item) => item.source === 'project') },
  ];
  return (
    <section className="redou-extension-view">
      <div className="redou-extension-toolbar">
        <ToolbarSearch value={query} placeholder="搜索技能" onChange={onQuery} />
        <div className="redou-extension-segment">
          <FilterButton active={source === 'all'} onClick={() => onSource('all')}>全部</FilterButton>
          <FilterButton active={source === 'system'} onClick={() => onSource('system')}>系统</FilterButton>
          <FilterButton active={source === 'user'} onClick={() => onSource('user')}>个人</FilterButton>
          <FilterButton active={source === 'project'} onClick={() => onSource('project')}>项目</FilterButton>
        </div>
      </div>
      {groups.map((group) => (
        <ExtensionSection title={group.title} count={group.items.length} key={group.id}>
          <div className="redou-extension-grid">
            {group.items.map((item) => <ExtensionCard item={item} key={item.id} busy={busyItemId === item.id} compact onToggle={onToggle} />)}
          </div>
        </ExtensionSection>
      ))}
      {!items.length ? <EmptyState text="没有找到匹配的技能。" /> : null}
    </section>
  );
}

function McpExplore({
  items,
  query,
  status,
  testMessages,
  mcpTestResults,
  busyItemId,
  testingItemId,
  onQuery,
  onStatus,
  onToggle,
  onTest,
  onEdit,
  onRemove,
  onAdd,
}: {
  items: ExtensionItem[];
  query: string;
  status: McpStatusFilter;
  testMessages: Record<string, string>;
  mcpTestResults: Record<string, McpLastTest>;
  busyItemId: string | null;
  testingItemId: string | null;
  onQuery: (value: string) => void;
  onStatus: (value: McpStatusFilter) => void;
  onToggle: (item: ExtensionItem) => Promise<void>;
  onTest: (item: ExtensionItem) => Promise<void>;
  onEdit: (item: ExtensionItem) => void;
  onRemove: (item: ExtensionItem) => Promise<void>;
  onAdd: () => void;
}) {
  return (
    <section className="redou-extension-view">
      <div className="redou-extension-toolbar">
        <ToolbarSearch value={query} placeholder="搜索 MCP" onChange={onQuery} />
        <div className="redou-extension-segment">
          <FilterButton active={status === 'all'} onClick={() => onStatus('all')}>全部</FilterButton>
          <FilterButton active={status === 'ready'} onClick={() => onStatus('ready')}>已启用</FilterButton>
          <FilterButton active={status === 'missing-config'} onClick={() => onStatus('missing-config')}>未配置</FilterButton>
          <FilterButton active={status === 'error'} onClick={() => onStatus('error')}>异常</FilterButton>
        </div>
      </div>
      <ExtensionSection title="推荐 MCP" count={0}>
        <div className="redou-extension-recommendation">
          <Server size={18} />
          <div>
            <strong>推荐源尚未配置</strong>
            <span>可以先添加自定义 MCP 服务器，后续接入市场推荐。</span>
          </div>
          <button className="redou-secondary-button" type="button" onClick={onAdd}>
            <Plus size={15} />
            <span>添加 MCP</span>
          </button>
        </div>
      </ExtensionSection>
      <ExtensionSection title="自定义 MCP" count={items.length}>
        <div className="redou-extension-list">
          {items.map((item) => (
            <McpRow
              item={item}
              key={item.id}
              busy={busyItemId === item.id}
              testing={testingItemId === item.id}
              testMessage={testMessages[item.id]}
              testResult={mcpTestResults[item.id]}
              onToggle={onToggle}
              onTest={onTest}
              onEdit={onEdit}
              onRemove={onRemove}
            />
          ))}
          {!items.length ? <EmptyState text="还没有配置 MCP 服务器。" /> : null}
        </div>
      </ExtensionSection>
    </section>
  );
}

function ManageView({
  kind,
  items,
  loading,
  testMessages,
  mcpTestResults,
  busyItemId,
  testingItemId,
  onToggle,
  onRemove,
  onTestMcp,
  onEditMcp,
  onConfigureMiniMax,
  onTestMiniMax,
}: {
  kind: ExtensionActiveKind;
  items: ExtensionItem[];
  loading: boolean;
  testMessages: Record<string, string>;
  mcpTestResults: Record<string, McpLastTest>;
  busyItemId: string | null;
  testingItemId: string | null;
  onToggle: (item: ExtensionItem) => Promise<void>;
  onRemove: (item: ExtensionItem) => Promise<void>;
  onTestMcp: (item: ExtensionItem) => Promise<void>;
  onEditMcp: (item: ExtensionItem) => void;
  onConfigureMiniMax: () => void;
  onTestMiniMax: (item: ExtensionItem) => Promise<void>;
}) {
  const title = kind === 'plugin' ? '已安装插件' : kind === 'skill' ? '技能管理' : 'MCP 服务器';
  return (
    <section className="redou-extension-view">
      <ExtensionSection title={title} count={items.length}>
        <div className="redou-extension-list">
          {items.map((item) => kind === 'mcp' ? (
            <McpRow
              item={item}
              key={item.id}
              busy={busyItemId === item.id}
              testing={testingItemId === item.id}
              testMessage={testMessages[item.id]}
              testResult={mcpTestResults[item.id]}
              onToggle={onToggle}
              onTest={onTestMcp}
              onEdit={onEditMcp}
              onRemove={onRemove}
            />
          ) : (
            <ManageRow
              item={item}
              key={item.id}
              busy={busyItemId === item.id}
              testing={testingItemId === item.id}
              testMessage={testMessages[item.id]}
              onToggle={onToggle}
              onRemove={onRemove}
              onConfigureMiniMax={onConfigureMiniMax}
              onTestMiniMax={onTestMiniMax}
            />
          ))}
          {!items.length ? <EmptyState text={loading ? '正在加载...' : '没有可管理的项目。'} /> : null}
        </div>
      </ExtensionSection>
    </section>
  );
}

function ExtensionSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="redou-extension-section">
      <div className="redou-extension-section-heading">
        <h2>{title}</h2>
        <span>{count}</span>
      </div>
      {children}
    </section>
  );
}

function ExtensionCard({
  item,
  busy,
  testing = false,
  testMessage,
  compact,
  onToggle,
  onConfigureMiniMax,
  onTestMiniMax,
}: {
  item: ExtensionItem;
  busy: boolean;
  testing?: boolean;
  testMessage?: string;
  compact?: boolean;
  onToggle: (item: ExtensionItem) => Promise<void>;
  onConfigureMiniMax?: () => void;
  onTestMiniMax?: (item: ExtensionItem) => Promise<void>;
}) {
  const minimax = isMiniMaxItem(item);
  return (
    <article className="redou-extension-card" data-compact={compact ? 'true' : 'false'} data-provider={minimax ? 'minimax' : undefined}>
      <div className="redou-extension-card-icon">{extensionIcon(item)}</div>
      <div className="redou-extension-card-main">
        <div>
          <strong>{item.title || item.name}</strong>
          <span>{item.description || item.path || 'Redou extension'}</span>
        </div>
        <div className="redou-extension-meta">
          <span>{sourceLabel(item.source)}</span>
          {item.category ? <span>{item.category}</span> : null}
          {minimax ? <span>{miniMaxStatusText(item)}</span> : null}
          {minimax && testMessage ? <span>{testMessage}</span> : null}
        </div>
      </div>
      {minimax ? (
        <div className="redou-extension-card-actions">
          <button className="redou-extension-icon-action" type="button" aria-label="配置" title="配置" onClick={onConfigureMiniMax}>
            <Settings size={16} />
          </button>
          <button className="redou-extension-icon-action" type="button" aria-label="测试" title="测试" disabled={testing} onClick={() => onTestMiniMax && void onTestMiniMax(item)}>
            <TestTube2 size={16} className={testing ? 'redou-spin-icon' : undefined} />
          </button>
          <button className="redou-extension-install" type="button" disabled={busy} aria-label={item.enabled ? '禁用' : '启用'} onClick={() => void onToggle(item)}>
            {item.enabled ? <Check size={16} /> : <Plus size={16} />}
          </button>
        </div>
      ) : (
        <button className="redou-extension-install" type="button" disabled={busy} aria-label={item.enabled ? '禁用' : '启用'} onClick={() => void onToggle(item)}>
          {item.enabled ? <Check size={16} /> : <Plus size={16} />}
        </button>
      )}
    </article>
  );
}

function ManageRow({
  item,
  busy,
  testing = false,
  testMessage,
  onToggle,
  onRemove,
  onConfigureMiniMax,
  onTestMiniMax,
}: {
  item: ExtensionItem;
  busy: boolean;
  testing?: boolean;
  testMessage?: string;
  onToggle: (item: ExtensionItem) => Promise<void>;
  onRemove: (item: ExtensionItem) => Promise<void>;
  onConfigureMiniMax?: () => void;
  onTestMiniMax?: (item: ExtensionItem) => Promise<void>;
}) {
  const minimax = isMiniMaxItem(item);
  return (
    <article className="redou-extension-row">
      <div className="redou-extension-card-icon">{extensionIcon(item)}</div>
      <div className="redou-extension-row-main">
        <strong>{item.title || item.name}</strong>
        <span>{item.description || item.path || item.name}</span>
        <div className="redou-extension-meta">
          <span>{sourceLabel(item.source)}</span>
          <span>{minimax ? miniMaxStatusText(item) : statusLabel(item.status)}</span>
          {minimax && testMessage ? <span>{testMessage}</span> : null}
        </div>
      </div>
      <Toggle checked={item.enabled} disabled={busy} onChange={() => void onToggle(item)} />
      {minimax ? (
        <>
          <button className="redou-extension-icon-action" type="button" aria-label="测试连接" title="测试连接" disabled={testing} onClick={() => onTestMiniMax && void onTestMiniMax(item)}>
            <TestTube2 size={16} className={testing ? 'redou-spin-icon' : undefined} />
          </button>
          <button className="redou-extension-icon-action" type="button" aria-label="配置" title="配置" onClick={onConfigureMiniMax}>
            <Settings size={16} />
          </button>
        </>
      ) : null}
      <button className="redou-extension-icon-action" type="button" aria-label="更多" title="更多" disabled>
        <MoreHorizontal size={16} />
      </button>
      {item.canRemove ? (
        <button className="redou-extension-icon-action" type="button" aria-label="删除" title="删除" disabled={busy} onClick={() => void onRemove(item)}>
          <Trash2 size={16} />
        </button>
      ) : null}
    </article>
  );
}

function mcpLastTestFromItem(item: ExtensionItem): McpLastTest | null {
  const raw = (item.raw || {}) as { lastTest?: McpLastTest; raw?: { lastTest?: McpLastTest } };
  return raw.lastTest || raw.raw?.lastTest || null;
}

function mcpToolsText(lastTest?: McpLastTest | null) {
  if (!lastTest) return '\u5c1a\u672a\u68c0\u6d4b';
  if (!lastTest.ok) return '\u68c0\u6d4b\u5931\u8d25';
  const names = (lastTest.tools || []).map((tool) => tool.name).filter(Boolean);
  const count = typeof lastTest.toolCount === 'number' ? lastTest.toolCount : names.length;
  if (!count) return `0 \u4e2a`;
  if (!names.length) return `${count} \u4e2a`;
  const preview = names.slice(0, 8).join('\u3001');
  return names.length < count ? `${preview} \u7b49 ${count} \u4e2a` : `${preview}\uff08${count} \u4e2a\uff09`;
}

function McpRow({
  item,
  busy,
  testing,
  testMessage,
  testResult,
  onToggle,
  onTest,
  onEdit,
  onRemove,
}: {
  item: ExtensionItem;
  busy: boolean;
  testing: boolean;
  testMessage?: string;
  testResult?: McpLastTest;
  onToggle: (item: ExtensionItem) => Promise<void>;
  onTest: (item: ExtensionItem) => Promise<void>;
  onEdit: (item: ExtensionItem) => void;
  onRemove: (item: ExtensionItem) => Promise<void>;
}) {
  const server = mcpServerFromItem(item);
  const detail = server.transport === 'stdio'
    ? [server.command, ...((Array.isArray(server.args) ? server.args : String(server.args || '').split(/\s+/)).filter(Boolean))].filter(Boolean).join(' ')
    : server.url;
  const lastTest = testResult || mcpLastTestFromItem(item);
  return (
    <article className="redou-extension-row redou-mcp-row" data-status={statusLabel(item.status)}>
      <div className="redou-extension-card-icon"><Server size={18} /></div>
      <div className="redou-extension-row-main">
        <strong>{item.title || item.name}</strong>
        <span>{detail || '缺少启动命令或 URL'}</span>
        <div className="redou-mcp-tools-line" title={mcpToolsText(lastTest)}>
          <span className="redou-mcp-tools-label">{'\u53ef\u7528\u5de5\u5177'}</span>
          <span className="redou-mcp-tools-value">{mcpToolsText(lastTest)}</span>
        </div>
        <div className="redou-extension-meta">
          <span>{server.transport === 'stdio' ? 'STDIO' : 'HTTP'}</span>
          <span>{statusLabel(item.status)}</span>
          {testMessage ? <span>{testMessage}</span> : null}
        </div>
      </div>
      <Toggle checked={item.enabled} disabled={busy} onChange={() => void onToggle(item)} />
      <button className="redou-extension-icon-action" type="button" aria-label="测试连接" title="测试连接" disabled={testing} onClick={() => void onTest(item)}>
        <TestTube2 size={16} className={testing ? 'redou-spin-icon' : undefined} />
      </button>
      <button className="redou-extension-icon-action" type="button" aria-label="编辑" title="编辑" onClick={() => onEdit(item)}>
        <Pencil size={16} />
      </button>
      <button className="redou-extension-icon-action" type="button" aria-label="删除" title="删除" disabled={busy} onClick={() => void onRemove(item)}>
        <Trash2 size={16} />
      </button>
    </article>
  );
}

function Toggle({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <button className="redou-toggle" type="button" data-enabled={checked ? 'true' : 'false'} disabled={disabled} aria-pressed={checked} onClick={onChange} />
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="redou-extension-empty">{text}</div>;
}

function DialogFrame({ title, children, onClose, className = '' }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  return (
    <div className="redou-extension-dialog-backdrop" role="presentation">
      <section className={`redou-extension-dialog ${className}`.trim()} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

const miniMaxTtsModels = ['speech-2.8-hd', 'speech-2.8-turbo', 'speech-2.6-hd', 'speech-02-hd'];
const miniMaxAspectRatios = ['1:1', '16:9', '9:16', '4:3', '3:4'];

function defaultMiniMaxConfig(): MiniMaxPluginConfig {
  return {
    enabled: false,
    provider: 'minimax',
    driver: 'direct_http',
    region: 'cn',
    host: 'https://api.minimaxi.com',
    outputDir: '.redou/minimax-output',
    defaults: {
      ttsModel: 'speech-2.8-hd',
      voiceId: 'male-qn-qingse',
      audioFormat: 'mp3',
      imageModel: 'image-01',
      imageAspectRatio: '16:9',
    },
  };
}

function miniMaxHostForRegion(region: MiniMaxPluginConfig['region'], currentHost: string) {
  if (region === 'cn') return 'https://api.minimaxi.com';
  if (region === 'global') return 'https://api.minimax.io';
  return currentHost || 'https://api.minimaxi.com';
}

function MiniMaxConfigDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [config, setConfig] = useState<MiniMaxPluginConfig>(defaultMiniMaxConfig);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testingAudio, setTestingAudio] = useState(false);
  const [testingImage, setTestingImage] = useState(false);
  const [message, setMessage] = useState('');
  const [audioText, setAudioText] = useState('Redou 正在测试 MiniMax 语音生成。');
  const [imagePrompt, setImagePrompt] = useState('一只橘猫坐在电脑旁，赛博朋克风格，16:9');
  const [audioResult, setAudioResult] = useState<MiniMaxToolResult | null>(null);
  const [imageResult, setImageResult] = useState<MiniMaxToolResult | null>(null);

  useEffect(() => {
    let active = true;
    redouApi.getMiniMaxConfig().then((result) => {
      if (!active) return;
      setLoading(false);
      if (result.ok && result.data) {
        setConfig(result.data);
      } else {
        setMessage(result.error?.message || '加载 MiniMax 配置失败。');
      }
    });
    return () => {
      active = false;
    };
  }, []);

  function updateConfig(patch: Partial<MiniMaxPluginConfig>) {
    setConfig((current) => ({ ...current, ...patch }));
  }

  function updateDefaults(patch: Partial<MiniMaxPluginConfig['defaults']>) {
    setConfig((current) => ({ ...current, defaults: { ...current.defaults, ...patch } }));
  }

  function changeRegion(region: MiniMaxPluginConfig['region']) {
    setConfig((current) => ({
      ...current,
      region,
      host: miniMaxHostForRegion(region, current.host),
    }));
  }

  function buildConfigPayload() {
    const payload: Record<string, unknown> = {
      enabled: config.enabled,
      provider: 'minimax',
      driver: 'direct_http',
      region: config.region,
      host: config.host,
      outputDir: config.outputDir,
      defaults: config.defaults,
    };
    if (apiKey.trim()) payload.apiKey = apiKey.trim();
    return payload;
  }

  async function save() {
    setSaving(true);
    setMessage('');
    const result = await redouApi.saveMiniMaxConfig(buildConfigPayload()).finally(() => setSaving(false));
    if (!result.ok || !result.data) {
      setMessage(result.error?.message || '保存 MiniMax 配置失败。');
      return;
    }
    setConfig(result.data);
    setApiKey('');
    setMessage('配置已保存。');
    await onSaved();
  }

  async function testConnection() {
    setTestingConnection(true);
    setMessage('');
    const result = await redouApi.testMiniMaxConnection({ config: buildConfigPayload() }).finally(() => setTestingConnection(false));
    const payload = result.data as MiniMaxToolResult | null;
    setMessage(!result.ok
      ? result.error?.message || '测试失败。'
      : payload?.ok ? payload.message || '本地配置已通过。' : payload?.hint || payload?.message || '测试失败。');
    await onSaved();
  }

  async function testAudio() {
    setTestingAudio(true);
    setAudioResult(null);
    setMessage('');
    const result = await redouApi.miniMaxTextToAudio({
      config: buildConfigPayload(),
      text: audioText,
      model: config.defaults.ttsModel,
      voice_id: config.defaults.voiceId,
      output_format: 'url',
    }).finally(() => setTestingAudio(false));
    const payload = result.data as MiniMaxToolResult | null;
    if (!result.ok || !payload?.ok) {
      setMessage(result.error?.message || payload?.hint || payload?.message || '测试语音失败。');
      return;
    }
    setAudioResult(payload);
    setMessage('测试语音已生成。');
  }

  async function testImage() {
    setTestingImage(true);
    setImageResult(null);
    setMessage('');
    const result = await redouApi.miniMaxTextToImage({
      config: buildConfigPayload(),
      prompt: imagePrompt,
      model: config.defaults.imageModel,
      aspect_ratio: config.defaults.imageAspectRatio,
      response_format: 'url',
      n: 1,
    }).finally(() => setTestingImage(false));
    const payload = result.data as MiniMaxToolResult | null;
    if (!result.ok || !payload?.ok) {
      setMessage(result.error?.message || payload?.hint || payload?.message || '测试图片失败。');
      return;
    }
    setImageResult(payload);
    setMessage('测试图片已生成。');
  }

  async function openOutput(input: Record<string, unknown> = {}) {
    const result = await redouApi.openMiniMaxOutputDir({ config: buildConfigPayload(), ...input });
    if (!result.ok) setMessage(result.error?.message || '打开失败。');
  }

  const canSave = Boolean(config.host.trim() && config.outputDir.trim() && config.defaults.ttsModel && config.defaults.voiceId && config.defaults.imageModel);
  const apiPlaceholder = config.apiKeySet && config.apiKeyMask ? `已保存 ${config.apiKeyMask}` : 'MINIMAX_API_KEY';

  return (
    <DialogFrame title="MiniMax 多模态" onClose={onClose} className="redou-minimax-dialog">
      <div className="redou-extension-form redou-minimax-form">
        {loading ? <div className="redou-extension-empty">正在加载配置...</div> : null}
        <div className="redou-minimax-summary">
          <div>
            <strong>当前接入方式：Direct HTTP</strong>
            <span>text_to_audio / text_to_image 会调用 MiniMax API，可能消耗 Token Plan 额度或账户余额。</span>
          </div>
          <label className="redou-extension-checkbox">
            <input type="checkbox" checked={config.enabled} onChange={(event) => updateConfig({ enabled: event.target.checked })} />
            <span>启用插件</span>
          </label>
        </div>
        <div className="redou-mcp-credential-grid">
          <label>
            <span>Region</span>
            <select value={config.region} onChange={(event) => changeRegion(event.target.value as MiniMaxPluginConfig['region'])}>
              <option value="cn">中国大陆 cn</option>
              <option value="global">Global global</option>
              <option value="advanced">自定义 advanced</option>
            </select>
          </label>
          <label>
            <span>Host</span>
            <input value={config.host} disabled={config.region !== 'advanced'} spellCheck={false} onChange={(event) => updateConfig({ host: event.target.value })} />
          </label>
        </div>
        <label>
          <span>API Key</span>
          <div className="redou-secret-field">
            <input
              value={apiKey}
              type={showApiKey ? 'text' : 'password'}
              placeholder={apiPlaceholder}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <button type="button" title={showApiKey ? '隐藏 API Key' : '显示 API Key'} onClick={() => setShowApiKey((shown) => !shown)}>
              {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </label>
        <label>
          <span>输出目录</span>
          <div className="redou-extension-inline-field">
            <input value={config.outputDir} spellCheck={false} onChange={(event) => updateConfig({ outputDir: event.target.value })} />
            <button type="button" title="打开输出目录" onClick={() => void openOutput()}>
              <FolderOpen size={15} />
            </button>
          </div>
        </label>
        <div className="redou-minimax-grid">
          <label>
            <span>默认语音模型</span>
            <select value={config.defaults.ttsModel} onChange={(event) => updateDefaults({ ttsModel: event.target.value })}>
              {miniMaxTtsModels.map((model) => <option value={model} key={model}>{model}</option>)}
            </select>
          </label>
          <label>
            <span>默认音色</span>
            <input value={config.defaults.voiceId} spellCheck={false} onChange={(event) => updateDefaults({ voiceId: event.target.value })} />
          </label>
          <label>
            <span>默认图片模型</span>
            <input value={config.defaults.imageModel} spellCheck={false} onChange={(event) => updateDefaults({ imageModel: event.target.value })} />
          </label>
          <label>
            <span>默认图片比例</span>
            <select value={config.defaults.imageAspectRatio} onChange={(event) => updateDefaults({ imageAspectRatio: event.target.value })}>
              {miniMaxAspectRatios.map((ratio) => <option value={ratio} key={ratio}>{ratio}</option>)}
            </select>
          </label>
        </div>
        <div className="redou-minimax-test-grid">
          <section>
            <div className="redou-minimax-test-heading">
              <FileAudio size={16} />
              <strong>测试语音</strong>
            </div>
            <textarea value={audioText} onChange={(event) => setAudioText(event.target.value)} />
            <button className="redou-secondary-button" type="button" disabled={testingAudio} onClick={() => void testAudio()}>
              <TestTube2 size={15} className={testingAudio ? 'redou-spin-icon' : undefined} />
              <span>生成测试语音</span>
            </button>
            {audioResult?.filePath ? (
              <div className="redou-minimax-result">
                <span>{audioResult.filePath}</span>
                <div>
                  <button type="button" onClick={() => void openOutput({ filePath: audioResult.filePath, openFile: true })}>打开文件</button>
                  <button type="button" onClick={() => void openOutput({ filePath: audioResult.filePath })}>打开目录</button>
                </div>
              </div>
            ) : null}
          </section>
          <section>
            <div className="redou-minimax-test-heading">
              <ImageIcon size={16} />
              <strong>测试图片</strong>
            </div>
            <textarea value={imagePrompt} onChange={(event) => setImagePrompt(event.target.value)} />
            <button className="redou-secondary-button" type="button" disabled={testingImage} onClick={() => void testImage()}>
              <TestTube2 size={15} className={testingImage ? 'redou-spin-icon' : undefined} />
              <span>生成测试图片</span>
            </button>
            {imageResult?.files?.length ? (
              <div className="redou-minimax-result">
                {imageResult.previews?.[0]?.dataUrl ? <img src={imageResult.previews[0].dataUrl} alt="MiniMax 生成图片缩略图" /> : null}
                <span>{imageResult.files[0]}</span>
                <div>
                  <button type="button" onClick={() => void openOutput({ filePath: imageResult.files?.[0], openFile: true })}>打开文件</button>
                  <button type="button" onClick={() => void openOutput({ filePath: imageResult.files?.[0] })}>打开目录</button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
        {message ? <p className="redou-extension-form-message">{message}</p> : null}
        <div className="redou-extension-form-actions">
          <button className="redou-secondary-button" type="button" disabled={testingConnection} onClick={() => void testConnection()}>
            <TestTube2 size={15} className={testingConnection ? 'redou-spin-icon' : undefined} />
            <span>测试连接</span>
          </button>
          <button className="redou-secondary-button" type="button" onClick={onClose}>关闭</button>
          <button className="redou-primary-button" type="button" disabled={!canSave || saving} onClick={() => void save()}>
            <Check size={15} />
            <span>保存</span>
          </button>
        </div>
      </div>
    </DialogFrame>
  );
}

function SkillCreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState<'user' | 'project'>('user');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function save() {
    setSaving(true);
    setMessage('');
    const result = await redouApi.createSkill({ name, description, location }).finally(() => setSaving(false));
    if (!result.ok) {
      setMessage(result.error?.message || '创建技能失败。');
      return;
    }
    await onCreated();
    onClose();
  }

  return (
    <DialogFrame title="创建技能" onClose={onClose}>
      <div className="redou-extension-form">
        <label><span>技能名称</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label><span>描述</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <label><span>位置</span><select value={location} onChange={(event) => setLocation(event.target.value as 'user' | 'project')}><option value="user">用户</option><option value="project">项目</option></select></label>
        {message ? <p className="redou-extension-form-message">{message}</p> : null}
        <div className="redou-extension-form-actions">
          <button className="redou-secondary-button" type="button" onClick={onClose}>取消</button>
          <button className="redou-primary-button" type="button" disabled={!name.trim() || saving} onClick={() => void save()}>
            <Sparkles size={15} />
            <span>生成 SKILL.md</span>
          </button>
        </div>
      </div>
    </DialogFrame>
  );
}

function PluginCreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [author, setAuthor] = useState('');
  const [directory, setDirectory] = useState('');
  const [includeSkills, setIncludeSkills] = useState(true);
  const [includeReadme, setIncludeReadme] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function chooseDirectory() {
    const result = await redouApi.selectContextItems({ kind: 'directory', title: '选择插件目录' });
    if (result.ok && !result.data?.canceled && result.data?.items?.[0]?.path) {
      setDirectory(result.data.items[0].path);
    }
  }

  async function save() {
    setSaving(true);
    setMessage('');
    const result = await redouApi.createPlugin({ name, description, author, directory, includeSkills, includeReadme }).finally(() => setSaving(false));
    if (!result.ok) {
      setMessage(result.error?.message || '创建插件失败。');
      return;
    }
    await onCreated();
    onClose();
  }

  return (
    <DialogFrame title="创建插件" onClose={onClose}>
      <div className="redou-extension-form">
        <label><span>插件名称</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label><span>描述</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <label><span>作者</span><input value={author} onChange={(event) => setAuthor(event.target.value)} /></label>
        <label>
          <span>目录</span>
          <div className="redou-extension-inline-field">
            <input value={directory} placeholder="默认写入 Redou Codex 本地插件目录" onChange={(event) => setDirectory(event.target.value)} />
            <button type="button" onClick={() => void chooseDirectory()}><FolderPlus size={15} /></button>
          </div>
        </label>
        <label className="redou-extension-checkbox"><input type="checkbox" checked={includeSkills} onChange={(event) => setIncludeSkills(event.target.checked)} /><span>生成 skills/ 目录</span></label>
        <label className="redou-extension-checkbox"><input type="checkbox" checked={includeReadme} onChange={(event) => setIncludeReadme(event.target.checked)} /><span>生成 README.md</span></label>
        {message ? <p className="redou-extension-form-message">{message}</p> : null}
        <div className="redou-extension-form-actions">
          <button className="redou-secondary-button" type="button" onClick={onClose}>取消</button>
          <button className="redou-primary-button" type="button" disabled={!name.trim() || saving} onClick={() => void save()}>
            <Plug size={15} />
            <span>生成插件</span>
          </button>
        </div>
      </div>
    </DialogFrame>
  );
}

function parseArgs(value: string) {
  return value.split(/\r?\n|,/).map((part) => part.trim()).filter(Boolean);
}

function parseEnv(value: string) {
  const env: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf('=');
    if (index < 0) {
      env[trimmed] = '';
      continue;
    }
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return env;
}

function envTextFromRecord(env: Record<string, string>) {
  return Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n');
}

function isPlaceholderEnvValue(key: string, value: string) {
  const normalizedKey = key.trim().toLowerCase();
  const normalizedValue = value.trim().toLowerCase();
  return normalizedValue === normalizedKey
    || normalizedValue === ''
    || normalizedValue.includes('your_')
    || normalizedValue.includes('<')
    || normalizedValue.includes('api_key_here');
}

function isSecretEnvKey(key: string) {
  return /(^|_)(api_?key|access_token|bearer_token|token|secret|password)$/i.test(key.trim());
}

function splitCredentialEnv(env: Record<string, string>, preferredKey = '') {
  const entries = Object.entries(env || {});
  const preferred = preferredKey
    ? entries.find(([key]) => key === preferredKey)
    : null;
  const primary = preferred || entries.find(([key]) => isSecretEnvKey(key)) || null;
  const primaryKey = primary?.[0] || preferredKey || '';
  const otherEnv: Record<string, string> = {};
  const hiddenSecretEnv: Record<string, string> = {};

  for (const [key, value] of entries) {
    if (key === primaryKey) continue;
    if (isSecretEnvKey(key)) hiddenSecretEnv[key] = value;
    else otherEnv[key] = value;
  }

  const primaryValue = primary?.[1] || '';
  return {
    apiKeyEnvName: primaryKey,
    apiKey: primaryKey && !isPlaceholderEnvValue(primaryKey, primaryValue) ? primaryValue : '',
    otherEnv,
    hiddenSecretEnv,
  };
}

function hasConcreteSecretEnv(env: Record<string, string>) {
  return Object.entries(env || {}).some(([key, value]) => (
    isSecretEnvKey(key) && Boolean(value.trim()) && !isPlaceholderEnvValue(key, value)
  ));
}

const MCP_CONFIG_EXAMPLE = `{
  "mcpServers": {
    "MiniMax": {
      "command": "uvx",
      "args": ["minimax-coding-plan-mcp", "-y"],
      "env": {
        "MINIMAX_API_KEY": "MINIMAX_API_KEY",
        "MINIMAX_API_HOST": "https://api.minimaxi.com"
      }
    }
  }
}`;

type ParsedMcpInput = {
  server: McpServerConfig & { raw?: Record<string, unknown> };
  warnings: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function optionalString(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}

function stringArrayFrom(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => optionalString(item).trim()).filter(Boolean);
  if (typeof value === 'string') return parseArgs(value);
  return [];
}

function stringRecordFrom(value: unknown) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key.trim())
      .map(([key, entryValue]) => [key.trim(), optionalString(entryValue)])
  );
}

function numberFrom(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function transportFromMcpConfig(config: Record<string, unknown>) {
  const explicit = optionalString(config.transport || config.transportType || config.type).toLowerCase();
  if (explicit === 'http') return 'http';
  if (explicit === 'streamable_http' || explicit === 'streamable-http') return 'streamable_http';
  if (optionalString(config.url || config.serverUrl).trim() && !optionalString(config.command).trim()) return 'streamable_http';
  return 'stdio';
}

function placeholderEnvKeys(env: Record<string, string>) {
  return Object.entries(env)
    .filter(([key, value]) => isPlaceholderEnvValue(key, value))
    .map(([key]) => key);
}

function parseMcpConfigJson(value: string, fallbackName = ''): ParsedMcpInput {
  const parsed = JSON.parse(value) as unknown;
  let name = fallbackName;
  let displayName = '';
  let config: Record<string, unknown> | null = null;
  const warnings: string[] = [];

  if (isRecord(parsed) && isRecord(parsed.mcpServers)) {
    const entries = Object.entries(parsed.mcpServers).filter(([, entry]) => isRecord(entry));
    if (!entries.length) throw new Error('JSON 里没有可用的 mcpServers 配置。');
    if (entries.length > 1) warnings.push(`检测到多个 MCP 服务器，已先使用 ${entries[0][0]}。`);
    name = entries[0][0] || name;
    config = entries[0][1] as Record<string, unknown>;
    displayName = optionalString(config.displayName || config.display_name || config.redouDisplayName || config.redou_display_name).trim();
  } else if (isRecord(parsed) && (parsed.command || parsed.url || parsed.args || parsed.env)) {
    name = optionalString(parsed.name).trim() || name;
    displayName = optionalString(parsed.displayName || parsed.display_name || parsed.redouDisplayName || parsed.redou_display_name).trim();
    config = parsed;
  }

  if (!config) throw new Error('请粘贴包含 mcpServers 的官方 MCP JSON。');

  const command = optionalString(config.command).trim();
  const url = optionalString(config.url || config.serverUrl).trim();
  const env = stringRecordFrom(config.env || config.env_vars);
  const placeholders = placeholderEnvKeys(env);
  if (placeholders.length) warnings.push(`环境变量 ${placeholders.join(', ')} 仍像占位符，请替换成真实值后再保存或测试。`);

  return {
    server: {
      name: name.trim(),
      displayName: displayName || name.trim(),
      transport: transportFromMcpConfig(config),
      command,
      args: stringArrayFrom(config.args),
      env,
      inheritEnv: config.inheritEnv === undefined && config.inherit_env === undefined
        ? true
        : config.inheritEnv !== false && config.inherit_env !== false,
      url,
      enabled: config.enabled === undefined ? true : Boolean(config.enabled),
      startupTimeoutSec: numberFrom(config.startupTimeoutSec ?? config.startup_timeout_sec ?? config.timeoutSec ?? config.timeout),
      toolTimeoutSec: numberFrom(config.toolTimeoutSec ?? config.tool_timeout_sec),
      raw: config,
    },
    warnings,
  };
}

function mcpConfigJsonFromServer(server: McpServerConfig | null) {
  if (!server) return '';
  const config: Record<string, unknown> = {};
  if (server.transport && server.transport !== 'stdio') {
    config.url = server.url || '';
    config.transport = server.transport;
  } else {
    config.command = server.command || '';
    const args = Array.isArray(server.args) ? server.args : parseArgs(String(server.args || ''));
    if (args.length) config.args = args;
    if (server.env && Object.keys(server.env).length) config.env = server.env;
  }
  if (server.enabled === false) config.enabled = false;
  if (server.startupTimeoutSec) config.startup_timeout_sec = server.startupTimeoutSec;
  return JSON.stringify({ mcpServers: { [server.name || 'mcp-server']: config } }, null, 2);
}

function mcpSummary(server: McpServerConfig) {
  const args = Array.isArray(server.args) ? server.args : parseArgs(String(server.args || ''));
  const envCount = Object.keys(server.env || {}).length;
  const target = server.transport === 'stdio'
    ? [server.command, ...args].filter(Boolean).join(' ')
    : server.url;
  return {
    title: server.displayName || server.name || '未命名 MCP',
    detail: target || '尚未解析启动命令或 URL',
    meta: [
      server.name ? `访问名 ${server.name}` : '未设置访问名',
      server.transport === 'stdio' ? 'STDIO' : 'HTTP',
      `${args.length} 个参数`,
      `${envCount} 个环境变量`,
    ],
  };
}

function McpServerDialog({ item, onClose, onSaved }: { item: ExtensionItem | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const server = item ? mcpServerFromItem(item) : null;
  const initialCredentialEnv = splitCredentialEnv(server?.env || {});
  const [accessName, setAccessName] = useState(server?.name || '');
  const [displayName, setDisplayName] = useState(server?.displayName || server?.name || '');
  const [transport, setTransport] = useState<'stdio' | 'http' | 'streamable_http'>(server?.transport || 'stdio');
  const [command, setCommand] = useState(server?.command || '');
  const [args, setArgs] = useState(Array.isArray(server?.args) ? server?.args.join('\n') : String(server?.args || ''));
  const [apiKeyEnvName, setApiKeyEnvName] = useState(initialCredentialEnv.apiKeyEnvName);
  const [apiKey, setApiKey] = useState(initialCredentialEnv.apiKey);
  const [showApiKey, setShowApiKey] = useState(false);
  const [hiddenSecretEnv, setHiddenSecretEnv] = useState<Record<string, string>>(initialCredentialEnv.hiddenSecretEnv);
  const [env, setEnv] = useState(envTextFromRecord(initialCredentialEnv.otherEnv));
  const [inheritEnv, setInheritEnv] = useState(server?.inheritEnv !== false);
  const [url, setUrl] = useState(server?.url || '');
  const [enabled, setEnabled] = useState(server?.enabled ?? true);
  const [timeout, setTimeoutValue] = useState(server?.startupTimeoutSec ? String(server.startupTimeoutSec) : '');
  const [importText, setImportText] = useState('');
  const [rawConfig, setRawConfig] = useState<Record<string, unknown> | null>(server?.raw || null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [configWarnings, setConfigWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState('');

  function applyParsedInput(parsed: ParsedMcpInput, quiet = false) {
    setAccessName(parsed.server.name);
    setDisplayName(parsed.server.displayName || parsed.server.name);
    setTransport(parsed.server.transport || 'stdio');
    setCommand(parsed.server.command || '');
    setArgs(Array.isArray(parsed.server.args) ? parsed.server.args.join('\n') : String(parsed.server.args || ''));
    const credentialEnv = splitCredentialEnv(parsed.server.env || {}, apiKeyEnvName);
    setApiKeyEnvName(credentialEnv.apiKeyEnvName);
    setApiKey(credentialEnv.apiKey);
    setHiddenSecretEnv(credentialEnv.hiddenSecretEnv);
    setEnv(envTextFromRecord(credentialEnv.otherEnv));
    setInheritEnv(parsed.server.inheritEnv !== false);
    setUrl(parsed.server.url || '');
    setEnabled(parsed.server.enabled ?? true);
    setTimeoutValue(parsed.server.startupTimeoutSec ? String(parsed.server.startupTimeoutSec) : '');
    setRawConfig(parsed.server.raw || null);
    setConfigWarnings(parsed.warnings);
    if (!quiet) setMessage(parsed.warnings[0] || `已解析 ${parsed.server.displayName || parsed.server.name || 'MCP'} 配置。`);
  }

  function updateImportText(value: string) {
    setImportText(value);
    if (!value.trim()) {
      setRawConfig(null);
      setConfigWarnings([]);
      return;
    }
    try {
      const parsed = parseMcpConfigJson(value, accessName);
      applyParsedInput(parsed, true);
      if (hasConcreteSecretEnv(parsed.server.env || {})) setImportText('');
      setMessage('');
    } catch {
      // The user may still be typing. The explicit parse button reports errors.
    }
  }

  function parseImportText() {
    try {
      const parsed = parseMcpConfigJson(importText, accessName);
      applyParsedInput(parsed);
      if (hasConcreteSecretEnv(parsed.server.env || {})) setImportText('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '解析 MCP 配置失败。');
    }
  }

  function buildConfig(): McpServerConfig {
    const mergedEnv = {
      ...hiddenSecretEnv,
      ...parseEnv(env),
    };
    const trimmedApiKeyEnvName = apiKeyEnvName.trim();
    if (trimmedApiKeyEnvName && apiKey.trim()) mergedEnv[trimmedApiKeyEnvName] = apiKey.trim();
    else if (trimmedApiKeyEnvName) delete mergedEnv[trimmedApiKeyEnvName];
    const config: McpServerConfig = {
      name: accessName.trim(),
      displayName: displayName.trim() || accessName.trim(),
      transport,
      command: command.trim(),
      args: parseArgs(args),
      env: mergedEnv,
      inheritEnv,
      url: url.trim(),
      enabled,
      startupTimeoutSec: timeout.trim() ? Number(timeout) : undefined,
    };
    if (rawConfig) config.raw = rawConfig;
    return config;
  }

  async function test() {
    setTesting(true);
    setMessage('');
    const result = await redouApi.testMcpServer(buildConfig()).finally(() => setTesting(false));
    if (!result.ok) {
      setMessage(result.error?.message || '测试失败。');
      return;
    }
    const lastTest = (result.data as { lastTest?: McpLastTest } | null)?.lastTest;
    setMessage(mcpTestMessage(lastTest));
  }

  async function save() {
    setSaving(true);
    setMessage('');
    const config = buildConfig();
    const result = item
      ? await redouApi.updateMcpServer(item.name, config)
      : await redouApi.addMcpServer(config);
    setSaving(false);
    if (!result.ok) {
      setMessage(result.error?.message || '保存 MCP 服务器失败。');
      return;
    }
    await onSaved();
    onClose();
  }

  const requiresCommand = transport === 'stdio';
  const envPlaceholderKeys = placeholderEnvKeys(parseEnv(env));
  const hasPlaceholderEnv = envPlaceholderKeys.length > 0;
  const apiKeyNameWarning = apiKey.trim() && !apiKeyEnvName.trim() ? '填写 API Key 时需要指定环境变量名。' : '';
  const placeholderWarning = hasPlaceholderEnv
    ? `其他环境变量 ${envPlaceholderKeys.join(', ')} 仍像占位符，请替换成真实值后再保存或测试。`
    : '';
  const visibleWarnings = [
    ...configWarnings.filter((warning) => !warning.startsWith('环境变量 ')),
    ...(apiKeyNameWarning ? [apiKeyNameWarning] : []),
    ...(placeholderWarning ? [placeholderWarning] : []),
  ];
  const canSave = Boolean(accessName.trim() && (requiresCommand ? command.trim() : url.trim()) && !hasPlaceholderEnv && !apiKeyNameWarning);
  const summary = mcpSummary(buildConfig());

  return (
    <DialogFrame title={item ? '编辑 MCP 服务器' : '添加 MCP 服务器'} onClose={onClose} className="redou-mcp-dialog">
      <div className="redou-extension-form redou-mcp-form">
        <label className="redou-mcp-config-import">
          <span>粘贴官方 MCP 配置 JSON</span>
          <textarea
            value={importText}
            placeholder={MCP_CONFIG_EXAMPLE}
            spellCheck={false}
            onChange={(event) => updateImportText(event.target.value)}
          />
        </label>
        <div className="redou-mcp-parse-row">
          <button className="redou-secondary-button" type="button" onClick={parseImportText}>
            <Sparkles size={15} />
            <span>解析配置</span>
          </button>
          <span>Redou 会自动提取 MCP 访问名、启动命令、参数、环境变量和传输方式。</span>
        </div>
        {accessName.trim() ? (
          <div className="redou-mcp-config-summary">
            <strong>{summary.title}</strong>
            <span>{summary.detail}</span>
            <div className="redou-extension-meta">
              {summary.meta.map((entry) => <span key={entry}>{entry}</span>)}
            </div>
          </div>
        ) : null}
        {visibleWarnings.length ? (
          <div className="redou-mcp-warning-list">
            {visibleWarnings.map((warning) => (
              <span key={warning}>{warning}</span>
            ))}
          </div>
        ) : null}
        <label>
          <span>Redou 显示名称</span>
          <input value={displayName} placeholder={accessName || 'MiniMax'} onChange={(event) => setDisplayName(event.target.value)} />
        </label>
        <div className="redou-mcp-credential-grid">
          <label>
            <span>API Key 变量名</span>
            <input value={apiKeyEnvName} placeholder="MINIMAX_API_KEY" spellCheck={false} onChange={(event) => setApiKeyEnvName(event.target.value)} />
          </label>
          <label>
            <span>API Key</span>
            <div className="redou-secret-field">
              <input
                value={apiKey}
                type={showApiKey ? 'text' : 'password'}
                placeholder={apiKeyEnvName ? '留空则使用系统环境变量' : '先填写变量名'}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setApiKey(event.target.value)}
              />
              <button type="button" title={showApiKey ? '隐藏 API Key' : '显示 API Key'} onClick={() => setShowApiKey((shown) => !shown)}>
                {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </label>
        </div>
        <button className="redou-mcp-advanced-toggle" type="button" onClick={() => setAdvancedOpen((open) => !open)}>
          <ChevronDown size={15} data-open={advancedOpen ? 'true' : 'false'} />
          <span>{advancedOpen ? '收起高级设置' : '高级设置'}</span>
        </button>
        {advancedOpen ? (
          <div className="redou-mcp-advanced-fields">
            <div className="redou-mcp-runtime-fields">
              <span className="redou-mcp-field-heading">通常不需要修改；只有命令找不到、厂商参数变化或切换 HTTP MCP 时使用。</span>
              <label>
                <span>MCP 访问名</span>
                <input value={accessName} disabled={Boolean(item)} spellCheck={false} onChange={(event) => setAccessName(event.target.value)} />
                <span className="redou-mcp-field-note">{item ? '用于运行时识别 MCP 服务，编辑已有服务时保持不变。' : '来自官方 mcpServers 的 key，保存后会作为运行时访问名。'}</span>
              </label>
              <label>
                <span>传输方式</span>
                <select value={transport} onChange={(event) => setTransport(event.target.value as 'stdio' | 'http' | 'streamable_http')}>
                  <option value="stdio">STDIO</option>
                  <option value="http">HTTP</option>
                  <option value="streamable_http">Streamable HTTP</option>
                </select>
              </label>
              {requiresCommand ? (
                <>
                  <label><span>启动命令</span><input value={command} placeholder="npx" onChange={(event) => setCommand(event.target.value)} /></label>
                  <label><span>参数数组</span><textarea value={args} placeholder="-y&#10;@modelcontextprotocol/server-filesystem" onChange={(event) => setArgs(event.target.value)} /></label>
                  <label><span>其他环境变量 key/value</span><textarea value={env} placeholder="MINIMAX_API_HOST=https://api.minimaxi.com" onChange={(event) => setEnv(event.target.value)} /></label>
                  <label className="redou-extension-checkbox"><input type="checkbox" checked={inheritEnv} onChange={(event) => setInheritEnv(event.target.checked)} /><span>继承系统环境变量</span></label>
                </>
              ) : (
                <label><span>URL</span><input value={url} placeholder="https://example.com/mcp" onChange={(event) => setUrl(event.target.value)} /></label>
              )}
              <label><span>超时时间（秒）</span><input value={timeout} type="number" min="1" placeholder="10" onChange={(event) => setTimeoutValue(event.target.value)} /></label>
              <label className="redou-extension-checkbox"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span>启用</span></label>
            </div>
          </div>
        ) : null}
        {message ? <p className="redou-extension-form-message">{message}</p> : null}
        <div className="redou-extension-form-actions">
          <button className="redou-secondary-button" type="button" disabled={!canSave || testing} onClick={() => void test()}>
            <TestTube2 size={15} />
            <span>测试连接</span>
          </button>
          <button className="redou-secondary-button" type="button" onClick={onClose}>取消</button>
          <button className="redou-primary-button" type="button" disabled={!canSave || saving} onClick={() => void save()}>
            <Check size={15} />
            <span>保存</span>
          </button>
        </div>
      </div>
    </DialogFrame>
  );
}
