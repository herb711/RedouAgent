# Runtimes

Runtimes adapt external execution engines into the Redou Workbench contract.

redou-codex is the primary runtime. Hermes is legacy. Pi and custom runtimes are scaffolds for future integrations.

Add shared contracts in `common` and runtime-specific files in their own subdirectory. Runtime adapters should emit Redou runtime events and avoid direct renderer or IPC dependencies.

Do not import `reference/codex` or copy old local-service/Hermes logic into the new runtime layer. Split runtime files before they approach 600 lines.
