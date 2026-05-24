interface RuntimeStatusBadgeProps {
  label: string;
}

export function RuntimeStatusBadge({ label }: RuntimeStatusBadgeProps) {
  return <span className="redou-runtime-badge">{label}</span>;
}
