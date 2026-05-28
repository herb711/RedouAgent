import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface } from "node:readline"
import { EventEmitter } from "node:events"
import { existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const REDOU_CODEX_PROVIDER_ID = "redou-codex"
const REDOU_CODEX_MODEL_ID = "redou-codex/default"
const REDOU_CODEX_AGENT = "redou-codex"
const REDOU_CODEX_VERSION = "redou-codex-ui-v6"
const REDOU_CODEX_PROJECT_ID = "global"
const REQUEST_TIMEOUT_MS = Number(process.env.REDOU_CODEX_APP_SERVER_TIMEOUT_MS ?? 120_000)
const DEFAULT_TITLE = "New redou-codex session"

type JsonObject = Record<string, any>
type RedouEvent = {
  directory: string
  project?: string
  workspace?: string
  payload: {
    id: string
    type: string
    properties: JsonObject
  }
}

type SessionInfo = {
  id: string
  slug: string
  projectID: string
  workspaceID?: string
  directory: string
  path?: string
  parentID?: string
  summary?: JsonObject
  cost?: number
  tokens?: Tokens
  share?: { url: string }
  title: string
  agent?: string
  model?: { id: string; providerID: string; variant?: string }
  version: string
  time: { created: number; updated: number; compacting?: number; archived?: number }
  permission?: Array<{ permission: string; pattern: string; action: string }>
  revert?: JsonObject
}

type Tokens = {
  total?: number
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

type MessageInfo = {
  id: string
  sessionID: string
  role: "user" | "assistant"
  time: { created: number; completed?: number }
  agent?: string
  model?: { providerID: string; modelID: string; variant?: string }
  parentID?: string
  modelID?: string
  providerID?: string
  mode?: string
  path?: { cwd: string; root: string }
  cost?: number
  tokens?: Tokens
  finish?: string
  error?: JsonObject
}

type Part = JsonObject & {
  id: string
  sessionID: string
  messageID: string
  type: string
}

type MessageWithParts = { info: MessageInfo; parts: Part[] }

type BridgeSession = {
  sessionID: string
  threadID: string
  directory: string
  info: SessionInfo
  messages: MessageWithParts[]
  activeAssistantMessageID?: string
  activeTurnID?: string
  itemMap: Map<string, Part>
  redouToMessage: Map<string, string>
  diff: string
  todo: Array<JsonObject>
}

type PendingPermission = {
  permissionID: string
  sessionID: string
  threadID: string
  rpcID: number | string
  method: string
  params: JsonObject
  request: JsonObject
}

type PendingRpc = {
  resolve: (value: any) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  method: string
}

function now() {
  return Date.now()
}

function suffix() {
  return `${Date.now().toString(16)}${Math.random().toString(36).slice(2, 12)}`
}

function id(prefix: string) {
  return `${prefix}_${suffix()}`
}

function slug(input: string) {
  const result = input
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return result || "redou-codex"
}

function emptyTokens(): Tokens {
  return { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
}

function defaultRuntimeRoot() {
  return path.resolve(__dirname, "..", "..", "redou-codex", "runtime")
}

function isBareCommand(value: string) {
  return !path.isAbsolute(value) && !value.includes("/") && !value.includes("\\")
}

function commandName(value: string) {
  return path.basename(value).toLowerCase().replace(/\.(exe|cmd|bat|ps1|sh|js)$/i, "")
}

function assertSafeRedouCodexBin(value: string) {
  const name = commandName(value)
  if (isBareCommand(value) || name === "codex" || name === "opencode") {
    throw new Error(`REDOU_CODEX_UNSAFE_BIN_NAME: ${value}. REDOU_CODEX_BIN must point to a redou-codex executable path.`)
  }
}

export function enabled() {
  return process.env.REDOU_CODEX_UI_DISABLE !== "1"
}

export type RuntimeResolution = {
  home: string
  runtimeRoot: string
  command: string
  argsPrefix: string[]
  kind: "native" | "wrapper" | "node-wrapper"
}

export function resolveRuntime(): RuntimeResolution {
  const runtimeRoot = path.resolve(process.env.REDOU_CODEX_RUNTIME_ROOT || defaultRuntimeRoot())
  const home = path.resolve(process.env.REDOU_CODEX_HOME || path.join(runtimeRoot, ".redou-codex-home"))
  const exe = process.platform === "win32" ? "redou-codex.exe" : "redou-codex"

  const fromEnv = process.env.REDOU_CODEX_BIN?.trim()
  if (fromEnv) {
    assertSafeRedouCodexBin(fromEnv)
    const command = path.resolve(fromEnv)
    if (!existsSync(command)) throw new Error(`REDOU_CODEX_RUNTIME_NOT_FOUND: ${command}`)
    return { home, runtimeRoot, command, argsPrefix: [], kind: "native" }
  }

  const candidates: Array<RuntimeResolution> = [
    {
      home,
      runtimeRoot,
      command: path.join(runtimeRoot, "codex-rs", "target", "release", exe),
      argsPrefix: [],
      kind: "native",
    },
    {
      home,
      runtimeRoot,
      command: path.join(runtimeRoot, "codex-rs", "target", "debug", exe),
      argsPrefix: [],
      kind: "native",
    },
    {
      home,
      runtimeRoot,
      command: path.join(runtimeRoot, "bin", process.platform === "win32" ? "redou-codex.cmd" : "redou-codex"),
      argsPrefix: [],
      kind: "wrapper",
    },
    {
      home,
      runtimeRoot,
      command: process.execPath,
      argsPrefix: [path.join(runtimeRoot, "codex-cli", "bin", "redou-codex.js")],
      kind: "node-wrapper",
    },
  ]

  for (const candidate of candidates) {
    const check = candidate.kind === "node-wrapper" ? candidate.argsPrefix[0] : candidate.command
    if (existsSync(check)) return candidate
  }

  throw new Error(`REDOU_CODEX_RUNTIME_NOT_FOUND: ${runtimeRoot}`)
}

function childEnv(resolution: RuntimeResolution) {
  const blocked = /^(OPENAI|ANTHROPIC|CODEX|OPENCODE)_(API|AUTH|BASE|TOKEN|KEY|HOME|CONFIG|PROVIDER|MODEL)/i
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (blocked.test(key) && !key.startsWith("REDOU_CODEX_")) continue
    env[key] = String(value)
  }
  env.REDOU_CODEX_RUNTIME = "1"
  env.REDOU_CODEX_UI = "1"
  env.REDOU_CODEX_HOME = resolution.home
  env.REDOU_CODEX_RUNTIME_ROOT = resolution.runtimeRoot
  env.REDOU_CODEX_MANAGED_PACKAGE_ROOT = resolution.runtimeRoot
  env.CODEX_HOME = resolution.home
  if (process.env.REDOU_CODEX_BASE_URL) env.REDOU_CODEX_BASE_URL = process.env.REDOU_CODEX_BASE_URL
  if (process.env.REDOU_CODEX_API_KEY) env.REDOU_CODEX_API_KEY = process.env.REDOU_CODEX_API_KEY
  if (process.env.REDOU_CODEX_MODEL) env.REDOU_CODEX_MODEL = process.env.REDOU_CODEX_MODEL
  return env
}

class JsonRpcConnection extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams
  private nextID = 1
  private pending = new Map<number | string, PendingRpc>()
  private stderr = ""
  private started?: Promise<void>

  async ensureStarted() {
    if (this.started) return this.started
    this.started = this.start()
    return this.started
  }

  private async start() {
    const runtime = resolveRuntime()
    mkdirSync(runtime.home, { recursive: true })
    const args = [...runtime.argsPrefix, "app-server", "--listen", "stdio://"]
    this.child = spawn(runtime.command, args, {
      cwd: process.cwd(),
      env: childEnv(runtime),
      stdio: "pipe",
      windowsHide: true,
    })

    this.child.stderr.on("data", (chunk) => {
      this.stderr += String(chunk)
      if (this.stderr.length > 32_000) this.stderr = this.stderr.slice(-32_000)
    })

    this.child.once("error", (error) => {
      this.rejectAll(new Error(`REDOU_CODEX_APP_SERVER_START_FAILED: ${error.message}`))
    })
    this.child.once("exit", (code, signal) => {
      const reason = signal ? `signal ${signal}` : `exit ${code}`
      this.rejectAll(new Error(`REDOU_CODEX_APP_SERVER_EXITED: ${reason}\n${this.stderr}`))
      this.started = undefined
      this.child = undefined
    })

    createInterface({ input: this.child.stdout }).on("line", (line) => this.onLine(line))

    await this.sendRequest("initialize", {
      clientInfo: {
        name: "redou-codex-ui",
        title: "Redou Codex UI",
        version: REDOU_CODEX_VERSION,
      },
      capabilities: {
        experimentalApi: true,
      },
    })
    this.notify("initialized", {})
  }

  private onLine(line: string) {
    if (!line.trim()) return
    let msg: JsonObject
    try {
      msg = JSON.parse(line)
    } catch {
      this.emit("protocol-error", new Error(`REDOU_CODEX_APP_SERVER_BAD_JSON: ${line.slice(0, 200)}`))
      return
    }

    if (Object.prototype.hasOwnProperty.call(msg, "id") && this.pending.has(msg.id)) {
      const pending = this.pending.get(msg.id)!
      this.pending.delete(msg.id)
      clearTimeout(pending.timer)
      if (msg.error) {
        const message = msg.error.message || JSON.stringify(msg.error)
        pending.reject(new Error(`REDOU_CODEX_RPC_ERROR:${pending.method}: ${message}`))
      } else {
        pending.resolve(msg.result)
      }
      return
    }

    if (typeof msg.method === "string") {
      if (Object.prototype.hasOwnProperty.call(msg, "id")) {
        this.emit("request", msg)
      } else {
        this.emit("notification", msg)
      }
    }
  }

  private sendRequest(method: string, params?: JsonObject): Promise<any> {
    return new Promise((resolve, reject) => {
      const child = this.child
      if (!child?.stdin.writable) {
        reject(new Error("REDOU_CODEX_APP_SERVER_NOT_RUNNING"))
        return
      }
      const id = this.nextID++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`REDOU_CODEX_RPC_TIMEOUT:${method}`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer, method })
      child.stdin.write(JSON.stringify({ id, method, params: params ?? {} }) + "\n")
    })
  }

  request(method: string, params?: JsonObject): Promise<any> {
    return this.ensureStarted().then(() => this.sendRequest(method, params))
  }

  notify(method: string, params?: JsonObject) {
    const child = this.child
    if (!child?.stdin.writable) return
    child.stdin.write(JSON.stringify({ method, params: params ?? {} }) + "\n")
  }

  respond(id: number | string, result: JsonObject) {
    const child = this.child
    if (!child?.stdin.writable) return
    child.stdin.write(JSON.stringify({ id, result }) + "\n")
  }

  respondError(id: number | string, code: number, message: string) {
    const child = this.child
    if (!child?.stdin.writable) return
    child.stdin.write(JSON.stringify({ id, error: { code, message } }) + "\n")
  }

  async stop() {
    for (const pending of this.pending.values()) clearTimeout(pending.timer)
    this.pending.clear()
    if (!this.child) return
    this.child.kill("SIGTERM")
    this.child = undefined
    this.started = undefined
  }

  private rejectAll(error: Error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
      this.pending.delete(id)
    }
  }
}

