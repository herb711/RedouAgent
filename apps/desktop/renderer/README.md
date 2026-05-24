# Redou-owned Renderer

This renderer is the new Redou Workbench UI shell. It is intentionally Redou-owned and presents Codex execution events rather than reimplementing the agent loop.

Add API wrappers in `src/api`, shared types in `src/types`, state slices in `src/state`, pages in `src/pages`, and reusable panels under `src/components`.

Do not put main-process logic, runtime adapters, or large all-in-one page state here. Page files compose panels; complex state belongs in focused state modules.
