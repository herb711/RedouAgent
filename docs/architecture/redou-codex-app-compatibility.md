# Redou-Codex App Compatibility Architecture

Redou Workbench should behave like the official Codex App execution surface while keeping Redou ownership narrow: desktop UI tone, project/task entry points, local data roots, and domestic model provider configuration.

## Ownership Boundary

- `reference/codex` is the read-only official Codex source snapshot.
- `runtimes/redou-codex` is the project-local runtime package copied from the official Codex tree and renamed at the product boundary.
- `apps/desktop/src/runtimes/redou-codex` is the Redou desktop adapter for the redou-codex app-server protocol.
- `apps/desktop/src/redou-codex/app-compat` is reserved for official Codex App compatibility contracts that Redou must project into the desktop UI.
- `apps/desktop/renderer` remains Redou-owned UI and must consume compatibility snapshots rather than infer agent state itself.

## Target Layers

```text
apps/desktop/src/redou-codex/
  app-compat/
    instructions/      Redou-Codex developer/base instruction assembly.
    context/           Turn context package, budget, compaction and replay inputs.
    events/            Full app-server notification coverage and normalization.
    state/             Thread, turn, item, diff, approval and task state machines.
    continuation/      Incomplete-turn detection, queued continuation and bounded retry.
    models/            Domestic model capability registry and degraded-mode rules.
    permissions/       Redou permission UI to redou-codex sandbox/approval contracts.
    diagnostics/       Event replay, context preview and stop-reason inspection.

apps/desktop/src/runtimes/redou-codex/
  JSON-RPC client, protocol builder, lifecycle, permission mapper and runtime facade.
```

## Compatibility Contracts

### Instructions

Redou-Codex instructions are assembled in this order:

1. Official Codex-compatible base behavior.
2. Redou Workbench autonomy guardrails.
3. Project and task rules.
4. Model capability warnings, especially for unknown OpenAI-compatible models.
5. Explicit user/developer overrides.

The adapter must not end a turn with a promise to inspect, continue, run, or change something without either doing it or reporting the blocker.

### Context

Every turn context package must be structured before serialization:

- project/task metadata
- current user input
- recent messages
- selected files and attachments
- project/task rules
- environment and git state
- runtime/model/permission state
- budget metadata

Objects must be serialized with structured JSON. `[object Object]` is a contract failure.

### Events And State

The app-server event stream is the source of truth. Redou state snapshots are projections of:

- thread lifecycle
- turn lifecycle
- item lifecycle
- assistant message deltas/completions
- plan updates
- command/file/diff updates
- approval requests/resolutions
- usage and model metadata
- warnings, errors and degraded-mode signals

The UI must distinguish `completed`, `waiting_user`, `waiting_approval`, `failed`, `incomplete`, `compacting` and `degraded`.

### Continuation

The continuation layer must detect a turn as `incomplete` when the final assistant message says it will continue checking or changing something but no later tool call or blocking approval exists. A bounded automatic continuation may run only when permissions and model policy allow it; otherwise the UI must show a clear needs-attention state.

### Models

Domestic providers are configured through Redou, not scattered through runtime logic. Each model is described by:

- provider id and base URL
- context window
- tool-call reliability
- parallel-tool support
- reasoning support
- wire API
- timeout profile
- known quirks

Unknown models must enter degraded mode and surface that fact in diagnostics.

## Migration Order

1. Rename Redou-owned Codex adapter names to redou-codex while preserving official reference/upstream paths.
2. Add the app-compat module skeleton and route context/instructions through it.
3. Expand app-server event mapping and state snapshots.
4. Add continuation and incomplete-turn detection.
5. Add model capability registry for domestic providers.
6. Move renderer assumptions to compatibility snapshot consumption.

## Acceptance Criteria

- Redou-owned runtime paths use `redou-codex` names.
- Official reference code remains isolated under `reference/codex`.
- Redou can replay task events and explain the stop reason.
- No Redou context serialization produces `[object Object]`.
- A final assistant promise without a following tool call is not treated as a clean completion.
- Unknown model metadata is visible as degraded mode.
