# REDOU_CODEX_UI_NAMING_CHECK_v6

## Passed checks

- New provider ID: `redou-codex`
- New default model ID: `redou-codex/default`
- New primary agent name: `redou-codex`
- New bridge namespace: `RedouCodexUI`
- New route/bridge package directory: `redou-codex-ui`
- New runtime package directory: `packages/opencode/redou-codex/runtime`
- New tools emitted to UI: `redou-codex.shell`, `redou-codex.file-change`, `redou-codex.<itemType>`
- New env/config namespace: `REDOU_CODEX_*`
- Bare command fallback rejected for: `codex`, `opencode`
- No root-level `bin/`, `runtimes/`, or `redou-opencode-adapter/` directory added.

## Expected inherited names

The runtime source copied from RedouAgent still contains internal source directories named `codex-rs` and `codex-cli`. These are part of the RedouAgent runtime tree and are not exposed by v6 as official Codex commands. The actual command names used by v6 are `redou-codex`, `redou-codex.js`, and `redou-codex app-server`.
