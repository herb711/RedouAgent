# REDOU_CODEX_UI_TEST_REPORT_v6

## Environment

- Node: v22.16.0
- npm: 10.9.2
- Bun: not available in this sandbox
- Rust/Cargo: not available in this sandbox
- Real precompiled redou-codex binary present: `False`

Because Bun and Rust/Cargo are unavailable here, I could not run the full opencode workspace build or compile the real Rust `redou-codex` binary in this sandbox.

The packaged RedouAgent runtime currently has no compiled binary at:

```text
packages/opencode/redou-codex/runtime/codex-rs/target/release/redou-codex
packages/opencode/redou-codex/runtime/codex-rs/target/debug/redou-codex
```

Attempting the bundled wrapper directly returns:

```text
REDOU_CODEX_RUNTIME_NOT_FOUND: redou-codex
```

That is expected until a real `redou-codex` binary is compiled or supplied.

## Executed checks

### 1. Runtime integrity

- Source runtime path: `/mnt/data/v6_redou/runtimes/redou-codex`
- Target runtime path: `packages/opencode/redou-codex/runtime`
- Source files: `4645`
- Target files: `4645`
- Missing: `0`
- Extra: `0`
- Changed content: `0`
- `bin/redou-codex` mode: `0o755`
- `codex-cli/bin/redou-codex.js` mode: `0o755`

Result: PASS.

### 2. Bridge syntax / executable JS check

`packages/opencode/src/redou-codex-ui/bridge.ts` was transpiled with the available global `tsc` and checked with `node --check`.

The local `tsc` command reports missing Node/project type dependencies because `bun install` was not run in this sandbox. No syntax parse errors were reported; emitted JS passed `node --check`.

Result: PASS for syntax/executable JS; full project typecheck deferred to local Bun environment.

### 3. True UI <-> redou-codex app-server protocol smoke test

I used a temporary fake `redou-codex` executable that implements the real `app-server --listen stdio://` JSON-RPC shape. It verified the bridge actually launches and communicates with an app-server process, not just rewrites files.

Fake redou-codex received:

```json
["initialize", "initialized", "thread/start", "turn/start"]
```

UI bridge emitted:

```json
["session.created", "message.updated", "message.part.updated", "session.status", "message.updated", "session.status", "message.part.updated", "message.part.updated", "message.part.delta", "message.part.updated", "message.part.updated", "message.part.updated", "message.part.updated", "permission.asked", "permission.replied", "message.part.updated", "session.diff", "message.updated", "session.updated", "session.status"]
```

Validated behaviors:

- UI bridge launched `redou-codex app-server --listen stdio://`.
- UI create session became `thread/start`.
- UI prompt became `turn/start`.
- Redou agent text delta became `message.part.delta`.
- Redou command execution became `redou-codex.shell` tool part.
- Redou diff became `session.diff` with opencode `SnapshotFileDiff` shape.
- Redou approval server request became `permission.asked`.
- UI approval response went back to redou-codex as JSON-RPC response with decision `accept`.
- Official `OPENAI_*` / `CODEX_*` test variables were stripped from the child process.

Result: PASS.

### 4. Runtime resolver safety

Resolver checks:

```json
[
  {
    "name": "rejects bare codex",
    "ok": true
  },
  {
    "name": "rejects bare opencode",
    "ok": true
  },
  {
    "name": "missing explicit redou bin reports not found",
    "ok": true
  }
]
```

Result: PASS.

### 5. Static validation

Static validation summary:

```json
{
  "ok": true,
  "passed": 47,
  "failed": 0
}
```

Result: PASS.

## What still requires your local environment

To run a real end-to-end model/tool session, compile or supply the real binary first:

```bash
cd packages/opencode/redou-codex/runtime/codex-rs
cargo build --release --bin redou-codex
```

Then run opencode with the UI bridge enabled:

```bash
cd <repo-root>
bun install
bun run --cwd packages/opencode typecheck
bun run --cwd packages/opencode test
REDOU_CODEX_HOME="$PWD/packages/opencode/redou-codex/runtime/.redou-codex-home" bun run dev
```

Optional explicit binary:

```bash
REDOU_CODEX_BIN="$PWD/packages/opencode/redou-codex/runtime/codex-rs/target/release/redou-codex" bun run dev
```

Do not set `REDOU_CODEX_BIN=codex` or `REDOU_CODEX_BIN=opencode`; v6 rejects those names.
## Zip validation

The final archive is validated separately in `opencode-redou-codex-ui-v6-zip-validation.json` and `opencode-redou-codex-ui-v6.sha256.txt`. The zip integrity checks used: `zipfile.is_zipfile == true` and `zipfile.testzip == null`.

Result: PASS.
