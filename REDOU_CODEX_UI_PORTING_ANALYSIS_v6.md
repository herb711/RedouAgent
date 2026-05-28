# REDOU_CODEX_UI_PORTING_ANALYSIS_v6

## 目标

v6 的目标不是把 `redou-codex` 当成 opencode 的一个普通 provider，而是把 opencode 改成 UI shell：

```text
opencode UI / SDK client / SSE event stream
  -> packages/opencode/src/redou-codex-ui/bridge.ts
  -> redou-codex app-server --listen stdio://
  -> redou-codex thread / turn / item / approval / diff protocol
```

因此，opencode 原有的 session/LLM/provider/tool agent loop 在 `REDOU_CODEX_UI_DISABLE != 1` 的默认模式下被旁路；UI 只接收、显示和回传 redou-codex 的状态与事件。

## 实际接入点

核心 bridge 放在 opencode 自己的 package 内部：

```text
packages/opencode/src/redou-codex-ui/bridge.ts
```

RedouAgent runtime 放在 package-local 位置：

```text
packages/opencode/redou-codex/runtime
```

没有新增根目录 `bin/`、`runtimes/`、`redou-opencode-adapter/`。

## 协议映射

bridge 使用 redou-codex app-server JSON-RPC/stdin-stdout 协议：

- `initialize` / `initialized`
- `thread/start`
- `thread/list`
- `thread/fork`
- `thread/archive`（best effort）
- `turn/start`
- `turn/interrupt`

redou-codex notifications 映射到 opencode UI event：

- `thread/started` -> `session.created`
- `thread/name/updated` -> `session.updated`
- `thread/status/changed` -> `session.status`
- `turn/started` -> `session.status: busy`
- `turn/completed` -> `message.updated` + `session.status: idle`
- `turn/diff/updated` -> `session.diff`
- `turn/plan/updated` -> reasoning/todo-style part
- `item/agentMessage/delta` -> `message.part.delta`
- `item/commandExecution/outputDelta` -> `redou-codex.shell` tool part
- `item/fileChange/patchUpdated` -> `redou-codex.file-change` tool part + diff
- `item/*/requestApproval` JSON-RPC server request -> `permission.asked`
- permission reply -> JSON-RPC response back to redou-codex with `accept` / `acceptForSession` / `decline`

## UI-facing API routes changed

The following opencode HTTP handlers now delegate to `RedouCodexUI` when enabled:

- session: create/list/get/messages/prompt/promptAsync/command/shell/diff/todo/fork/abort/delete/update/permission response
- global event stream: `/global/event`
- instance event stream: `/event`
- provider list/auth/config provider: returns only `redou-codex/default`
- permission list/reply: replies are forwarded to redou-codex server requests
- instance agent list: returns a single `redou-codex` primary agent

## 命名策略

新增模块、provider、model、agent、tool names、config/env names 全部使用：

```text
redou-codex
RedouCodex
redouCodex
REDOU_CODEX_*
```

Bare `codex` / `opencode` executable fallback is rejected by `REDOU_CODEX_UNSAFE_BIN_NAME`.

注意：`redou-codex` runtime 源码内部仍然有上游目录名 `codex-rs` / `codex-cli`，这是 RedouAgent runtime 自身源码结构；v6 没有把它们暴露成新命令或新配置名。
