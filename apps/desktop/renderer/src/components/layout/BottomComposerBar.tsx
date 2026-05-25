import { TaskComposer } from '../composer/TaskComposer';
import type { AgentThreadMessage, ComposerPermissionModeId, ComposerState, ComposerSubmitOptions, ContextItemData, ContextPackageData, ModelConfigSelection, ModelConfigSnapshot, WorkbenchTask } from '../../types';

interface BottomComposerBarProps {
  task: WorkbenchTask;
  composer: ComposerState;
  modelConfig: ModelConfigSnapshot;
  context: ContextPackageData;
  contextItems: ContextItemData[];
  pendingQueuedMessages?: AgentThreadMessage[];
  onPermissionModeChange: (mode: ComposerPermissionModeId) => void;
  onModelSelect: (selection: ModelConfigSelection) => Promise<void>;
  onOpenSettings: () => void;
  onSelectContextItems: (kind: 'file' | 'image' | 'directory') => Promise<void>;
  onAddDroppedContextFiles: (files: FileList) => Promise<void>;
  onRemoveContextItem: (path: string) => void;
  onClearContext: () => void;
  onSubmit: (input: string, options: ComposerSubmitOptions) => Promise<void>;
  onGuideQueuedMessage?: (message: AgentThreadMessage) => void;
  onDeleteQueuedMessage?: (message: AgentThreadMessage) => void;
}

export function BottomComposerBar({
  task,
  composer,
  modelConfig,
  context,
  contextItems,
  pendingQueuedMessages = [],
  onPermissionModeChange,
  onModelSelect,
  onOpenSettings,
  onSelectContextItems,
  onAddDroppedContextFiles,
  onRemoveContextItem,
  onClearContext,
  onSubmit,
  onGuideQueuedMessage,
  onDeleteQueuedMessage,
}: BottomComposerBarProps) {
  return (
    <div className="redou-bottom-composer-bar" aria-label="Redou Task Composer">
      <TaskComposer
        task={task}
        composer={composer}
        modelConfig={modelConfig}
        context={context}
        contextItems={contextItems}
        pendingQueuedMessages={pendingQueuedMessages}
        onPermissionModeChange={onPermissionModeChange}
        onModelSelect={onModelSelect}
        onOpenSettings={onOpenSettings}
        onSelectContextItems={onSelectContextItems}
        onAddDroppedContextFiles={onAddDroppedContextFiles}
        onRemoveContextItem={onRemoveContextItem}
        onClearContext={onClearContext}
        onSubmit={onSubmit}
        onGuideQueuedMessage={onGuideQueuedMessage}
        onDeleteQueuedMessage={onDeleteQueuedMessage}
      />
    </div>
  );
}
