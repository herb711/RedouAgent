# Redou-Codex App Compatibility

This layer owns the Redou-side projection of official Codex App behavior.

Redou Workbench should keep product ownership narrow: UI tone, project/task shell, local data roots, permission controls, and domestic model provider configuration. Execution semantics should flow through redou-codex app-server events and compatibility snapshots.

Planned modules:

- `instructions`: base/developer instruction assembly.
- `context`: structured context packages, budget, compaction inputs, replay inputs.
- `events`: complete app-server notification normalization.
- `state`: thread, turn, item, diff, approval, task and stop-reason state.
- `continuation`: incomplete-turn detection and bounded continuation.
- `models`: provider capability registry and degraded-mode rules.
- `permissions`: permission UI to sandbox/approval contracts.
- `diagnostics`: event replay, context preview and stop-reason explanation.

Do not import from `reference/codex` here. Reuse the local `runtimes/redou-codex` protocol/runtime surface and keep official reference code isolated.
