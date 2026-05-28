import { spawn } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { LLMEvent, ToolResultValue, type LLMEvent as LLMEventType } from "@opencode-ai/llm"
import * as Stream from "effect/Stream"
import type { Info as ProviderInfo, Model as ProviderModel } from "@/provider/provider"
import type { ModelMessage, Tool } from "ai"

export const providerID = "redou-codex"
export const runtimeNotFoundCode = "REDOU_CODEX_RUNTIME_NOT_FOUND"

type JsonLine = Record<string, any>

type ActiveToolState = {
  emittedToolCalls: Set<string>
  textID?: string
  text: string
  reasoningID?: string
  reasoning: string
  stepStarted: boolean
  finished: boolean
}

const OFFICIAL_ENV_PREFIXES = ["OPENAI_", "ANTHROPIC_", "CODEX_", "OPENCODE_"]
const OFFICIAL_ENV_KEYS = new Set([
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "CODEX_HOME",
  "CODEX_AUTH_TOKEN",
  "CODEX_API_KEY",
  "OPENCODE_API_KEY",
])

export type RedouCodexOptions = Record<string, unknown> & {
  redouCodexHome?: string
  redouCodexRoot?: string
  redouCodexBin?: string
  redouCodexDataHome?: string
  redouCodexArgs?: string[]
  baseURL?: string
  apiKey?: string
  model?: string
  timeout?: number | false
  timeoutMs?: number | false
}

export type ResolvedRuntime = {
  root?: string
  command: string
  args: string[]
  env: Record<string, string>
  useShell: boolean
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function asStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined
}

function executableName() {
  return process.platform === "win32" ? "redou-codex.exe" : "redou-codex"
}

function runtimeRootLooksValid(root: string) {
  return existsSync(path.join(root, "codex-rs")) || existsSync(path.join(root, "bin", "redou-codex"))
}

function bundledRuntimeCandidates() {
  const currentFile = fileURLToPath(import.meta.url)
  const currentDir = path.dirname(currentFile)
  return [
    // Source layout: packages/opencode/src/session/llm/redou-codex-runtime.ts
    path.resolve(currentDir, "../../../runtimes/redou-codex"),
    // Built package layouts.
    path.resolve(currentDir, "../../runtimes/redou-codex"),
    path.resolve(currentDir, "../../../../runtimes/redou-codex"),
    // Repository and package cwd layouts.
    path.resolve(process.cwd(), "packages/opencode/runtimes/redou-codex"),
    path.resolve(process.cwd(), "runtimes/redou-codex"),
  ]
}

export function isRedouCodexModel(model: ProviderModel) {
  return String(model.providerID) === providerID
}

export function resolveRuntime(options: RedouCodexOptions = {}): ResolvedRuntime {
  const envRoot = process.env.REDOU_CODEX_RUNTIME_ROOT ?? process.env.REDOU_CODEX_ROOT
  const envHome = process.env.REDOU_CODEX_HOME
  const envHomeAsRuntime = envHome && runtimeRootLooksValid(envHome) ? envHome : undefined
  const configuredRoot =
    asString(options.redouCodexRoot) ?? asString(options.redouCodexHome) ?? envRoot ?? envHomeAsRuntime
  const configuredBin = asString(options.redouCodexBin) ?? process.env.REDOU_CODEX_BIN
  const candidates = (configuredRoot ? [configuredRoot] : bundledRuntimeCandidates()).filter((item): item is string => Boolean(item))
  const exe = executableName()

  if (configuredBin) {
    const root = candidates.find(runtimeRootLooksValid)
    return baseResolved(root, configuredBin, [], options)
  }

  for (const root of candidates) {
    if (!runtimeRootLooksValid(root)) continue
    const release = path.join(root, "codex-rs", "target", "release", exe)
    const debug = path.join(root, "codex-rs", "target", "debug", exe)
    const shell = process.platform === "win32" ? path.join(root, "bin", "redou-codex.cmd") : path.join(root, "bin", "redou-codex")
    const nodeWrapper = path.join(root, "codex-cli", "bin", "redou-codex.js")

    for (const candidate of [release, debug, shell, nodeWrapper]) {
      if (existsSync(candidate)) return baseResolved(root, candidate, [], options)
    }
  }

  throw new Error(`${runtimeNotFoundCode}: redou-codex`)
}

