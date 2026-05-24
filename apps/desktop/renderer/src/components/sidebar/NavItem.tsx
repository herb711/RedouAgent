import type { LucideIcon } from 'lucide-react';

interface NavItemProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick?: () => void;
}

export function NavItem({ icon: Icon, label, active, onClick }: NavItemProps) {
  return (
    <button className="redou-nav-item" data-active={active ? 'true' : 'false'} type="button" onClick={onClick}>
      <Icon size={16} />
      <span>{label}</span>
    </button>
  );
}
