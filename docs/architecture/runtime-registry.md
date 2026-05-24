# Runtime Registry

The runtime registry resolves a task to a runtime adapter with this priority:

1. `task.runtime`
2. `project.defaultRuntime`
3. `settings.defaultRuntime`
4. `redou-codex`

`redou-codex` is the default runtime. Hermes is legacy. Pi and custom runtimes are scaffolds.

The `redou-codex` adapter launches the project-local runtime under `runtimes/redou-codex`. It must not search for or fallback to a system `codex` binary.
