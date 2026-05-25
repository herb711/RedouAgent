import { PanelRight } from 'lucide-react';
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { BottomComposerBar } from './BottomComposerBar';
import { LeftNavigation } from './LeftNavigation';
import { MainThreadLayout } from './MainThreadLayout';
import { RightStatusRail } from './RightStatusRail';
import { TopTitleBar } from './TopTitleBar';
import { ArtifactPreviewPage } from '../../pages/ArtifactPreviewPage';
import { BrowserPage } from '../../pages/BrowserPage';
import { DiffReviewPage } from '../../pages/DiffReviewPage';
import { SettingsPage } from '../../pages/SettingsPage';
import type { WorkbenchActions, WorkbenchState } from '../../state/workbenchStore';
import { isPendingQueuedUserMessage } from '../../utils/threadMessages';

interface AppShellProps {
  state: WorkbenchState;
  actions: WorkbenchActions;
}

const SIDEBAR_WIDTH_STORAGE_KEY = 'redou.sidebar.width';
const DEFAULT_SIDEBAR_WIDTH = 260;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 420;

interface NavSnapshot {
  view: WorkbenchState['activeView'];
  projectId: string;
  taskId?: string;
}

function clampSidebarWidth(width: number) {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
}

function readInitialSidebarWidth() {
  if (typeof window === 'undefined') return DEFAULT_SIDEBAR_WIDTH;
  const stored = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
  return Number.isFinite(stored) ? clampSidebarWidth(stored) : DEFAULT_SIDEBAR_WIDTH;
}

