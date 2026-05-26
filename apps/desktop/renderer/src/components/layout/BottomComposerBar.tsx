import { TaskComposer } from '../composer/TaskComposer';
import type { AgentThreadMessage, ComposerEditTarget, ComposerPermissionModeId, ComposerState, ComposerSubmitOptions, ContextItemData, ContextPackageData, ModelConfigSelection, ModelConfigSnapshot, WorkbenchTask } from '../../types';

interface BottomComposerBarProps {
  task: WorkbenchTask;
  composer: ComposerState;
  modelConfig: ModelConfigSnapshot;
  context: ContextPackageData;
  contextItems: ContextItemData[];
  composerInput: string;
  composerEditTarget?: ComposerEditTarget | null;
  pendingQueuedMessages?: AgentThreadMessage[];
  onComposerInputChange: (input: string) => void;
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
  onCancelComposerEdit?: () => void;
}

export function BottomComposerBar({
  task,
  composer,
  modelConfig,
  context,
  contextItems,
  composerInput,
  composerEditTarget,
  pendingQueuedMessages = [],
  onComposerInputChange,
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
  onCancelComposerEdit,
}: BottomComposerBarProps) {
  return (
    <div className="redou-bottom-composer-bar" aria-label="Redou Task Composer">
      <TaskComposer
        task={task}
        composer={composer}
        modelConfig={modelConfig}
        context={context}
        contextItems={contextItems}
        value={composerInput}
        editTarget={composerEditTarget}
        pendingQueuedMessages={pendingQueuedMessages}
        onInputChange={onComposerInputChange}
        onPermissionModeChange={onPermissionModeChange}
        onModelSelect={onModelSelect}
        onOpenSettings={onOpenSettings}
        onSelectContextItems={onSelectContextItems}
        onAddDroppedContextFiles={onAddDroppedContextFiles}
        onRemoveContextItem={onRemoveContextItem}
        onClearContext={onClearContext}
        onSubmit={onSubmit}
        onStopTask={onStopTask}
        onGuideQueuedMessage={onGuideQueuedMessage}
        onDeleteQueuedMessage={onDeleteQueuedMessage}
        onCancelEdit={onCancelComposerEdit}
      />
    </div>
  );
}
