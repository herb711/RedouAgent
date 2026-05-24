# redou-codex Runtime

Phase 1 goal: prove `Electron -> preload -> IPC -> runtimeRunOrchestrator -> redou-codex app-server` without using the system Codex command.

## Runtime Command

- Default Windows command: `runtimes/redou-codex/codex-rs/target/release/redou-codex.exe app-server`.
- Fallback executable search: release `redou-codex.exe`, debug `redou-codex.exe`, then managed `runtimes/redou-codex/bin/redou-codex.exe`.
- Development-only fallback: Cargo may run the project-local `redou-codex` source only when the desktop passes `allowCargoFallback` or `REDOU_CODEX_ALLOW_CARGO_FALLBACK=1` / `REDOU_CODEX_DEV_MODE=1` is set.
- Production behavior: missing `redou-codex.exe` is `REDOU_CODEX_RUNTIME_NOT_FOUND`; production must not fall back to Cargo.
- Override: `REDOU_CODEX_COMMAND` must be an explicit path to `redou-codex.exe`.
- Forbidden: bare `codex`, `codex.exe`, `where codex`, PATH lookup, wrapper scripts for app-server startup, and `WindowsApps/codex.exe`.

## Current Code Boundaries

- Desktop command resolution: `apps/desktop/src/runtimes/redou-codex/redouCodexRuntimeConfig.cjs`.
- Desktop app-server transport client: `apps/desktop/src/runtimes/redou-codex/redouCodexAppServerClient.cjs`.
- Desktop availability check: `apps/desktop/src/runtimes/redou-codex/redouCodexAvailability.cjs`.
- Runtime wrapper scripts: `runtimes/redou-codex/bin/redou-codex.cmd` and `runtimes/redou-codex/bin/redou-codex`.
- Runtime CLI entry: `runtimes/redou-codex/codex-rs/cli/src/main.rs`.
- Rust app-server entry: `runtimes/redou-codex/codex-rs/app-server/src/main.rs` or `redou-codex app-server`.

## Official Codex/OpenAI Touchpoints To Replace Later

- Authentication entry:
  - CLI login command: `runtimes/redou-codex/codex-rs/cli/src/main.rs`.
  - Login implementation: `runtimes/redou-codex/codex-rs/login/src`.
  - App-server account processor: `runtimes/redou-codex/codex-rs/app-server/src/request_processors/account_processor.rs`.
- Model call entry:
  - Model client: `runtimes/redou-codex/codex-rs/core/src/client.rs`.
  - Provider construction: `runtimes/redou-codex/codex-rs/model-provider/src/provider.rs`.
  - Redou env placeholder: `runtimes/redou-codex/codex-rs/model-provider/src/redou_env.rs`.
- Config directory:
  - Redou desktop sets `REDOU_CODEX_HOME` and a fixed child `CODEX_HOME` to `.redou/redou-codex`.
  - The child environment strips inherited official Codex auth variables such as `OPENAI_API_KEY`, `CODEX_API_KEY`, and `CODEX_ACCESS_TOKEN`.
  - The runtime must not read the user's global `~/.codex/auth.json`; auth/config reads are scoped to `.redou/redou-codex`.
- App-server startup:
  - CLI subcommand: `redou-codex app-server`.
  - Rust app-server runner: `runtimes/redou-codex/codex-rs/app-server/src/lib.rs`.
- Protocol/events to map for Redou:
  - Existing desktop mapper: `apps/desktop/src/runtimes/redou-codex/redouCodexEventMapper.cjs`.
  - App-server protocol schemas: `runtimes/redou-codex/codex-rs/app-server-protocol`.
  - Redou still needs explicit contracts for model config, login/account status, turn lifecycle, approvals, command output, file changes, plan updates, and error events.

## Reserved Model Env

- `REDOU_MODEL_PROVIDER`
- `REDOU_MODEL_BASE_URL`
- `REDOU_MODEL_API_KEY`
- `REDOU_MODEL_NAME`

Missing model config is surfaced as `REDOU_MODEL_CONFIG_MISSING` before starting a model turn. Phase 2 should wire these values into an OpenAI-compatible provider under the Rust model-provider layer.

## Verification Commands

Build the project-local runtime:

```powershell
Set-Location D:\SynologyDrive\ZhuSync\workcopy\RedouAgent\runtimes\redou-codex
cargo build --manifest-path .\codex-rs\Cargo.toml -p redou-codex-cli --bin redou-codex
.\codex-rs\target\debug\redou-codex.exe --version
```

Start Redou desktop against the project-local runtime:

```powershell
Set-Location D:\SynologyDrive\ZhuSync\workcopy\RedouAgent
$env:REDOU_MODEL_PROVIDER = "openai-compatible"
$env:REDOU_MODEL_BASE_URL = "https://your-model-host.example/v1"
$env:REDOU_MODEL_API_KEY = "your-redou-model-key"
$env:REDOU_MODEL_NAME = "your-model-name"
npm.cmd --prefix apps\desktop run build:renderer
npm.cmd --prefix apps\desktop run dev
```

Confirm command resolution does not use system Codex:

```powershell
Set-Location D:\SynologyDrive\ZhuSync\workcopy\RedouAgent
node --test apps\desktop\tests\redouCodexRuntimeConfig.test.cjs
rg -n -- "where codex|where.exe codex|CODEX_ACCESS_DENIED|codex.exe" apps\desktop\src runtimes\redou-codex\bin runtimes\redou-codex\codex-cli\bin
```

Confirm the resolved runtime path is project-local:

```powershell
Set-Location D:\SynologyDrive\ZhuSync\workcopy\RedouAgent
node -e "const { defaultRedouCodexCommand } = require('./apps/desktop/src/runtimes/redou-codex/index.cjs'); console.log(defaultRedouCodexCommand({ workspaceRoot: process.cwd() }))"
```

Inspect redou-codex app-server logs:

```powershell
Set-Location D:\SynologyDrive\ZhuSync\workcopy\RedouAgent
Get-Content .redou\logs\redou-codex-app-server.jsonl -Wait
```