export function AppShell({ state, actions }: AppShellProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(readInitialSidebarWidth);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [navBackStack, setNavBackStack] = useState<NavSnapshot[]>([]);
  const [navForwardStack, setNavForwardStack] = useState<NavSnapshot[]>([]);
  const { data } = state;
  const activeProject = data.projects.find((project) => project.id === data.activeProjectId);
  const pendingQueuedMessages = useMemo(() => data.agentMessages.filter(isPendingQueuedUserMessage), [data.agentMessages]);
  const visibleAgentMessages = useMemo(() => data.agentMessages.filter((message) => !isPendingQueuedUserMessage(message)), [data.agentMessages]);
  const title =
    state.activeView === 'settings'
      ? '设置'
      : state.activeView === 'diffReview'
        ? '文件变更预览'
        : state.activeView === 'artifactPreview'
          ? '交付物预览'
          : state.activeView === 'browser'
            ? '内置浏览器'
          : data.activeTask.title;
  const shellStyle = {
    '--redou-sidebar-width': `${sidebarWidth}px`,
  } as CSSProperties;
  const currentNavSnapshot = useMemo<NavSnapshot>(() => ({
    view: state.activeView,
    projectId: data.activeProjectId,
    taskId: data.activeTask.id,
  }), [data.activeProjectId, data.activeTask.id, state.activeView]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  const startSidebarResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const shellLeft = shellRef.current?.getBoundingClientRect().left || 0;
    setIsResizingSidebar(true);

    function updateWidth(pointerEvent: PointerEvent) {
      setSidebarWidth(clampSidebarWidth(pointerEvent.clientX - shellLeft));
    }

    function stopResize() {
      setIsResizingSidebar(false);
      window.removeEventListener('pointermove', updateWidth);
      window.removeEventListener('pointerup', stopResize);
    }

    updateWidth(event.nativeEvent);
    window.addEventListener('pointermove', updateWidth);
    window.addEventListener('pointerup', stopResize);
  }, []);

  function resizeSidebarWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    setSidebarWidth((width) => clampSidebarWidth(width + (event.key === 'ArrowRight' ? 16 : -16)));
  }

  function sameSnapshot(left: NavSnapshot, right: NavSnapshot) {
    return left.view === right.view && left.projectId === right.projectId && left.taskId === right.taskId;
  }

  function pushCurrentSnapshot() {
    setNavBackStack((stack) => {
      const last = stack[stack.length - 1];
      return last && sameSnapshot(last, currentNavSnapshot) ? stack : [...stack, currentNavSnapshot];
    });
    setNavForwardStack([]);
  }

  const applyNavSnapshot = useCallback((snapshot: NavSnapshot) => {
    if (snapshot.taskId) actions.selectTask(snapshot.taskId);
    else if (snapshot.projectId) actions.selectProject(snapshot.projectId);
    actions.selectView(snapshot.view);
  }, [actions]);

  function navigateWithHistory(callback: () => void) {
    pushCurrentSnapshot();
    callback();
  }

  function goBack() {
    const previous = navBackStack[navBackStack.length - 1];
    if (!previous) return;
    setNavBackStack((stack) => stack.slice(0, -1));
    setNavForwardStack((stack) => [currentNavSnapshot, ...stack]);
    applyNavSnapshot(previous);
  }

  function goForward() {
    const next = navForwardStack[0];
    if (!next) return;
    setNavForwardStack((stack) => stack.slice(1));
    setNavBackStack((stack) => [...stack, currentNavSnapshot]);
    applyNavSnapshot(next);
  }

  if (state.activeView === 'settings') {
    return (
      <div className="redou-app-shell redou-app-shell-settings" ref={shellRef}>
        <SettingsPage
          appSettings={state.appSettings}
          modelConfig={state.modelConfig}
          onBack={() => navigateWithHistory(() => actions.selectView('thread'))}
          onSelectModel={actions.selectConfiguredModel}
          onProbeModelProvider={actions.probeModelProvider}
          onSaveModelProvider={actions.saveModelProvider}
          onRemoveModelProvider={actions.removeModelProvider}
          onUpdateAppSettings={actions.updateAppSettings}
          onNotifyDesktop={actions.notifyDesktop}
        />
      </div>
    );
  }

  return (
    <div
      ref={shellRef}
      className="redou-app-shell"
      data-sidebar-hidden={sidebarHidden ? 'true' : 'false'}
      data-sidebar-resizing={isResizingSidebar ? 'true' : 'false'}
      style={shellStyle}
    >
      {sidebarHidden ? (
        <button className="redou-sidebar-reveal" type="button" aria-label="显示侧边栏" title="显示侧边栏" onClick={() => setSidebarHidden(false)}>
          <PanelRight size={16} />
        </button>
      ) : (
        <>
          <LeftNavigation
            projects={data.projects}
            activeProjectId={data.activeProjectId}
            activeTaskId={data.activeTask.id}
            activeView={state.activeView}
            expandedProjectIds={state.expandedProjectIds}
            onCollapseSidebar={() => setSidebarHidden(true)}
            canGoBack={navBackStack.length > 0}
            canGoForward={navForwardStack.length > 0}
            onGoBack={goBack}
            onGoForward={goForward}
            onCollapseAllProjects={actions.collapseAllProjects}
            onCreateBlankProject={actions.createBlankProject}
            onCreateConversationInProject={actions.createConversationInProject}
            onCreateProjectFromFolder={actions.createProjectFromFolder}
            onToggleProjectPinned={actions.toggleProjectPinned}
            onOpenProjectFolder={actions.openProjectFolder}
            onRenameProject={actions.renameProject}
            onArchiveProjectConversation={actions.archiveProjectConversation}
            onRemoveProject={actions.removeProject}
            onSelectProject={(projectId) => navigateWithHistory(() => actions.selectProject(projectId))}
            onSelectTask={(taskId) => navigateWithHistory(() => actions.selectTask(taskId))}
            onSelectView={(view) => navigateWithHistory(() => actions.selectView(view))}
          />
          <div
            className="redou-sidebar-resizer"
            role="separator"
            aria-label="调整侧边栏宽度"
            aria-orientation="vertical"
            tabIndex={0}
            onKeyDown={resizeSidebarWithKeyboard}
            onPointerDown={startSidebarResize}
          />
        </>
      )}
      <section className="redou-workbench-surface" aria-label="Redou Workbench">
        <TopTitleBar taskTitle={title} activeProjectName={activeProject?.name ?? 'Redou'} />
        <div className="redou-workbench-body">
          <div className="redou-main-stack">
            {state.activeView === 'thread' ? (
              <>
                <MainThreadLayout
                  activeProjectName={activeProject?.name ?? 'RedouAgent'}
                  task={data.activeTask}
                  agentMessages={visibleAgentMessages}
                  changes={data.mockChanges}
                  progressSteps={data.progressSteps}
                  runtimeStatus={data.runtimeStatus}
                  onOpenDiff={() => navigateWithHistory(() => actions.selectView('diffReview'))}
                  onGuideQueuedMessage={actions.guideQueuedMessage}
                  onDeleteQueuedMessage={actions.deleteQueuedMessage}
                />
                <BottomComposerBar
                  task={data.activeTask}
                  composer={data.composer}
                  modelConfig={state.modelConfig}
                  context={data.mockContext}
                  contextItems={data.contextItems}
                  pendingQueuedMessages={pendingQueuedMessages}
                  onPermissionModeChange={actions.setComposerPermissionMode}
                  onModelSelect={actions.selectConfiguredModel}
                  onOpenSettings={() => navigateWithHistory(() => actions.selectView('settings'))}
                  onSelectContextItems={actions.selectContextItems}
                  onAddDroppedContextFiles={actions.addDroppedContextFiles}
                  onRemoveContextItem={actions.removeContextItem}
                  onClearContext={actions.clearContext}
                  onSubmit={actions.submitComposer}
                  onGuideQueuedMessage={actions.guideQueuedMessage}
                  onDeleteQueuedMessage={actions.deleteQueuedMessage}
                />
              </>
            ) : null}
            {state.activeView === 'diffReview' ? (
              <DiffReviewPage
                changes={data.mockChanges}
                onBack={() => navigateWithHistory(() => actions.selectView('thread'))}
                onStageFile={actions.stageGitFile}
                onUnstageFile={actions.unstageGitFile}
                onRevertFile={actions.revertGitFile}
                onStageHunk={actions.stageGitHunk}
                onRevertHunk={actions.revertGitHunk}
                onCreatePullRequest={actions.createPullRequest}
              />
            ) : null}
            {state.activeView === 'artifactPreview' ? (
              <ArtifactPreviewPage
                artifacts={data.mockArtifacts}
                onBack={() => navigateWithHistory(() => actions.selectView('thread'))}
                onOpenArtifact={actions.openArtifact}
                onRevealArtifact={actions.revealArtifact}
                onGenerateImage={actions.generateImageArtifact}
                onCaptureScreenshot={actions.captureScreenshotComment}
                onPopoutArtifact={actions.popoutArtifact}
              />
            ) : null}
            {state.activeView === 'browser' ? (
              <BrowserPage
                browser={data.browser}
                onBack={() => navigateWithHistory(() => actions.selectView('thread'))}
                onNavigate={actions.setBrowserUrl}
                onOpenExternal={actions.openBrowserExternal}
                onPopout={actions.popoutBrowser}
                onCaptureScreenshot={actions.captureScreenshotComment}
              />
            ) : null}
          </div>
          {state.activeView === 'thread' ? <RightStatusRail state={state} actions={actions} /> : null}
        </div>
      </section>
    </div>
  );
}
