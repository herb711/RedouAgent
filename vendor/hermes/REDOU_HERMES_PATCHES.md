# Redou-specific Hermes patches

Keep this file updated whenever Redou changes code under `vendor/hermes`.  The
folder intentionally preserves Hermes' original internal layout to make upstream
sync easier.

## Patches currently preserved

- Busy input defaults to `queue` via `hermes_cli/busy_input.py`; guide/steer is
  explicit and interrupt/replace remains available through Redou UI paths.
- Redou Context Assembly Contract in `hermes_cli/redou_context.py`: current user
  request appears once, queued future messages are excluded, guide/control events
  stay out of ordinary history, raw events are summarized, and prompt-bound
  secrets are redacted.
- Redou profile creation uses `--no-skills` where applicable, preserving the
  Redou policy that bundled skills are not auto-packed into new desktop profiles.
- Explicit desktop task packaging is implemented in `hermes_cli/redou_task_skill_packager.py`; Redou desktop only sends project/task state and records the result. Packaged skills include task-derived descriptions and context notes, are never created by automatic background packaging, and are written under the project `HERMES_HOME` / `.redou/skills/` directory.

## Sync workflow

1. Sync or diff upstream Hermes against this entire `vendor/hermes` subtree.
2. Re-apply or verify the patches listed above.
3. Run at least:

```bash
PYTHONPATH=vendor/hermes python -m py_compile vendor/hermes/hermes_cli/redou_context.py vendor/hermes/hermes_cli/busy_input.py
node --test ./apps/desktop/tests/*.test.cjs
```

## Redou task skill packager

Redou's explicit task-to-skill packaging implementation lives in Hermes as:

- `hermes_cli/redou_task_skill_packager.py`

The desktop application only collects project/task state and invokes this Hermes-side entry point with `python -m hermes_cli.redou_task_skill_packager`. Redou sets `HERMES_HOME` to the project `.redou` root and passes `REDOU_PROJECT_SKILLS_DIR`, so task-packaged skills are created under `<project-redou-root>/skills/task-packages/`. This keeps the skill format, metadata generation, supporting reference files, redaction, and writes inside the Hermes fork while preserving a clear upstream synchronization boundary.

## Hermes skill management bridge

- `hermes_cli/skill_manage_bridge.py` is kept inside Hermes so Redou Skills page actions call Hermes `skill_manage` through a process boundary instead of reimplementing skill mutation in the desktop layer.
