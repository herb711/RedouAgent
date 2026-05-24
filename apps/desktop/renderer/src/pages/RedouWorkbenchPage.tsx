import { AppShell } from '../components/layout/AppShell';
import { useWorkbenchStore } from '../state/workbenchStore';

export function RedouWorkbenchPage() {
  const workbench = useWorkbenchStore();

  return <AppShell state={workbench.state} actions={workbench.actions} />;
}
