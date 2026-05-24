# Extension Guide

Add a runtime by creating a new `apps/desktop/src/runtimes/<id>` directory with an adapter, README, and index export, then register it through `runtimes/common/runtimeRegistry.cjs` wiring.

Add IPC by creating a focused `apps/desktop/src/ipc/<domain>Ipc.cjs` file and adding only its register call to `ipc/index.cjs`.

Add a UI panel under the matching `apps/desktop/renderer/src/components/<domain>` directory. Keep pages as layout composition only.

Add context sources by creating a new builder under `apps/desktop/src/core/context` and composing it from `contextAssembler.cjs`. Codex turn input belongs only in `redouCodexInputBuilder.cjs`.

Add event mapping in the runtime-specific mapper, then keep cross-runtime normalization in `runtimes/common/runtimeEventMapper.cjs`.

Avoid giant files by splitting when a module gains a second responsibility. Business files must remain under 600 lines, adapters should be facades, stores should be entity-scoped, and renderer state should be split by entity or panel.
