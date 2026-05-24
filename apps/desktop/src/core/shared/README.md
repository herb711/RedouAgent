# Shared Core

Shared core contains small cross-domain helpers and constants that are genuinely used by multiple core modules.

Add shared code here only after duplication appears across models, stores, context, rules, events, or snapshots.

Do not place runtime-specific code, IPC handlers, platform wrappers, or broad utility dumping-ground modules here.
