# Components

Components are split by Workbench panel: layout, sidebar, thread, composer, status, review, files, changes, rules, context, logs, and artifacts.

`RedouWorkbenchPage` only composes the page. Complex UI must be split into the panel directories instead of being embedded in the page.

`TodoProjectionView` can only display results derived from Codex plan/item events. It must not plan tasks or maintain a Redou todo planner.