class RedouCodexUIBridge {
  private connection = new JsonRpcConnection()
  private emitter = new EventEmitter()
  private sessions = new Map<string, BridgeSession>()
  private threadToSession = new Map<string, string>()
  private permissions = new Map<string, PendingPermission>()
  private emittedSessions = new Set<string>()

  constructor() {
    this.connection.on("notification", (msg: JsonObject) => this.handleNotification(msg))
    this.connection.on("request", (msg: JsonObject) => this.handleServerRequest(msg))
  }

  onGlobalEvent(cb: (event: RedouEvent) => void) {
    this.emitter.on("global-event", cb)
    return () => this.emitter.off("global-event", cb)
  }

  runtimeInfo() {
    const resolved = resolveRuntime()
    return {
      enabled: enabled(),
      providerID: REDOU_CODEX_PROVIDER_ID,
      modelID: REDOU_CODEX_MODEL_ID,
      runtimeRoot: resolved.runtimeRoot,
      home: resolved.home,
      command: resolved.command,
      argsPrefix: resolved.argsPrefix,
      kind: resolved.kind,
    }
  }

  providerList() {
    const provider = redouProviderInfo()
    return {
      all: [provider],
      default: { [REDOU_CODEX_PROVIDER_ID]: REDOU_CODEX_MODEL_ID },
      connected: [REDOU_CODEX_PROVIDER_ID],
    }
  }