function baseResolved(root: string | undefined, command: string, args: string[], options: RedouCodexOptions): ResolvedRuntime {
  const env = sanitizedEnv(options)
  const isNodeWrapper = command.endsWith(".js")
  const isCmd = command.endsWith(".cmd")

  if (root) {
    env.REDOU_CODEX_MANAGED_PACKAGE_ROOT = safeRealpath(root)
    env.REDOU_CODEX_RUNTIME_ROOT = root
  }
  env.REDOU_CODEX_RUNTIME = "1"

  const dataHome = asString(options.redouCodexDataHome) ?? process.env.REDOU_CODEX_DATA_HOME
  if (dataHome) {
    env.REDOU_CODEX_HOME = dataHome
    env.CODEX_HOME = dataHome
  }

  const baseURL = asString(options.baseURL) ?? process.env.REDOU_CODEX_BASE_URL
  const apiKey = asString(options.apiKey) ?? process.env.REDOU_CODEX_API_KEY
  const model = asString(options.model) ?? process.env.REDOU_CODEX_MODEL
  if (baseURL) env.REDOU_CODEX_BASE_URL = baseURL
  if (apiKey) env.REDOU_CODEX_API_KEY = apiKey
  if (model) env.REDOU_CODEX_MODEL = model

  if (isNodeWrapper) return { root, command: process.execPath, args: [command, ...args], env, useShell: false }
  return { root, command, args, env, useShell: isCmd }
}

function sanitizedEnv(options: RedouCodexOptions): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (OFFICIAL_ENV_KEYS.has(key)) continue
    if (OFFICIAL_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) continue
    env[key] = String(value)
  }
  // Explicitly keep Redou values supplied through process env unless provider options override them.
  const passthrough = [
    "REDOU_CODEX_RUNTIME_ROOT",
    "REDOU_CODEX_ROOT",
    "REDOU_CODEX_BIN",
    "REDOU_CODEX_BASE_URL",
    "REDOU_CODEX_API_KEY",
    "REDOU_CODEX_MODEL",
    "REDOU_CODEX_DATA_HOME",
    "REDOU_CODEX_DEV_MODE",
    "REDOU_CODEX_ALLOW_CARGO_FALLBACK",
  ]
  for (const key of passthrough) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  if (asString(options.baseURL)) env.REDOU_CODEX_BASE_URL = asString(options.baseURL)!
  if (asString(options.apiKey)) env.REDOU_CODEX_API_KEY = asString(options.apiKey)!
  if (asString(options.model)) env.REDOU_CODEX_MODEL = asString(options.model)!
  return env
}

function safeRealpath(input: string) {
  try {
    return realpathSync(input)
  } catch {
    return input
  }
}

function textContent(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return JSON.stringify(content)
  return content
    .map((part) => {
      if (typeof part === "string") return part
      if (!part || typeof part !== "object") return JSON.stringify(part)
      if ("text" in part && typeof part.text === "string") return part.text
      if ("type" in part) return `[${String(part.type)} ${JSON.stringify(part)}]`
      return JSON.stringify(part)
    })
    .join("\n")
}

function summarizeTools(tools: Record<string, Tool>) {
  const names = Object.keys(tools).filter((name) => name !== "invalid")
  if (!names.length) return ""
  return [
    "<opencode_tool_context>",
    "opencode has the following tool names enabled in the outer session. Redou Codex executes its own provider-side shell, file, MCP and search tools; provider-executed tool activity will be mirrored back into opencode as tool events:",
    names.join(", "),
    "</opencode_tool_context>",
  ].join("\n")
}

export function renderPrompt(input: { system: string[]; messages: ModelMessage[]; tools: Record<string, Tool> }) {
  const chunks: string[] = []
  if (input.system.length) chunks.push("<system>", input.system.join("\n\n"), "</system>")
  for (const message of input.messages) chunks.push(`<${message.role}>`, textContent(message.content), `</${message.role}>`)
  const toolContext = summarizeTools(input.tools)
  if (toolContext) chunks.push(toolContext)
  return chunks.join("\n")
}

function redouExecArgs(input: { model: ProviderModel; options: RedouCodexOptions; prompt: string }) {
  const configured = asStringArray(input.options.redouCodexArgs)
  if (configured) return configured
  const model = asString(input.options.model) ?? process.env.REDOU_CODEX_MODEL ?? input.model.api.id ?? input.model.id
  return ["exec", "--json", "--skip-git-repo-check", "--sandbox", "workspace-write", "--model", model, "-"]
}

