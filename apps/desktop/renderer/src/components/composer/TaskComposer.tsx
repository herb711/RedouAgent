import { CornerDownRight, FilePlus2, FolderOpen, ImagePlus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { type DragEvent, useEffect, useRef, useState } from 'react';
import { ComposerActionButtons } from './ComposerActionButtons';
import { createPermissionPolicy, defaultComposerPermissionMode } from './composerOptions';
import { ModelSelectorButton } from './ModelSelectorButton';
import { PermissionModeButton } from './PermissionModeButton';
import type { AgentThreadMessage, ComposerEditTarget, ComposerPermissionModeId, ComposerState, ComposerSubmitOptions, ContextItemData, ContextPackageData, ModelConfigSelection, ModelConfigSnapshot, WorkbenchTask } from '../../types';

interface TaskComposerProps {
  task: WorkbenchTask;
  composer: ComposerState;
  modelConfig: ModelConfigSnapshot;
  context: ContextPackageData;
  contextItems: ContextItemData[];
  value: string;
  editTarget?: ComposerEditTarget | null;
  pendingQueuedMessages?: AgentThreadMessage[];
  onInputChange: (input: string) => void;
  onPermissionModeChange: (mode: ComposerPermissionModeId) => void;
  onModelSelect: (selection: ModelConfigSelection) => Promise<void>;
  onOpenSettings: () => void;
  onSelectContextItems: (kind: 'file' | 'image' | 'directory') => Promise<void>;
  onAddDroppedContextFiles: (files: FileList) => Promise<void>;
  onRemoveContextItem: (path: string) => void;
  onClearContext: () => void;
  onSubmit: (input: string, options: ComposerSubmitOptions) => Promise<boolean | void>;
  onStopTask?: () => Promise<void>;
  onGuideQueuedMessage?: (message: AgentThreadMessage) => void;
  onDeleteQueuedMessage?: (message: AgentThreadMessage) => void;
  onCancelEdit?: () => void;
}

function shortPathLabel(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join('/') || path;
}

export function TaskComposer({
  task,
  composer,
  modelConfig,
  context,
  contextItems,
  value,
  editTarget,
  pendingQueuedMessages = [],
  onInputChange,
  onPermissionModeChange,
  onModelSelect,
  onOpenSettings,
  onSelectContextItems,
  onAddDroppedContextFiles,
  onRemoveContextItem,
  onClearContext,
  onSubmit,
  onStopTask,
  onGuideQueuedMessage,
  onDeleteQueuedMessage,
  onCancelEdit,
}: TaskComposerProps) {
  const [submitting, setSubmitting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const permissionMode = composer.permissionMode || defaultComposerPermissionMode;
  const running = task.status === 'running';
  const hasInput = Boolean(value.trim());
  const hasPendingQueue = pendingQueuedMessages.length > 0;
  const submit = async (deliveryMode: ComposerSubmitOptions['deliveryMode'] = 'auto') => {
    if (submitting || !hasInput) return;
    setSubmitting(true);
    try {
      const submitted = await onSubmit(value, {
        permissionMode,
        permissionPolicy: createPermissionPolicy(permissionMode),
        deliveryMode,
        modelSelection: composer.modelSelection || modelConfig.selected,
        reasoningEffort: composer.reasoningEffort,
        editTarget: editTarget || null,
      });
      if (submitted === false) return;
      onInputChange('');
      onClearContext();
    } finally {
      setSubmitting(false);
    }
  };
  const stopTask = async () => {
    if (stopping || !running || !onStopTask) return;
    setStopping(true);
    try {
      await onStopTask();
    } finally {
      setStopping(false);
    }
  };
  const selectContext = async (kind: 'file' | 'image' | 'directory') => {
    setContextMenuOpen(false);
    await onSelectContextItems(kind);
  };
  const dragContainsFiles = (event: DragEvent<HTMLElement>) => Array.from(event.dataTransfer.types).includes('Files');
  const startVoiceInput = () => {
    const SpeechRecognition = (window as Window & {
      SpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        maxAlternatives: number;
        onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        onerror: (() => void) | null;
        onend: (() => void) | null;
        start: () => void;
      };
      webkitSpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        maxAlternatives: number;
        onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        onerror: (() => void) | null;
        onend: (() => void) | null;
        start: () => void;
      };
    }).SpeechRecognition || (window as Window & {
      webkitSpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        maxAlternatives: number;
        onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        onerror: (() => void) | null;
        onend: (() => void) | null;
        start: () => void;
      };
    }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      window.alert('当前运行环境不支持系统语音识别。');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (!transcript) return;
      onInputChange(value ? `${value} ${transcript}` : transcript);
    };
    recognition.onerror = () => setVoiceActive(false);
    recognition.onend = () => setVoiceActive(false);
    setVoiceActive(true);
    recognition.start();
  };
  const handleDragOver = (event: DragEvent<HTMLFormElement>) => {
    if (!dragContainsFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragActive(true);
  };
  const handleDrop = async (event: DragEvent<HTMLFormElement>) => {
    if (!dragContainsFiles(event)) return;
    event.preventDefault();
    setDragActive(false);
    if (event.dataTransfer.files.length) await onAddDroppedContextFiles(event.dataTransfer.files);
  };

  useEffect(() => {
    const focusComposer = () => {
      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        const end = textarea.value.length;
        textarea.setSelectionRange(end, end);
      });
    };
    window.addEventListener('redou:focus-composer', focusComposer);
    return () => window.removeEventListener('redou:focus-composer', focusComposer);
  }, []);

  useEffect(() => {
    if (!editTarget) return;
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
    });
  }, [editTarget]);

  useEffect(() => {
    const quoteMessage = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string }>).detail;
      const text = String(detail?.text || '').trim();
      if (!text) return;
      const nextValue = value.trim() ? `${value}\n\n${text}` : text;
      onInputChange(nextValue);
      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        const end = textarea.value.length;
        textarea.setSelectionRange(end, end);
      });
    };
    window.addEventListener('redou:quote-message', quoteMessage);
    return () => window.removeEventListener('redou:quote-message', quoteMessage);
  }, [onInputChange, value]);

  return (
    <div className="redou-task-composer-shell" data-has-pending-queue={hasPendingQueue ? 'true' : undefined}>
      {hasPendingQueue ? (
        <div className="redou-composer-pending-queue" aria-label="排队消息">
          {pendingQueuedMessages.map((message) => (
            <div className="redou-composer-pending-queue-item" key={message.queueId || message.id}>
              <CornerDownRight className="redou-composer-pending-queue-icon" size={17} />
              <span className="redou-composer-pending-queue-text" title={message.body}>
                {message.body}
              </span>
              <div className="redou-composer-pending-queue-actions">
                <button type="button" disabled={submitting || !onGuideQueuedMessage} onClick={() => onGuideQueuedMessage?.(message)}>
                  <CornerDownRight size={15} />
                  <span>引导</span>
                </button>
                <button
                  className="redou-composer-queue-icon-button"
                  type="button"
                  aria-label="取消排队"
                  title="取消排队"
                  disabled={submitting || !onDeleteQueuedMessage}
                  onClick={() => onDeleteQueuedMessage?.(message)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <form
        className="redou-task-composer"
        data-drag-active={dragActive ? 'true' : 'false'}
        onDragOver={handleDragOver}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
        }}
        onDrop={(event) => void handleDrop(event)}
        onSubmit={async (event) => {
          event.preventDefault();
          await submit(editTarget ? 'new_turn' : 'auto');
        }}
      >
        {editTarget ? (
          <div className="redou-composer-edit-row">
            <Pencil size={14} />
            <span>正在编辑这条消息</span>
            <button type="button" onClick={onCancelEdit}>
              <X size={13} />
              <span>取消</span>
            </button>
          </div>
        ) : null}
        <div className="redou-composer-input-row">
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder={composer.placeholder}
            aria-label="Request follow-up change"
            value={value}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              void submit(editTarget ? 'new_turn' : event.ctrlKey ? 'guide' : 'auto');
            }}
          />
        </div>
        {running && !hasPendingQueue && !editTarget ? (
          <div className="redou-composer-queue-row">
            <span>任务正在执行，普通发送会排队到下一轮。</span>
            <button type="button" disabled={submitting || !hasInput} onClick={() => void submit('guide')}>
              <CornerDownRight size={14} />
              <span>引导当前任务</span>
            </button>
          </div>
        ) : null}
        {contextItems.length ? (
          <div className="redou-composer-context-picks" aria-label="Selected context">
            {contextItems.map((item) => (
              <span className="redou-composer-context-chip" data-kind={item.kind} key={`${item.kind}:${item.path}`} title={item.path}>
                <span>{shortPathLabel(item.path)}</span>
                <button type="button" aria-label={`Remove ${shortPathLabel(item.path)}`} onClick={() => onRemoveContextItem(item.path)}>
                  <X size={12} />
                </button>
              </span>
            ))}
            <button className="redou-composer-clear-context" type="button" onClick={onClearContext}>
              Clear
            </button>
          </div>
        ) : null}
        <div className="redou-composer-footer">
          <div className="redou-composer-left-controls">
            <div className="redou-composer-add-wrap">
              <button
                className="redou-composer-add"
                type="button"
                aria-label="Add context"
                title="Add context"
                aria-haspopup="menu"
                aria-expanded={contextMenuOpen ? 'true' : 'false'}
                onClick={() => setContextMenuOpen((open) => !open)}
              >
                <Plus size={18} />
              </button>
              {contextMenuOpen ? (
                <div className="redou-composer-context-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => void selectContext('file')}>
                    <FilePlus2 size={16} />
                    <span>File</span>
                  </button>
                  <button type="button" role="menuitem" onClick={() => void selectContext('image')}>
                    <ImagePlus size={16} />
                    <span>Image</span>
                  </button>
                  <button type="button" role="menuitem" onClick={() => void selectContext('directory')}>
                    <FolderOpen size={16} />
                    <span>Folder</span>
                  </button>
                </div>
              ) : null}
            </div>
            <PermissionModeButton mode={permissionMode} onChange={onPermissionModeChange} />
          </div>
          <div className="redou-composer-right-controls">
            <ModelSelectorButton
              label={composer.model}
              modelId={composer.modelId}
              modelConfig={modelConfig}
              selected={composer.modelSelection || modelConfig.selected}
              reasoningEffort={composer.reasoningEffort}
              runtime={composer.runtime}
              onModelSelect={onModelSelect}
              onOpenSettings={onOpenSettings}
            />
            <ComposerActionButtons
              submitting={submitting}
              sendDisabled={submitting || !hasInput}
              stopDisabled={stopping || !running || !onStopTask}
              voiceActive={voiceActive}
              onVoiceInput={startVoiceInput}
              onStopTask={stopTask}
            />
          </div>
        </div>
      </form>
    </div>
  );
}
