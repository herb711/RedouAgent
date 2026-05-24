# Directory Map

- `apps/desktop/src/core`: Redou models, stores, context, rules, events, snapshots.
- `apps/desktop/src/runtimes`: runtime contracts and adapters.
- `apps/desktop/src/runtimes/redou-codex`: Redou desktop adapter for the redou-codex app-server protocol.
- `apps/desktop/src/redou-codex/app-compat`: planned Codex App compatibility contracts projected into Redou.
- `apps/desktop/src/orchestrator`: workflow glue between tasks, context, runtime, approvals, and snapshots.
- `apps/desktop/src/ipc`: IPC channel registration and routing only.
- `apps/desktop/src/platform`: Electron, filesystem, git, logging, process, and config wrappers.
- `apps/desktop/src/legacy`: narrow compatibility shims only.
- `apps/desktop/renderer`: Redou-owned Vite/React workbench UI.
- `apps/desktop/src_legacy`: old source reference only.
- `reference/codex`: copied Codex source snapshot for protocol reference only.
- `runtimes/redou-codex`: Redou-owned runtime implementation copied from `reference/codex`.

Do not put business logic in IPC index files, renderer page composition files, platform wrappers, or reference snapshots.
