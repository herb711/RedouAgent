#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"

const root = path.resolve(import.meta.dirname, "../../..")
const checks = []
function ok(name, pass, detail = "") {
  checks.push({ name, pass, detail })
  if (!pass) process.exitCode = 1
}
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8")
}
function exists(rel) {
  return fs.existsSync(path.join(root, rel))
}

const provider = read("packages/opencode/src/provider/provider.ts")
const llm = read("packages/opencode/src/session/llm.ts")
const runtime = read("packages/opencode/src/session/llm/redou-codex-runtime.ts")
const redouProvider = read("packages/opencode/src/provider/redou-codex.ts")

ok("no root adapter bin", !exists("bin") && !exists("redou-opencode-adapter") && !exists("runtimes"))
ok("bundled runtime is under packages/opencode", exists("packages/opencode/runtimes/redou-codex/codex-cli/bin/redou-codex.js"))
ok("redou provider file exists", redouProvider.includes("RedouCodexProvider") && redouProvider.includes('ProviderID.make("redou-codex")'))
ok("provider catalog is extended", provider.includes("database[RedouCodexProvider.info.id] = toPublicInfo(RedouCodexProvider.info)"))
ok("provider custom loader autoloads redou", provider.includes('"redou-codex": Effect.fnUntraced') && provider.includes("autoload: true"))
ok("default model prefers redou", provider.includes("const redouCodex = s.providers[RedouCodexProvider.info.id]"))
ok("LLM stream branches to redou before AI SDK getLanguage", llm.indexOf("RedouCodexRuntime.isRedouCodexModel") > -1 && llm.indexOf("RedouCodexRuntime.isRedouCodexModel") < llm.indexOf("provider.getLanguage"))
ok("runtime resolves only configured or bundled paths", runtime.includes("configuredRoot ? [configuredRoot] : bundledRuntimeCandidates()"))
ok("runtime has no PATH codex fallback", !/spawn\(["'`]codex["'`]/.test(runtime) && !/which\(["'`]codex["'`]/.test(runtime) && !runtime.includes("npx codex") && !runtime.includes("bunx codex"))
ok("official env is stripped", ["OPENAI_", "ANTHROPIC_", "CODEX_", "OPENCODE_"].every((k) => runtime.includes(k)))
ok("redou env is injected", ["REDOU_CODEX_BASE_URL", "REDOU_CODEX_API_KEY", "REDOU_CODEX_MODEL", "REDOU_CODEX_RUNTIME_ROOT"].every((k) => runtime.includes(k)))
ok("exec json mode is used", runtime.includes('"exec", "--json"') && runtime.includes('"--skip-git-repo-check"'))
ok("provider-executed tool mirroring exists", runtime.includes("providerExecuted: true") && runtime.includes("ToolResultValue.make"))
for (const kind of ["command_execution", "file_change", "mcp_tool_call", "collab_tool_call", "web_search", "todo_list", "error"]) {
  ok(`maps redou item ${kind}`, runtime.includes(`case "${kind}"`))
}
ok("redou runtime tests exist", exists("packages/opencode/test/redou-codex-runtime.test.ts"))
ok("node wrapper syntax checkable", exists("packages/opencode/runtimes/redou-codex/codex-cli/bin/redou-codex.js"))

const hash = crypto.createHash("sha256").update(runtime).digest("hex")
const result = { pass: checks.every((c) => c.pass), checks, runtimeSha256: hash }
console.log(JSON.stringify(result, null, 2))
process.exit(result.pass ? 0 : 1)
