import { Check, ChevronDown, ChevronRight, Settings } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  getReasoningEffortLabel,
  reasoningEffortOptions,
} from './composerOptions';
import type { ComposerReasoningEffortId, ModelConfigSelection, ModelConfigSnapshot } from '../../types';

interface ModelSelectorButtonProps {
  label: string;
  modelId?: string;
  modelConfig: ModelConfigSnapshot;
  selected?: ModelConfigSelection | null;
  reasoningEffort?: ComposerReasoningEffortId;
  runtime: string;
  onModelSelect: (selection: ModelConfigSelection) => Promise<void>;
  onOpenSettings: () => void;
}

export function ModelSelectorButton({
  label,
  modelId = '',
  modelConfig,
  selected,
  reasoningEffort = 'xhigh',
  onModelSelect,
  onOpenSettings,
}: ModelSelectorButtonProps) {
  const [open, setOpen] = useState(false);
  const [expandedProviderIds, setExpandedProviderIds] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const effortLabel = getReasoningEffortLabel(reasoningEffort);
  const activeProvider = selected
    ? modelConfig.providers.find((provider) => provider.id === selected.providerId)
    : null;
  const activeModelId = selected?.modelId || modelId;
  const buttonLabel = label || (activeProvider && activeModelId ? `${activeProvider.label} / ${activeModelId}` : '配置模型');

  useEffect(() => {
    if (!modelConfig.providers.length) return;
    const activeProviderId = selected?.providerId || modelConfig.providers[0]?.id;
    if (!activeProviderId) return;
    setExpandedProviderIds((current) => current.includes(activeProviderId) ? current : [activeProviderId, ...current]);
  }, [modelConfig.providers, selected?.providerId]);

  useEffect(() => {
    if (!open) return undefined;

    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    window.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  function toggleProvider(providerId: string) {
    setExpandedProviderIds((current) => current.includes(providerId)
      ? current.filter((id) => id !== providerId)
      : [...current, providerId]);
  }

  async function selectModel(providerId: string, nextModelId: string) {
    await onModelSelect({ providerId, modelId: nextModelId });
    setOpen(false);
  }

  return (
    <div className="redou-composer-popover-anchor" ref={rootRef}>
      <button
        className="redou-model-button"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : 'false'}
        onClick={() => setOpen((value) => !value)}
      >
        <strong>{buttonLabel}</strong>
        <ChevronDown size={15} />
      </button>
      {open ? (
        <div className="redou-model-menu" role="menu" aria-label="Model and reasoning">
          <div className="redou-model-menu-topline">
            <span className="redou-menu-heading">模型</span>
            <button className="redou-model-settings-link" type="button" onClick={onOpenSettings} aria-label="打开模型设置" title="打开模型设置">
              <Settings size={15} />
            </button>
          </div>
          {modelConfig.providers.length ? (
            <div className="redou-model-provider-list">
              {modelConfig.providers.map((provider) => {
                const expanded = expandedProviderIds.includes(provider.id);
                return (
                  <div className="redou-model-provider-group" key={provider.id}>
                    <button
                      className="redou-model-provider-row"
                      type="button"
                      role="menuitem"
                      aria-expanded={expanded ? 'true' : 'false'}
                      onClick={() => toggleProvider(provider.id)}
                    >
                      <span>{provider.label}</span>
                      <ChevronRight size={16} />
                    </button>
                    {expanded ? (
                      <div className="redou-model-provider-models">
                        {provider.models.map((option) => {
                          const active = selected?.providerId === provider.id && selected?.modelId === option;
                          return (
                            <button
                              className="redou-model-menu-item"
                              type="button"
                              role="menuitemradio"
                              aria-checked={active}
                              key={option}
                              onClick={() => void selectModel(provider.id, option)}
                            >
                              <span>{option}</span>
                              {active ? <Check size={17} /> : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="redou-model-empty">
              <span>还没有配置模型</span>
              <button type="button" onClick={onOpenSettings}>去配置</button>
            </div>
          )}
          <div className="redou-menu-separator" />
          <span className="redou-menu-heading">推理强度 · {effortLabel}</span>
          <div className="redou-model-effort-row">
            {reasoningEffortOptions.filter((option) => option.id !== 'auto').map((option) => (
              <button
                className="redou-effort-chip"
                type="button"
                data-active={option.id === reasoningEffort ? 'true' : 'false'}
                key={option.id}
                onClick={() => undefined}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
