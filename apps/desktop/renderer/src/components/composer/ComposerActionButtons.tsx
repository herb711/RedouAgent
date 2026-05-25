import { ArrowUp, Mic } from 'lucide-react';

interface ComposerActionButtonsProps {
  submitting?: boolean;
  voiceActive?: boolean;
  onVoiceInput?: () => void;
}

export function ComposerActionButtons({ submitting = false, voiceActive = false, onVoiceInput }: ComposerActionButtonsProps) {
  return (
    <div className="redou-composer-actions">
      <button className="redou-icon-button" data-active={voiceActive ? 'true' : 'false'} type="button" aria-label="Voice input" title="语音输入" onClick={onVoiceInput}>
        <Mic size={16} />
      </button>
      <button className="redou-send-button" type="submit" aria-label={submitting ? 'Submitting' : 'Send message'} disabled={submitting}>
        <ArrowUp size={17} strokeWidth={2.5} />
      </button>
    </div>
  );
}
