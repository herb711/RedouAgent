import { AlertCircle, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import type { ProgressStepData } from '../../types';

interface ProgressStepProps {
  step: ProgressStepData;
}

export function ProgressStep({ step }: ProgressStepProps) {
  const icon =
    step.status === 'completed' ? (
      <CheckCircle2 size={16} />
    ) : step.status === 'active' ? (
      <Loader2 size={16} />
    ) : step.status === 'error' ? (
      <AlertCircle size={16} />
    ) : (
      <Circle size={16} />
    );

  return (
    <div className="redou-progress-step" data-status={step.status}>
      <span className="redou-step-icon">{icon}</span>
      <span>{step.label}</span>
    </div>
  );
}