  configProviders() {
    const provider = redouProviderInfo()
    return {
      providers: [provider],
      default: { [REDOU_CODEX_PROVIDER_ID]: REDOU_CODEX_MODEL_ID },
    }
  }

  async list(input: { directory?: string; limit?: number; search?: string } = {}) {
    await this.connection.ensureStarted()
    await this.refreshThreads(input.directory)
    const sessions = [...this.sessions.values()]
      .filter((entry) => !input.directory || entry.directory === input.directory)
      .map((entry) => entry.info)
      .filter((info) => !input.search || info.title.includes(input.search))
      .sort((a, b) => b.time.updated - a.time.updated)
    return typeof input.limit === "number" ? sessions.slice(0, input.limit) : sessions
  }

  status() {
    return Object.fromEntries(
      [...this.sessions.values()].map((entry) => [entry.sessionID, { type: entry.activeTurnID ? "busy" : "idle" }]),
    )
  }

  async get(sessionID: string) {
    const session = this.require(sessionID)
    return session.info
  }

  async children(_sessionID: string) {
    return []
  }

  async todo(sessionID: string) {
    return this.require(sessionID).todo
  }

  async diff(sessionID: string) {
    const session = this.require(sessionID)
    if (!session.diff) return []
    return [toSnapshotDiff(session.diff)]
  }

  async messages(sessionID: string) {
    return this.require(sessionID).messages
  }

  async message(sessionID: string, messageID: string) {
    const result = this.require(sessionID).messages.find((msg) => msg.info.id === messageID)
    if (!result) throw new Error(`REDOU_CODEX_MESSAGE_NOT_FOUND: ${messageID}`)
    return result
  }

  async create(payload?: JsonObject, directory?: string) {
    await this.connection.ensureStarted()
    const cwd = path.resolve(directory || process.env.REDOU_CODEX_WORKDIR || process.cwd())
    const result = await this.connection.request("thread/start", {
      cwd,
      model: process.env.REDOU_CODEX_MODEL,
      modelProvider: process.env.REDOU_CODEX_MODEL_PROVIDER,
      approvalPolicy: process.env.REDOU_CODEX_APPROVAL_POLICY || "unlessTrusted",
      sandbox: process.env.REDOU_CODEX_SANDBOX || "workspaceWrite",
      personality: process.env.REDOU_CODEX_PERSONALITY || "friendly",
      serviceName: "redou-codex-ui",
      sessionStartSource: "startup",
    })
    const thread = result?.thread ?? result
    const session = this.adoptThread(thread, cwd, payload?.title)
    this.emitSessionCreated(session)
    return session.info
  }

  async remove(sessionID: string) {
    const session = this.require(sessionID)
    try {
      await this.connection.request("thread/archive", { threadId: session.threadID })
    } catch {
      // Older app-server builds may not have archive enabled. The UI store should still remove the shell session.
    }
    this.sessions.delete(sessionID)
    this.threadToSession.delete(session.threadID)
    this.emit("session.deleted", { sessionID, info: session.info }, session.directory)
    return true
  }

  async update(sessionID: string, payload: JsonObject) {
    const session = this.require(sessionID)
    if (typeof payload.title === "string") {
      session.info.title = payload.title
      try {
        await this.connection.request("thread/name/update", { threadId: session.threadID, threadName: payload.title })
      } catch {
        // Non-fatal: display title remains updated for the UI.
      }
    }
    if (payload.time?.archived !== undefined) session.info.time.archived = payload.time.archived
    session.info.time.updated = now()
    this.emit("session.updated", { sessionID, info: session.info }, session.directory)
    return session.info
  }