function codexUsage(line: JsonLine) {
  const item = line.usage
  if (!item || typeof item !== "object") return undefined
  const inputTokens = typeof item.input_tokens === "number" ? item.input_tokens : 0
  const cachedInputTokens = typeof item.cached_input_tokens === "number" ? item.cached_input_tokens : 0
  const outputTokens = typeof item.output_tokens === "number" ? item.output_tokens : 0
  const reasoningTokens = typeof item.reasoning_output_tokens === "number" ? item.reasoning_output_tokens : 0
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cacheReadInputTokens: cachedInputTokens,
    reasoningTokens,
    providerMetadata: { redouCodex: { usage: item } },
  }
}

function statusOf(item: JsonLine) {
  return typeof item.status === "string" ? item.status : undefined
}

function failedStatus(item: JsonLine) {
  const status = statusOf(item)
  return status === "failed" || status === "declined"
}

function providerMetadata(line: JsonLine, toolKind?: string) {
  const item = line.item
  return {
    redouCodex: {
      runtime: "exec",
      eventType: line.type,
      itemID: typeof item?.id === "string" ? item.id : undefined,
      itemType: typeof item?.type === "string" ? item.type : undefined,
      toolKind,
      providerExecuted: true,
    },
  }
}

function truncateOutput(value: string, max = 60000) {
  if (value.length <= max) return value
  return value.slice(0, max) + `\n\n[redou-codex output truncated by opencode adapter: ${value.length - max} chars omitted]`
}

function contentText(content: unknown) {
  if (!Array.isArray(content)) return content === undefined ? "" : JSON.stringify(content)
  return content
    .map((entry) => {
      if (typeof entry === "string") return entry
      if (entry && typeof entry === "object" && "text" in entry && typeof (entry as any).text === "string") return (entry as any).text
      return JSON.stringify(entry)
    })
    .join("\n")
}

function toolMapping(item: JsonLine):
  | {
      id: string
      name: string
      input: Record<string, unknown>
      title: string
      output: string
      metadata: Record<string, unknown>
      error?: string
      kind: string
    }
  | undefined {
  if (!item || typeof item !== "object" || typeof item.id !== "string" || typeof item.type !== "string") return undefined
  switch (item.type) {
    case "command_execution":
      return {
        id: item.id,
        name: "shell",
        input: { command: item.command ?? "", provider: "redou-codex" },
        title: typeof item.command === "string" && item.command.trim() ? item.command : "Redou Codex command",
        output: truncateOutput(typeof item.aggregated_output === "string" ? item.aggregated_output : ""),
        metadata: { exitCode: item.exit_code, status: item.status },
        error: failedStatus(item) ? `redou-codex command ${item.status ?? "failed"}` : undefined,
        kind: "command_execution",
      }
    case "file_change":
      return {
        id: item.id,
        name: "edit",
        input: { changes: item.changes ?? [], provider: "redou-codex" },
        title: "Redou Codex file changes",
        output: JSON.stringify(item.changes ?? [], null, 2),
        metadata: { status: item.status, changes: item.changes ?? [] },
        error: failedStatus(item) ? "redou-codex file change failed" : undefined,
        kind: "file_change",
      }
    case "mcp_tool_call": {
      const result = item.result
      const error = item.error
      return {
        id: item.id,
        name: `mcp:${item.server ?? "unknown"}.${item.tool ?? "unknown"}`,
        input: { server: item.server, tool: item.tool, arguments: item.arguments ?? {}, provider: "redou-codex" },
        title: `MCP ${item.server ?? "unknown"}.${item.tool ?? "unknown"}`,
        output: result ? contentText(result.content) : "",
        metadata: { status: item.status, result, error },
        error: failedStatus(item) || error ? String(error?.message ?? "redou-codex MCP tool failed") : undefined,
        kind: "mcp_tool_call",
      }
    }
    case "collab_tool_call":
      return {
        id: item.id,
        name: "task",
        input: { tool: item.tool, prompt: item.prompt, receiverThreadIDs: item.receiver_thread_ids, provider: "redou-codex" },
        title: `Redou Codex collab ${item.tool ?? "tool"}`,
        output: JSON.stringify(item.agents_states ?? {}, null, 2),
        metadata: { status: item.status, agentsStates: item.agents_states ?? {} },
        error: failedStatus(item) ? "redou-codex collab tool failed" : undefined,
        kind: "collab_tool_call",
      }
    case "web_search":
      return {
        id: item.id,
        name: "websearch",
        input: { query: item.query ?? "", action: item.action, provider: "redou-codex" },
        title: `Web search: ${item.query ?? ""}`,
        output: JSON.stringify({ query: item.query, action: item.action }, null, 2),
        metadata: { action: item.action },
        kind: "web_search",
      }
    case "todo_list":
      return {
        id: item.id,
        name: "todowrite",
        input: { items: item.items ?? [], provider: "redou-codex" },
        title: "Redou Codex todo list",
        output: JSON.stringify(item.items ?? [], null, 2),
        metadata: { items: item.items ?? [] },
        kind: "todo_list",
      }
    case "error":
      return {
        id: item.id,
        name: "redou_error",
        input: { provider: "redou-codex" },
        title: "Redou Codex error",
        output: typeof item.message === "string" ? item.message : JSON.stringify(item),
        metadata: { item },
        error: typeof item.message === "string" ? item.message : "redou-codex error",
        kind: "error",
      }
    default:
      return undefined
  }
}

