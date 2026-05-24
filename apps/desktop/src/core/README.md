# Core

Core contains Redou-owned domain models, stores, context packages, rules, event shapes, and snapshots.

Add entity definitions under `models`, persistence facades under `store`, context builders under `context`, rule logic under `rules`, event helpers under `events`, and view snapshots under `snapshots`.

Do not put runtime process control, IPC registration, Electron code, or renderer UI here. Core must not re-create Codex plan/todo/goal execution state; it only stores Redou outer task metadata and Codex-derived projections.
