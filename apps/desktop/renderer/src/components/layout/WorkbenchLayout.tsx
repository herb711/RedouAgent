import type { ReactNode } from 'react';

interface WorkbenchLayoutProps {
  sidebar: ReactNode;
  main: ReactNode;
  rightTop: ReactNode;
  rightMiddle: ReactNode;
  rightBottom: ReactNode;
  bottom: ReactNode;
}

export function WorkbenchLayout(props: WorkbenchLayoutProps) {
  return (
    <div className="workbench-layout">
      <aside>{props.sidebar}</aside>
      <main>{props.main}</main>
      <section>{props.rightTop}{props.rightMiddle}{props.rightBottom}</section>
      <footer>{props.bottom}</footer>
    </div>
  );
}