function toolEvents(line: JsonLine, state: ActiveToolState): LLMEventType[] {
  const item = line.item
  const mapped = toolMapping(item)
  if (!mapped) return []
  const events: LLMEventType[] = []
  const metadata = providerMetadata(line, mapped.kind)

  if (!state.emittedToolCalls.has(mapped.id)) {
    state.emittedToolCalls.add(mapped.id)
    events.push(
      LLMEvent.toolCall({
        id: mapped.id,
        name: mapped.name,
        input: mapped.input,
        providerExecuted: true,
        providerMetadata: metadata,
      }),
    )
  } else if (line.type === "item.updated") {
    events.push(
      LLMEvent.toolCall({
        id: mapped.id,
        name: mapped.name,
        input: mapped.input,
        providerExecuted: true,
        providerMetadata: metadata,
      }),
    )
  }

  if (line.type !== "item.completed") return events

  if (mapped.error) {
    events.push(
      LLMEvent.toolError({
        id: mapped.id,
        name: mapped.name,
        message: mapped.error,
        error: new Error(mapped.error),
        providerMetadata: metadata,
      }),
    )
  } else {
    events.push(
      LLMEvent.toolResult({
        id: mapped.id,
        name: mapped.name,
        result: ToolResultValue.make({ title: mapped.title, output: mapped.output, metadata: mapped.metadata }),
        providerExecuted: true,
        providerMetadata: metadata,
      }),
    )
  }
  state.emittedToolCalls.delete(mapped.id)
  return events
}

function textEvents(line: JsonLine, state: ActiveToolState) {
  const type = line.type
  if (type !== "item.started" && type !== "item.updated" && type !== "item.completed") return [] as LLMEventType[]
  const item = line.item
  if (!item || typeof item !== "object") return [] as LLMEventType[]
  const itemType = item.type
  const events: LLMEventType[] = []

  if (itemType === "agent_message" && typeof item.text === "string") {
    if (!state.textID) {
      state.textID = String(item.id ?? "redou-text")
      state.text = ""
      events.push(LLMEvent.textStart({ id: state.textID, providerMetadata: providerMetadata(line) }))
    }
    const delta = item.text.startsWith(state.text) ? item.text.slice(state.text.length) : item.text
    if (delta) events.push(LLMEvent.textDelta({ id: state.textID, text: delta, providerMetadata: providerMetadata(line) }))
    state.text = item.text
    if (type === "item.completed") {
      events.push(LLMEvent.textEnd({ id: state.textID, providerMetadata: providerMetadata(line) }))
      state.textID = undefined
    }
  }

  if (itemType === "reasoning" && typeof item.text === "string") {
    if (!state.reasoningID) {
      state.reasoningID = String(item.id ?? "redou-reasoning")
      state.reasoning = ""
      events.push(LLMEvent.reasoningStart({ id: state.reasoningID, providerMetadata: providerMetadata(line) }))
    }
    const delta = item.text.startsWith(state.reasoning) ? item.text.slice(state.reasoning.length) : item.text
    if (delta) events.push(LLMEvent.reasoningDelta({ id: state.reasoningID, text: delta, providerMetadata: providerMetadata(line) }))
    state.reasoning = item.text
    if (type === "item.completed") {
      events.push(LLMEvent.reasoningEnd({ id: state.reasoningID, providerMetadata: providerMetadata(line) }))
      state.reasoningID = undefined
    }
  }

  return events
}

