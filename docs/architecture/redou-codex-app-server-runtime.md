# redou-codex App-Server Runtime

redou-codex integration is split by responsibility:

- Client: app-server process, JSON-RPC JSONL, pending map, timeout, dispose.
- Protocol: thread, turn, steer, interrupt, resume parameter construction.
- Adapter: facade that satisfies the Redou runtime contract.
- Mapper: app-server notifications to Redou AgentEvent records.
- Permission: Redou approval UI to app-server approval/sandbox parameters.
- Session: task thread and active turn references.
- Lifecycle: start, resume, steer, interrupt orchestration.
- Error: normalized user-facing runtime errors.

No Redou source may import from `reference/codex`; that tree is read-only reference material.

The desktop app-server launch resolves a real project-local runtime executable first: `runtimes/redou-codex/codex-rs/target/release/redou-codex.exe`, then the debug build, then a managed `runtimes/redou-codex/bin/redou-codex.exe` if present. `REDOU_CODEX_COMMAND` may only override this with an explicit `redou-codex.exe` path. The desktop client does not use `codex.exe` from `PATH`.
