import { afterEach, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { LLMEvent } from "@opencode-ai/llm"
import { RedouCodexRuntime } from "../src/session/llm/redou-codex-runtime"

const savedEnv = new Map<string, string | undefined>()

function remember(key: string) {
  if (!savedEnv.has(key)) savedEnv.set(key, process.env[key])
}

function setEnv(key: string, value: string | undefined) {
  remember(key)
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  savedEnv.clear()
})

async function fakeRuntimeRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "redou-codex-runtime-"))
  await mkdir(path.join(root, "bin"), { recursive: true })
  const bin = path.join(root, "bin", process.platform === "win32" ? "redou-codex.cmd" : "redou-codex")
  await writeFile(bin, process.platform === "win32" ? "@echo off\necho fake redou\n" : "#!/usr/bin/env sh\necho fake redou\n")
  await chmod(bin, 0o755)
  return { root, bin }
}

test("resolves only configured or bundled redou-codex and never PATH codex", async () => {
  const { root, bin } = await fakeRuntimeRoot()
  try {
    setEnv("PATH", `${path.join(os.tmpdir(), "hostile-codex")}${path.delimiter}${process.env.PATH ?? ""}`)
    const resolved = RedouCodexRuntime.resolveRuntime({ redouCodexRoot: root })
    expect(resolved.command).toBe(bin)
    expect(resolved.command).not.toBe("codex")
    expect(resolved.command).not.toBe("opencode")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("throws REDOU_CODEX_RUNTIME_NOT_FOUND when explicit runtime root is wrong", () => {
  expect(() => RedouCodexRuntime.resolveRuntime({ redouCodexRoot: path.join(os.tmpdir(), "missing-redou-codex") })).toThrow(
    "REDOU_CODEX_RUNTIME_NOT_FOUND",
  )
})

test("strips official provider environment and injects redou runtime variables", async () => {
  const { root } = await fakeRuntimeRoot()
  try {
    setEnv("OPENAI_API_KEY", "sk-should-not-leak")
    setEnv("ANTHROPIC_API_KEY", "anthropic-should-not-leak")
    setEnv("CODEX_API_KEY", "codex-should-not-leak")
    setEnv("OPENCODE_API_KEY", "opencode-should-not-leak")
    const resolved = RedouCodexRuntime.resolveRuntime({
      redouCodexRoot: root,
      baseURL: "http://127.0.0.1:15580/v1",
      apiKey: "sk-redou",
      model: "qwen/local",
    })
    expect(resolved.env.OPENAI_API_KEY).toBeUndefined()
    expect(resolved.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(resolved.env.CODEX_API_KEY).toBeUndefined()
    expect(resolved.env.OPENCODE_API_KEY).toBeUndefined()
    expect(resolved.env.REDOU_CODEX_BASE_URL).toBe("http://127.0.0.1:15580/v1")
    expect(resolved.env.REDOU_CODEX_API_KEY).toBe("sk-redou")
    expect(resolved.env.REDOU_CODEX_MODEL).toBe("qwen/local")
    expect(resolved.env.REDOU_CODEX_RUNTIME_ROOT).toBe(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("maps redou-codex text, usage, and provider-executed shell tool events", () => {
  const state = { emittedToolCalls: new Set<string>(), text: "", reasoning: "", stepStarted: false, finished: false }
  const events = [
    ...RedouCodexRuntime.mapJsonLineToEvents({ type: "turn.started" }, state),
    ...RedouCodexRuntime.mapJsonLineToEvents(
      {
        type: "item.started",
        item: { id: "cmd1", type: "command_execution", command: "pwd", aggregated_output: "", status: "in_progress" },
      },
      state,
    ),
    ...RedouCodexRuntime.mapJsonLineToEvents(
      {
        type: "item.completed",
        item: { id: "cmd1", type: "command_execution", command: "pwd", aggregated_output: "/tmp\n", exit_code: 0, status: "completed" },
      },
      state,
    ),
    ...RedouCodexRuntime.mapJsonLineToEvents(
      { type: "item.completed", item: { id: "msg1", type: "agent_message", text: "done" } },
      state,
    ),
    ...RedouCodexRuntime.mapJsonLineToEvents(
      { type: "turn.completed", usage: { input_tokens: 3, cached_input_tokens: 1, output_tokens: 2, reasoning_output_tokens: 0 } },
      state,
    ),
  ]
  expect(events.some((event) => event.type === "step-start")).toBe(true)
  const toolCall = events.find((event) => LLMEvent.is.toolCall(event))
  expect(toolCall?.name).toBe("shell")
  expect(toolCall?.providerExecuted).toBe(true)
  const toolResult = events.find((event) => LLMEvent.is.toolResult(event))
  expect(toolResult?.providerExecuted).toBe(true)
  expect(events.filter(LLMEvent.is.textDelta).map((event) => event.text).join("")).toBe("done")
  const finish = events.find((event) => LLMEvent.is.finish(event))
  expect(finish?.usage?.inputTokens).toBe(3)
  expect(finish?.usage?.cacheReadInputTokens).toBe(1)
})

test("maps redou-codex file, MCP, websearch, todo and error events as provider-executed opencode tool events", () => {
  const state = { emittedToolCalls: new Set<string>(), text: "", reasoning: "", stepStarted: false, finished: false }
  const lines = [
    { type: "item.completed", item: { id: "f1", type: "file_change", changes: [{ path: "a.txt", kind: "update" }], status: "completed" } },
    { type: "item.completed", item: { id: "m1", type: "mcp_tool_call", server: "fs", tool: "read", arguments: { path: "a.txt" }, result: { content: [{ type: "text", text: "ok" }], structured_content: { ok: true } }, status: "completed" } },
    { type: "item.completed", item: { id: "w1", type: "web_search", query: "redou", action: "search" } },
    { type: "item.completed", item: { id: "t1", type: "todo_list", items: [{ text: "check", completed: true }] } },
    { type: "item.completed", item: { id: "e1", type: "error", message: "boom" } },
  ]
  const events = lines.flatMap((line) => RedouCodexRuntime.mapJsonLineToEvents(line, state))
  const calls = events.filter(LLMEvent.is.toolCall)
  expect(calls.map((event) => event.name)).toEqual(["edit", "mcp:fs.read", "websearch", "todowrite", "redou_error"])
  expect(calls.every((event) => event.providerExecuted === true)).toBe(true)
  expect(events.some(LLMEvent.is.toolError)).toBe(true)
})
