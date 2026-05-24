import { BadgeCheck, Check, ChevronDown, Hand, ShieldAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getPermissionModeOption, permissionModeOptions } from './composerOptions';
import type { ComposerPermissionModeId } from '../../types';

interface PermissionModeButtonProps {
  mode: ComposerPermissionModeId;
  onChange: (mode: ComposerPermissionModeId) => void;
}

const optionIcons = {
  default: Hand,
  'auto-review': BadgeCheck,
  'full-access': ShieldAlert,
} as const;

export function PermissionModeButton({ mode, onChange }: PermissionModeButtonProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = getPermissionModeOption(mode);
  const SelectedIcon = optionIcons[mode];

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

  return (
    <div className="redou-composer-popover-anchor" ref={rootRef}>
      <button
        className="redou-permission-button"
        data-mode={mode}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : 'false'}
        title={selected.description}
        onClick={() => setOpen((value) => !value)}
      >
        <SelectedIcon size={15} />
        <span>{selected.label}</span>
        <ChevronDown size={15} />
      </button>
      {open ? (
        <div className="redou-permission-menu" role="menu" aria-label="Permission mode">
          {permissionModeOptions.map((option) => {
            const Icon = optionIcons[option.id];
            const active = option.id === mode;

            return (
              <button
                className="redou-permission-menu-item"
                data-active={active ? 'true' : 'false'}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                key={option.id}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
              >
                <Icon size={18} />
                <span>{option.label}</span>
                {active ? <Check size={18} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