  async fork(sessionID: string) {
    const source = this.require(sessionID)
    const result = await this.connection.request("thread/fork", { threadId: source.threadID })
    const thread = result?.thread ?? result
    const session = this.adoptThread(thread, source.directory, `${source.info.title} (fork)`)
    this.emitSessionCreated(session)
    return session.info
  }

  async abort(sessionID: string) {
    const session = this.require(sessionID)
    if (session.activeTurnID) {
      await this.connection.request("turn/interrupt", { threadId: session.threadID, turnId: session.activeTurnID })
    }
    session.activeTurnID = undefined
    this.emit("session.status", { sessionID, status: { type: "idle" } }, session.directory)
    return true
  }

  async prompt(sessionID: string, payload: JsonObject) {
    await this.startTurn(sessionID, payload)
    return this.require(sessionID).messages.at(-1)
  }

  async promptAsync(sessionID: string, payload: JsonObject) {
    await this.startTurn(sessionID, payload)
    return undefined
  }

  async command(sessionID: string, payload: JsonObject) {
    const text = [payload.command, payload.arguments].filter(Boolean).join(" ")
    await this.startTurn(sessionID, { ...payload, parts: [{ type: "text", text }] })
    return this.require(sessionID).messages.at(-1)
  }

  async shell(sessionID: string, payload: JsonObject) {
    const command = payload.command || payload.text || ""
    await this.startTurn(sessionID, {
      ...payload,
      parts: [
        {
          type: "text",
          text: `Run this shell command with redou-codex and report the result:\n\n${command}`,
        },
      ],
    })
    return this.require(sessionID).messages.at(-1)
  }

  async summarize(sessionID: string) {
    await this.startTurn(sessionID, {
      parts: [{ type: "text", text: "Summarize this redou-codex thread so far." }],
    })
    return true
  }

  listPermissions() {
    return [...this.permissions.values()].map((pending) => pending.request)
  }

  async permissionReply(permissionID: string, response: "once" | "always" | "reject") {
    const pending = this.permissions.get(permissionID)
    if (!pending) throw new Error(`REDOU_CODEX_PERMISSION_NOT_FOUND: ${permissionID}`)
    return this.permissionRespond(pending.sessionID, permissionID, response)
  }

  async permissionRespond(sessionID: string, permissionID: string, response: "once" | "always" | "reject") {
    const pending = this.permissions.get(permissionID)
    if (!pending) throw new Error(`REDOU_CODEX_PERMISSION_NOT_FOUND: ${permissionID}`)
    if (pending.sessionID !== sessionID) throw new Error(`REDOU_CODEX_PERMISSION_SESSION_MISMATCH: ${permissionID}`)
    this.permissions.delete(permissionID)
    const decision = response === "reject" ? "decline" : response === "always" ? "acceptForSession" : "accept"
    this.connection.respond(pending.rpcID, { decision })
    this.emit(
      "permission.replied",
      { sessionID, requestID: permissionID, reply: response },
      this.require(sessionID).directory,
    )
    return true
  }

  async deleteMessage(sessionID: string, messageID: string) {
    const session = this.require(sessionID)
    session.messages = session.messages.filter((msg) => msg.info.id !== messageID)
    this.emit("message.removed", { sessionID, messageID }, session.directory)
    return true
  }

  async deletePart(sessionID: string, messageID: string, partID: string) {
    const session = this.require(sessionID)
    const msg = session.messages.find((item) => item.info.id === messageID)
    if (msg) msg.parts = msg.parts.filter((part) => part.id !== partID)
    this.emit("message.part.removed", { sessionID, messageID, partID }, session.directory)
    return true
  }

  async updatePart(sessionID: string, _messageID: string, _partID: string, part: Part) {
    const session = this.require(sessionID)
    this.upsertPart(session, part)
    return part
  }

  private async startTurn(sessionID: string, payload: JsonObject) {
    const session = this.require(sessionID)
    await this.connection.ensureStarted()
    const text = promptText(payload)
    const user = this.createUserMessage(session, text, payload)
    session.messages.push(user)
    this.emit("message.updated", { sessionID, info: user.info }, session.directory)
    for (const part of user.parts) this.emit("message.part.updated", { sessionID, part, time: now() }, session.directory)

    const result = await this.connection.request("turn/start", {
      threadId: session.threadID,
      input: [{ type: "text", text }],
      cwd: session.directory,
      model: process.env.REDOU_CODEX_MODEL,
      modelProvider: process.env.REDOU_CODEX_MODEL_PROVIDER,
      approvalPolicy: process.env.REDOU_CODEX_APPROVAL_POLICY || "unlessTrusted",
      sandbox: process.env.REDOU_CODEX_SANDBOX || "workspaceWrite",
      serviceName: "redou-codex-ui",
    })
    const turn = result?.turn ?? result
    if (turn?.id) session.activeTurnID = turn.id
    this.emit("session.status", { sessionID, status: { type: "busy" } }, session.directory)
    return user
  }

