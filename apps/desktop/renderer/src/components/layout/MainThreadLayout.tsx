import { ArrowDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ThreadHeader } from '../thread/ThreadHeader';
import { ThreadMessageList } from '../thread/ThreadMessageList';
import type { AgentThreadMessage, ChangesData, ProgressStepData, RuntimeStatusData, WorkbenchTask } from '../../types';

interface MainThreadLayoutProps {
  activeProjectName: string;
  task: WorkbenchTask;
  agentMessages: AgentThreadMessage[];
  changes: ChangesData;
  progressSteps: ProgressStepData[];
  runtimeStatus?: RuntimeStatusData | null;
  onOpenDiff: () => void;
  onGuideQueuedMessage?: (message: AgentThreadMessage) => void;
  onDeleteQueuedMessage?: (message: AgentThreadMessage) => void;
}

const BOTTOM_SCROLL_THRESHOLD = 32;

function isScrolledToBottom(element: HTMLElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_SCROLL_THRESHOLD;
}

export function MainThreadLayout({ activeProjectName, task, agentMessages, changes, progressSteps, runtimeStatus, onOpenDiff, onGuideQueuedMessage, onDeleteQueuedMessage }: MainThreadLayoutProps) {
  const scrollRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const shouldFollowBottomRef = useRef(true);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollTimerRef = useRef<number | null>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const messageGrowthKey = useMemo(() => {
    const messageKey = agentMessages
      .map((message) => `${message.id}:${message.role || ''}:${message.status || ''}:${message.body.length}`)
      .join('|');
    return [
      task.id,
      task.status,
      task.userPrompt?.length || 0,
      messageKey,
      changes.files.length,
      changes.insertions,
      changes.deletions,
      changes.diffSummary.length,
      progressSteps.map((step) => `${step.id}:${step.status}`).join('|'),
      runtimeStatus?.turnStatus || '',
      runtimeStatus?.activeTurnId || '',
    ].join(':');
  }, [agentMessages, changes.deletions, changes.diffSummary.length, changes.files.length, changes.insertions, progressSteps, runtimeStatus?.activeTurnId, runtimeStatus?.turnStatus, task.id, task.status, task.userPrompt]);

  const userSubmissionKey = useMemo(() => {
    const userMessages = agentMessages
      .filter((message) => message.role === 'user')
      .map((message) => `${message.id}:${message.body.length}`)
      .join('|');
    return `${task.id}:${task.userPrompt?.length || 0}:${userMessages}`;
  }, [agentMessages, task.id, task.userPrompt]);

  const clearProgrammaticScrollTimer = useCallback(() => {
    if (programmaticScrollTimerRef.current === null) return;
    window.clearTimeout(programmaticScrollTimerRef.current);
    programmaticScrollTimerRef.current = null;
  }, []);

  const updateBottomState = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const atBottom = isScrolledToBottom(element);
    if (programmaticScrollRef.current && !atBottom) return;
    if (atBottom) {
      programmaticScrollRef.current = false;
      clearProgrammaticScrollTimer();
    }
    shouldFollowBottomRef.current = atBottom;
    setShowJumpToBottom(!atBottom);
  }, [clearProgrammaticScrollTimer]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const element = scrollRef.current;
    if (!element) return;
    programmaticScrollRef.current = true;
    clearProgrammaticScrollTimer();
    element.scrollTo({ top: element.scrollHeight, behavior });
    programmaticScrollTimerRef.current = window.setTimeout(() => {
      programmaticScrollRef.current = false;
      updateBottomState();
    }, behavior === 'smooth' ? 500 : 0);
  }, [clearProgrammaticScrollTimer, updateBottomState]);

  useEffect(() => {
    shouldFollowBottomRef.current = true;
    setShowJumpToBottom(false);
    requestAnimationFrame(() => scrollToBottom('auto'));
  }, [scrollToBottom, task.id]);

  useEffect(() => {
    if (!shouldFollowBottomRef.current) {
      updateBottomState();
      return;
    }
    requestAnimationFrame(() => scrollToBottom('auto'));
  }, [messageGrowthKey, scrollToBottom, updateBottomState]);

  useEffect(() => {
    shouldFollowBottomRef.current = true;
    setShowJumpToBottom(false);
    requestAnimationFrame(() => {
      scrollToBottom('auto');
      requestAnimationFrame(() => scrollToBottom('auto'));
    });
  }, [scrollToBottom, userSubmissionKey]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (shouldFollowBottomRef.current) {
        scrollToBottom('auto');
      } else {
        updateBottomState();
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollToBottom, updateBottomState]);

  useEffect(() => () => clearProgrammaticScrollTimer(), [clearProgrammaticScrollTimer]);

  const jumpToBottom = useCallback(() => {
    shouldFollowBottomRef.current = true;
    setShowJumpToBottom(false);
    scrollToBottom('smooth');
  }, [scrollToBottom]);

  return (
    <div className="redou-main-thread-frame">
      <main ref={scrollRef} className="redou-main-thread" aria-label="Redou Task Thread" onScroll={updateBottomState}>
        <div ref={contentRef} className="redou-thread-scroll-content">
          <ThreadHeader activeProjectName={activeProjectName} task={task} progressSteps={progressSteps} runtimeStatus={runtimeStatus} />
          <ThreadMessageList
            task={task}
            agentMessages={agentMessages}
            changes={changes}
            progressSteps={progressSteps}
            onOpenDiff={onOpenDiff}
            onGuideQueuedMessage={onGuideQueuedMessage}
            onDeleteQueuedMessage={onDeleteQueuedMessage}
          />
        </div>
      </main>
      {showJumpToBottom ? (
        <button className="redou-jump-to-bottom-button" type="button" aria-label="Scroll to latest message" onClick={jumpToBottom}>
          <ArrowDown size={20} strokeWidth={2.2} />
        </button>
      ) : null}
    </div>
  );
}
