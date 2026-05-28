# redou-codex UI runtime

This package-local directory contains the RedouAgent `redou-codex` runtime and the opencode UI bridge uses it as the backend agent runtime.

The UI bridge is implemented in:

- `packages/opencode/src/redou-codex-ui/bridge.ts`

The bridge launches:

```bash
redou-codex app-server --listen stdio://
```

All new public names intentionally use `redou-codex`, `RedouCodex`, `redouCodex`, or `REDOU_CODEX_*` to avoid ambiguity with official Codex binaries or configuration.

Runtime resolution order:

1. `REDOU_CODEX_BIN` as an explicit path; bare `codex` / `opencode` commands are rejected.
2. `codex-rs/target/release/redou-codex`
3. `codex-rs/target/debug/redou-codex`
4. `bin/redou-codex`
5. `codex-cli/bin/redou-codex.js`

When starting the child process, official upstream variables such as `OPENAI_*`, `ANTHROPIC_*`, `CODEX_*`, and `OPENCODE_*` auth/base/provider/model variables are stripped unless they are `REDOU_CODEX_*` variables.
