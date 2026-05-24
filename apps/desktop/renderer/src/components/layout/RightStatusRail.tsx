import { RightActivityRail } from './RightActivityRail';
import { RightInspectorPanel } from './RightInspectorPanel';
import type { WorkbenchActions, WorkbenchState } from '../../state/workbenchStore';

interface RightStatusRailProps {
  state: WorkbenchState;
  actions: WorkbenchActions;
}

export function RightStatusRail({ state, actions }: RightStatusRailProps) {
  return (
    <aside className="redou-right-status-rail" aria-label="Redou activity and inspector">
      {state.rightPanelOpen && state.activeRightPanel ? (
        <RightInspectorPanel
          data={state.data}
          activePanel={state.activeRightPanel}
          onClose={actions.closeRightPanel}
          runtimeAvailability={state.runtimeAvailability}
          runtimeError={state.runtimeError}
          apiMode={state.apiMode}
          onOpenArtifactPreview={() => actions.selectView('artifactPreview')}
        />
      ) : null}
      <RightActivityRail
        panels={state.data.rightPanels}
        activePanel={state.activeRightPanel}
        panelOpen={state.rightPanelOpen}
        onSelectPanel={actions.selectRightPanel}
      />
    </aside>
  );
}
