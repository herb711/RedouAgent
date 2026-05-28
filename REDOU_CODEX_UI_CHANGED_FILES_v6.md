# REDOU_CODEX_UI_CHANGED_FILES_v6

## Added

- `packages/opencode/src/redou-codex-ui/bridge.ts`
  - RedouCodex UI bridge.
  - Starts `redou-codex app-server --listen stdio://`.
  - Converts opencode UI/session/event expectations into redou-codex thread/turn/item/approval protocol.
  - Rejects unsafe `REDOU_CODEX_BIN=codex` / `REDOU_CODEX_BIN=opencode`.
  - Strips official upstream API/auth/base/provider/model environment variables before launching the child process.

- `packages/opencode/redou-codex/runtime/**`
  - RedouAgent `runtimes/redou-codex` copied into opencode package-local runtime location.
  - Runtime integrity: source files `4645`, target files `4645`, missing `0`, changed `0`.

- `packages/opencode/redou-codex/README.md`
  - Runtime/bridge naming and launch notes.

## Modified

- `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`
  - Session/message/prompt/command/shell/diff/todo/fork/abort/update/delete APIs delegate to `RedouCodexUI`.
  - Opencode session storage/agent loop is not the execution backend in redou mode.

- `packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts`
  - `/global/event` streams RedouCodexUI events to the app UI.

- `packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts`
  - `/event` streams RedouCodexUI events for CLI/TUI consumers that use instance events.

- `packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts`
  - Provider list/auth/authorize/callback are made redou-codex-only in redou mode.

- `packages/opencode/src/server/routes/instance/httpapi/handlers/config.ts`
  - Config provider endpoint exposes `redou-codex/default`.

- `packages/opencode/src/server/routes/instance/httpapi/handlers/instance.ts`
  - Agent list exposes a single primary `redou-codex` UI agent.

- `packages/opencode/src/server/routes/instance/httpapi/handlers/permission.ts`
  - Permission list/reply now forwards RedouCodex approval requests and replies.

## Not changed intentionally

- Original opencode backend files remain in the repository because the UI/server package imports their schemas, route groups, SDK generation types, and shared UI data structures.
- In default redou mode, the modified route handlers bypass those backend execution paths.
- Set `REDOU_CODEX_UI_DISABLE=1` only if you intentionally want to fall back to original opencode behavior for debugging.