  private handleNotification(msg: JsonObject) {
    const method = msg.method
    const params = msg.params ?? {}
    if (method === "thread/started") {
      const thread = params.thread
      if (thread?.id) {
        const session = this.adoptThread(thread, thread.cwd || process.cwd(), thread.name || thread.preview)
        this.emitSessionCreated(session)
      }
      return
    }
    if (method === "thread/status/changed") {
      const session = this.findByThread(params.threadId)
      if (session) this.emit("session.status", { sessionID: session.sessionID, status: typeof params.status === "string" ? { type: params.status } : params.status }, session.directory)
      return
    }
    if (method === "thread/name/updated") {
      const session = this.findByThread(params.threadId)
      if (session) {
        session.info.title = params.threadName || DEFAULT_TITLE
        session.info.time.updated = now()
        this.emit("session.updated", { sessionID: session.sessionID, info: session.info }, session.directory)
      }
      return
    }
    if (method === "turn/started") {
      const session = this.findByThread(params.threadId)
      if (!session) return
      session.activeTurnID = params.turn?.id
      this.ensureAssistant(session, params.turn?.id)
      this.emit("session.status", { sessionID: session.sessionID, status: { type: "busy" } }, session.directory)
      return
    }
    if (method === "turn/completed") {
      const session = this.findByThread(params.threadId)
      if (!session) return
      const assistant = this.ensureAssistant(session, params.turn?.id)
      assistant.info.time.completed = now()
      assistant.info.finish = params.turn?.status || "completed"
      session.activeTurnID = undefined
      session.activeAssistantMessageID = undefined
      session.info.time.updated = now()
      this.emit("message.updated", { sessionID: session.sessionID, info: assistant.info }, session.directory)
      this.emit("session.updated", { sessionID: session.sessionID, info: session.info }, session.directory)
      this.emit("session.status", { sessionID: session.sessionID, status: { type: "idle" } }, session.directory)
      return
    }
    if (method === "turn/diff/updated") {
      const session = this.findByThread(params.threadId)
      if (!session) return
      session.diff = params.diff || ""
      this.emit("session.diff", { sessionID: session.sessionID, diff: session.diff ? [toSnapshotDiff(session.diff)] : [] }, session.directory)
      return
    }
    if (method === "turn/plan/updated") {
      const session = this.findByTurn(params.turnId)
      if (!session) return
      session.todo = Array.isArray(params.plan)
        ? params.plan.map((item: JsonObject) => ({ title: item.step, status: item.status }))
        : []
      this.emit("message.part.updated", { sessionID: session.sessionID, part: this.planPart(session, params), time: now() }, session.directory)
      return
    }
    if (method === "item/started" || method === "item/completed") {
      const session = this.findByThread(params.threadId)
      if (!session) return
      this.mapItem(session, params.item, method === "item/completed")
      return
    }
    if (method === "item/agentMessage/delta") {
      const session = this.findByThread(params.threadId)
      if (!session) return
      const part = this.partForItem(session, params.itemId, "text")
      part.text = `${part.text ?? ""}${params.delta ?? ""}`
      this.emit("message.part.delta", {
        sessionID: session.sessionID,
        messageID: part.messageID,
        partID: part.id,
        field: "text",
        delta: params.delta ?? "",
      }, session.directory)
      this.emit("message.part.updated", { sessionID: session.sessionID, part, time: now() }, session.directory)
      return
    }
    if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta" || method === "item/plan/delta") {
      const session = this.findByThread(params.threadId)
      if (!session) return
      const part = this.partForItem(session, params.itemId, "reasoning")
      part.text = `${part.text ?? ""}${params.delta ?? ""}`
      this.emit("message.part.delta", {
        sessionID: session.sessionID,
        messageID: part.messageID,
        partID: part.id,
        field: "text",
        delta: params.delta ?? "",
      }, session.directory)
      return
    }
    if (method === "item/commandExecution/outputDelta" || method === "item/fileChange/outputDelta") {
      const session = this.findByThread(params.threadId)
      if (!session) return
      const part = this.partForItem(session, params.itemId, "tool")
      if (!part.state) part.state = this.toolState("running", {}, "")
      part.state.output = `${part.state.output ?? ""}${params.delta ?? ""}`
      this.emit("message.part.updated", { sessionID: session.sessionID, part, time: now() }, session.directory)
      return
    }
    if (method === "item/fileChange/patchUpdated") {
      const session = this.findByThread(params.threadId)
      if (!session) return
      this.mapItem(session, { id: params.itemId, type: "fileChange", changes: params.changes, status: "inProgress" }, false)
      return
    }
    if (method === "serverRequest/resolved") {
      for (const [permissionID, pending] of this.permissions) {
        if (pending.threadID === params.threadId && String(pending.rpcID) === String(params.requestId)) {
          this.permissions.delete(permissionID)
        }
      }
      return
    }
    if (method === "error") {
      const session = this.findByThread(params.threadId) || [...this.sessions.values()].at(-1)
      this.emit("session.error", {
        sessionID: session?.sessionID,
        error: { name: "RedouCodexError", message: params.error?.message || "redou-codex error" },
      }, session?.directory || process.cwd())
    }
  }

  private handleServerRequest(msg: JsonObject) {
    const method = msg.method
    const params = msg.params ?? {}
    if (method.includes("requestApproval")) {
      const session = this.findByThread(params.threadId)
      if (!session) {
        this.connection.respondError(msg.id, -32602, "Unknown redou-codex thread")
        return
      }
      const permissionID = id("per")
      const request = {
        id: permissionID,
        sessionID: session.sessionID,
        permission: `redou-codex.${method}`,
        patterns: [params.command || params.reason || params.itemId || "redou-codex"],
        metadata: {
          redouCodex: true,
          method,
          params,
        },
        always: ["redou-codex"],
        tool: params.itemId
          ? {
              messageID: this.ensureAssistant(session, params.turnId).info.id,
              callID: params.itemId,
            }
          : undefined,
      }
      this.permissions.set(permissionID, {
        permissionID,
        sessionID: session.sessionID,
        threadID: session.threadID,
        rpcID: msg.id,
        method,
        params,
        request,
      })
      this.emit("permission.asked", request, session.directory)
      return
    }

    if (method === "attestation/generate") {
      this.connection.respond(msg.id, { token: "" })
      return
    }

    this.connection.respondError(msg.id, -32601, `Unsupported redou-codex UI request: ${method}`)
  }

  private mapItem(session: BridgeSession, item: JsonObject, completed: boolean) {
    if (!item?.id) return
    const type = item.type || item.kind
    if (type === "agentMessage") {
      const part = this.partForItem(session, item.id, "text")
      part.text = item.text ?? part.text ?? ""
      if (completed) part.time = { ...(part.time ?? { start: now() }), end: now() }
      this.emit("message.part.updated", { sessionID: session.sessionID, part, time: now() }, session.directory)
      return
    }
    if (type === "reasoning" || type === "plan") {
      const part = this.partForItem(session, item.id, "reasoning")
      part.text = item.text || item.summary || item.content || part.text || ""
      if (completed) part.time = { ...(part.time ?? { start: now() }), end: now() }
      this.emit("message.part.updated", { sessionID: session.sessionID, part, time: now() }, session.directory)
      return
    }
    if (type === "commandExecution") {
      const part = this.partForItem(session, item.id, "tool")
      part.tool = "redou-codex.shell"
      part.callID = item.id
      part.state = this.toolState(completed ? terminalToolStatus(item.status) : "running", { command: item.command, cwd: item.cwd }, item.aggregatedOutput ?? "", item)
      this.emit("message.part.updated", { sessionID: session.sessionID, part, time: now() }, session.directory)
      return
    }
    if (type === "fileChange") {
      const part = this.partForItem(session, item.id, "tool")
      part.tool = "redou-codex.file-change"
      part.callID = item.id
      part.state = this.toolState(completed ? terminalToolStatus(item.status) : "running", { changes: item.changes }, fileChangeOutput(item), item)
      session.diff = fileChangeOutput(item) || session.diff
      this.emit("message.part.updated", { sessionID: session.sessionID, part, time: now() }, session.directory)
      return
    }
    if (type === "mcpToolCall" || type === "collabToolCall" || type === "webSearch" || type === "imageView") {
      const part = this.partForItem(session, item.id, "tool")
      part.tool = `redou-codex.${type}`
      part.callID = item.id
      part.state = this.toolState(completed ? terminalToolStatus(item.status) : "running", item, JSON.stringify(item.result ?? item.action ?? {}, null, 2), item)
      this.emit("message.part.updated", { sessionID: session.sessionID, part, time: now() }, session.directory)
      return
    }
    if (type === "userMessage") return

    const part = this.partForItem(session, item.id, "tool")
    part.tool = `redou-codex.${type || "item"}`
    part.callID = item.id
    part.state = this.toolState(completed ? "completed" : "running", item, JSON.stringify(item, null, 2), item)
    this.emit("message.part.updated", { sessionID: session.sessionID, part, time: now() }, session.directory)
  }

  private partForItem(session: BridgeSession, itemID: string, preferred: "text" | "reasoning" | "tool") {
    const existing = session.itemMap.get(itemID)
    if (existing) return existing
    const assistant = this.ensureAssistant(session, session.activeTurnID)
    const part: Part =
      preferred === "tool"
        ? {
            id: id("prt"),
            sessionID: session.sessionID,
            messageID: assistant.info.id,
            type: "tool",
            callID: itemID,
            tool: "redou-codex.item",
            state: this.toolState("running", {}, ""),
            metadata: { redouCodexItemID: itemID },
          }
        : preferred === "reasoning"
          ? {
              id: id("prt"),
              sessionID: session.sessionID,
              messageID: assistant.info.id,
              type: "reasoning",
              text: "",
              metadata: { redouCodexItemID: itemID },
              time: { start: now() },
            }
          : {
              id: id("prt"),
              sessionID: session.sessionID,
              messageID: assistant.info.id,
              type: "text",
              text: "",
              metadata: { redouCodexItemID: itemID },
              time: { start: now() },
            }
    assistant.parts.push(part)
    session.itemMap.set(itemID, part)
    session.redouToMessage.set(itemID, assistant.info.id)
    this.emit("message.part.updated", { sessionID: session.sessionID, part, time: now() }, session.directory)
    return part
  }

  private planPart(session: BridgeSession, params: JsonObject): Part {
    const assistant = this.ensureAssistant(session, params.turnId)
    const itemID = `plan:${params.turnId}`
    const existing = session.itemMap.get(itemID)
    if (existing) return existing
    const part = {
      id: id("prt"),
      sessionID: session.sessionID,
      messageID: assistant.info.id,
      type: "reasoning",
      text: (params.plan ?? []).map((step: JsonObject) => `- [${step.status}] ${step.step}`).join("\n"),
      time: { start: now() },
      metadata: { redouCodexPlan: true, explanation: params.explanation },
    }
    assistant.parts.push(part)
    session.itemMap.set(itemID, part)
    return part
  }

  private toolState(status: string, input: JsonObject, output: string, metadata?: JsonObject) {
    const start = now()
    if (status === "running") return { status: "running", input, title: toolTitle(input, metadata), metadata, time: { start } }
    if (status === "error") return { status: "error", input, error: output || "redou-codex tool failed", metadata, time: { start, end: now() } }
    return { status: "completed", input, output, title: toolTitle(input, metadata), metadata: metadata ?? {}, time: { start, end: now() } }
  }

  private upsertPart(session: BridgeSession, part: Part) {
    const msg = session.messages.find((item) => item.info.id === part.messageID)
    if (!msg) return
    const index = msg.parts.findIndex((item) => item.id === part.id)
    if (index === -1) msg.parts.push(part)
    else msg.parts[index] = part
    this.emit("message.part.updated", { sessionID: session.sessionID, part, time: now() }, session.directory)
  }

  private createUserMessage(session: BridgeSession, text: string, payload: JsonObject): MessageWithParts {
    const messageID = payload.messageID || id("msg")
    const part: Part = {
      id: id("prt"),
      sessionID: session.sessionID,
      messageID,
      type: "text",
      text,
      time: { start: now(), end: now() },
      metadata: { redouCodexInput: true },
    }
    return {
      info: {
        id: messageID,
        sessionID: session.sessionID,
        role: "user",
        time: { created: now() },
        agent: REDOU_CODEX_AGENT,
        model: { providerID: REDOU_CODEX_PROVIDER_ID, modelID: REDOU_CODEX_MODEL_ID },
      },
      parts: [part],
    }
  }

  private ensureAssistant(session: BridgeSession, turnID?: string): MessageWithParts {
    if (session.activeAssistantMessageID) {
      const existing = session.messages.find((msg) => msg.info.id === session.activeAssistantMessageID)
      if (existing) return existing
    }
    const parentID = [...session.messages].reverse().find((msg) => msg.info.role === "user")?.info.id ?? id("msg")
    const messageID = id("msg")
    const assistant: MessageWithParts = {
      info: {
        id: messageID,
        sessionID: session.sessionID,
        role: "assistant",
        time: { created: now() },
        parentID,
        modelID: REDOU_CODEX_MODEL_ID,
        providerID: REDOU_CODEX_PROVIDER_ID,
        mode: "redou-codex",
        agent: REDOU_CODEX_AGENT,
        path: { cwd: session.directory, root: session.directory },
        cost: 0,
        tokens: emptyTokens(),
      },
      parts: [],
    }
    session.activeAssistantMessageID = messageID
    session.activeTurnID = turnID ?? session.activeTurnID
    session.messages.push(assistant)
    this.emit("message.updated", { sessionID: session.sessionID, info: assistant.info }, session.directory)
    return assistant
  }

  private adoptThread(thread: JsonObject, directory: string, title?: string): BridgeSession {
    const threadID = String(thread?.id ?? id("thr"))
    const existingID = this.threadToSession.get(threadID)
    if (existingID) return this.sessions.get(existingID)!
    const created = thread?.createdAt ? Number(thread.createdAt) * 1000 : now()
    const sessionID = id("ses")
    const displayTitle = title || thread?.threadName || thread?.name || thread?.preview || DEFAULT_TITLE
    const info: SessionInfo = {
      id: sessionID,
      slug: slug(displayTitle),
      projectID: REDOU_CODEX_PROJECT_ID,
      directory,
      title: displayTitle,
      agent: REDOU_CODEX_AGENT,
      model: { id: REDOU_CODEX_MODEL_ID, providerID: REDOU_CODEX_PROVIDER_ID },
      version: REDOU_CODEX_VERSION,
      cost: 0,
      tokens: emptyTokens(),
      time: { created, updated: now() },
      permission: [],
    }
    const session: BridgeSession = {
      sessionID,
      threadID,
      directory,
      info,
      messages: [],
      itemMap: new Map(),
      redouToMessage: new Map(),
      diff: "",
      todo: [],
    }
    this.sessions.set(sessionID, session)
    this.threadToSession.set(threadID, sessionID)
    return session
  }

  private async refreshThreads(directory?: string) {
    try {
      const result = await this.connection.request("thread/list", {
        limit: 50,
        cwd: directory,
        archived: false,
        sourceKinds: ["cli", "vscode"],
      })
      const entries = result?.threads ?? result?.items ?? result?.data ?? []
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          const thread = entry.thread ?? entry
          if (thread?.id) this.adoptThread(thread, thread.cwd || directory || process.cwd(), thread.name || thread.preview)
        }
      }
    } catch {
      // Listing is best-effort. A fresh UI can still create the first redou-codex thread.
    }
  }

  private require(sessionID: string) {
    const session = this.sessions.get(sessionID)
    if (!session) throw new Error(`REDOU_CODEX_SESSION_NOT_FOUND: ${sessionID}`)
    return session
  }

  private findByThread(threadID: string | undefined) {
    if (!threadID) return
    const sessionID = this.threadToSession.get(threadID)
    if (!sessionID) return
    return this.sessions.get(sessionID)
  }

  private findByTurn(turnID: string | undefined) {
    if (!turnID) return
    return [...this.sessions.values()].find((session) => session.activeTurnID === turnID)
  }

  private emitSessionCreated(session: BridgeSession) {
    if (this.emittedSessions.has(session.sessionID)) return
    this.emittedSessions.add(session.sessionID)
    this.emit("session.created", { sessionID: session.sessionID, info: session.info }, session.directory)
  }

  private emit(type: string, properties: JsonObject, directory: string) {
    this.emitter.emit("global-event", {
      directory,
      project: REDOU_CODEX_PROJECT_ID,
      payload: {
        id: id("evt"),
        type,
        properties,
      },
    } satisfies RedouEvent)
  }
}

