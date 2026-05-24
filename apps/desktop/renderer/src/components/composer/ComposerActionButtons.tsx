import { ArrowUp, Mic } from 'lucide-react';

interface ComposerActionButtonsProps {
  submitting?: boolean;
}

export function ComposerActionButtons({ submitting = false }: ComposerActionButtonsProps) {
  return (
    <div className="redou-composer-actions">
      <button className="redou-icon-button" type="button" aria-label="Voice input">
        <Mic size={16} />
      </button>
      <button className="redou-send-button" type="submit" aria-label={submitting ? 'Submitting' : 'Send message'} disabled={submitting}>
        <ArrowUp size={17} strokeWidth={2.5} />
      </button>
    </div>
  );
}
