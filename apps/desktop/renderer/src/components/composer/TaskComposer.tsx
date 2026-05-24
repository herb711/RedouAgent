import { CornerDownRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { ComposerActionButtons } from './ComposerActionButtons';
import { createPermissionPolicy } from './composerOptions';
import { ModelSelectorButton } from './ModelSelectorButton';
import { PermissionModeButton } from './PermissionModeButton';
import type { ComposerPermissionModeId, ComposerState, ComposerSubmitOptions, ModelConfigSelection, ModelConfigSnapshot, WorkbenchTask } from '../../types';

interface TaskComposerProps {
  task: WorkbenchTask;
  composer: ComposerState;
  modelConfig: ModelConfigSnapshot;
  onPermissionModeChange: (mode: ComposerPermissionModeId) => void;
  onModelSelect: (selection: ModelConfigSelection) => Promise<void>;
  onOpenSettings: () => void;
  onSubmit: (input: string, options: ComposerSubmitOptions) => Promise<void>;
}

export function TaskComposer({ task, composer, modelConfig, onPermissionModeChange, onModelSelect, onOpenSettings, onSubmit }: TaskComposerProps) {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const permissionMode = composer.permissionMode || 'default';
  const running = task.status === 'running';
  const hasInput = Boolean(value.trim());
  const submit = async (deliveryMode: ComposerSubmitOptions['deliveryMode'] = 'auto') => {
    if (submitting || !hasInput) return;
    setSubmitting(true);
    try {
      await onSubmit(value, {
        permissionMode,
        permissionPolicy: createPermissionPolicy(permissionMode),
        deliveryMode,
        modelSelection: composer.modelSelection || modelConfig.selected,
        reasoningEffort: composer.reasoningEffort,
      });
      setValue('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="redou-task-composer"
      onSubmit={async (event) => {
        event.preventDefault();
        await submit('auto');
      }}
    >
      <div className="redou-composer-input-row">
        <textarea
          rows={1}
          placeholder={composer.placeholder}
          aria-label="Request follow-up change"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void submit(event.ctrlKey ? 'guide' : 'auto');
          }}
        />
      </div>
      {running ? (
        <div className="redou-composer-queue-row">
          <span>任务正在执行，普通发送会排队到下一轮。</span>
          <button type="button" disabled={submitting || !hasInput} onClick={() => void submit('guide')}>
            <CornerDownRight size={14} />
            <span>引导当前任务</span>
          </button>
        </div>
      ) : null}
      <div className="redou-composer-footer">
        <div className="redou-composer-left-controls">
          <button className="redou-composer-add" type="button" aria-label="Add context" title="Add context">
            <Plus size={18} />
          </button>
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
          <ComposerActionButtons submitting={submitting} />
        </div>
      </div>
    </form>
  );
}
