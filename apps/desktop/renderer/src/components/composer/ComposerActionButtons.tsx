import { ArrowUp, Mic, Square } from 'lucide-react';

interface ComposerActionButtonsProps {
  submitting?: boolean;
  sendDisabled?: boolean;
  stopDisabled?: boolean;
  voiceActive?: boolean;
  onVoiceInput?: () => void;
  onStopTask?: () => void | Promise<void>;
}

export function ComposerActionButtons({
  submitting = false,
  sendDisabled = false,
  stopDisabled = true,
  voiceActive = false,
  onVoiceInput,
  onStopTask,
}: ComposerActionButtonsProps) {
  return (
    <div className="redou-composer-actions">
      <button className="redou-icon-button" data-active={voiceActive ? 'true' : 'false'} type="button" aria-label="Voice input" title="语音输入" onClick={onVoiceInput}>
        <Mic size={16} />
      </button>
      <button
        className="redou-stop-button"
        type="button"
        aria-label="Stop task"
        title="停止任务"
        disabled={stopDisabled}
        onClick={() => void onStopTask?.()}
      >
        <Square size={13} strokeWidth={2.6} />
      </button>
      <button className="redou-send-button" type="submit" aria-label={submitting ? 'Submitting' : 'Send message'} disabled={sendDisabled}>
        <ArrowUp size={17} strokeWidth={2.5} />
      </button>
    </div>
  );
}