export function mapJsonLineToEvents(line: JsonLine, state: ActiveToolState): LLMEventType[] {
  if (line.type === "turn.started" && !state.stepStarted) {
    state.stepStarted = true
    return [LLMEvent.stepStart({ index: 0 })]
  }
  if (line.type === "error") return [LLMEvent.providerError({ message: String(line.message ?? "redou-codex error"), retryable: false })]
  if (line.type === "turn.failed") {
    const message = String(line.error?.message ?? "redou-codex turn failed")
    return [LLMEvent.providerError({ message, retryable: false, providerMetadata: { redouCodex: { error: line.error } } })]
  }
  const events = [...textEvents(line, state), ...toolEvents(line, state)]
  if (line.type === "turn.completed" && !state.finished) {
    state.finished = true
    if (state.textID) {
      events.push(LLMEvent.textEnd({ id: state.textID, providerMetadata: providerMetadata(line) }))
      state.textID = undefined
    }
    if (state.reasoningID) {
      events.push(LLMEvent.reasoningEnd({ id: state.reasoningID, providerMetadata: providerMetadata(line) }))
      state.reasoningID = undefined
    }
    const usage = codexUsage(line)
    events.push(
      LLMEvent.stepFinish({ index: 0, reason: "stop", usage, providerMetadata: { redouCodex: { runtime: "exec" } } }),
      LLMEvent.finish({ reason: "stop", usage, providerMetadata: { redouCodex: { runtime: "exec" } } }),
    )
  }
  return events
}

function sanitizeError(input: string) {
  return input
    .replace(/(sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+/g, "$1…")
    .replace(/(REDOU_CODEX_API_KEY=)[^\s]+/g, "$1…")
    .replace(/(OPENAI_API_KEY=)[^\s]+/g, "$1…")
    .replace(/(ANTHROPIC_API_KEY=)[^\s]+/g, "$1…")
}

async function* runJsonl(input: {
  model: ProviderModel
  provider: ProviderInfo
  system: string[]
  messages: ModelMessage[]
  tools: Record<string, Tool>
  abort: AbortSignal
}) {
  const options = input.provider.options as RedouCodexOptions
  const runtime = resolveRuntime(options)
  const prompt = renderPrompt(input)
  const execArgs = redouExecArgs({ model: input.model, options, prompt })
  const child = spawn(runtime.command, [...runtime.args, ...execArgs], {
    stdio: ["pipe", "pipe", "pipe"],
    env: runtime.env,
    cwd: process.cwd(),
    windowsHide: true,
    shell: runtime.useShell,
  })

  const kill = () => {
    if (!child.killed) child.kill("SIGTERM")
  }
  input.abort.addEventListener("abort", kill, { once: true })

  let stderr = ""
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })

  child.stdin.end(prompt)

  const state: ActiveToolState = {
    emittedToolCalls: new Set(),
    text: "",
    reasoning: "",
    stepStarted: false,
    finished: false,
  }
  let lineBuffer = ""
  child.stdout.setEncoding("utf8")

  try {
    for await (const chunk of child.stdout) {
      lineBuffer += chunk
      while (true) {
        const idx = lineBuffer.indexOf("\n")
        if (idx < 0) break
        const raw = lineBuffer.slice(0, idx).trim()
        lineBuffer = lineBuffer.slice(idx + 1)
        if (!raw) continue
        let line: JsonLine
        try {
          line = JSON.parse(raw)
        } catch {
          if (!state.textID) {
            state.textID = "redou-text"
            yield LLMEvent.textStart({ id: state.textID })
          }
          yield LLMEvent.textDelta({ id: state.textID, text: raw + "\n" })
          continue
        }

        for (const event of mapJsonLineToEvents(line, state)) {
          if (event.type === "provider-error") throw new Error(event.message)
          yield event
        }
      }
    }
  } finally {
    input.abort.removeEventListener("abort", kill)
  }

  const code = await new Promise<number | null>((resolve) => child.on("close", resolve))
  if (code !== 0) throw new Error(sanitizeError(stderr.trim()) || `redou-codex exited with ${code}`)
}

export function stream(input: {
  model: ProviderModel
  provider: ProviderInfo
  system: string[]
  messages: ModelMessage[]
  tools: Record<string, Tool>
  abort: AbortSignal
}) {
  return Stream.fromAsyncIterable(runJsonl(input), (error) => (error instanceof Error ? error : new Error(String(error))))
}

export const RedouCodexRuntime = {
  providerID,
  runtimeNotFoundCode,
  isRedouCodexModel,
  resolveRuntime,
  renderPrompt,
  mapJsonLineToEvents,
  stream,
} as const
