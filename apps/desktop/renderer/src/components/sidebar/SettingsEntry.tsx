import { Settings } from 'lucide-react';

interface SettingsEntryProps {
  active?: boolean;
  onClick?: () => void;
}

export function SettingsEntry({ active, onClick }: SettingsEntryProps) {
  return (
    <button className="redou-settings-entry" data-active={active ? 'true' : 'false'} type="button" onClick={onClick}>
      <Settings size={16} />
      <span>设置</span>
    </button>
  );
}
