# Redou Workbench main source

This is the new Redou Workbench source root. It is the main line for the rewrite; `apps/desktop/src_legacy` is reference-only legacy code.

Responsibilities:
- Own the desktop shell, orchestration, context assembly, runtime adapters, IPC registration, and platform boundaries.
- Treat Codex thread, turn, plan, item, diff, approval, command, and file-change events as the execution-state source of truth.

Add new code by domain: core state and context in `core`, runtime implementations in `runtimes`, workflow glue in `orchestrator`, IPC channels in `ipc`, and host capabilities in `platform`.

Do not place renderer UI, copied external sources, old local-service logic, or all-in-one service files here. Business files must stay below 600 lines; split earlier when a file starts to absorb multiple responsibilities.
