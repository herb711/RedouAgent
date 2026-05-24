import type { ReactNode } from 'react';

interface ProjectSectionProps {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function ProjectSection({ title, actions, children }: ProjectSectionProps) {
  return (
    <section className="redou-project-section">
      <div className="redou-project-section-heading">
        <h2>{title}</h2>
        {actions ? <div className="redou-project-section-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
