import { TaskComposer } from '../composer/TaskComposer';
import type { ComposerPermissionModeId, ComposerState, ComposerSubmitOptions, ModelConfigSelection, ModelConfigSnapshot, WorkbenchTask } from '../../types';

interface BottomComposerBarProps {
  task: WorkbenchTask;
  composer: ComposerState;
  modelConfig: ModelConfigSnapshot;
  onPermissionModeChange: (mode: ComposerPermissionModeId) => void;
  onModelSelect: (selection: ModelConfigSelection) => Promise<void>;
  onOpenSettings: () => void;
  onSubmit: (input: string, options: ComposerSubmitOptions) => Promise<void>;
}

export function BottomComposerBar({ task, composer, modelConfig, onPermissionModeChange, onModelSelect, onOpenSettings, onSubmit }: BottomComposerBarProps) {
  return (
    <div className="redou-bottom-composer-bar" aria-label="Redou Task Composer">
      <TaskComposer
        task={task}
        composer={composer}
        modelConfig={modelConfig}
        onPermissionModeChange={onPermissionModeChange}
        onModelSelect={onModelSelect}
        onOpenSettings={onOpenSettings}
        onSubmit={onSubmit}
      />
    </div>
  );
}
