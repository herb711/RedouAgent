# redou-codex Runtime

redou-codex is the primary Redou Workbench runtime and the execution-state source of truth.

File boundaries:
- `redouCodexRuntimeAdapter.cjs` is only a facade. It delegates and must not become the whole runtime.
- `redouCodexAppServerClient.cjs` owns the redou-codex app-server process and JSON-RPC JSONL transport.
- `redouCodexProtocol.cjs` builds protocol parameters.
- `redouCodexEventMapper.cjs` maps app-server notifications to Redou AgentEvent records.
- `redouCodexPermissionMapper.cjs` maps Redou permission UI choices to app-server approval and sandbox parameters.
- `redouCodexSessionStore.cjs` stores thread and turn session references.
- `redouCodexLifecycle.cjs` orchestrates start, resume, steer, and interrupt flows.
- `redouCodexErrorMapper.cjs` and `redouCodexErrors.cjs` normalize errors.
- `redouCodexAvailability.cjs` checks executable and app-server availability later.

Do not import from `reference/codex`. Do not put all logic in `redouCodexRuntimeAdapter.cjs`. Treat `allow_always` and similar permissions conservatively when Phase 2 implements real behavior.
