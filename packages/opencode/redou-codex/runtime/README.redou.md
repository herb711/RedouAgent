# Redou Runtime Snapshot

This directory was copied from `reference/codex` and converted into the Redou-owned runtime `redou-codex`.

Redou desktop must launch this runtime through a project-local command:

- `runtimes/redou-codex/bin/redou-codex.cmd` on Windows.
- `runtimes/redou-codex/bin/redou-codex` on macOS/Linux.

`REDOU_CODEX_COMMAND` is allowed only as an explicit path override to another `redou-codex` executable or script. It must not point to a bare `codex` command or `WindowsApps/codex.exe`.

Original reference source remains in `reference/codex`.
