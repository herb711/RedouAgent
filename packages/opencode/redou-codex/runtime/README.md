# redou-codex Runtime

`redou-codex` is Redou Agent's project-local runtime fork of the Codex app-server source snapshot.

This tree is copied from `reference/codex` and is now owned by Redou. Do not refresh or edit `reference/codex` when changing this runtime.

## Commands

Windows:

```cmd
bin\redou-codex.cmd app-server
```

macOS/Linux:

```sh
bin/redou-codex app-server
```

Build the native CLI:

```sh
cargo build --manifest-path ./codex-rs/Cargo.toml -p redou-codex-cli --bin redou-codex
```

The wrappers only run binaries under this directory or `cargo run` against this directory. They do not call `codex`, `where codex`, or `WindowsApps/codex.exe`.

## Model Env Reserved For Phase 2

- `REDOU_MODEL_PROVIDER`
- `REDOU_MODEL_BASE_URL`
- `REDOU_MODEL_API_KEY`
- `REDOU_MODEL_NAME`

Phase 1 only reserves and validates these values from Redou desktop. The Rust model layer still contains upstream Codex/OpenAI code paths and is listed in the Redou architecture notes for follow-up replacement.
