# Store

Store modules are entity-scoped persistence facades for projects, tasks, messages, events, rules, context packages, artifacts, logs, runtime sessions, and workspace state.

Add a new store only when a new entity needs persistence. Each store should document its future `.redou/...` location and expose narrow CRUD-style functions.

Do not create `redouStore.cjs`, `localService.cjs`, or any all-in-one store. Stores must not talk directly to Codex, Electron IPC, or renderer UI.
