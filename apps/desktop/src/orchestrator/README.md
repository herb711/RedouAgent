# Orchestrator

The orchestrator connects Redou tasks, context packages, runtime selection, runtime events, approvals, and UI snapshots.

Add workflow-level coordination here when it spans core and runtimes. Keep entity persistence in stores and host APIs in platform.

Do not maintain a Redou plan/todo/goal engine here. Todo and plan projections must be derived from Codex plan/item events.
