# Context

ContextPackage is a core Redou feature. Project rules, task rules, user input, recent messages, attachments, selected files, workspace summaries, and environment information are assembled here before runtime execution.

Responsibilities:
- `contextAssembler.cjs` is the entry point and only composes smaller builders.
- Rules, messages, files, attachments, environment, and budget decisions belong in separate builder modules.
- Codex input construction must live in `redouCodexInputBuilder.cjs`.

Do not put all context logic into a giant `contextAssembler`. Do not generate Redou-owned plan/todo/goal steps here. Keep `contextAssembler.cjs` below 400 lines and split new context sources into their own modules.
