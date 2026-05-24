# Redou Workbench Rewrite

Redou Workbench is a direct rewrite rather than a conservative migration. The old desktop code grew around Redou-local services and Hermes execution paths; the new architecture treats Codex app-server as the primary execution engine and keeps Redou focused on workbench ownership.

Source relationship:
- `apps/desktop/src` is the new mainline source root.
- `apps/desktop/src_legacy` is preserved as reference-only legacy Redou/Hermes code.
- `reference/codex` is a copied OpenAI Codex source snapshot for protocol and behavior reference only.

Execution-state source of truth:
- Codex thread, turn, plan, item, diff, approval, command, and file-change events are authoritative.
- Redou does not maintain a second plan/todo/goal engine.
- Todo views are projections derived from Codex plan and item lifecycle events.

Redou owns the desktop shell, project/task entry points, rule management, context packaging, permission UI, event display, snapshots, and renderer workbench.

Hermes remains available only as a legacy runtime scaffold during the rewrite. `vendor/hermes` and old code are retained but are not the Phase 1 mainline.