function promptText(payload: JsonObject) {
  const parts = Array.isArray(payload.parts) ? payload.parts : []
  const text = parts
    .map((part: JsonObject) => {
      if (part.type === "text") return part.text || ""
      if (part.type === "file") return `[Attached file: ${part.filename || part.url || "file"}]`
      if (part.type === "agent") return `@${part.name}`
      return typeof part.text === "string" ? part.text : ""
    })
    .filter(Boolean)
    .join("\n")
  return text || payload.text || payload.prompt || payload.command || ""
}

function terminalToolStatus(input: string | undefined) {
  if (input === "failed" || input === "declined") return "error"
  return input === "completed" ? "completed" : "running"
}

function fileChangeOutput(item: JsonObject) {
  if (!Array.isArray(item?.changes)) return item?.diff || ""
  return item.changes
    .map((change: JsonObject) => [change.path, change.kind, change.diff].filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n\n")
}

function toSnapshotDiff(patch: string) {
  const lines = patch.split("\n")
  const additions = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++ ")).length
  const deletions = lines.filter((line) => line.startsWith("-") && !line.startsWith("--- ")).length
  return {
    file: "redou-codex.diff",
    patch,
    additions,
    deletions,
    status: "modified",
  }
}

function toolTitle(input: JsonObject, metadata?: JsonObject) {
  if (input.command) return String(input.command)
  if (metadata?.type) return `redou-codex ${metadata.type}`
  if (input.tool) return String(input.tool)
  return "redou-codex"
}

function redouProviderInfo() {
  return {
    id: REDOU_CODEX_PROVIDER_ID,
    name: "Redou Codex",
    source: "custom",
    env: ["REDOU_CODEX_HOME", "REDOU_CODEX_BIN", "REDOU_CODEX_MODEL", "REDOU_CODEX_BASE_URL"],
    options: {},
    models: {
      [REDOU_CODEX_MODEL_ID]: {
        id: REDOU_CODEX_MODEL_ID,
        providerID: REDOU_CODEX_PROVIDER_ID,
        api: { npm: "redou-codex", name: "redou-codex", url: "local://redou-codex" },
        name: "Redou Codex",
        family: "redou-codex",
        capabilities: {
          temperature: true,
          reasoning: true,
          attachment: true,
          toolcall: true,
          input: { text: true, audio: false, image: true, video: false, pdf: true },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: true,
        },
        cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
        limit: { context: 1_000_000, output: 64_000 },
        status: "active",
        options: {},
        headers: {},
        release_date: "2026-05-28",
      },
    },
  }
}

const singleton = new RedouCodexUIBridge()

export const RedouCodexUI = {
  enabled,
  resolveRuntime,
  runtimeInfo: () => singleton.runtimeInfo(),
  onGlobalEvent: (cb: (event: RedouEvent) => void) => singleton.onGlobalEvent(cb),
  providerList: () => singleton.providerList(),
  configProviders: () => singleton.configProviders(),
  list: (input?: { directory?: string; limit?: number; search?: string }) => singleton.list(input),
  status: () => singleton.status(),
  get: (sessionID: string) => singleton.get(sessionID),
  children: (sessionID: string) => singleton.children(sessionID),
  todo: (sessionID: string) => singleton.todo(sessionID),
  diff: (sessionID: string) => singleton.diff(sessionID),
  messages: (sessionID: string) => singleton.messages(sessionID),
  message: (sessionID: string, messageID: string) => singleton.message(sessionID, messageID),
  create: (payload?: JsonObject, directory?: string) => singleton.create(payload, directory),
  remove: (sessionID: string) => singleton.remove(sessionID),
  update: (sessionID: string, payload: JsonObject) => singleton.update(sessionID, payload),
  fork: (sessionID: string) => singleton.fork(sessionID),
  abort: (sessionID: string) => singleton.abort(sessionID),
  prompt: (sessionID: string, payload: JsonObject) => singleton.prompt(sessionID, payload),
  promptAsync: (sessionID: string, payload: JsonObject) => singleton.promptAsync(sessionID, payload),
  command: (sessionID: string, payload: JsonObject) => singleton.command(sessionID, payload),
  shell: (sessionID: string, payload: JsonObject) => singleton.shell(sessionID, payload),
  summarize: (sessionID: string) => singleton.summarize(sessionID),
  listPermissions: () => singleton.listPermissions(),
  permissionReply: (permissionID: string, response: "once" | "always" | "reject") =>
    singleton.permissionReply(permissionID, response),
  permissionRespond: (sessionID: string, permissionID: string, response: "once" | "always" | "reject") =>
    singleton.permissionRespond(sessionID, permissionID, response),
  deleteMessage: (sessionID: string, messageID: string) => singleton.deleteMessage(sessionID, messageID),
  deletePart: (sessionID: string, messageID: string, partID: string) => singleton.deletePart(sessionID, messageID, partID),
  updatePart: (sessionID: string, messageID: string, partID: string, part: Part) =>
    singleton.updatePart(sessionID, messageID, partID, part),
}
