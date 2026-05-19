// Local-service facade boundary:
// - index.cjs owns local service wiring, dependency injection, public API routing, and compatibility glue.
// - Database schema and persistence details live under db/ and db/repositories/.
// - Process spawning, run tracking, and process termination live in processes/processManager.cjs.
// - Schedule CRUD, polling, and trigger orchestration live in scheduler/schedulerService.cjs.
// - Task context assembly, context policy, compression hooks, and attachment formatting live in context/contextBuilder.cjs.
// - Status/session/usage/analysis read models live in analytics/analyticsService.cjs.
// - Settings, theme/language, and dashboard config routing live in settings/settingsService.cjs.
// - User input attachment file operations live in artifacts/artifactService.cjs.
// - UI log reads and task JSONL journals live in logs/logService.cjs.
// - Plugin hub/runtime actions live in plugins/pluginService.cjs; skills and task skill packaging live in skills/skillService.cjs.
// - Local event publishing and lifecycle init/dispose/health behavior live in eventBus.cjs and lifecycle.cjs.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createLocalDb } = require("./db/index.cjs");
const { createEventBus } = require("./eventBus.cjs");
const { LifecycleService } = require("./lifecycle.cjs");
const { AnalyticsService } = require("./analytics/analyticsService.cjs");
const { ContextBuilder } = require("./context/contextBuilder.cjs");
const { ProcessManager } = require("./processes/processManager.cjs");
const { SchedulerService } = require("./scheduler/schedulerService.cjs");
const { SettingsService } = require("./settings/settingsService.cjs");
const { ArtifactService } = require("./artifacts/artifactService.cjs");
const { LogService } = require("./logs/logService.cjs");
const { PluginService } = require("./plugins/pluginService.cjs");
const { SkillService } = require("./skills/skillService.cjs");

const GLOBAL_USER_FILE = "USER.md";
const GLOBAL_RULES_FILE = "GLOBAL_RULES.md";
const PROJECT_RULES_FILE = "PROJECT_RULES.md";
const TASK_RULES_FILE = "TASK_RULES.md";
const TASK_CONTEXT_FILE = "TASK_CONTEXT.md";
const TASK_STATE_FILE = "TASK_STATE.json";
const TASK_EVENTS_FILE = "events.jsonl";
const TASK_MESSAGES_FILE = "messages.jsonl";
const TASK_UPLOADS_DIR = "uploads";
const REDOU_CONTEXT_DIR = ".redou";
const REDOU_TASKS_DIR = "tasks";
const REDOU_SKILLS_DIR = "skills";
const REDOU_ANALYSIS_DIR = "analysis";
const RECENT_MESSAGE_LIMIT = 20;
const RECENT_MESSAGE_CONTENT_LIMIT = 4000;
const DEFAULT_MODEL_CONTEXT_TOKENS = 128000;
const COMPACT_FORCE_RATIO = 0.85;
const COMPACT_EMERGENCY_RATIO = 0.95;
const RECENT_TURN_DIGEST_LIMIT = 6;
const RECENT_TURN_DIGEST_MAX_CHARS = 6000;
const RECENT_CONVERSATION_MAX_CHARS = 24000;
const CONTEXT_RULE_MAX_CHARS = 280;
const VALID_MESSAGE_ROLES = new Set(["user", "assistant", "system", "tool", "event"]);
const PROFILE_RUNTIME_CONFIG_KEYS = ["model", "providers", "custom_providers", "model_aliases", "agent"];
const DELIVERY_MODES = new Set(["new_turn", "queue", "guide", "interrupt_replace"]);
const RUN_MODES = new Set(["execute", "plan"]);
const USER_INPUT_STATUSES = new Set(["pending", "consumed", "completed", "cancelled"]);
const ANALYSIS_RESULTS_FILE = "model-benchmarks.json";
const ANALYSIS_DEFAULT_MAX_ITERATIONS = 1000;
const ANALYSIS_DOCKER_WORKSPACE = "/workspace";
const ANALYSIS_WORKSPACE_PROJECT_ID = "model-benchmarks";
const ANALYSIS_WORKSPACE_PROJECT_NAME = "Model Benchmarks";
const ANALYSIS_WORKSPACE_TASK_KIND = "analysis_benchmark";
const ANALYSIS_ABILITY_KEYS = [
  "environmentConstraints",
  "projectDelivery",
  "debugRepair",
  "frameworkExtension",
  "parsingEdgeCases",
  "verificationIteration",
  "researchProduct",
  "documentationReproducibility",
];
const ANALYSIS_TASKS = [
  {
    id: "task1",
    file: "task1.md",
    title: "Docker environment lab",
    capability: "environment",
  },
  {
    id: "task2",
    file: "task2.md",
    title: "Small project build",
    capability: "implementation",
  },
  {
    id: "task3",
    file: "task3.md",
    title: "Debug and repair loop",
    capability: "debugging",
  },
  {
    id: "task4",
    file: "task4.md",
    title: "Research and product plan",
    capability: "research",
  },
  {
    id: "task5",
    file: "task5.md",
    title: "Peewee ORM industrial bug fixing",
    capability: "debugging",
  },
  {
    id: "task6",
    file: "task6.md",
    title: "Bottle plugin extension",
    capability: "framework",
  },
  {
    id: "task7",
    file: "task7.md",
    title: "Markdown parser implementation",
    capability: "parsing",
  },
  {
    id: "task8",
    file: "task8.md",
    title: "Click CLI framework bug fixing",
    capability: "debugging",
  },
  {
    id: "task9",
    file: "task9.md",
    title: "Jinja2 custom extension development",
    capability: "framework",
  },
];

function isoNow() {
  return new Date().toISOString();
}

function nowSeconds() {
  return Date.now() / 1000;
}

function safeSegment(value, fallback) {
  const clean = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 96)
    .toLowerCase();
  return clean || fallback;
}

function compact(value, max = 300) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

function compactMultiline(value, max = 4000) {
  const text = String(value || "").replace(/\r\n/g, "\n");
  return text.length > max ? `${text.slice(0, max).trimEnd()}\n[truncated]` : text;
}

function markdownListText(value, max = 1200) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, max)
    .trim();
}

function stripImmediateRequestTail(value) {
  let text = String(value || "").trim();
  const sentenceTail = /[。！？.!?]\s*(?=(现在|接下来|顺便|然后|另外|同时|此外|马上|今天|now|next|also|then|please|can you|could you))/i;
  const sentenceMatch = text.match(sentenceTail);
  if (sentenceMatch?.index != null && sentenceMatch.index > 0) {
    text = text.slice(0, sentenceMatch.index + 1).trim();
  }
  const clauseTail =
    /([，,；;]\s*)(现在|接下来|顺便|然后|另外|同时|此外|马上|今天|now|next|also|then)\s*(请|帮我|给我|回答|回复|告诉我|解释|写|生成|处理|做|看|检查|测试|执行|运行|实现|修复|创建|总结|please|can you|could you|answer|reply|tell|explain|write|generate|handle|check|test|run|implement|fix|create|summarize).*$/i;
  text = text.replace(clauseTail, "").trim();
  return text;
}

function extractContextRuleContent(raw) {
  const stripped = stripContextDirectiveLead(raw);
  const concise = stripImmediateRequestTail(stripped);
  return markdownListText(concise || stripped, CONTEXT_RULE_MAX_CHARS);
}

function stripContextDirectiveLead(value) {
  return String(value || "")
    .trim()
    .replace(
      /^(please\s+)?(remember|note|save|record|use this as|add this to|add to|keep in mind|以后|下次|记住|记忆|记录|保存|请记住|帮我记住)[\s:：,，-]*/i,
      "",
    )
    .replace(
      /^(this\s+)?(project|task)\s+(rule|memory|mem|instruction|preference)[\s:：,，-]*/i,
      "",
    )
    .replace(/^(项目|任务|本项目|本任务|当前项目|当前任务)(规则|记忆|偏好|要求)?[\s:：,，-]*/i, "")
    .replace(/^(规则|偏好|要求)[\s:：,，-]*/i, "")
    .trim();
}

function classifyContextDirective(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const hasRememberSignal =
    /(remember|note this|save this|record this|keep in mind|always|never|from now on|以后|下次|以后都|总是|永远|记住|记忆|记录|保存)/i.test(raw);
  const hasExplicitDirective =
    /^(this\s+)?(project|task)\s+(rules?|memory|mem|instruction|preference)[\s:：,，-]/i.test(raw) ||
    /^(项目|任务|本项目|本任务|当前项目|当前任务)(规则|记忆|偏好|要求)?[\s:：,，-]/i.test(raw) ||
    /^(规则|偏好|要求)[\s:：,，-]/i.test(raw) ||
    /(项目|任务).{0,16}(规则|记忆|偏好|要求)[\s:：,，-]/i.test(raw);
  if (!hasRememberSignal && !hasExplicitDirective) return null;

  const taskScoped = /(task\s+(rules?|instruction|preference)|this task|current task|任务|本任务|当前任务)/i.test(raw);
  const projectScoped = /(project\s+(rules?|memory|mem|instruction|preference)|this project|current project|项目|本项目|当前项目)/i.test(raw);
  const explicitProjectRules = /(project\s+(rules?|instruction|preference)|项目.*(规则|偏好|要求)|本项目|当前项目)/i.test(raw);

  const scope = projectScoped && !taskScoped ? "project" : "task";
  const content = extractContextRuleContent(raw);
  if (!content || content.length < 2) return null;
  return { scope, content };
}

function normalizeDeliveryMode(value, fallback = "queue") {
  const mode = String(value || "").trim().toLowerCase();
  return DELIVERY_MODES.has(mode) ? mode : fallback;
}

function normalizeRunMode(value, fallback = "execute") {
  const mode = String(value || "").trim().toLowerCase();
  return RUN_MODES.has(mode) ? mode : fallback;
}

class SecretRedactor {
  static replacement = "[REDACTED_SECRET]";

  static redactText(value) {
    let count = 0;
    let text = String(value || "");
    const replace = (pattern, replacer) => {
      text = text.replace(pattern, (...args) => {
        count += 1;
        return typeof replacer === "function" ? replacer(...args) : replacer;
      });
    };

    replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, `[private key ${SecretRedactor.replacement}]`);
    replace(/\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Authorization: Bearer ${SecretRedactor.replacement}`);
    replace(/\b(sk|pk)-[A-Za-z0-9_-]{12,}\b/g, (match, prefix) => `${prefix}-${SecretRedactor.replacement}`);
    replace(
      /\b((?:api[_-]?key|access[_-]?key|secret[_-]?key|secret[_-]?access[_-]?key|token|auth[_-]?token|password|passwd|pwd|root[_-]?password|admin[_-]?password|ssh[_-]?password|server[_-]?password|cloud[_-]?password))[ \t]*[:=][ \t]*(['"])(?:(?!\2).){1,4096}\2/gi,
      (_match, key, quote) => `${key}=${quote}${SecretRedactor.replacement}${quote}`,
    );
    replace(
      /\b((?:api[_-]?key|access[_-]?key|secret[_-]?key|secret[_-]?access[_-]?key|token|auth[_-]?token|password|passwd|pwd|root[_-]?password|admin[_-]?password|ssh[_-]?password|server[_-]?password|cloud[_-]?password))[ \t]*[:=][ \t]*([^\s,;]+)/gi,
      (_match, key) => `${key}=${SecretRedactor.replacement}`,
    );
    replace(
      /\b(AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|AZURE_CLIENT_SECRET|GOOGLE_APPLICATION_CREDENTIALS|OPENAI_API_KEY|ANTHROPIC_API_KEY|MINIMAX_API_KEY)[ \t]*[:=][ \t]*([^\s,;]+)/g,
      (_match, key) => `${key}=${SecretRedactor.replacement}`,
    );
    replace(
      /((?:密码|口令|密钥|令牌|凭证|访问令牌|访问密钥|私钥)[ \t]*(?:[:：=]|是|为)[ \t]*)([`'"])(?:(?!\2).){1,4096}\2/g,
      (_match, key, quote) => `${key}${quote}${SecretRedactor.replacement}${quote}`,
    );
    replace(
      /((?:密码|口令|密钥|令牌|凭证|访问令牌|访问密钥|私钥)[ \t]*(?:[:：=]|是|为)[ \t]*)(?!\[REDACTED_SECRET\])([^\s,;，。；、|]+)/g,
      (_match, key) => `${key}${SecretRedactor.replacement}`,
    );
    replace(
      /\b(Password bytes[ \t]*:[ \t]*b)([`'"])(?:(?!\2).){1,4096}\2/gi,
      (_match, key, quote) => `${key}${quote}${SecretRedactor.replacement}${quote}`,
    );
    replace(
      /(`ssh\b[^`\r\n]*`[ \t]+)(?!\[REDACTED_SECRET\])(?=[^\s`]*[A-Za-z])(?=[^\s`]*\d)(?=[^\s`]*[^A-Za-z0-9\s`])([^\s`]{8,})/gi,
      (_match, prefix) => `${prefix}${SecretRedactor.replacement}`,
    );
    replace(
      /(\bssh\b(?![^\r\n]*\bpassword[ \t]*[:=])[^\r\n]*?\b[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+[^\r\n]*?[ \t]+)(?!\[REDACTED_SECRET\])(?=[^\s`]*[A-Za-z])(?=[^\s`]*\d)(?=[^\s`]*[^A-Za-z0-9\s`])([^\s`]{8,})/gi,
      (_match, prefix) => `${prefix}${SecretRedactor.replacement}`,
    );

    return { text, count };
  }

  static containsUnredactedSecret(value) {
    const text = String(value || "");
    return [
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
      /\bAuthorization\s*:\s*Bearer\s+(?!\[REDACTED_SECRET\])[A-Za-z0-9._~+/=-]{8,}/i,
      /\b(sk|pk)-(?!(?:\[REDACTED_SECRET\]))[A-Za-z0-9_-]{12,}\b/i,
      /\b(?:api[_-]?key|access[_-]?key|secret[_-]?key|secret[_-]?access[_-]?key|token|auth[_-]?token|password|passwd|pwd|root[_-]?password|admin[_-]?password|ssh[_-]?password|server[_-]?password|cloud[_-]?password)[ \t]*[:=][ \t]*(?!\[REDACTED_SECRET\])['"]?[^'"\s,;]{4,}/i,
      /(?:密码|口令|密钥|令牌|凭证|访问令牌|访问密钥|私钥)[ \t]*(?:[:：=]|是|为)[ \t]*(?![`'"]?\[REDACTED_SECRET\])[`'"]?[^\s,;，。；、|]{4,}/i,
      /\bPassword bytes[ \t]*:[ \t]*b(?![`'"]?\[REDACTED_SECRET\])[`'"][^`'"]{4,}[`'"]/i,
      /`ssh\b[^`\r\n]*`[ \t]+(?!\[REDACTED_SECRET\])(?=[^\s`]*[A-Za-z])(?=[^\s`]*\d)(?=[^\s`]*[^A-Za-z0-9\s`])[^\s`]{8,}/i,
      /\bssh\b(?![^\r\n]*\bpassword[ \t]*[:=])[^\r\n]*?\b[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+[^\r\n]*?[ \t]+(?!\[REDACTED_SECRET\])(?=[^\s`]*[A-Za-z])(?=[^\s`]*\d)(?=[^\s`]*[^A-Za-z0-9\s`])[^\s`]{8,}/i,
    ].some((pattern) => pattern.test(text));
  }
}

function redact(value) {
  return SecretRedactor.redactText(value).text;
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureTextFile(file, initialText) {
  mkdirp(path.dirname(file));
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, initialText, "utf8");
  }
}

function ensureEmptyFile(file) {
  mkdirp(path.dirname(file));
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, "", "utf8");
  }
}

function cjkCharCount(text) {
  const matches = String(text || "").match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g);
  return matches ? matches.length : 0;
}

function estimateContextTokens(text) {
  const value = String(text || "");
  if (!value) return 0;
  const cjk = cjkCharCount(value);
  const nonCjk = Math.max(0, value.length - cjk);
  return Math.max(1, cjk + Math.ceil(nonCjk / 4));
}

function contextPercent(tokens, maxTokens = DEFAULT_MODEL_CONTEXT_TOKENS) {
  if (!maxTokens || maxTokens <= 0) return 0;
  return Math.round((Math.max(0, tokens) / maxTokens) * 1000) / 10;
}

function getContextBudget(modelContextTokens) {
  const parsed = Number(modelContextTokens);
  const safeModelContextTokens = Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_MODEL_CONTEXT_TOKENS;
  const reservedOutput = Math.min(8192, Math.floor(safeModelContextTokens * 0.15));
  const safetyMargin = Math.floor(safeModelContextTokens * 0.05);
  const inputBudget = Math.max(1, safeModelContextTokens - reservedOutput - safetyMargin);
  return {
    modelContextTokens: safeModelContextTokens,
    inputBudget,
    reservedOutput,
    safetyMargin,
  };
}

function shouldCompactContext(contextUsage, budget) {
  const inputBudget = Math.max(1, Number(budget?.inputBudget || DEFAULT_MODEL_CONTEXT_TOKENS));
  const ratio = Math.max(0, Number(contextUsage || 0)) / inputBudget;
  return {
    shouldCompact: ratio >= COMPACT_FORCE_RATIO,
    emergency: ratio >= COMPACT_EMERGENCY_RATIO,
    ratio,
  };
}

function defaultTaskContextText() {
  return renderTaskContextMarkdown(defaultTaskState());
}

function defaultTaskState() {
  return {
    task_goal: "",
    current_phase: "not_started",
    constraints: [],
    decisions: [],
    completed: [],
    open_issues: [],
    files_changed: [],
    commands_run: [],
    current_focus: "",
    next_steps: [],
  };
}

const TASK_STATE_FIELDS = Object.keys(defaultTaskState());

function normalizeTaskState(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalized = defaultTaskState();
  for (const field of TASK_STATE_FIELDS) {
    const current = source[field];
    if (Array.isArray(normalized[field])) {
      normalized[field] = uniqueList(
        (Array.isArray(current) ? current : current ? [current] : [])
          .map((item) => markdownListText(item, 700))
          .filter(Boolean),
        80,
      );
    } else {
      normalized[field] = markdownListText(current, 900);
    }
  }
  return normalized;
}

function renderTaskStateStructuredMarkdown(state) {
  const safe = normalizeTaskState(state);
  return [
    "# Task Context",
    "",
    "## A. Structured State",
    "",
    "### Current Goal",
    "",
    safe.task_goal || "(empty)",
    "",
    "### Current Phase",
    "",
    safe.current_phase || "(empty)",
    "",
    "### Constraints",
    "",
    renderMarkdownList(safe.constraints),
    "",
    "### Decisions",
    "",
    renderMarkdownList(safe.decisions),
    "",
    "### Completed",
    "",
    renderMarkdownList(safe.completed),
    "",
    "### Open Issues",
    "",
    renderMarkdownList(safe.open_issues),
    "",
    "### Files Changed",
    "",
    renderMarkdownList(safe.files_changed),
    "",
    "### Commands Run",
    "",
    renderMarkdownList(safe.commands_run),
    "",
    "### Current Focus",
    "",
    safe.current_focus || "(empty)",
    "",
    "### Next Action",
    "",
    renderMarkdownList(safe.next_steps),
    "",
    "---",
  ].join("\n");
}

function renderRecentTurnDigest(state) {
  const safe = normalizeTaskState(state);
  const digest = [
    ...safe.open_issues.slice(-3).map((item) => `issue: ${compact(item, 220)}`),
    ...safe.commands_run.slice(-4).map((item) => `command: ${compact(item, 220)}`),
    ...safe.files_changed.slice(-6).map((item) => `file: ${compact(item, 180)}`),
    ...safe.completed.slice(-3).map((item) => `done: ${compact(item, 220)}`),
  ];
  return renderMarkdownList(digest, "(empty)");
}

function renderTaskContextMarkdown(state) {
  return [
    renderTaskStateStructuredMarkdown(state).trimEnd(),
    "",
    "## B. Recent Turn Digest",
    "",
    renderRecentTurnDigest(state),
    "",
  ].join("\n");
}

function parseTaskStateFromStructuredText(text) {
  const value = String(text || "");
  return normalizeTaskState({
    task_goal: markdownSectionsByTitle(value, ["Current Goal", "Current Brief"])[0] || "",
    current_phase: markdownSectionsByTitle(value, ["Current Phase"])[0] || "",
    constraints: parseMarkdownListSection(value, "Constraints").concat(parseMarkdownListSection(value, "Active Constraints")),
    decisions: parseMarkdownListSection(value, "Decisions"),
    completed: parseMarkdownListSection(value, "Completed").concat(parseMarkdownListSection(value, "Progress Summary")),
    open_issues: parseMarkdownListSection(value, "Open Issues"),
    files_changed: parseMarkdownListSection(value, "Files Changed").concat(parseMarkdownListSection(value, "Relevant Files")),
    commands_run: parseMarkdownListSection(value, "Commands Run"),
    current_focus: markdownSectionsByTitle(value, ["Current Focus"])[0] || "",
    next_steps: parseMarkdownListSection(value, "Next Action").concat(parseMarkdownListSection(value, "Todo List")),
  });
}

function taskStatePathFromContextPath(taskContextPath) {
  return path.join(path.dirname(String(taskContextPath || "")), TASK_STATE_FILE);
}

function taskEventsPathFromContextPath(taskContextPath) {
  return path.join(path.dirname(String(taskContextPath || "")), TASK_EVENTS_FILE);
}

function readTaskStateFile(taskStatePath) {
  const parsed = readJson(taskStatePath, null);
  return normalizeTaskState(parsed);
}

function writeTaskStateFiles(task, state) {
  const safe = normalizeTaskState(state);
  const statePath = task.statePath || taskStatePathFromContextPath(task.contextPath);
  const contextPath = task.contextPath;
  mkdirp(path.dirname(statePath));
  fs.writeFileSync(statePath, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
  fs.writeFileSync(contextPath, renderTaskContextMarkdown(safe), "utf8");
  return safe;
}

function hasTaskContextShape(text) {
  const value = String(text || "");
  return (
    /^# Task Context\s*$/m.test(value) &&
    /^## A\. Structured State\s*$/m.test(value) &&
    (/^## B\. Recent Turn Digest\s*$/m.test(value) || /^## B\. Raw Turn Log\s*$/m.test(value))
  );
}

function stripTaskContextHeading(text) {
  return String(text || "")
    .replace(/^\s*#\s*Task Context\s*/i, "")
    .trim();
}

function normalizeTaskContextText(text) {
  const value = String(text || "").replace(/\r\n/g, "\n").trimEnd();
  if (!value.trim()) return defaultTaskContextText();
  if (hasTaskContextShape(value)) {
    return value
      .replace(/^## B\. Raw Turn Log\s*$/m, "## B. Recent Turn Digest")
      .replace(/\n*$/, "\n");
  }
  const legacy = stripTaskContextHeading(value);
  const state = normalizeTaskState({
    completed: legacy ? [compactMultiline(legacy, 1200)] : [],
  });
  return renderTaskContextMarkdown(state);
}

function splitTaskContext(text) {
  const normalized = normalizeTaskContextText(text);
  const digestMarker = normalized.search(/^## B\. Recent Turn Digest\s*$/m);
  const rawMarker = normalized.search(/^## B\. Raw Turn Log\s*$/m);
  const marker = digestMarker >= 0 ? digestMarker : rawMarker;
  if (marker < 0) {
    const empty = normalizeTaskContextText("");
    return { structuredState: empty, recentTurnDigest: "", rawTurnLog: "" };
  }
  const structuredState = normalized.slice(0, marker).trimEnd();
  const recentTurnDigest = normalized
    .slice(marker)
    .replace(/^## B\. (?:Recent Turn Digest|Raw Turn Log)\s*$/m, "")
    .trim();
  return { structuredState, recentTurnDigest, rawTurnLog: recentTurnDigest };
}

function recentTurnDigest(taskContext, maxEntries = RECENT_TURN_DIGEST_LIMIT, maxChars = RECENT_TURN_DIGEST_MAX_CHARS) {
  if (maxEntries <= 0 || maxChars <= 0) return "";
  const { recentTurnDigest: digest } = splitTaskContext(taskContext);
  if (!digest) return "";
  const entries = digest
    .split(/\n(?=-\s+)/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  let text = entries.slice(-Math.max(0, maxEntries)).join("\n").trim();
  if (text.length > maxChars) {
    text = `[older digest omitted]\n${text.slice(text.length - maxChars).replace(/^\s+/, "")}`;
  }
  return text;
}

function trimTaskContextRawLog(taskContext, maxEntries = 2) {
  const normalized = normalizeTaskContextText(taskContext);
  const state = parseTaskStateFromStructuredText(splitTaskContext(normalized).structuredState);
  const digest = recentTurnDigest(normalized, maxEntries);
  return [
    renderTaskStateStructuredMarkdown(state).trimEnd(),
    "",
    "## B. Recent Turn Digest",
    "",
    digest || "(empty)",
    "",
  ].join("\n");
}

function uniqueList(values, maxItems = 12) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const text = String(value || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function markdownBulletBlock(values) {
  const items = uniqueList(values);
  if (!items.length) return "  []";
  return items.map((item) => `  - ${item}`).join("\n");
}

function normalizeRuleKey(value) {
  return String(value || "")
    .trim()
    .replace(/^[-*]\s+/, "")
    .replace(/[.!?。！？,，;；:：]+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function appendDedupeRules(file, rules) {
  const cleanRules = uniqueList(rules, 50).filter(Boolean);
  if (!cleanRules.length) return [];
  const current = readText(file);
  const existing = new Set(
    current
      .split(/\r?\n/)
      .map(normalizeRuleKey)
      .filter(Boolean),
  );
  const added = [];
  for (const rule of cleanRules) {
    const key = normalizeRuleKey(rule);
    if (!key || existing.has(key)) continue;
    existing.add(key);
    added.push(rule);
  }
  if (!added.length) return [];
  const entry = added.map((rule) => `- ${rule}`).join("\n");
  fs.writeFileSync(file, `${current.trimEnd()}\n\n${entry}\n`, "utf8");
  return added;
}

function projectWorkspaceOutputRule(workspacePath) {
  const cleanPath = String(workspacePath || "").trim();
  if (!cleanPath) return "";
  const displayPath = path.resolve(cleanPath).replace(/`/g, "'");
  return `Keep all task outputs for this project under the configured project workspace path: ${displayPath}. This includes generated files, reports, logs, and other artifacts, unless the user explicitly requests otherwise.`;
}

function markdownHeading(line) {
  const match = String(line || "").match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
  if (!match) return null;
  return {
    depth: match[1].length,
    title: match[2].trim().toLowerCase(),
  };
}

function markdownSectionsByTitle(markdown, titles) {
  const wanted = new Set(titles.map((title) => String(title || "").trim().toLowerCase()).filter(Boolean));
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const sections = [];
  let current = null;
  for (const line of lines) {
    const heading = markdownHeading(line);
    if (heading) {
      if (current && heading.depth <= current.depth) {
        sections.push(current.lines.join("\n"));
        current = null;
      }
      if (wanted.has(heading.title)) {
        current = { depth: heading.depth, lines: [] };
      }
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push(current.lines.join("\n"));
  return sections;
}

function normalizeExtractedRule(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^\[[ xX]\]\s+/, "")
    .replace(/^(rules?|constraints?|requirements?|preferences?|规则|约束|要求|偏好)\s*[:：]\s*/i, "")
    .trim();
}

function isUsefulExtractedRule(value) {
  const text = normalizeExtractedRule(value);
  if (!text) return false;
  if (/^(?:\[\]|\(empty\)|empty|none|null|n\/a|\[truncated\])$/i.test(text)) return false;
  if (/^(?:files?|commands?|errors?|attachments?|constraints?|todos?|evidence|open_issues)\s*[:：]$/i.test(text)) return false;
  if (/^(?:文件|命令|错误|附件|约束|待办|证据|开放问题)\s*[:：]$/.test(text)) return false;
  if (text.endsWith(":") || text.endsWith("：")) return false;
  if (!/[\p{L}\p{N}]/u.test(text)) return false;
  if (Array.from(text).length < 6) return false;
  return true;
}

function extractedRulesFromMarkdownBlock(block) {
  const rules = [];
  let paragraph = [];
  const flushParagraph = () => {
    const text = normalizeExtractedRule(paragraph.join(" "));
    paragraph = [];
    if (isUsefulExtractedRule(text)) rules.push(text);
  };

  for (const rawLine of String(block || "").replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    if (markdownHeading(line) || /^-{3,}$/.test(line)) {
      flushParagraph();
      continue;
    }

    const bullet = line.match(/^[-*+]\s+(.+)$/) || line.match(/^\d+[.)]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      const text = normalizeExtractedRule(bullet[1]);
      if (isUsefulExtractedRule(text)) rules.push(text);
      continue;
    }

    if (/^(?:user request|assistant summary|observed artifacts|light tags)\s*[:：]$/i.test(line)) {
      flushParagraph();
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return uniqueList(rules, 50);
}

function fallbackRulesFromNamedSections(markdown, titles) {
  const wanted = new Set(titles.map((title) => String(title || "").trim().toLowerCase()).filter(Boolean));
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const rules = [];
  let activeDepth = 0;
  let activeLines = [];
  const flush = () => {
    if (activeLines.length) rules.push(...extractedRulesFromMarkdownBlock(activeLines.join("\n")));
    activeLines = [];
  };
  for (const line of lines) {
    const heading = markdownHeading(line);
    if (heading) {
      if (activeDepth && heading.depth <= activeDepth) {
        flush();
        activeDepth = 0;
      }
      if (wanted.has(heading.title)) {
        activeDepth = heading.depth;
        activeLines = [];
      }
      continue;
    }
    if (activeDepth && /^-{3,}\s*$/.test(line)) {
      flush();
      activeDepth = 0;
      continue;
    }
    if (activeDepth) activeLines.push(line);
  }
  flush();
  return uniqueList(rules, 50);
}

function labeledMarkdownBlock(text, label, stopLabels) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const labelPattern = new RegExp(`^${label}\\s*[:：]\\s*$`, "i");
  const stopPatterns = stopLabels.map((item) => new RegExp(`^${item}\\s*[:：]\\s*$`, "i"));
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (labelPattern.test(trimmed)) {
      if (current) blocks.push(current.join("\n"));
      current = [];
      continue;
    }
    if (current && stopPatterns.some((pattern) => pattern.test(trimmed))) {
      blocks.push(current.join("\n"));
      current = null;
      continue;
    }
    if (current) current.push(line);
  }
  if (current) blocks.push(current.join("\n"));
  return blocks;
}

function explicitRulesFromRawTurnLog(rawTurnLog, targetScope) {
  const rules = [];
  for (const userRequest of labeledMarkdownBlock(rawTurnLog, "User Request", [
    "Assistant Summary",
    "Observed Artifacts",
    "Light Tags",
  ])) {
    const directive = classifyContextDirective(userRequest);
    if (directive?.scope === targetScope && directive.content) {
      rules.push(directive.content);
    }
  }
  return uniqueList(rules, 50);
}

function extractRulesFromTaskContextText(taskContext, targetScope) {
  const normalized = normalizeTaskContextText(taskContext);
  const { structuredState, rawTurnLog } = splitTaskContext(normalized);
  const sectionTitles = targetScope === "project"
    ? [
        "Project Rules",
        "Project Rule",
        "Project Constraints",
        "Project-wide Rules",
        "Project-wide Constraints",
        "Active Constraints",
      ]
    : [
        "Task Rules",
        "Task Rule",
        "Task Constraints",
        "Active Constraints",
        "Validation Criteria",
        "Output Requirements",
        "Requirements",
        "Constraints",
      ];
  const rules = [];
  for (const section of markdownSectionsByTitle(structuredState, sectionTitles)) {
    rules.push(...extractedRulesFromMarkdownBlock(section));
  }
  if (!rules.length) {
    for (const section of markdownSectionsByTitle(normalized, sectionTitles)) {
      rules.push(...extractedRulesFromMarkdownBlock(section));
    }
  }
  if (!rules.length) {
    rules.push(...fallbackRulesFromNamedSections(taskContext, sectionTitles));
  }
  rules.push(...explicitRulesFromRawTurnLog(rawTurnLog, targetScope));
  return uniqueList(rules, 50);
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function readTextFirst(files) {
  for (const file of files || []) {
    const text = readText(file);
    if (text) return text;
  }
  return "";
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function toInt(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function timestampSeconds(value, fallback = nowSeconds()) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value / 1000 : value;
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed / 1000 : fallback;
}

function timestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function usageFromMetadata(metadata = {}) {
  const meta = metadata && typeof metadata === "object" ? metadata : {};
  return {
    inputTokens: toInt(meta.inputTokens ?? meta.input_tokens),
    outputTokens: toInt(meta.outputTokens ?? meta.output_tokens),
    cacheReadTokens: toInt(meta.cacheReadTokens ?? meta.cache_read_tokens),
    cacheWriteTokens: toInt(meta.cacheWriteTokens ?? meta.cache_write_tokens),
    reasoningTokens: toInt(meta.reasoningTokens ?? meta.reasoning_tokens),
    apiCalls: toInt(meta.apiCalls ?? meta.api_calls),
    estimatedCostUsd: toNumber(meta.estimatedCostUsd ?? meta.estimated_cost_usd),
  };
}

function mergeMetadata(message = {}) {
  const metadata = message.metadata && typeof message.metadata === "object" ? message.metadata : {};
  const event = metadata.event && typeof metadata.event === "object" ? metadata.event : {};
  const eventMetadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
  return {
    metadata,
    event,
    eventMetadata,
    combined: { ...metadata, ...eventMetadata },
    eventType: metadata.eventType || event.type || "",
  };
}

function normalizeUserInputStatus(value, fallback = "pending") {
  const status = String(value || "").trim().toLowerCase();
  return USER_INPUT_STATUSES.has(status) ? status : fallback;
}

function createUserInputEnvelope(input = {}) {
  const deliveryMode = normalizeDeliveryMode(input.deliveryMode, "new_turn");
  return {
    id: String(input.id || crypto.randomUUID()),
    text: String(input.text || ""),
    turnId: String(input.turnId || crypto.randomUUID()),
    ...(input.runId ? { runId: String(input.runId) } : {}),
    deliveryMode,
    status: normalizeUserInputStatus(input.status, "pending"),
    ...(input.targetRunId ? { targetRunId: String(input.targetRunId) } : {}),
    ...(input.consumedAt ? { consumedAt: String(input.consumedAt) } : {}),
  };
}

function messageInputEnvelope(message = {}) {
  const { metadata } = mergeMetadata(message);
  const envelope = metadata.inputEnvelope && typeof metadata.inputEnvelope === "object"
    ? metadata.inputEnvelope
    : null;
  if (!envelope) return null;
  return {
    id: String(envelope.id || ""),
    text: String(envelope.text || ""),
    turnId: String(envelope.turnId || ""),
    runId: envelope.runId ? String(envelope.runId) : undefined,
    deliveryMode: normalizeDeliveryMode(envelope.deliveryMode, "new_turn"),
    status: normalizeUserInputStatus(envelope.status, "pending"),
    targetRunId: envelope.targetRunId ? String(envelope.targetRunId) : undefined,
    consumedAt: envelope.consumedAt ? String(envelope.consumedAt) : undefined,
  };
}

function promptTextFromMessages(messages = []) {
  return (messages || [])
    .map((message) => {
      const content = message?.content;
      if (Array.isArray(content)) {
        return content
          .map((part) => {
            if (typeof part === "string") return part;
            if (part && typeof part === "object") return String(part.text || part.content || "");
            return "";
          })
          .join("\n");
      }
      return String(content || "");
    })
    .join("\n\n");
}

function countOccurrences(haystack, needle) {
  const source = String(haystack || "");
  const target = String(needle || "");
  if (!target) return 0;
  let count = 0;
  let index = source.indexOf(target);
  while (index >= 0) {
    count += 1;
    index = source.indexOf(target, index + target.length);
  }
  return count;
}

function scrubCurrentRequestEcho(content, currentRequest) {
  const source = String(content || "");
  const request = String(currentRequest || "").trim();
  if (!request || request.length < 8) return source;
  return source.split(request).join("[current request omitted here]");
}

function completedRunIdsFromMessages(messages = []) {
  const completed = new Set();
  const cancelled = new Set();
  for (const message of messages || []) {
    const { combined, eventType } = mergeMetadata(message);
    const runId = combined.runId ? String(combined.runId) : "";
    if (!runId) continue;
    if (eventType === "done") {
      if (combined.cancelled || combined.stopRequested || combined.replacedByRunId) {
        cancelled.add(runId);
      } else {
        completed.add(runId);
      }
    }
    if (eventType === "error" && (combined.cancelled || combined.stopRequested)) {
      cancelled.add(runId);
    }
  }
  for (const runId of cancelled) completed.delete(runId);
  return completed;
}

function isControlEventMessage(message = {}) {
  const { metadata, eventType } = mergeMetadata(message);
  return (
    eventType === "control_event" ||
    metadata.controlEvent === true ||
    metadata.controlEventType ||
    metadata.deliveryMode === "guide" ||
    messageInputEnvelope(message)?.deliveryMode === "guide"
  );
}

function isPromptHistoryMessage(message, completedRunIds, currentRequestId = "") {
  if (!message || !["user", "assistant", "tool"].includes(message.role)) return false;
  const { combined, eventType } = mergeMetadata(message);
  if (["command_start", "command_output", "command_end", "tool_start", "tool_output", "tool_end", "done", "raw_log", "queue_update", "run_stage"].includes(eventType)) {
    return false;
  }
  if (isControlEventMessage(message)) return false;
  const envelope = messageInputEnvelope(message);
  if (envelope) {
    if (envelope.id && envelope.id === currentRequestId) return false;
    if (envelope.deliveryMode === "guide") return false;
    if (envelope.status !== "completed") return false;
  }
  if (combined.runId && completedRunIds.size > 0 && !completedRunIds.has(String(combined.runId))) {
    return false;
  }
  return true;
}

function renderPromptHistoryMessage(message, currentRequestText, redactionStats) {
  const { combined } = mergeMetadata(message);
  const envelope = messageInputEnvelope(message);
  const rawContent = compactMultiline(message.content, RECENT_MESSAGE_CONTENT_LIMIT);
  const scrubbed = scrubCurrentRequestEcho(rawContent, currentRequestText);
  const redacted = SecretRedactor.redactText(scrubbed);
  redactionStats.count += redacted.count;
  const attachments = Array.isArray(message.attachments) && message.attachments.length > 0
    ? message.attachments.map((attachment) => {
        const line = [
          attachment.name || "attachment",
          attachment.storedPath ? `storedPath=${attachment.storedPath}` : "",
          attachment.mimeType ? `mimeType=${attachment.mimeType}` : "",
        ].filter(Boolean).join(" ");
        const safe = SecretRedactor.redactText(line);
        redactionStats.count += safe.count;
        return safe.text;
      }).join("\n")
    : "";
  const content = attachments
    ? `${redacted.text}\n\nAttachments:\n${attachments}`.trim()
    : redacted.text;
  return {
    role: message.role,
    content,
    metadata: {
      redouContextKind: "history",
      ...(combined.runId ? { runId: String(combined.runId) } : {}),
      ...(envelope?.turnId ? { turnId: envelope.turnId } : {}),
      ...(envelope?.id ? { inputEnvelopeId: envelope.id } : {}),
    },
  };
}

class ToolLogSummarizer {
  static summarize(messages = [], completedRunIds = new Set(), currentRequestText = "", redactionStats = { count: 0 }) {
    const byRun = new Map();
    const ensure = (runId) => {
      const key = String(runId || "legacy");
      if (!byRun.has(key)) {
        byRun.set(key, { commands: [], tools: [], files: [], errors: [], outputs: [], success: null });
      }
      return byRun.get(key);
    };

    for (const message of messages || []) {
      const { event, combined, eventType } = mergeMetadata(message);
      const runId = combined.runId ? String(combined.runId) : "";
      if (runId && completedRunIds.size > 0 && !completedRunIds.has(runId)) continue;
      if (!["command_start", "command_end", "command_output", "tool_start", "tool_end", "tool_output", "file_changed", "error"].includes(eventType)) {
        continue;
      }
      const bucket = ensure(runId);
      if (eventType === "command_start" && event.command) {
        bucket.commands.push(event.command);
      } else if (eventType === "command_end") {
        bucket.success = event.success !== false;
      } else if (eventType === "tool_start" && event.name) {
        bucket.tools.push(event.name);
      } else if (eventType === "tool_end") {
        bucket.success = event.success !== false;
      } else if (eventType === "file_changed") {
        bucket.files.push(event.path || event.summary);
      } else if (eventType === "error") {
        bucket.errors.push(event.message || message.content);
      } else if (eventType === "command_output" || eventType === "tool_output") {
        const raw = eventType === "tool_output"
          ? (typeof event.output === "string" ? event.output : JSON.stringify(event.output ?? {}))
          : (event.content || message.content);
        const firstUsefulLine = String(raw || "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean);
        if (firstUsefulLine) {
          bucket.outputs.push(firstUsefulLine);
        }
      }
    }

    const lines = [];
    for (const [runId, bucket] of Array.from(byRun.entries()).slice(-4)) {
      const parts = [];
      if (bucket.commands.length) parts.push(`commands: ${uniqueList(bucket.commands, 6).join("; ")}`);
      if (bucket.tools.length) parts.push(`tools: ${uniqueList(bucket.tools, 8).join(", ")}`);
      if (bucket.success != null) parts.push(`result: ${bucket.success ? "success" : "failed"}`);
      if (bucket.files.length) parts.push(`files: ${uniqueList(bucket.files, 8).join(", ")}`);
      if (bucket.outputs.length) parts.push(`key output: ${uniqueList(bucket.outputs.map((item) => compact(item, 220)), 4).join(" | ")}`);
      if (bucket.errors.length) parts.push(`errors: ${uniqueList(bucket.errors.map((item) => compact(item, 260)), 4).join(" | ")}`);
      if (!parts.length) continue;
      const rawLine = `- run ${runId}: ${parts.join("; ")}`;
      const scrubbed = scrubCurrentRequestEcho(rawLine, currentRequestText);
      const redacted = SecretRedactor.redactText(scrubbed);
      redactionStats.count += redacted.count;
      lines.push(redacted.text);
    }
    return lines.join("\n");
  }
}

function parseMarkdownListSection(markdown, title) {
  const sections = markdownSectionsByTitle(markdown, [title]);
  if (!sections.length) return [];
  return sections[0]
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter((line) => line && line !== "(empty)" && line !== "No completed turns yet." && !/^#+\s/.test(line));
}

function renderMarkdownList(items, empty = "(empty)") {
  const values = uniqueList((items || []).map((item) => String(item || "").trim()).filter(Boolean), 12);
  return values.length ? values.map((item) => `- ${item}`).join("\n") : empty;
}

class TaskStateManager {
  static update(taskContext, userInput, assistantText, options = {}) {
    const artifacts = options.artifacts && typeof options.artifacts === "object"
      ? options.artifacts
      : emptyTurnArtifacts();
    const existingState = parseTaskStateFromStructuredText(splitTaskContext(taskContext).structuredState);
    const state = compressTaskContext([
      { type: "turn_digest", user: userInput, assistant: assistantText, ...(artifacts || {}) },
    ], options.budget || {});
    const merged = normalizeTaskState({
      ...state,
      constraints: [...existingState.constraints, ...state.constraints],
      decisions: [...existingState.decisions, ...state.decisions],
      completed: [...existingState.completed, ...state.completed],
      open_issues: [...existingState.open_issues, ...state.open_issues],
      files_changed: [...existingState.files_changed, ...state.files_changed],
      commands_run: [...existingState.commands_run, ...state.commands_run],
      next_steps: [...existingState.next_steps, ...state.next_steps],
      task_goal: state.task_goal || existingState.task_goal,
      current_phase: state.current_phase || existingState.current_phase,
      current_focus: state.current_focus || existingState.current_focus,
    });
    const nextStructured = renderTaskStateStructuredMarkdown(merged);
    return {
      structuredState: nextStructured,
      rawTurnLog: "",
      recentTurnDigest: renderRecentTurnDigest(merged),
      taskStateSnapshot: nextStructured.replace(/^# Task Context\s*/i, "").trim(),
    };
  }
}

class ContextValidator {
  static validate(messages = [], options = {}) {
    const errors = [];
    const currentRequestText = String(options.currentRequestText || "").trim();
    const currentRequestId = String(options.currentRequestId || "");
    const allowEmptyCurrentRequest = options.allowEmptyCurrentRequest === true;
    const promptText = promptTextFromMessages(messages);
    const userMessages = messages.filter((message) => message?.role === "user");
    const lastUser = userMessages[userMessages.length - 1] || null;
    const occurrenceTarget = currentRequestText.length >= 16
      ? currentRequestText
      : `# Current User Request\n\n${currentRequestText}`;
    const occurrences = currentRequestText ? countOccurrences(promptText, occurrenceTarget) : 0;

    if (!currentRequestText) {
      if (!allowEmptyCurrentRequest) {
        errors.push("Current User Request is empty.");
      }
    } else if (occurrences !== 1) {
      errors.push(`Current User Request occurrence count is ${occurrences}, expected 1.`);
    }
    if (currentRequestText && (!lastUser || !String(lastUser.content || "").includes(currentRequestText))) {
      errors.push("Current User Request is not the last user message.");
    }

    for (const message of messages) {
      const kind = message?.metadata?.redouContextKind || "";
      const envelope = messageInputEnvelope(message);
      const { eventType } = mergeMetadata(message);
      if (kind === "history" && envelope && envelope.status !== "completed") {
        errors.push(`History includes non-completed turn ${envelope.turnId || envelope.id}.`);
      }
      if (kind === "history" && envelope && ["pending", "consumed"].includes(envelope.status)) {
        errors.push(`History includes queued or future user input ${envelope.id}.`);
      }
      if (kind === "history" && envelope?.deliveryMode === "guide") {
        errors.push(`Guide/control event appears as user history ${envelope.id}.`);
      }
      if (kind === "history" && ["command_start", "command_output", "command_end", "tool_start", "tool_output", "tool_end", "done", "raw_log", "run_stage"].includes(eventType)) {
        errors.push(`Raw run event ${eventType} appears in conversation history.`);
      }
    }

    const nonCurrentPromptText = promptTextFromMessages(
      lastUser ? messages.slice(0, messages.lastIndexOf(lastUser)) : messages,
    );
    if (/\b(command_start|tool_start|tool_end|queue_update|raw_log|run_stage)\b/.test(nonCurrentPromptText)) {
      errors.push("Prompt contains raw run event labels.");
    }
    if (SecretRedactor.containsUnredactedSecret(promptText)) {
      errors.push("Prompt contains an unredacted secret-like value.");
    }

    return {
      ok: errors.length === 0,
      errors,
      currentRequestId,
      currentRequestOccurrences: occurrences,
      messageCount: messages.length,
    };
  }
}

function clampScore(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function modelBenchmarkKey(provider, model) {
  const providerPart = safeSegment(provider || "auto", "auto");
  const modelPart = safeSegment(model || "default", "default");
  return `${providerPart}--${modelPart}`.slice(0, 160);
}

function pathExists(root, relativePath) {
  return fs.existsSync(path.join(root, ...String(relativePath || "").split(/[\\/]+/).filter(Boolean)));
}

function readRelativeText(root, relativePath) {
  return readText(path.join(root, ...String(relativePath || "").split(/[\\/]+/).filter(Boolean)));
}

function readRelativeJson(root, relativePath) {
  const text = readRelativeText(root, relativePath);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function joinRelativePath(root, relativePath) {
  return path.join(root, ...String(relativePath || "").split(/[\\/]+/).filter(Boolean));
}

function pathExistsAny(root, relativePaths) {
  return relativePaths.some((candidate) => fs.existsSync(joinRelativePath(root, candidate)));
}

function readRelativeTextAny(root, relativePaths) {
  for (const candidate of relativePaths) {
    const text = readText(joinRelativePath(root, candidate));
    if (text) return text;
  }
  return "";
}

function firstExistingRelativePath(root, relativePaths) {
  for (const candidate of relativePaths) {
    const fullPath = joinRelativePath(root, candidate);
    if (fs.existsSync(fullPath)) return fullPath;
  }
  return joinRelativePath(root, relativePaths[0] || "");
}

function listFilesRecursive(dir, limit = 400) {
  const files = [];
  const visit = (current) => {
    if (files.length >= limit || !fs.existsSync(current)) return;
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= limit) break;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        visit(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  };
  visit(dir);
  return files;
}

function hasAny(text, patterns) {
  const value = String(text || "");
  return patterns.some((pattern) =>
    pattern instanceof RegExp ? pattern.test(value) : value.includes(String(pattern)),
  );
}

function isAnalysisModelCallFailure(text) {
  return hasAny(text, [
    /API call failed after \d+ retries/i,
    /\bRateLimitError\b/i,
    /\brate_limit_error\b/i,
    /\busage limit exceeded\b/i,
    /\bStream stalled mid tool-call\b/i,
    /\bStream interrupted before completion\b/i,
    /\bPartial stream dropped tool call/i,
    /\bPartial stream delivered before error\b/i,
    /\bStreaming failed after partial delivery\b/i,
  ]);
}

function commandText(events) {
  return events
    .filter((event) => event && (event.type === "command_start" || event.type === "tool_start"))
    .map((event) => event.command || JSON.stringify(event.input || {}) || "")
    .join("\n");
}

function sectionScore(id, label, score, evidence = "") {
  return {
    id,
    label,
    score: clampScore(score),
    evidence: compact(evidence, 260),
  };
}

function averageScore(items) {
  const scores = items.map((item) => Number(item.score || 0));
  if (scores.length === 0) return 0;
  return clampScore(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

function analysisTestCounts(summary) {
  const judge = summary?.judge_result || {};
  const passedCount = Number(judge.passed_count);
  const total = Number(judge.total);
  const failedCount = Number(judge.failed_count || 0);
  const errorCount = Number(judge.error_count || 0);
  if (Number.isFinite(passedCount) && Number.isFinite(total) && total > 0) {
    const executedTotal = passedCount +
      (Number.isFinite(failedCount) ? failedCount : 0) +
      (Number.isFinite(errorCount) ? errorCount : 0);
    const adjustedTotal = Math.max(total, executedTotal);
    return { passedCount, total, adjustedTotal, failedCount, errorCount };
  }
  return null;
}

function analysisTestPassRatio(summary) {
  const counts = analysisTestCounts(summary);
  if (counts) {
    const { passedCount, adjustedTotal } = counts;
    return Math.max(0, Math.min(1, passedCount / adjustedTotal));
  }
  const judge = summary?.judge_result || {};
  const metric = Number(summary?.current_metric ?? judge.metric ?? 0);
  return Number.isFinite(metric) ? Math.max(0, Math.min(1, metric)) : 0;
}

function analysisTaskProcessStatus({
  stopped = false,
  childError = null,
  exitCode = 0,
  modelCallFailed = false,
  postProcessFailed = false,
  finalAssistantText = "",
} = {}) {
  if (stopped) return "interrupted";
  if (childError || modelCallFailed || postProcessFailed) return "failed";
  const hasFinalAssistantText = String(finalAssistantText || "").trim().length > 0;
  if (exitCode != null && exitCode !== 0 && !hasFinalAssistantText) return "failed";
  return "completed";
}

function normalizeAnalysisTaskStatus(task, { score = 0, sections = [], gradeLogText = "", migratedSummary = null } = {}) {
  const status = String(task?.status || "pending");
  if (status !== "failed") return status;
  const summaryText = `${task?.summary || ""}\n${task?.error || ""}`;
  if (isAnalysisModelCallFailure(summaryText)) return status;
  const hasEvaluation =
    Boolean(migratedSummary) ||
    analysisFinalScoreFromLog(gradeLogText) != null ||
    (Array.isArray(sections) && sections.length > 0) ||
    Number(score || 0) > 0;
  return hasEvaluation ? "completed" : status;
}

function analysisTaskGradeLogText(workspacePath, taskId) {
  const id = String(taskId || "").trim();
  if (!workspacePath || !id) return "";
  const logName = `${id}_grade_all.log`;
  return readTextFirst([
    path.join(analysisDisplayResultsDir(workspacePath), id, logName),
    path.join(workspacePath, "logs", logName),
    path.join(workspacePath, "reports", logName),
  ]);
}

function analysisFinalScoreFromLog(logText) {
  const match = String(logText || "").match(/Final Score:\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!match) return null;
  const score = Number(match[1]);
  const max = Number(match[2]);
  if (!Number.isFinite(score) || !Number.isFinite(max) || max <= 0) return null;
  return clampScore((score / max) * 100);
}

const ANALYSIS_GRADE_SECTION_MAP = {
  task1: {
    "Task1 Phase 1: Files": [{ id: "workspace_structure", label: "Workspace structure" }],
    "Task1 Phase 2: Compose Service": [{ id: "compose_contract", label: "Docker compose contract" }],
    "Task1 Phase 3: Toolchain": [{ id: "environment_verification", label: "Environment verification" }],
    "Task1 Phase 4: Workspace Mount": [{ id: "mount_evidence", label: "Workspace mount evidence" }],
    "Task1 Phase 5: Docs": [{ id: "documentation", label: "README and ENV report" }],
  },
  task2: {
    "Phase 0: Environment": [{ id: "container_execution", label: "Container execution" }],
    "Phase 1: Scaffold": [{ id: "project_created", label: "Project files" }],
    "Phase 2: Data Logic": [{ id: "persistence", label: "Persistence and data logic" }],
    "Phase 3: UI and Build": [{ id: "features", label: "Task board UI and build" }],
    "Phase 4: Runtime Curl": [{ id: "verification", label: "Runtime verification" }],
    "Phase 5: Report": [{ id: "report", label: "Delivery report" }],
  },
  task3: {
    "Task3 Phase 0: Environment": [{ id: "container_execution", label: "Container-only commands" }],
    "Task3 Phase 1: Scaffold": [{ id: "project_created", label: "Library project" }],
    "Task3 Phase 2: Initial Failure": [{ id: "tests_created", label: "Tests and initial failure" }],
    "Task3 Phase 3: Final Pass": [{ id: "bug_loop", label: "Failing-to-passing loop" }],
    "Task3 Phase 4: Behavior": [{ id: "function_coverage", label: "Required utility coverage" }],
    "Task3 Phase 5: Report": [{ id: "log_report", label: "Log and report" }],
  },
  task4: {
    "Task4 Phase 0: Environment": [{ id: "environment", label: "Environment" }],
    "Task4 Phase 1: Sources and Notes": [{ id: "sources", label: "Sources and notes" }],
    "Task4 Phase 2: Report and Comparison": [{ id: "comparison", label: "Report and comparison" }],
    "Task4 Phase 3: Product Design": [{ id: "product_plan", label: "Product plan" }],
    "Task4 Phase 4: Citation Quality": [{ id: "citation_quality", label: "Citation quality" }],
    "Task4 Phase 5: Delivery": [
      { id: "report_saved", label: "Research report saved" },
      { id: "container_check", label: "Container file check" },
    ],
  },
};

function analysisPhaseScoresFromLog(logText) {
  const phases = [];
  let current = null;
  for (const line of String(logText || "").split(/\r?\n/)) {
    const running = line.match(/^Running\s+(.+?)\s+\(([0-9]+(?:\.[0-9]+)?)\s+pts\)\s*$/i);
    if (running) {
      current = {
        name: running[1].trim(),
        points: Number(running[2]),
        awarded: null,
        status: "",
      };
      phases.push(current);
      continue;
    }
    const result = line.match(/^(.+?)\s+(PASS|FAIL|PARTIAL):\s*\+([0-9]+(?:\.[0-9]+)?)\s*$/i);
    if (!result) continue;
    const name = result[1].trim();
    const phase = [...phases].reverse().find((item) => item.name === name && item.awarded == null) ||
      (current?.awarded == null ? current : null);
    if (!phase) continue;
    phase.awarded = Number(result[3]);
    phase.status = result[2].toUpperCase();
  }
  return phases.filter((phase) => phase.awarded != null && phase.points > 0);
}

function analysisTaskSectionsFromGradeLog(taskId, logText) {
  const map = ANALYSIS_GRADE_SECTION_MAP[taskId];
  if (!map) return [];
  const sections = [];
  for (const phase of analysisPhaseScoresFromLog(logText)) {
    const mapped = map[phase.name];
    if (!mapped) continue;
    const score = (Number(phase.awarded) / Number(phase.points)) * 100;
    for (const section of mapped) {
      sections.push(sectionScore(
        section.id,
        section.label,
        score,
        `${phase.name}: ${phase.status} +${phase.awarded}/${phase.points}`,
      ));
    }
  }
  return sections;
}

function analysisLatestMigratedTaskSummary(workspacePath, modelRunName, taskId) {
  const migratedMatch = /^task([5-9])$/.exec(String(taskId || ""));
  if (!workspacePath || !modelRunName || !migratedMatch) return null;
  const taskNumber = migratedMatch[1];
  const resultsRel = `model_runs/${modelRunName}/results`;
  for (const index of [3, 2, 1]) {
    const summary = readRelativeJson(workspacePath, `${resultsRel}/task${taskNumber}_submit_${index}_summary.json`);
    if (summary) return summary;
  }
  return null;
}

function analysisMigratedTaskSectionsFromSummary(taskId, workspacePath, modelRunName, summary) {
  const migratedMatch = /^task([5-9])$/.exec(String(taskId || ""));
  if (!workspacePath || !modelRunName || !migratedMatch || !summary) return [];
  const taskNumber = migratedMatch[1];
  const runRel = `model_runs/${modelRunName}/task${taskNumber}`;
  const resultsRel = `model_runs/${modelRunName}/results`;
  const testRatio = analysisTestPassRatio(summary);
  const testScore = testRatio * 100;
  const testCounts = analysisTestCounts(summary);
  const testEvidence = testCounts
    ? `${testCounts.passedCount}/${testCounts.adjustedTotal} passed`
    : `metric=${testRatio}`;
  const report = readRelativeText(workspacePath, `${resultsRel}/task${taskNumber}_report.md`);
  const runFiles = listFilesRecursive(path.join(workspacePath, "model_runs", modelRunName, `task${taskNumber}`), 220);
  return [
    sectionScore("working_copy", "Isolated working copy", runFiles.length > 0 ? 100 : 0, `${runFiles.length} files in ${runRel}`),
    sectionScore("automated_tests", "Automated hidden tests", testScore, testEvidence),
    sectionScore("official_submission", "Official evaluator run", 100, "task_project_evaluate.py summary"),
    sectionScore("source_integrity", "Original source untouched", summary?.original_source_unchanged === true ? 100 : 20, "original source checksum"),
    sectionScore("container_execution", "Container-only commands", 100, "task_project_evaluate.py summary"),
    sectionScore("report", "Delivery report", report.length > 1000 ? 100 : report ? 55 : 0, `task${taskNumber}_report.md`),
  ];
}

function countHttpLinks(text) {
  const matches = String(text || "").match(/https?:\/\/[^\s)>\]]+/g);
  return matches ? matches.length : 0;
}

function regexEscape(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function analysisContainerExecPatterns(analysisEnvName) {
  const escapedEnvName = regexEscape(analysisEnvName);
  return [
    new RegExp(`docker\\s+compose\\s+exec\\b[^\\r\\n]*\\b${escapedEnvName}\\b`, "i"),
    new RegExp(`docker\\s+exec\\b[^\\r\\n]*\\b${escapedEnvName}\\b`, "i"),
  ];
}

function hasContainerExecCommand(commands, analysisEnvName, extraPatterns = []) {
  const execPatterns = analysisContainerExecPatterns(analysisEnvName);
  return String(commands || "")
    .split(/\r?\n/)
    .some((line) =>
      hasAny(line, execPatterns) &&
      extraPatterns.every((pattern) => hasAny(line, [pattern])),
    );
}

function analysisModelRunName(provider, model, key) {
  return safeSegment(model || key || `${provider || "auto"}-model`, "model");
}

function analysisDockerEnvironmentName(provider, model, key) {
  const modelKey = key || modelBenchmarkKey(provider, model);
  const suffix = safeSegment(modelKey, "model").replace(/[._-]+/g, "-");
  return `agent-lab-${suffix}`.slice(0, 120).replace(/[-.]+$/g, "") || "agent-lab-model";
}

function isMissingDockerContainerOutput(output) {
  return hasAny(output, [
    /\bNo such container\b/i,
    /\bNo such object\b/i,
    /\bnot found\b/i,
  ]);
}

function replaceAnalysisDockerEnvironment(prompt, envName) {
  const target = String(envName || "").trim();
  if (!target || target === "agent-lab") return String(prompt || "");
  return String(prompt || "").replace(/(^|[^A-Za-z0-9_-])agent-lab(?![A-Za-z0-9_-])/g, `$1${target}`);
}

function normalizeAnalysisWorkspaceScript(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^SERVICE="agent-lab"$/gm, 'SERVICE="${DOCKER_SERVICE:-agent-lab}"')
    .replace(/\bdocker compose exec(?!\s+-T)\s+"\$SERVICE"/g, 'docker compose exec -T "$SERVICE"');
}

function normalizeAnalysisWorkspaceScriptsInPlace(workspacePath) {
  if (!workspacePath || !fs.existsSync(workspacePath)) return;
  let entries = [];
  try {
    entries = fs.readdirSync(workspacePath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !/\.sh$/i.test(entry.name)) continue;
    const file = path.join(workspacePath, entry.name);
    const current = readText(file);
    const normalized = normalizeAnalysisWorkspaceScript(current);
    if (normalized !== current) {
      fs.writeFileSync(file, normalized, "utf8");
    }
  }
}

function analysisTaskNumber(taskId) {
  const match = /^task(\d+)$/.exec(String(taskId || "").trim());
  return match ? match[1] : "";
}

function analysisTaskBatchScript(taskId) {
  const number = analysisTaskNumber(taskId);
  return number ? `task${number}_grade_all.sh` : "";
}

function analysisDisplayResultsDir(workspacePath) {
  return path.join(workspacePath, REDOU_CONTEXT_DIR, REDOU_ANALYSIS_DIR, "results");
}

function listRelativeFiles(root, limit = 20) {
  return listFilesRecursive(root, limit)
    .map((file) => path.relative(root, file).replace(/\\/g, "/"))
    .filter(Boolean);
}

function analysisTaskDisplayArtifacts(workspacePath, taskId) {
  const workspace = String(workspacePath || "").trim();
  const id = String(taskId || "").trim();
  const empty = {
    rootPath: "",
    batchLogPath: "",
    batchLogPreview: "",
    reports: [],
    logs: [],
    modelResults: [],
  };
  if (!workspace || !id) return empty;
  const rootPath = path.join(analysisDisplayResultsDir(workspace), id);
  const batchLogName = `${id}_grade_all.log`;
  const batchLogCandidates = [
    path.join(rootPath, batchLogName),
    path.join(workspace, "logs", batchLogName),
    path.join(workspace, "reports", batchLogName),
  ];
  const batchLogPath = batchLogCandidates.find((candidate) => fs.existsSync(candidate)) || "";
  const hasRoot = fs.existsSync(rootPath);
  return {
    rootPath: hasRoot ? rootPath : "",
    batchLogPath,
    batchLogPreview: batchLogPath ? compactMultiline(readText(batchLogPath), 2400) : "",
    reports: hasRoot ? listRelativeFiles(path.join(rootPath, "reports"), 20) : [],
    logs: hasRoot ? listRelativeFiles(path.join(rootPath, "logs"), 20) : [],
    modelResults: hasRoot ? listRelativeFiles(path.join(rootPath, "model_results"), 20) : [],
  };
}

function shellQuoteSingle(value) {
  return `'${String(value || "").replace(/'/g, "'\"'\"'")}'`;
}

function analysisComposeHasService(composeText, serviceName) {
  const escaped = regexEscape(serviceName);
  return new RegExp(`(^|\\n)\\s{2}["']?${escaped}["']?\\s*:`, "m").test(String(composeText || ""));
}

function analysisComposeHasWorkspaceMount(composeText) {
  return /\/workspace\b/i.test(String(composeText || "")) &&
    /(?:-\s*["']?(?:\.\/?|\$\{PWD\})["']?\s*:\s*["']?\/workspace\b|target:\s*["']?\/workspace\b)/i.test(String(composeText || ""));
}

function positiveIntegerOrNull(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

function normalizeAnalysisMaxIterations(value, fallback = ANALYSIS_DEFAULT_MAX_ITERATIONS) {
  return positiveIntegerOrNull(value) || positiveIntegerOrNull(fallback) || ANALYSIS_DEFAULT_MAX_ITERATIONS;
}

function readRootAgentMaxTurns(hermesHome) {
  const text = readText(path.join(hermesHome, "config.yaml"));
  const agentBlock = topLevelYamlBlock(text, "agent");
  for (const line of agentBlock.split(/\r?\n/).slice(1)) {
    const match = line.match(/^\s+max_turns:\s*(.*)$/);
    const value = match ? positiveIntegerOrNull(yamlScalar(match[1])) : null;
    if (value) return value;
  }

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^max_turns:\s*(.*)$/);
    const value = match ? positiveIntegerOrNull(yamlScalar(match[1])) : null;
    if (value) return value;
  }

  return null;
}

function analysisTaskPromptPath(projectRoot, task) {
  return path.join(projectRoot, "analyze", task.file);
}

function readDotEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const rawLine of readText(file).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

function sleepSync(ms) {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

function isTransientFileError(error) {
  return ["EBUSY", "EACCES", "EPERM", "ENOTEMPTY"].includes(error && error.code);
}

function removeDirectoryWithRetries(dir) {
  const maxAttempts = process.platform === "win32" ? 5 : 3;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientFileError(error) || attempt === maxAttempts - 1) {
        break;
      }
      sleepSync(60 * (attempt + 1));
    }
  }

  throw lastError;
}

function replaceFileFromTemp(tmp, target) {
  const maxAttempts = process.platform === "win32" ? 8 : 3;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      if (process.platform === "win32" && fs.existsSync(target)) {
        fs.copyFileSync(tmp, target);
        fs.unlinkSync(tmp);
      } else {
        fs.renameSync(tmp, target);
      }
      return;
    } catch (error) {
      lastError = error;
      if (process.platform === "win32" && fs.existsSync(tmp)) {
        try {
          fs.copyFileSync(tmp, target);
          fs.unlinkSync(tmp);
          return;
        } catch (copyError) {
          lastError = copyError;
        }
      }
      if (!isTransientFileError(lastError) || attempt === maxAttempts - 1) {
        break;
      }
      sleepSync(35 * (attempt + 1));
    }
  }

  throw lastError;
}

function writeJsonAtomic(file, value) {
  mkdirp(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    replaceFileFromTemp(tmp, file);
  } catch (error) {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
    throw error;
  }
}

function copyFileAtomic(source, target) {
  mkdirp(path.dirname(target));
  const tmp = `${target}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.copyFileSync(source, tmp);
  try {
    replaceFileFromTemp(tmp, target);
  } catch (error) {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
    throw error;
  }
}

function copyDirectoryRecursive(source, target) {
  if (!fs.existsSync(source)) return;
  mkdirp(path.dirname(target));
  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    filter: (src) => {
      const name = path.basename(src);
      return name !== "__pycache__" && name !== ".pytest_cache" && !name.endsWith(".pyc");
    },
  });
}

function assertChildPath(root, target, label) {
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(target);
  const rootCmp = process.platform === "win32" ? rootPath.toLowerCase() : rootPath;
  const targetCmp = process.platform === "win32" ? targetPath.toLowerCase() : targetPath;
  if (targetCmp === rootCmp || !targetCmp.startsWith(`${rootCmp}${path.sep}`)) {
    throw new Error(`Refusing to delete ${label}: path is outside Redou app data.`);
  }
  return targetPath;
}

function yamlString(value) {
  return JSON.stringify(String(value || ""));
}

function yamlScalar(value) {
  let text = String(value || "").trim();
  if (!text || text === "null" || text === "~") return "";
  if (text.includes(" #")) {
    text = text.slice(0, text.indexOf(" #")).trim();
  }
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1);
  }
  return text.trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function topLevelYamlBlock(text, key) {
  const lines = String(text || "").split(/\r?\n/);
  const keyPattern = new RegExp(`^${escapeRegex(key)}:\\s*(?:.*)?$`);
  const start = lines.findIndex((line) => keyPattern.test(line));
  if (start < 0) return "";

  const block = [lines[start]];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z_][A-Za-z0-9_-]*:\s*/.test(line) && line.trim() && !line.startsWith(" ")) {
      break;
    }
    block.push(line);
  }
  return block.join("\n").trimEnd();
}

function yamlBlockListValues(block, key) {
  const lines = String(block || "").split(/\r?\n/);
  const keyPattern = new RegExp(`^\\s{2}${escapeRegex(key)}:\\s*(.*)?$`);
  const start = lines.findIndex((line) => keyPattern.test(line));
  if (start < 0) return [];

  const inline = lines[start].match(keyPattern)?.[1]?.trim() || "";
  if (inline && inline !== "[]") {
    return [yamlScalar(inline)].filter(Boolean);
  }

  const values = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s{2}[A-Za-z_][A-Za-z0-9_-]*:\s*/.test(line)) break;
    const match = line.match(/^\s{4}-\s*(.+?)\s*$/);
    if (match) {
      const value = yamlScalar(match[1]);
      if (value) values.push(value);
    }
  }
  return values;
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const raw of values || []) {
    const value = String(raw || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function isImageMime(mimeType) {
  return String(mimeType || "").toLowerCase().startsWith("image/");
}

function eventContent(event) {
  switch (event.type) {
    case "assistant_message":
    case "assistant_delta":
    case "command_output":
    case "raw_log":
      return event.content || "";
    case "command_start":
      return event.command || "";
    case "command_end":
      return `command ${event.success ? "succeeded" : "failed"}${event.exitCode == null ? "" : ` (${event.exitCode})`}`;
    case "tool_start":
      return `tool started: ${event.name}`;
    case "tool_output":
      return typeof event.output === "string" ? event.output : JSON.stringify(event.output ?? {});
    case "tool_end":
      return `tool ${event.success ? "succeeded" : "failed"}: ${event.name}`;
    case "file_changed":
      return event.summary || event.path || "";
    case "queue_update":
      return event.message || `${Number(event.queued || 0)} queued`;
    case "run_stage":
      return [event.label || event.stage || "stage", event.status].filter(Boolean).join(": ");
    case "error":
      return event.message || "error";
    case "done":
      return "done";
    default:
      return JSON.stringify(event);
  }
}

function emptyTurnArtifacts() {
  return { files: [], commands: [], errors: [], attachments: [] };
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function tryParseJsonObject(value) {
  if (value && typeof value === "object") return value;
  const text = String(value || "").trim();
  if (!text || !/^[{[]/.test(text)) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function outputPayloadFromEvent(event) {
  if (!event || typeof event !== "object") return null;
  if (event.type === "tool_output") return event.output;
  if (event.type === "command_output") return tryParseJsonObject(event.content) || event;
  return event.output || event.content || null;
}

function truthyErrorValue(value) {
  if (value == null || value === false) return "";
  const text = typeof value === "string" ? value.trim() : JSON.stringify(value);
  if (!text || text === "null" || text === "false") return "";
  return compactMultiline(text, 600);
}

function exitCodeFromValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function eventExitCode(event, payload = null) {
  const source = asObject(payload) || {};
  const code = exitCodeFromValue(
    event?.exitCode ?? event?.exit_code ?? event?.code ?? source.exitCode ?? source.exit_code ?? source.status,
  );
  if (code != null) return code;
  if (event?.type === "command_end" && event.success === false) return 1;
  if (event?.success === true || source.success === true) return 0;
  return null;
}

function stderrFromPayload(payload) {
  const source = asObject(payload);
  if (!source) return "";
  return markdownListText(source.stderr || source.stdErr || source.errorOutput || "", 700);
}

function keyErrorLines(text, maxLines = 4) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const keyed = lines.filter((line) => /(error|exception|traceback|assertion|failed|failure|stderr|失败|报错)/i.test(line));
  return uniqueList((keyed.length ? keyed : lines).map((line) => compact(line, 240)), maxLines);
}

function summarizeEventError(event) {
  if (!event || typeof event !== "object") return "";
  if (event.type === "error") return truthyErrorValue(event.message || event.details);
  const payload = outputPayloadFromEvent(event);
  const payloadObject = asObject(payload);
  if (event.type === "tool_output") {
    const toolError = truthyErrorValue(payloadObject ? payloadObject.error : event.error);
    if (toolError) return toolError;
  }
  const stderr = stderrFromPayload(payload);
  const exitCode = eventExitCode(event, payload);
  if (exitCode != null && exitCode !== 0) {
    const source = stderr || (payloadObject ? payloadObject.stdout || payloadObject.output || "" : payload);
    const keyLines = keyErrorLines(source).join(" | ");
    return [`exitCode ${exitCode}`, keyLines].filter(Boolean).join(": ");
  }
  if (stderr) return keyErrorLines(stderr).join(" | ");
  return "";
}

function recordTurnArtifact(artifacts, key, value) {
  if (!artifacts || !Object.prototype.hasOwnProperty.call(artifacts, key)) return;
  const text = compactMultiline(value, 1000).trim();
  if (!text) return;
  artifacts[key].push(text);
  artifacts[key] = uniqueList(artifacts[key], 20);
}

function collectTurnArtifactFromEvent(artifacts, event) {
  if (!artifacts || !event || typeof event !== "object") return;
  if (event.type === "command_end") {
    const code = eventExitCode(event);
    if (code != null && code !== 0) recordTurnArtifact(artifacts, "errors", eventContent(event));
    return;
  }
  if (event.type === "command_output" || event.type === "tool_output" || event.type === "raw_log") {
    const summary = summarizeEventError(event);
    if (summary) recordTurnArtifact(artifacts, "errors", summary);
    return;
  }
  if (event.type === "command_start") {
    recordTurnArtifact(artifacts, "commands", event.command);
  } else if (event.type === "file_changed") {
    recordTurnArtifact(artifacts, "files", event.path || event.summary);
  } else if (event.type === "error") {
    recordTurnArtifact(artifacts, "errors", event.message || event.details);
  } else if (event.type === "command_end" && event.success === false) {
    recordTurnArtifact(artifacts, "errors", eventContent(event));
  } else if (event.type === "command_output" || event.type === "tool_output" || event.type === "raw_log") {
    const text = event.type === "tool_output"
      ? eventContent(event)
      : String(event.content || "");
    if (/(Error|Exception|Traceback|Assertion|failed|失败|报错)/i.test(text)) {
      recordTurnArtifact(artifacts, "errors", text);
    }
  }
}

function seedAttachmentArtifacts(artifacts, attachments) {
  for (const attachment of attachments || []) {
    const label = [
      attachment.name || "attachment",
      attachment.storedPath ? `storedPath=${attachment.storedPath}` : "",
      attachment.mimeType ? `mimeType=${attachment.mimeType}` : "",
    ].filter(Boolean).join(" ");
    recordTurnArtifact(artifacts, "attachments", label);
  }
}

const LIGHT_TAG_KEYWORDS = {
  constraints: ["以后", "默认", "从现在起", "每次", "都要", "必须", "不要再", "禁止", "优先", "保持", "固定", "只能", "不允许"],
  todos: ["帮我", "实现", "修改", "检查", "调试", "运行", "跑一下", "设计", "生成", "整理", "下一步", "计划", "任务"],
  open_issues: ["问题", "失败", "报错", "不确定", "还没", "需要", "风险", "冲突", "歧义", "待确认", "unresolved"],
};

function matchingKeywords(text, keywords) {
  const source = String(text || "");
  return keywords.filter((keyword) => source.toLowerCase().includes(keyword.toLowerCase()));
}

function evidenceMatches(text) {
  const source = String(text || "");
  const matches = [];
  const pathMatches = source.match(/[A-Za-z]:[\\/][^\s"'`<>]+|(?:^|[\s"'`])(?:\.{1,2}[\\/]|[A-Za-z0-9_.-]+[\\/])[^\s"'`<>]+/gm) || [];
  const fileMatches = source.match(/\b[\w.-]+\.(?:py|js|ts|tsx|md|json|csv|xlsx|tex|cjs)\b/g) || [];
  const commandMatches = source.match(/\b(?:npm|python|pytest|git|docker|node|pip|conda)\b[^\r\n]*/gi) || [];
  const errorMatches = source.match(/\b(?:Error|Exception|Traceback|Assertion|failed)\b[^\r\n]*|(?:失败|报错)[^\r\n]*/g) || [];
  const metricMatches = source.match(/\b(?:AUC|ACC|RMSE|loss|accuracy|metrics)\b[^\r\n]*/gi) || [];
  matches.push(...pathMatches, ...fileMatches, ...commandMatches, ...errorMatches, ...metricMatches);
  return uniqueList(matches, 12);
}

function extractLightTags(userInput, assistantSummary, artifacts = emptyTurnArtifacts()) {
  const combined = [
    userInput,
    assistantSummary,
    ...(artifacts.files || []),
    ...(artifacts.commands || []),
    ...(artifacts.errors || []),
    ...(artifacts.attachments || []),
  ].join("\n");
  return {
    constraints: matchingKeywords(userInput, LIGHT_TAG_KEYWORDS.constraints),
    todos: matchingKeywords(userInput, LIGHT_TAG_KEYWORDS.todos),
    evidence: evidenceMatches(combined),
    open_issues: matchingKeywords(combined, LIGHT_TAG_KEYWORDS.open_issues),
  };
}

function eventEnvelope(raw) {
  const entry = raw && typeof raw === "object" ? raw : {};
  const metadata = entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
  const event = metadata.event && typeof metadata.event === "object"
    ? metadata.event
    : entry.event && typeof entry.event === "object"
      ? entry.event
      : entry;
  return { entry, metadata, event };
}

function contextEventId(raw, fallbackIndex = 0) {
  const { entry, metadata, event } = eventEnvelope(raw);
  return String(
    event.id ||
    metadata.eventId ||
    metadata.toolCallId ||
    metadata.inputEnvelope?.id ||
    entry.id ||
    `${event.type || entry.role || "event"}:${event.command || entry.content || ""}:${entry.createdAt || event.createdAt || fallbackIndex}`,
  );
}

function commandKey(command) {
  return String(command || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function commandRecordKey(event, index) {
  const metadata = event?.metadata && typeof event.metadata === "object" ? event.metadata : {};
  return String(
    metadata.commandId ||
    metadata.toolCallId ||
    event.id ||
    metadata.command ||
    event.command ||
    `command-${index}`,
  );
}

function addStateItem(target, field, value, limit = 80) {
  const text = markdownListText(value, 700);
  if (!text || !Array.isArray(target[field])) return;
  target[field] = uniqueList([...target[field], text], limit);
}

function addOpenIssue(openIssues, id, text) {
  const key = String(id || text || "").trim();
  const body = markdownListText(text, 700);
  if (!key || !body) return;
  openIssues.set(key, body);
}

function removeOpenIssue(openIssues, id) {
  const key = String(id || "").trim();
  if (!key) return;
  openIssues.delete(key);
}

function summarizeMessageForState(text, max = 260) {
  return SecretRedactor.redactText(compact(markdownListText(text, max), max)).text;
}

function extractConstraintCandidates(text) {
  const source = String(text || "");
  if (!/(must|only|never|do not|don't|required|constraint|禁止|必须|不要|只能|不允许|默认|保持|优先)/i.test(source)) {
    return [];
  }
  return [summarizeMessageForState(source, 320)];
}

function extractDecisionCandidates(text) {
  const source = String(text || "");
  if (!/(decide|decision|choose|chosen|use |adopt|决定|选择|采用|确认)/i.test(source)) return [];
  return [summarizeMessageForState(source, 280)];
}

function extractNextStepCandidates(text) {
  const source = String(text || "");
  if (!/(next|todo|follow.?up|remaining|下一步|待办|继续|后续)/i.test(source)) return [];
  return [summarizeMessageForState(source, 260)];
}

function commandSummary(command, record) {
  const cleanCommand = SecretRedactor.redactText(compact(command || record?.command || "command", 220)).text;
  const exitCode = record?.exitCode ?? 0;
  if (record?.status === "failed") {
    const lines = SecretRedactor.redactText(
      keyErrorLines([record.stderr, record.error, record.output].filter(Boolean).join("\n")).join(" | "),
    ).text;
    return `failed: ${cleanCommand} (exitCode ${exitCode})${lines ? `: ${lines}` : ""}`;
  }
  return `passed: ${cleanCommand} (exitCode ${exitCode})`;
}

function stateBudgetMaxChars(budget) {
  if (typeof budget === "number") return Math.max(800, Math.floor(budget));
  const source = budget && typeof budget === "object" ? budget : {};
  return Math.max(
    800,
    Math.floor(
      Number(source.stateMaxChars || source.taskStateMaxChars || source.maxChars || source.structuredStateMaxChars) ||
      Number(source.inputBudget || 0) * 4 ||
      12000,
    ),
  );
}

const TASK_STATE_FIELD_WEIGHTS = {
  task_goal: 0.06,
  current_phase: 0.03,
  constraints: 0.16,
  decisions: 0.13,
  completed: 0.08,
  open_issues: 0.18,
  files_changed: 0.10,
  commands_run: 0.12,
  current_focus: 0.04,
  next_steps: 0.10,
};

function trimItemsToChars(items, maxChars, preferRecent = false) {
  const source = preferRecent ? [...items].reverse() : [...items];
  const kept = [];
  let used = 0;
  for (const raw of source) {
    const item = markdownListText(raw, Math.max(120, maxChars));
    if (!item) continue;
    const remaining = maxChars - used;
    if (remaining <= 0) break;
    const trimmed = item.length > remaining ? compact(item, Math.max(80, remaining)) : item;
    if (!trimmed) break;
    kept.push(trimmed);
    used += trimmed.length + 2;
  }
  return preferRecent ? kept.reverse() : kept;
}

function applyTaskStateBudget(state, budget) {
  const normalized = normalizeTaskState(state);
  const maxChars = stateBudgetMaxChars(budget);
  const next = defaultTaskState();
  for (const field of TASK_STATE_FIELDS) {
    const fieldBudget = Math.max(120, Math.floor(maxChars * (TASK_STATE_FIELD_WEIGHTS[field] || 0.05)));
    if (Array.isArray(normalized[field])) {
      const preferRecent = ["commands_run", "files_changed", "open_issues", "next_steps"].includes(field);
      next[field] = trimItemsToChars(normalized[field], fieldBudget, preferRecent);
    } else {
      next[field] = compact(normalized[field], fieldBudget);
    }
  }
  return normalizeTaskState(next);
}

function compressTaskContext(events, budget = {}) {
  const state = defaultTaskState();
  const seenIds = new Set();
  const commandsByKey = new Map();
  const commandAliasByCommand = new Map();
  const openIssues = new Map();
  const commandIssues = new Map();
  let latestUser = "";
  let latestAssistant = "";
  let latestFocus = "";

  const sortedEvents = (Array.isArray(events) ? events : []).filter(Boolean);
  sortedEvents.forEach((raw, index) => {
    const id = contextEventId(raw, index);
    if (seenIds.has(id)) return;
    seenIds.add(id);
    const { entry, metadata, event } = eventEnvelope(raw);
    const type = String(event.type || metadata.eventType || entry.role || "").trim();
    const role = String(entry.role || "").trim();
    const content = String(entry.content || event.content || event.message || "").trim();

    if (role === "user" || type === "user") {
      latestUser = summarizeMessageForState(content || metadata.inputEnvelope?.text || "", 320);
      if (latestUser) latestFocus = latestUser;
      for (const item of extractConstraintCandidates(content)) addStateItem(state, "constraints", item);
      for (const item of extractDecisionCandidates(content)) addStateItem(state, "decisions", item);
      for (const item of extractNextStepCandidates(content)) addStateItem(state, "next_steps", item);
      return;
    }

    if (role === "assistant" || type === "assistant_message") {
      latestAssistant = summarizeMessageForState(content || event.content || "", 320);
      if (latestAssistant) {
        addStateItem(state, "completed", latestAssistant);
        latestFocus = latestAssistant;
      }
      for (const item of extractDecisionCandidates(latestAssistant)) addStateItem(state, "decisions", item);
      for (const item of extractNextStepCandidates(latestAssistant)) addStateItem(state, "next_steps", item);
      return;
    }

    if (type === "turn_digest" || type === "turn_summary") {
      if (event.user) latestUser = summarizeMessageForState(event.user, 320);
      if (event.assistant) latestAssistant = summarizeMessageForState(event.assistant, 320);
      if (event.goal) latestUser = summarizeMessageForState(event.goal, 320);
      if (latestUser) latestFocus = latestUser;
      if (latestAssistant) addStateItem(state, "completed", latestAssistant);
      for (const item of event.constraints || []) addStateItem(state, "constraints", item);
      for (const item of event.decisions || []) addStateItem(state, "decisions", item);
      for (const item of event.next_steps || event.nextSteps || []) addStateItem(state, "next_steps", item);
      for (const item of event.files || []) addStateItem(state, "files_changed", item);
      for (const item of event.commands || []) addStateItem(state, "commands_run", item);
      for (const item of event.errors || []) addOpenIssue(openIssues, `turn:${item}`, item);
      return;
    }

    if (type === "file_changed") {
      addStateItem(state, "files_changed", event.path || event.summary);
      latestFocus = event.path || latestFocus;
      return;
    }

    if (type === "error") {
      const issue = summarizeEventError(event) || summarizeMessageForState(content, 320);
      addOpenIssue(openIssues, `error:${id}`, issue);
      latestFocus = issue || latestFocus;
      return;
    }

    if (type === "command_start") {
      const key = commandRecordKey(event, index);
      const command = event.command || metadata.command || content;
      commandsByKey.set(key, { command, status: "running", output: "", stderr: "", error: "", exitCode: null });
      if (command) commandAliasByCommand.set(commandKey(command), key);
      return;
    }

    if (type === "command_output" || type === "tool_output") {
      const payload = outputPayloadFromEvent(event);
      const payloadObject = asObject(payload);
      const command = event.command || metadata.command || payloadObject?.command || "";
      const key = command
        ? (commandAliasByCommand.get(commandKey(command)) || commandKey(command))
        : commandRecordKey(event, index);
      const record = commandsByKey.get(key) || { command, status: "running", output: "", stderr: "", error: "", exitCode: null };
      record.command = record.command || command || metadata.command || event.name || "tool";
      record.output = compactMultiline([record.output, payloadObject?.stdout || payloadObject?.output || event.content || ""].filter(Boolean).join("\n"), 900);
      record.stderr = compactMultiline([record.stderr, stderrFromPayload(payload)].filter(Boolean).join("\n"), 900);
      record.error = compactMultiline([record.error, summarizeEventError(event)].filter(Boolean).join("\n"), 900);
      const code = eventExitCode(event, payload);
      if (code != null) record.exitCode = code;
      if (record.error || (record.exitCode != null && record.exitCode !== 0)) record.status = "failed";
      commandsByKey.set(key, record);
      if (record.command) commandAliasByCommand.set(commandKey(record.command), key);
      if (record.status === "failed") {
        const issueId = `command:${commandKey(record.command)}`;
        commandIssues.set(commandKey(record.command), issueId);
        addOpenIssue(openIssues, issueId, commandSummary(record.command, record));
      }
      return;
    }

    if (type === "command_end") {
      const command = event.command || metadata.command || "";
      const key = command
        ? (commandAliasByCommand.get(commandKey(command)) || commandKey(command))
        : commandRecordKey(event, index);
      const record = commandsByKey.get(key) || { command, status: "running", output: "", stderr: "", error: "", exitCode: null };
      record.command = record.command || command || "command";
      const code = eventExitCode(event);
      record.exitCode = code == null ? (event.success === false ? 1 : 0) : code;
      record.status = record.exitCode === 0 ? "passed" : "failed";
      commandsByKey.set(key, record);
      if (record.command) commandAliasByCommand.set(commandKey(record.command), key);
      const issueId = commandIssues.get(commandKey(record.command)) || `command:${commandKey(record.command)}`;
      if (record.status === "passed") {
        removeOpenIssue(openIssues, issueId);
      } else {
        commandIssues.set(commandKey(record.command), issueId);
        addOpenIssue(openIssues, issueId, commandSummary(record.command, record));
      }
    }
  });

  for (const record of commandsByKey.values()) {
    if (!record.command || record.status === "running") continue;
    addStateItem(state, "commands_run", commandSummary(record.command, record), 120);
  }

  state.task_goal = latestUser || state.task_goal || "";
  state.current_focus = latestFocus || latestAssistant || latestUser || "";
  state.current_phase = state.open_issues.length || openIssues.size
    ? "blocked"
    : state.completed.length || state.commands_run.length || state.files_changed.length
      ? "in_progress"
      : "not_started";
  state.open_issues = uniqueList([...state.open_issues, ...openIssues.values()], 80);
  if (!state.next_steps.length && state.open_issues.length) {
    addStateItem(state, "next_steps", "Resolve the current open issue before continuing.");
  }
  return applyTaskStateBudget(state, budget);
}

function inferCommandFromTool(event) {
  const input = event.input && typeof event.input === "object" ? event.input : {};
  const command = input.command || input.cmd || input.code || input.shell_command;
  if (typeof command !== "string" || !command.trim()) return null;
  const name = String(event.name || "").toLowerCase();
  if (
    name.includes("terminal") ||
    name.includes("shell") ||
    name.includes("command") ||
    name.includes("execute")
  ) {
    return command.trim();
  }
  return null;
}

function eventToolKey(event) {
  const metadata = event && typeof event.metadata === "object" ? event.metadata : {};
  return String(metadata.toolCallId || event.id || event.name || "").trim();
}

function inferFileChangedFromTool(event) {
  const name = String(event.name || "").toLowerCase();
  if (!/(file|write|edit|patch|apply|save|modify)/.test(name)) return null;
  const data = event.output && typeof event.output === "object" ? event.output : event.input;
  const candidates = [];
  if (data && typeof data === "object") {
    for (const key of ["path", "file", "filename", "target", "output_path"]) {
      if (typeof data[key] === "string" && data[key].trim()) {
        candidates.push(data[key].trim());
      }
    }
    if (Array.isArray(data.files)) {
      for (const item of data.files) {
        if (typeof item === "string" && item.trim()) candidates.push(item.trim());
        else if (item && typeof item === "object" && typeof item.path === "string") candidates.push(item.path.trim());
      }
    }
  }
  const file = candidates.find(Boolean);
  if (!file) return null;
  return {
    type: "file_changed",
    path: file,
    changeType: name.includes("delete") ? "delete" : "modify",
    summary: `Changed by ${event.name}`,
  };
}

class RedouLocalService {
  constructor({ app, projectRoot, hermesRoot, hermesHome, log }) {
    this.app = app;
    this.projectRoot = projectRoot;
    const repoHermesRoot = path.resolve(__dirname, "..", "..", "..", "..", "..", "vendor", "hermes");
    const projectHermesRoot = path.join(projectRoot, "vendor", "hermes");
    this.hermesRoot = hermesRoot
      || (fs.existsSync(projectHermesRoot) ? projectHermesRoot : "")
      || (fs.existsSync(repoHermesRoot) ? repoHermesRoot : projectRoot);
    this.hermesHome = hermesHome;
    this.log = typeof log === "function" ? log : () => {};
    this.pythonPath = null;
    this.activeRuns = new Map();
    this.taskQueues = new Map();
    this.analysisQueue = [];
    this.activeAnalysisRuns = new Map();
    this.activeAnalysisRun = null;
    this.activeAnalysisShellChildren = new Set();
    this.shuttingDown = false;
    this.eventBus = createEventBus();
    this.db = createLocalDb({
      paths: {
        appDataRoot: () => this.appDataRoot(),
        globalDir: () => this.globalDir(),
        projectsDir: () => this.projectsDir(),
        statePath: () => this.statePath(),
        projectJsonPath: (projectId) => this.projectJsonPath(projectId),
      },
      activeRuns: this.activeRuns,
    });
    this.settingsService = new SettingsService({ repos: this.db.repositories, eventBus: this.eventBus, dashboardBridge: (action, payload) => this.runDashboardBridge(action, payload) });
    this.artifactService = new ArtifactService({
      repos: this.db.repositories,
      helpers: {
        compact,
        findProjectAndTask: (projectId, taskId) => this.findProjectAndTask(projectId, taskId),
        isoNow,
        redact,
        safeSegment,
      },
      logger: this.log,
    });
    this.logService = new LogService({
      repos: this.db.repositories,
      paths: {
        hermesHome: () => this.hermesHome,
      },
      helpers: {
        findProjectAndTask: (projectId, taskId) => this.findProjectAndTask(projectId, taskId),
        isoNow,
        normalizeUserInputStatus,
        redact,
        taskEventsPathFromContextPath,
        updateChatTask: (projectId, taskId, body, options) => this.updateChatTask(projectId, taskId, body, options),
        validMessageRoles: VALID_MESSAGE_ROLES,
      },
      logger: this.log,
    });
    this.pluginService = new PluginService({ dashboardBridge: (action, payload) => this.runDashboardBridge(action, payload) });
    this.skillService = new SkillService({
      dashboardBridge: (action, payload) => this.runDashboardBridge(action, payload),
      env: {
        appDataRoot: () => this.appDataRoot(),
        childEnv: (extra) => this.childEnv(extra),
        projectRoot: () => this.projectRoot,
        pythonPath: () => this.pythonPath,
      },
      helpers: {
        appendTaskMessage: (projectId, taskId, role, content, metadata, attachments) => this.appendTaskMessage(projectId, taskId, role, content, metadata, attachments),
        compact,
        ensureProjectHermesProfile: (project) => this.ensureProjectHermesProfile(project),
        findProjectAndTask: (projectId, taskId) => this.findProjectAndTask(projectId, taskId),
        isoNow,
        loadMessagesFile: (messagesPath, options) => this.loadMessagesFile(messagesPath, options),
        projectContextDir: (project) => this.projectContextDir(project),
        projectHermesHome: (project) => this.projectHermesHome(project),
        projectProfileHomesForBridge: () => this.projectProfileHomesForBridge(),
        projectSkillsDir: (project) => this.projectSkillsDir(project),
        readText,
        redact,
      },
      logger: this.log,
    });
    this.processManager = new ProcessManager({
      activeRuns: this.activeRuns,
      eventBus: this.eventBus,
      log: this.log,
    });
    this.schedulerService = new SchedulerService({
      dashboardBridge: (action, payload) => this.runDashboardBridge(action, payload),
      eventBus: this.eventBus,
      repos: this.db.repositories,
      processManager: this.processManager,
      contextBuilder: () => this.contextBuilder,
      logger: this.log,
    });
    this.contextBuilder = new ContextBuilder({
      host: this,
      repos: this.db.repositories,
      logger: this.log,
      options: {
        recentMessageLimit: RECENT_MESSAGE_LIMIT,
        recentMessageContentLimit: RECENT_MESSAGE_CONTENT_LIMIT,
        defaultModelContextTokens: DEFAULT_MODEL_CONTEXT_TOKENS,
        compactForceRatio: COMPACT_FORCE_RATIO,
      },
      helpers: {
        appendDedupeRules,
        applyTaskStateBudget,
        classifyContextDirective,
        compactMultiline,
        compressTaskContext,
        contextPercent,
        ContextValidator,
        createUserInputEnvelope,
        defaultTaskState,
        emptyTurnArtifacts,
        ensureEmptyFile,
        estimateContextTokens,
        extractRulesFromTaskContextText,
        getContextBudget,
        hasTaskContextShape,
        isControlEventMessage,
        isImageMime,
        isoNow,
        mergeMetadata,
        messageInputEnvelope,
        mkdirp,
        normalizeDeliveryMode,
        normalizeTaskContextText,
        parseTaskStateFromStructuredText,
        promptTextFromMessages,
        readTaskStateFile,
        readText,
        redact,
        renderTaskContextMarkdown,
        renderTaskStateStructuredMarkdown,
        scrubCurrentRequestEcho,
        SecretRedactor,
        seedAttachmentArtifacts,
        shouldCompactContext,
        splitTaskContext,
        taskEventsPathFromContextPath,
        taskStatePathFromContextPath,
        uniqueList,
        writeTaskStateFiles,
      },
    });
    this.analyticsService = new AnalyticsService({
      host: this,
      paths: {
        hermesHome: () => this.hermesHome,
      },
      analysis: {
        tasks: ANALYSIS_TASKS,
        abilityKeys: ANALYSIS_ABILITY_KEYS,
      },
    });
    this.lifecycle = new LifecycleService({
      host: this,
      eventBus: this.eventBus,
      logger: this.log,
    });
  }

  setPythonPath(pythonPath) {
    this.pythonPath = pythonPath || null;
  }

  appDataRoot() {
    return path.join(this.app.getPath("userData"), "appData");
  }

  globalDir() {
    return path.join(this.appDataRoot(), "global");
  }

  projectsDir() {
    return path.join(this.appDataRoot(), "projects");
  }

  statePath() {
    return path.join(this.appDataRoot(), "state.json");
  }

  projectDir(projectId) {
    return path.join(this.projectsDir(), safeSegment(projectId, "project"));
  }

  taskDir(projectId, taskId) {
    return path.join(this.projectDir(projectId), "tasks", safeSegment(taskId, "task"));
  }

  projectContextDir(project) {
    const workspacePath = String(project?.path || project?.workspace_path || "").trim();
    if (workspacePath) {
      return path.join(path.resolve(workspacePath), REDOU_CONTEXT_DIR);
    }
    return this.projectDir(project?.id || "project");
  }

  projectSkillsDir(project) {
    return path.join(this.projectContextDir(project), REDOU_SKILLS_DIR);
  }

  taskContextDir(project, taskId) {
    return path.join(this.projectContextDir(project), REDOU_TASKS_DIR, safeSegment(taskId, "task"));
  }

  taskQueueKey(projectId, taskId) {
    return `${projectId}\n${taskId}`;
  }

  queueDepth(projectId, taskId) {
    return (this.taskQueues.get(this.taskQueueKey(projectId, taskId)) || []).length;
  }

  activeRunForTask(projectId, taskId) {
    return this.processManager.activeRunForTask(projectId, taskId);
  }

  markAnalysisInterrupted(item, reason = "Stopped because Redou Agent is closing.") {
    return this.lifecycle.markAnalysisInterrupted(item, reason);
  }

  stopAllHermesActivity(reason = "Redou Agent is closing; stopping Hermes local runtime.") {
    return this.lifecycle.stopAllHermesActivity(reason);
  }

  emitQueueUpdate(webContents, projectId, taskId, runId, message, metadata = {}) {
    const event = {
      type: "queue_update",
      queued: this.queueDepth(projectId, taskId),
      message,
      metadata: { runId, projectId, taskId, ...metadata },
    };
    this.emitToRenderer(webContents, { runId, projectId, taskId, event });
    this.persistEvent(projectId, taskId, event);
  }

  removeAppDataDir(root, target, label) {
    const targetPath = assertChildPath(root, target, label);
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
  }

  hasActiveRunFor(projectId, taskId = null) {
    for (const run of this.activeRuns.values()) {
      if (run.projectId !== projectId) continue;
      if (!taskId || run.taskId === taskId) return true;
    }
    if (this.hasAnalysisRunForTask(projectId, taskId)) return true;
    return false;
  }

  ensureInitialized() {
    return this.lifecycle.init();
  }

  dispose(reason = "Redou Agent is closing; stopping Hermes local runtime.") {
    return this.lifecycle.dispose(reason);
  }

  healthCheck() {
    return this.lifecycle.healthCheck();
  }

  ensureGlobalFiles() {
    const root = this.globalDir();
    ensureTextFile(path.join(root, GLOBAL_USER_FILE), "# User Preferences\n\n");
    ensureTextFile(path.join(root, GLOBAL_RULES_FILE), "# Global Rules\n\n");
    return {
      userPath: path.join(root, GLOBAL_USER_FILE),
      globalRulesPath: path.join(root, GLOBAL_RULES_FILE),
    };
  }

  readAllProjects() {
    const projects = this.db.repositories.tasks
      .listProjects()
      .filter((project) => project && typeof project === "object")
      .map((project) => this.ensureProject(project));
    return projects.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  }

  getState() { return this.settingsService.getState(); }

  saveState(state) { return this.settingsService.saveState(state); }

  latestTaskForProject(project) {
    const tasks = Array.isArray(project?.tasks) ? project.tasks : [];
    return [...tasks].sort((left, right) => {
      const rightTime =
        timestampMs(right.updatedAt) ?? timestampSeconds(right.updated_at || right.created_at, 0) * 1000;
      const leftTime =
        timestampMs(left.updatedAt) ?? timestampSeconds(left.updated_at || left.created_at, 0) * 1000;
      return rightTime - leftTime;
    })[0] || null;
  }

  resolveCurrentChatSelection(projects, state = this.getState()) {
    const safeProjects = Array.isArray(projects) ? projects : [];
    const project =
      safeProjects.find((item) => item.id === state.current_project_id) ??
      safeProjects[0] ??
      null;
    if (!project) {
      return { current_project_id: "", current_task_id: "" };
    }
    const task =
      (project.tasks || []).find((item) => item.id === state.current_task_id) ??
      this.latestTaskForProject(project);
    return {
      current_project_id: project.id,
      current_task_id: task?.id || "",
    };
  }

  projectJsonPath(projectId) {
    return path.join(this.projectDir(projectId), "project.json");
  }

  readProject(projectId) {
    const project = this.db.repositories.tasks.readProject(projectId);
    return project && typeof project === "object" ? this.ensureProject(project) : null;
  }

  writeProject(project) {
    const ensured = this.normalizeProject(project);
    this.db.repositories.tasks.writeProject(ensured);
    return ensured;
  }

  normalizeProject(project) {
    const id = safeSegment(project.id || project.name, `project-${Date.now().toString(36)}`);
    const createdAt = project.createdAt || (project.created_at ? new Date(project.created_at * 1000).toISOString() : isoNow());
    const updatedAt = project.updatedAt || (project.updated_at ? new Date(project.updated_at * 1000).toISOString() : createdAt);
    const workspacePath = project.path || project.workspace_path || "";
    const appDataRoot = this.projectDir(id);
    const contextRoot = this.projectContextDir({ ...project, id, path: workspacePath, workspace_path: workspacePath });
    const hermesHomePath = contextRoot;
    const rulesPath = path.join(contextRoot, PROJECT_RULES_FILE);
    const normalized = {
      id,
      name: project.name || "Untitled Project",
      path: workspacePath,
      workspace_path: workspacePath,
      hermesProfile: project.hermesProfile || this.desiredProjectProfileName(id),
      appDataPath: appDataRoot,
      contextPath: contextRoot,
      hermesHomePath,
      skillsPath: path.join(hermesHomePath, REDOU_SKILLS_DIR),
      rulesPath,
      createdAt,
      updatedAt,
      created_at: project.created_at || Math.floor(new Date(createdAt).getTime() / 1000),
      updated_at: Math.floor(new Date(updatedAt).getTime() / 1000),
      tasks: Array.isArray(project.tasks) ? project.tasks : [],
    };
    normalized.tasks = normalized.tasks.map((task) => this.normalizeTask(normalized, task));
    return normalized;
  }

  normalizeTask(project, task) {
    const id = safeSegment(task.id || task.title, `task-${Date.now().toString(36)}`);
    const createdAt = task.createdAt || (task.created_at ? new Date(task.created_at * 1000).toISOString() : isoNow());
    const updatedAt = task.updatedAt || (task.updated_at ? new Date(task.updated_at * 1000).toISOString() : createdAt);
    // Project-bound task artifacts live beside the project in <workspace>/.redou/tasks/<task-id>.
    // For projects without a workspace path, the same layout falls back to appData/projects/<project-id>/tasks/<task-id>.
    const root = this.taskContextDir(project, id);
    const contextRoot = root;
    const hermesSessionId = compact(task.hermesSessionId || task.session_id, 160) || undefined;
    const contextPath = path.join(contextRoot, TASK_CONTEXT_FILE);
    const statePath = path.join(contextRoot, TASK_STATE_FILE);
    const eventsPath = path.join(contextRoot, TASK_EVENTS_FILE);
    return {
      id,
      projectId: project.id,
      title: task.title || "Untitled Task",
      path: task.path,
      appDataPath: root,
      rulesPath: path.join(contextRoot, TASK_RULES_FILE),
      contextPath,
      statePath,
      eventsPath,
      messagesPath: path.join(root, TASK_MESSAGES_FILE),
      uploadsPath: path.join(root, TASK_UPLOADS_DIR),
      hermesSessionId,
      session_id: hermesSessionId || null,
      model_provider: task.model_provider || "",
      model: task.model || "",
      ...(task.kind ? { kind: compact(task.kind, 80) } : {}),
      ...(task.analysisKey ? { analysisKey: compact(task.analysisKey, 180) } : {}),
      ...(task.analysisRunId ? { analysisRunId: compact(task.analysisRunId, 180) } : {}),
      ...(task.analysisProvider ? { analysisProvider: compact(task.analysisProvider, 120) } : {}),
      ...(task.analysisModel ? { analysisModel: compact(task.analysisModel, 180) } : {}),
      createdAt,
      updatedAt,
      created_at: task.created_at || Math.floor(new Date(createdAt).getTime() / 1000),
      updated_at: Math.floor(new Date(updatedAt).getTime() / 1000),
    };
  }

  ensureProject(project) {
    const normalized = this.normalizeProject(project);
    mkdirp(normalized.appDataPath);
    mkdirp(this.projectContextDir(normalized));
    mkdirp(this.projectSkillsDir(normalized));
    ensureTextFile(normalized.rulesPath, "# Project Rules\n\n");
    this.ensureProjectHermesProfile(normalized);
    normalized.tasks = normalized.tasks.map((task) => this.ensureTask(normalized, task));
    this.writeProject(normalized);
    return normalized;
  }

  ensureTask(project, task) {
    const normalized = this.normalizeTask(project, task);
    mkdirp(normalized.appDataPath);
    mkdirp(normalized.uploadsPath);
    ensureTextFile(normalized.rulesPath, "# Task Rules\n\n");
    ensureEmptyFile(normalized.eventsPath);
    if (!fs.existsSync(normalized.statePath)) {
      writeTaskStateFiles(normalized, defaultTaskState());
    }
    ensureTextFile(normalized.contextPath, renderTaskContextMarkdown(readTaskStateFile(normalized.statePath)));
    this.ensureTaskContextShape(normalized.contextPath, normalized);
    ensureEmptyFile(normalized.messagesPath);
    this.db.repositories.tasks.writeTaskMetadata(normalized);
    return normalized;
  }

  ensureTaskContextShape(taskContextPath, task = null) {
    return this.contextBuilder.ensureTaskContextShape(taskContextPath, task);
  }

  ensureTaskStateShape(task) {
    return this.contextBuilder.ensureTaskStateShape(task);
  }

  desiredProjectProfileName(projectId) {
    const base = safeSegment(projectId, "project").replace(/\./g, "-");
    const name = `redou-${base}`;
    return safeSegment(name, "redou-project").slice(0, 64).replace(/[-_]+$/g, "") || "redou-project";
  }

  projectHermesHome(project) {
    return this.projectContextDir(project);
  }

  rootHermesEnv() {
    return readDotEnv(path.join(this.hermesHome, ".env"));
  }

  childEnv(extra = {}) {
    const baseEnv = {
      ...process.env,
      // Redou's model setup writes credentials to the bundled Hermes home.
      // Prefer that explicit UI state over stale parent-process variables.
      ...this.rootHermesEnv(),
      ...extra,
    };
    const pythonPath = [this.hermesRoot, baseEnv.PYTHONPATH || ""].filter(Boolean).join(path.delimiter);
    return {
      ...baseEnv,
      PYTHONPATH: pythonPath,
      HERMES_PYTHON_SRC_ROOT: this.hermesRoot,
      HERMES_VENDOR_ROOT: this.hermesRoot,
      REDOU_PROJECT_ROOT: this.projectRoot,
    };
  }

  parseBridgeJson(stdout) {
    const text = String(stdout || "").trim();
    if (!text) throw new Error("Dashboard bridge returned no output.");
    try {
      return JSON.parse(text);
    } catch {
      const objectStart = text.lastIndexOf("\n{");
      if (objectStart >= 0) {
        return JSON.parse(text.slice(objectStart + 1));
      }
      const arrayStart = text.lastIndexOf("\n[");
      if (arrayStart >= 0) {
        return JSON.parse(text.slice(arrayStart + 1));
      }
      throw new Error(`Dashboard bridge returned invalid JSON: ${compact(text, 240)}`);
    }
  }

  runDashboardBridge(action, payload = {}) {
    if (!this.pythonPath || !fs.existsSync(this.pythonPath)) {
      throw new Error("Hermes Python runtime is unavailable.");
    }
    const bridgePath = path.join(__dirname, "..", "..", "dashboard_bridge.py");
    const result = this.processManager.spawnSync(this.pythonPath, [bridgePath, action], {
      cwd: this.projectRoot,
      env: this.childEnv({
        HERMES_HOME: this.hermesHome,
        REDOU_APP_DATA_ROOT: this.appDataRoot(),
        PYTHONUTF8: "1",
        PYTHONUNBUFFERED: "1",
      }),
      input: JSON.stringify(payload || {}),
      encoding: "utf8",
      shell: false,
      timeout: 60000,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });

    if (result.error) {
      throw result.error;
    }

    let parsed = null;
    if (result.stdout && result.stdout.trim()) {
      parsed = this.parseBridgeJson(result.stdout);
    }

    if (result.status !== 0) {
      const message =
        (parsed && parsed.error) ||
        compact(redact(result.stderr || result.stdout || `exit code ${result.status}`), 500);
      throw new Error(message);
    }

    if (parsed && parsed.ok === false && parsed.error) {
      throw new Error(parsed.error);
    }

    return parsed;
  }

  projectProfileHomesForBridge() {
    return this.readAllProjects()
      .map((project) => ({
        profile: project.hermesProfile,
        profileHome: this.projectHermesHome(project),
        projectId: project.id,
        projectName: project.name,
        workspacePath: project.path || project.workspace_path || "",
      }))
      .filter((item) => item.profile && item.profileHome);
  }

  getConfig() { return this.settingsService.getConfig(); }

  getConfigDefaults() { return this.settingsService.getConfigDefaults(); }

  getConfigSchema() { return this.settingsService.getConfigSchema(); }

  saveConfig(config) { return this.settingsService.saveConfig(config); }

  getConfigRaw() { return this.settingsService.getConfigRaw(); }

  saveConfigRaw(yamlText) { return this.settingsService.saveConfigRaw(yamlText); }

  getSkills() { return this.skillService.getSkills(); }

  toggleSkill(name, enabled, scope = null) { return this.skillService.toggleSkill(name, enabled, scope); }

  deleteSkill(skill) { return this.skillService.deleteSkill(skill); }

  mergeSkills(skills) { return this.skillService.mergeSkills(skills); }

  getToolsets() { return this.skillService.getToolsets(); }

  getModelInfo() {
    return this.runDashboardBridge("get_model_info");
  }

  getModelSetupCatalog() {
    return this.runDashboardBridge("get_model_setup_catalog");
  }

  getModelOptions() {
    return this.runDashboardBridge("get_model_options");
  }

  getAuxiliaryModels() {
    return this.runDashboardBridge("get_auxiliary_models");
  }

  setModelAssignment(body) {
    return this.runDashboardBridge("set_model_assignment", body);
  }

  refreshModelSetupModels(body) {
    return this.runDashboardBridge("refresh_model_setup_models", body);
  }

  setupMainModel(body) {
    return this.runDashboardBridge("setup_main_model", body);
  }

  getLogs(params = {}) {
    return this.logService.getLogs(params);
  }

  getCronJobs() {
    return this.schedulerService.listSchedules();
  }

  createCronJob(job) {
    return this.schedulerService.createSchedule(job);
  }

  updateCronJob(id, updates = {}) {
    return this.schedulerService.updateSchedule(id, updates);
  }

  pauseCronJob(id) {
    return this.schedulerService.pauseSchedule(id);
  }

  resumeCronJob(id) {
    return this.schedulerService.resumeSchedule(id);
  }

  triggerCronJob(id) {
    return this.schedulerService.runNow(id);
  }

  deleteCronJob(id) {
    return this.schedulerService.deleteSchedule(id);
  }

  getThemes() { return this.settingsService.getThemes(); }

  setTheme(name) { return this.settingsService.setTheme(name); }

  getLanguage() { return this.settingsService.getLanguage(); }

  setLanguage(language) { return this.settingsService.setLanguage(language); }

  getDashboardPlugins() { return this.pluginService.getDashboardPlugins(); }

  rescanDashboardPlugins() { return this.pluginService.rescanDashboardPlugins(); }

  getPluginsHub() { return this.pluginService.getPluginsHub(); }

  installAgentPlugin(body) { return this.pluginService.installAgentPlugin(body); }

  enableAgentPlugin(name) { return this.pluginService.enableAgentPlugin(name); }

  disableAgentPlugin(name) { return this.pluginService.disableAgentPlugin(name); }

  updateAgentPlugin(name) { return this.pluginService.updateAgentPlugin(name); }

  removeAgentPlugin(name) { return this.pluginService.removeAgentPlugin(name); }

  savePluginProviders(body) { return this.pluginService.savePluginProviders(body); }

  setPluginVisibility(name, hidden) { return this.pluginService.setPluginVisibility(name, hidden); }

  getModelsAnalytics(days) {
    return this.analyticsService.getModelsAnalytics(days);
  }

  activeAnalysisItems() {
    return this.analyticsService.activeAnalysisItems();
  }

  primaryActiveAnalysisRun() {
    return this.analyticsService.primaryActiveAnalysisRun();
  }

  getStatus() {
    return this.analyticsService.getStatus();
  }

  desktopSessionId(project, task) {
    return this.analyticsService.desktopSessionId(project, task);
  }

  findTaskByDesktopSessionId(sessionId) {
    return this.analyticsService.findTaskByDesktopSessionId(sessionId);
  }

  activeRunForTaskSnapshot(projectId, taskId) {
    return this.analyticsService.activeRunForTaskSnapshot(projectId, taskId);
  }

  analysisRunForTaskSnapshot(projectId, taskId) {
    return this.analyticsService.analysisRunForTaskSnapshot(projectId, taskId);
  }

  hasAnalysisRunForTask(projectId, taskId = null) {
    return this.analyticsService.hasAnalysisRunForTask(projectId, taskId);
  }

  taskRuntimeSnapshot(projectId, taskId) {
    return this.analyticsService.taskRuntimeSnapshot(projectId, taskId);
  }

  taskCompletionStatus(project, task, runtime) {
    return this.analyticsService.taskCompletionStatus(project, task, runtime);
  }

  decorateTaskRuntime(project, task) {
    return this.analyticsService.decorateTaskRuntime(project, task);
  }

  decorateProjectRuntime(project) {
    return this.analyticsService.decorateProjectRuntime(project);
  }

  activeRunUsage(run) {
    return this.analyticsService.activeRunUsage(run);
  }

  updateActiveRunFromEvent(run, event) {
    if (!run || !event || typeof event !== "object") return;
    run.lastActiveAtMs = Date.now();
    const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
    const usage = usageFromMetadata(metadata);
    if (usage.inputTokens) run.inputTokens = usage.inputTokens;
    if (usage.outputTokens) run.outputTokens = usage.outputTokens;
    if (usage.cacheReadTokens) run.cacheReadTokens = usage.cacheReadTokens;
    if (usage.cacheWriteTokens) run.cacheWriteTokens = usage.cacheWriteTokens;
    if (usage.reasoningTokens) run.reasoningTokens = usage.reasoningTokens;
    if (usage.apiCalls) run.apiCalls = usage.apiCalls;
    if (usage.estimatedCostUsd) run.estimatedCostUsd = usage.estimatedCostUsd;

    if (event.type === "assistant_delta" && event.content) {
      run.assistantDeltaText = `${run.assistantDeltaText || ""}${event.content}`;
      run.outputEstimateTokens = estimateContextTokens(run.assistantDeltaText);
    } else if (event.type === "assistant_message" && event.content) {
      run.outputEstimateTokens = estimateContextTokens(event.content);
    } else if (event.type === "run_stage") {
      run.currentStage = {
        stage: event.stage || "",
        label: event.label || "",
        status: event.status || "",
        source: event.source || "hermes",
        timestamp: event.timestamp || event.metadata?.timestamp || isoNow(),
        details: event.details || "",
      };
    }
  }

  usageForMessages(messages, activeRun = null) {
    return this.analyticsService.usageForMessages(messages, activeRun);
  }

  toolCountForMessages(messages) {
    return this.analyticsService.toolCountForMessages(messages);
  }

  latestContent(messages, roles) {
    return this.analyticsService.latestContent(messages, roles);
  }

  sessionRecordForTask(project, task) {
    return this.analyticsService.sessionRecordForTask(project, task);
  }

  desktopSessionRecords() {
    return this.analyticsService.desktopSessionRecords();
  }

  getSessions(limit = 20, offset = 0) {
    return this.analyticsService.getSessions(limit, offset);
  }

  dashboardMessageFromTaskMessage(message) {
    return this.analyticsService.dashboardMessageFromTaskMessage(message);
  }

  getSessionMessages(sessionId) {
    return this.analyticsService.getSessionMessages(sessionId);
  }

  getUsageAnalytics(days = 7) {
    return this.analyticsService.getUsageAnalytics(days);
  }

  analysisDir() {
    return path.join(this.appDataRoot(), "analysis");
  }

  analysisStorePath() {
    return path.join(this.analysisDir(), ANALYSIS_RESULTS_FILE);
  }

  analysisWorkspaceRoot() {
    return path.join(this.analysisDir(), "workspaces");
  }

  ensureAnalysisWorkspaceProject() {
    const existing = this.readProject(ANALYSIS_WORKSPACE_PROJECT_ID);
    if (existing) return existing;
    const createdAt = isoNow();
    return this.ensureProject({
      id: ANALYSIS_WORKSPACE_PROJECT_ID,
      name: ANALYSIS_WORKSPACE_PROJECT_NAME,
      path: "",
      workspace_path: "",
      createdAt,
      updatedAt: createdAt,
      tasks: [],
    });
  }

  createAnalysisWorkspaceTask(model, runId, maxIterations) {
    const project = this.ensureAnalysisWorkspaceProject();
    const createdAt = isoNow();
    const provider = String(model.provider || "").trim();
    const modelName = String(model.model || "").trim();
    const key = String(model.key || modelBenchmarkKey(provider, modelName));
    const title = `Benchmark: ${provider || "auto"} / ${modelName || "default"}`;
    const id = safeSegment(`benchmark-${key}-${runId}`, `benchmark-${Date.now().toString(36)}`);
    const existing = (project.tasks || []).find((task) => task.id === id);
    const task = existing || this.ensureTask(project, {
      id,
      projectId: project.id,
      title,
      createdAt,
      updatedAt: createdAt,
      kind: ANALYSIS_WORKSPACE_TASK_KIND,
      analysisKey: key,
      analysisRunId: runId,
      analysisProvider: provider,
      analysisModel: modelName,
      model_provider: provider,
      model: modelName,
    });
    const saved = this.writeProject({
      ...project,
      updatedAt: createdAt,
      tasks: existing ? project.tasks : [...project.tasks, task],
    });
    const savedTask = saved.tasks.find((item) => item.id === id) || task;
    if (!existing) {
      this.appendTaskMessage(
        saved.id,
        savedTask.id,
        "user",
        `Run model capability benchmark for ${provider || "auto"} / ${modelName || "default"}.`,
        {
          analysisRunId: runId,
          analysisKey: key,
          modelProvider: provider,
          model: modelName,
          maxIterations,
        },
      );
    }
    return { project: saved, task: savedTask };
  }

  analysisWorkspaceEventMetadata(item, extra = {}) {
    return {
      runId: item.runId,
      analysisRunId: item.runId,
      analysisKey: item.key,
      modelProvider: item.provider,
      model: item.model,
      hermesProfile: "analysis",
      ...extra,
    };
  }

  persistAnalysisWorkspaceEvent(item, event) {
    if (!item?.projectId || !item?.taskId) return null;
    item.analysisLastActiveAtMs = Date.now();
    const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
    const payload = {
      ...event,
      metadata: this.analysisWorkspaceEventMetadata(item, metadata),
    };
    try {
      return this.persistEvent(item.projectId, item.taskId, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Could not persist analysis workspace event runId=${item.runId || ""}: ${message}`);
      return null;
    }
  }

  syncAnalysisWorkspaceQueued(item) {
    this.persistAnalysisWorkspaceEvent(item, {
      type: "queue_update",
      queued: 1,
      message: "Queued for model capability analysis.",
      metadata: { queuedAt: item.queuedAt },
    });
  }

  syncAnalysisWorkspaceTaskPlan(item) {
    ANALYSIS_TASKS.forEach((task, index) => {
      this.syncAnalysisWorkspaceTaskStage(item, task, "pending", "Waiting", {
        planIndex: index + 1,
        planTotal: ANALYSIS_TASKS.length,
      });
    });
  }

  syncAnalysisWorkspaceStarted(item, workspacePath, analysisEnvName) {
    this.persistAnalysisWorkspaceEvent(item, {
      type: "raw_log",
      content: "Model capability benchmark started.",
      metadata: {
        workspacePath,
        analysisEnvName,
      },
    });
  }

  syncAnalysisWorkspaceTaskStage(item, task, status, summary = "", extra = {}) {
    const cleanStatus = String(status || "running").toLowerCase();
    const stageStatus =
      cleanStatus === "completed" || cleanStatus === "done"
        ? "completed"
        : cleanStatus === "failed" || cleanStatus === "error"
          ? "failed"
          : cleanStatus === "interrupted" || cleanStatus === "cancelled"
            ? "failed"
            : cleanStatus === "pending"
              ? "pending"
              : "running";
    this.persistAnalysisWorkspaceEvent(item, {
      type: "run_stage",
      stage: task.id,
      label: `${task.id}: ${task.title}`,
      status: stageStatus,
      details: compact(summary || stageStatus, 600),
      metadata: {
        analysisTaskId: task.id,
        analysisTaskTitle: task.title,
        capability: task.capability,
        score: extra.score,
        durationMs: extra.durationMs,
        planIndex: extra.planIndex,
        planTotal: extra.planTotal,
      },
    });
  }

  syncAnalysisWorkspaceFinished(item, status, summary, result = null) {
    const cleanStatus = String(status || "").toLowerCase();
    const completed = cleanStatus === "completed";
    const interrupted = cleanStatus === "interrupted";
    if (!completed) {
      this.persistAnalysisWorkspaceEvent(item, {
        type: "error",
        message: summary || (interrupted ? "Benchmark interrupted." : "Benchmark failed."),
        metadata: { status: cleanStatus || "failed" },
      });
    } else if (summary) {
      this.persistAnalysisWorkspaceEvent(item, {
        type: "raw_log",
        content: summary,
        metadata: { status: cleanStatus },
      });
    }
    const totals = result?.totals || {};
    this.persistAnalysisWorkspaceEvent(item, {
      type: "done",
      metadata: {
        completed,
        interrupted,
        status: cleanStatus || (completed ? "completed" : "failed"),
        exitCode: completed ? 0 : 1,
        summary: summary || "",
        durationMs: toInt(totals.durationMs),
        inputTokens: toInt(totals.inputTokens),
        outputTokens: toInt(totals.outputTokens),
        cacheReadTokens: toInt(totals.cacheReadTokens),
        reasoningTokens: toInt(totals.reasoningTokens),
        apiCalls: toInt(totals.apiCalls),
        estimatedCostUsd: Number(totals.estimatedCostUsd || 0),
      },
    });
  }

  readAnalysisStore() {
    const store = readJson(this.analysisStorePath(), null);
    const fallback = { version: 1, updatedAt: isoNow(), results: [] };
    if (!store || typeof store !== "object") return fallback;
    const results = Array.isArray(store.results) ? store.results : [];
    return {
      version: 1,
      updatedAt: store.updatedAt || isoNow(),
      results: results.map((result) => this.normalizeAnalysisResult(result)).filter(Boolean),
    };
  }

  writeAnalysisStore(store) {
    const normalized = {
      version: 1,
      updatedAt: isoNow(),
      results: Array.isArray(store?.results)
        ? store.results.map((result) => this.normalizeAnalysisResult(result)).filter(Boolean)
        : [],
    };
    writeJsonAtomic(this.analysisStorePath(), normalized);
    return normalized;
  }

  normalizeAnalysisResult(result) {
    if (!result || typeof result !== "object") return null;
    const provider = String(result.provider || "").trim();
    const model = String(result.model || "").trim();
    const key = String(result.key || modelBenchmarkKey(provider, model));
    const modelRunName = analysisModelRunName(provider, model, key);
    const workspacePath = String(result.workspacePath || "");
    const tasks = Array.isArray(result.tasks) ? result.tasks : [];
    const normalizedTasks = tasks.map((task) => {
      const taskId = String(task.id || "");
      const gradeLogText = analysisTaskGradeLogText(workspacePath, taskId);
      const gradeLogSections = analysisTaskSectionsFromGradeLog(taskId, gradeLogText);
      const migratedSummary = analysisLatestMigratedTaskSummary(workspacePath, modelRunName, taskId);
      const migratedSections = analysisMigratedTaskSectionsFromSummary(taskId, workspacePath, modelRunName, migratedSummary);
      const migratedScore = migratedSummary ? clampScore(analysisTestPassRatio(migratedSummary) * 100) : null;
      const rawSections = Array.isArray(task.sections)
        ? task.sections.map((section) => ({
            id: String(section.id || ""),
            label: String(section.label || ""),
            score: clampScore(section.score),
            evidence: String(section.evidence || ""),
          }))
        : [];
      const score = migratedScore ?? analysisFinalScoreFromLog(gradeLogText) ?? clampScore(task.score);
      const sections = migratedSections.length > 0
        ? migratedSections
        : gradeLogSections.length > 0
          ? gradeLogSections
          : rawSections;
      return {
        id: taskId,
        title: String(task.title || ""),
        capability: String(task.capability || ""),
        status: normalizeAnalysisTaskStatus(task, { score, sections, gradeLogText, migratedSummary }),
        startedAt: task.startedAt || null,
        completedAt: task.completedAt || null,
        durationMs: toInt(task.durationMs),
        inputTokens: toInt(task.inputTokens),
        outputTokens: toInt(task.outputTokens),
        cacheReadTokens: toInt(task.cacheReadTokens),
        reasoningTokens: toInt(task.reasoningTokens),
        apiCalls: toInt(task.apiCalls),
        estimatedCostUsd: Number(task.estimatedCostUsd || 0),
        score,
        sections,
        error: task.error ? String(task.error) : null,
        summary: String(task.summary || ""),
        artifacts: analysisTaskDisplayArtifacts(workspacePath, taskId),
      };
    });
    const derivedAbilityScores = normalizedTasks.length > 0
      ? this.analysisAbilityScores(normalizedTasks)
      : null;
    return {
      id: String(result.id || key),
      key,
      runId: String(result.runId || ""),
      provider,
      model,
      agent: String(result.agent || "Hermes Agent"),
      status: String(result.status || "completed"),
      startedAt: result.startedAt || null,
      completedAt: result.completedAt || null,
      updatedAt: result.updatedAt || result.completedAt || result.startedAt || isoNow(),
      workspacePath,
      summary: String(result.summary || ""),
      totals: {
        durationMs: toInt(result.totals?.durationMs),
        inputTokens: toInt(result.totals?.inputTokens),
        outputTokens: toInt(result.totals?.outputTokens),
        cacheReadTokens: toInt(result.totals?.cacheReadTokens),
        reasoningTokens: toInt(result.totals?.reasoningTokens),
        apiCalls: toInt(result.totals?.apiCalls),
        estimatedCostUsd: Number(result.totals?.estimatedCostUsd || 0),
      },
      abilityScores: this.normalizeAnalysisAbilityScores(result.abilityScores, derivedAbilityScores),
      tasks: normalizedTasks,
    };
  }

  normalizeAnalysisAbilityScores(rawScores, derivedScores = null) {
    return this.analyticsService.normalizeAnalysisAbilityScores(rawScores, derivedScores);
  }

  withLiveAnalysisTiming(result, nowMs = Date.now()) {
    return this.analyticsService.withLiveAnalysisTiming(result, nowMs);
  }

  getAnalysisBenchmarks() {
    const store = this.readAnalysisStore();
    const snapshot = this.analyticsService.buildAnalysisBenchmarksSnapshot(store, {
      activeAnalysisRuns: this.activeAnalysisItems(),
      analysisQueue: this.analysisQueue,
    });
    if (snapshot.changed) {
      this.writeAnalysisStore({ ...store, results: snapshot.results });
    }
    return snapshot.response;
  }

  normalizeAnalysisModelInput(input) {
    const items = Array.isArray(input?.models) ? input.models : [];
    const normalized = [];
    const seen = new Set();
    for (const item of items) {
      const provider = String(item?.provider || "").trim();
      const model = String(item?.model || "").trim();
      if (!provider && !model) continue;
      const key = modelBenchmarkKey(provider, model);
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push({ provider, model, key });
    }
    return normalized;
  }

  analysisDefaultMaxIterations() {
    return readRootAgentMaxTurns(this.hermesHome) || ANALYSIS_DEFAULT_MAX_ITERATIONS;
  }

  startAnalysisBenchmarks(webContents, input = {}) {
    if (this.shuttingDown) {
      return { ok: false, runIds: [], queued: 0, skipped: 0, warning: "Redou Agent is closing." };
    }
    const models = this.normalizeAnalysisModelInput(input);
    if (models.length === 0) {
      throw new Error("Select at least one configured model before starting analysis.");
    }
    const busyKeys = new Set([
      ...this.activeAnalysisItems().map((item) => item.key),
      ...this.analysisQueue.map((item) => item.key),
    ]);
    const maxIterations = normalizeAnalysisMaxIterations(input.maxIterations, this.analysisDefaultMaxIterations());
    const store = this.readAnalysisStore();
    const results = store.results.filter(
      (result) => !models.some((model) => model.key === result.key && !busyKeys.has(model.key)),
    );
    const runIds = [];
    for (const model of models) {
      if (busyKeys.has(model.key)) {
        continue;
      }
      const runId = crypto.randomUUID();
      runIds.push(runId);
      const workspaceTask = this.createAnalysisWorkspaceTask(model, runId, maxIterations);
      const result = this.normalizeAnalysisResult({
        id: model.key,
        key: model.key,
        runId,
        provider: model.provider,
        model: model.model,
        agent: "Hermes Agent",
        status: "queued",
        startedAt: isoNow(),
        updatedAt: isoNow(),
        summary: "Queued for model capability analysis.",
        tasks: ANALYSIS_TASKS.map((task) => ({
          ...task,
          status: "pending",
          score: 0,
          sections: [],
        })),
      });
      results.push(result);
      this.analysisQueue.push({
        ...model,
        runId,
        maxIterations,
        webContents,
        projectId: workspaceTask.project.id,
        taskId: workspaceTask.task.id,
        queuedAt: isoNow(),
      });
      const queuedItem = this.analysisQueue.at(-1);
      this.syncAnalysisWorkspaceTaskPlan(queuedItem);
      this.syncAnalysisWorkspaceQueued(queuedItem);
    }
    this.writeAnalysisStore({ ...store, results });
    this.emitAnalysisEvent(webContents, { type: "changed" });
    setImmediate(() => this.startAnalysisQueue());
    return {
      ok: true,
      runIds,
      queued: runIds.length,
      skipped: models.length - runIds.length,
    };
  }

  emitAnalysisEvent(webContents, payload = {}) {
    if (!webContents || webContents.isDestroyed()) return;
    webContents.send("redou:analysis-event", {
      ...payload,
      updatedAt: isoNow(),
    });
  }

  updateAnalysisResult(key, updater) {
    const store = this.readAnalysisStore();
    const index = store.results.findIndex((result) => result.key === key);
    if (index < 0) return null;
    const next = this.normalizeAnalysisResult(updater(store.results[index]));
    store.results[index] = next;
    this.writeAnalysisStore(store);
    return next;
  }

  updateAnalysisTask(key, taskId, updater) {
    return this.updateAnalysisResult(key, (result) => ({
      ...result,
      updatedAt: isoNow(),
      tasks: result.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              ...updater(task),
            }
          : task,
      ),
    }));
  }

  startAnalysisQueue() {
    if (this.shuttingDown) return;
    while (this.analysisQueue.length > 0) {
      const item = this.analysisQueue.shift();
      item.analysisStartedAtMs = Date.now();
      item.analysisLastActiveAtMs = item.analysisStartedAtMs;
      this.activeAnalysisRuns.set(item.runId, item);
      if (!this.activeAnalysisRun) {
        this.activeAnalysisRun = item;
      }
      Promise.resolve()
        .then(() => this.runAnalysisModelBenchmark(item))
        .catch((error) => {
          if (this.shuttingDown || item.stopRequested) {
            this.markAnalysisInterrupted(item, "Stopped because Redou Agent is closing.");
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          const failedResult = this.updateAnalysisResult(item.key, (result) => ({
            ...result,
            status: "failed",
            completedAt: isoNow(),
            updatedAt: isoNow(),
            summary: message,
          }));
          this.syncAnalysisWorkspaceFinished(item, "failed", message, failedResult);
          this.emitAnalysisEvent(item.webContents, { type: "changed", runId: item.runId, error: message });
        })
        .finally(async () => {
          try {
            await this.cleanupAnalysisDockerEnvironment(
              item,
              item.workspacePath || path.join(this.analysisWorkspaceRoot(), safeSegment(item.key, "model")),
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log(`Analysis cleanup failed for ${item.key}: ${message}`);
          } finally {
            this.activeAnalysisRuns.delete(item.runId);
            if (this.activeAnalysisRun?.runId === item.runId) {
              this.activeAnalysisRun = null;
              this.activeAnalysisRun = this.primaryActiveAnalysisRun();
            }
            this.emitAnalysisEvent(item.webContents, { type: "changed", runId: item.runId });
            if (!this.shuttingDown) {
              setImmediate(() => this.startAnalysisQueue());
            }
          }
        });
    }
  }

  nextAnalysisWorkspacePath(key, runId = "") {
    const root = this.analysisWorkspaceRoot();
    const base = safeSegment(key, "model");
    const run = safeSegment(runId, "run").slice(0, 32) || "run";
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const suffix = attempt === 0 ? run : `${run}-${attempt}`;
      const candidate = assertChildPath(root, path.join(root, `${base}-${suffix}`), "analysis workspace");
      if (!fs.existsSync(candidate)) return candidate;
    }
    const candidate = assertChildPath(
      root,
      path.join(root, `${base}-${run}-${crypto.randomBytes(4).toString("hex")}`),
      "analysis workspace",
    );
    return candidate;
  }

  prepareAnalysisWorkspace(key, runId = "") {
    const root = this.analysisWorkspaceRoot();
    mkdirp(root);
    const workspace = path.join(root, safeSegment(key, "model"));
    if (fs.existsSync(workspace)) {
      const resolved = assertChildPath(root, workspace, "analysis workspace");
      try {
        removeDirectoryWithRetries(resolved);
      } catch (error) {
        if (!isTransientFileError(error)) {
          throw error;
        }
        const fallback = this.nextAnalysisWorkspacePath(key, runId);
        this.log(
          `Analysis workspace is busy (${error.code || error.message}); using a fresh workspace: ${fallback}`,
        );
        return this.prepareAnalysisWorkspaceAt(fallback);
      }
    }
    return this.prepareAnalysisWorkspaceAt(workspace);
  }

  prepareAnalysisWorkspaceAt(workspace) {
    mkdirp(workspace);
    mkdirp(path.join(workspace, "projects"));
    mkdirp(path.join(workspace, "reports"));
    mkdirp(path.join(workspace, "logs"));
    mkdirp(analysisDisplayResultsDir(workspace));
    const promptDir = path.join(workspace, REDOU_CONTEXT_DIR, REDOU_ANALYSIS_DIR, "prompts");
    mkdirp(promptDir);
    for (const task of ANALYSIS_TASKS) {
      const source = analysisTaskPromptPath(this.hermesRoot, task);
      if (fs.existsSync(source)) {
        fs.copyFileSync(source, path.join(promptDir, path.basename(task.file)));
      }
    }
    const analyzeRoot = path.join(this.hermesRoot, "analyze");
    const supportFiles = [
      "task_project_tasks.py",
      "task_project_prepare.py",
      "task_project_judge.py",
      "task_project_evaluate.py",
      "task_project_requirements.txt",
      "task1_grade_all.sh",
      "task2_grade_all.sh",
      "task2_phase0_env_check.sh",
      "task2_phase1_project_scaffold_check.sh",
      "task2_phase2_data_logic_check.sh",
      "task2_phase3_ui_build_check.sh",
      "task2_phase4_runtime_check.sh",
      "task2_phase5_report_check.sh",
      "task3_grade_all.sh",
      "task3_phase0_env_check.sh",
      "task3_phase1_scaffold_check.sh",
      "task3_phase2_initial_failure_check.sh",
      "task3_phase3_final_pass_check.sh",
      "task3_phase4_behavior_check.sh",
      "task3_phase5_report_check.sh",
      "task4_grade_all.sh",
      "task4_phase0_env_check.sh",
      "task4_phase1_sources_notes_check.sh",
      "task4_phase2_report_comparison_check.sh",
      "task4_phase3_product_design_check.sh",
      "task4_phase4_citation_quality_check.sh",
      "task4_phase5_delivery_check.sh",
      "task5.yaml",
      "task6.yaml",
      "task7.yaml",
      "task8.yaml",
      "task9.yaml",
      "task5_grade_all.sh",
      "task6_grade_all.sh",
      "task7_grade_all.sh",
      "task8_grade_all.sh",
      "task9_grade_all.sh",
    ];
    for (const file of supportFiles) {
      const source = path.join(analyzeRoot, file);
      if (fs.existsSync(source)) {
        const target = path.join(workspace, file);
        fs.copyFileSync(source, target);
        if (/\.sh$/i.test(file)) {
          fs.writeFileSync(target, normalizeAnalysisWorkspaceScript(readText(target)), "utf8");
        }
      }
    }
    for (const dir of [
      "task5_source",
      "task5_tests",
      "task6_source",
      "task6_tests",
      "task7_source",
      "task7_tests",
      "task8_source",
      "task8_tests",
      "task9_source",
      "task9_tests",
    ]) {
      copyDirectoryRecursive(path.join(analyzeRoot, dir), path.join(workspace, dir));
    }
    return workspace;
  }

  analysisPromptForTask(task, provider, model, context = {}) {
    const promptPath = analysisTaskPromptPath(this.hermesRoot, task);
    let taskPrompt = readText(promptPath).trim();
    if (!taskPrompt) {
      throw new Error(`Analysis prompt not found: ${promptPath}`);
    }
    const analysisEnvName =
      context.analysisEnvName || analysisDockerEnvironmentName(provider, model, context.key);
    const modelRunName = context.modelRunName || analysisModelRunName(provider, model, "");
    const dockerWorkspace = ANALYSIS_DOCKER_WORKSPACE;
    const benchmarkRoot = dockerWorkspace;
    const taskNumber = String(task.id || "").replace(/^task/, "");
    const taskFolder = `task${taskNumber}`;
    const runRoot = `${benchmarkRoot}/model_runs/${modelRunName}`;
    const replacements = {
      "@@MODEL_NAME@@": modelRunName,
      "@@DOCKER_SERVICE@@": analysisEnvName,
      "@@DOCKER_WORKSPACE@@": dockerWorkspace,
      "@@BENCHMARK_ROOT@@": benchmarkRoot,
      "@@RUN_ROOT@@": runRoot,
      "@@RUN_DIR@@": `${runRoot}/${taskFolder}`,
      "@@RESULTS_DIR@@": `${runRoot}/results`,
      "@@TASK_NUMBER@@": taskNumber,
      "@@TASK_FOLDER@@": taskFolder,
    };
    for (const [token, value] of Object.entries(replacements)) {
      taskPrompt = taskPrompt.split(token).join(value);
    }
    taskPrompt = taskPrompt.replace(/<MODEL_NAME>/g, modelRunName);
    taskPrompt = replaceAnalysisDockerEnvironment(taskPrompt, analysisEnvName);
    return [
      "You are running a Redou Agent model capability benchmark.",
      `Benchmark task: ${task.id} - ${task.title}.`,
      `Model under test: ${provider || "auto"} / ${model || "default"}.`,
      "Work only in the current working directory. Complete the benchmark task as written.",
      "Use real tool calls and real command output. Do not invent verification results.",
      "At the end, briefly report what was completed, where artifacts were saved, and any failures.",
      `Docker test environment for this model: ${analysisEnvName}.`,
      `Use ${analysisEnvName} wherever the task refers to the Docker Compose service, Docker container, or docker compose exec target.`,
      "Treat /workspace as the only benchmark workspace path inside Docker. All task paths such as /workspace/projects, /workspace/reports, /workspace/logs, and /workspace/model_runs refer to that Docker path.",
      "Do not write benchmark artifacts to a host-side absolute /workspace path or to a nested ./workspace directory. If you need to create or edit an absolute /workspace path, do it through Docker, for example docker compose exec -T " +
        `${analysisEnvName} bash -lc 'mkdir -p /workspace/projects /workspace/reports /workspace/logs'.`,
      "The benchmark run root is mounted into Docker as /workspace, so files created there must persist back into the Redou analysis workspace.",
      "",
      taskPrompt,
    ].join("\n");
  }

  runAnalysisShellCommand({ command, args = [], cwd, timeoutMs = 600000, env = {} }) {
    return this.processManager.runBufferedCommand({
      command,
      args,
      cwd,
      env: this.childEnv(env),
      timeoutMs,
      shutdown: this.shuttingDown,
      shutdownResult: { code: null, signal: "shutdown", error: "Redou Agent is closing.", output: "" },
      trackingSet: this.activeAnalysisShellChildren,
    });
  }

  backupAnalysisEnvironmentFile(workspacePath, fileName) {
    const source = path.join(workspacePath, fileName);
    if (!fs.existsSync(source)) return;
    const backupPath = path.join(
      workspacePath,
      REDOU_CONTEXT_DIR,
      REDOU_ANALYSIS_DIR,
      "scheduler",
      `${fileName}.before-scheduler`,
    );
    if (!fs.existsSync(backupPath)) {
      copyFileAtomic(source, backupPath);
    }
  }

  writeAnalysisFallbackDockerEnvironment(workspacePath, envName, reason = "") {
    mkdirp(workspacePath);
    this.backupAnalysisEnvironmentFile(workspacePath, "Dockerfile");
    this.backupAnalysisEnvironmentFile(workspacePath, "docker-compose.yml");
    const dockerfile = [
      "FROM node:20-bookworm",
      "RUN apt-get update \\",
      "  && apt-get install -y --no-install-recommends \\",
      "    bash ca-certificates curl git python3 python3-pip python3-venv wget \\",
      "  && rm -rf /var/lib/apt/lists/*",
      "WORKDIR /workspace",
      'CMD ["bash", "-lc", "tail -f /dev/null"]',
      "",
    ].join("\n");
    const compose = [
      "services:",
      `  ${envName}:`,
      "    build:",
      "      context: .",
      `    container_name: ${yamlString(envName)}`,
      `    working_dir: ${yamlString(ANALYSIS_DOCKER_WORKSPACE)}`,
      "    volumes:",
      `      - .:${ANALYSIS_DOCKER_WORKSPACE}`,
      '    command: bash -lc "tail -f /dev/null"',
      "",
    ].join("\n");
    mkdirp(path.join(workspacePath, REDOU_CONTEXT_DIR, REDOU_ANALYSIS_DIR, "scheduler"));
    fs.writeFileSync(path.join(workspacePath, "Dockerfile"), dockerfile, "utf8");
    fs.writeFileSync(path.join(workspacePath, "docker-compose.yml"), compose, "utf8");
    fs.writeFileSync(
      path.join(workspacePath, REDOU_CONTEXT_DIR, REDOU_ANALYSIS_DIR, "scheduler", "docker-fallback-reason.txt"),
      `${reason || "Scheduler-created Docker environment."}\n`,
      "utf8",
    );
    return { status: "created", envName, reason };
  }

  async analysisDockerContainerId(envName, workspacePath) {
    if (!envName || !workspacePath || this.shuttingDown) {
      return { status: "skipped", containerId: "", output: "" };
    }
    const composeResult = await this.runAnalysisShellCommand({
      command: "docker",
      args: ["compose", "ps", "-q", envName],
      cwd: workspacePath,
      timeoutMs: 120000,
    });
    const composeId = String(composeResult.stdout || composeResult.output || "").trim().split(/\r?\n/).find(Boolean) || "";
    if (composeResult.code === 0 && composeId) {
      return { status: "completed", containerId: composeId, output: composeResult.output || composeId };
    }
    const inspectResult = await this.runAnalysisShellCommand({
      command: "docker",
      args: ["inspect", "-f", "{{.Id}}", envName],
      cwd: workspacePath,
      timeoutMs: 120000,
    });
    const inspectedId = String(inspectResult.stdout || inspectResult.output || "").trim().split(/\r?\n/).find(Boolean) || "";
    if (inspectResult.code === 0 && inspectedId) {
      return { status: "completed", containerId: inspectedId, output: inspectResult.output || inspectedId };
    }
    return {
      status: "failed",
      containerId: "",
      output: compactMultiline(`${composeResult.output || ""}\n${inspectResult.output || inspectResult.error || ""}`, 1200),
    };
  }

  async copyAnalysisBenchmarkSupportIntoDocker(workspacePath, envName) {
    const container = await this.analysisDockerContainerId(envName, workspacePath);
    if (container.status !== "completed" || !container.containerId) {
      return { status: "skipped", envName, reason: "container not available", output: container.output || "" };
    }

    const supportEntries = [
      "task_project_tasks.py",
      "task_project_prepare.py",
      "task_project_judge.py",
      "task_project_evaluate.py",
      "task_project_requirements.txt",
      "task1_grade_all.sh",
      "task2_grade_all.sh",
      "task2_phase0_env_check.sh",
      "task2_phase1_project_scaffold_check.sh",
      "task2_phase2_data_logic_check.sh",
      "task2_phase3_ui_build_check.sh",
      "task2_phase4_runtime_check.sh",
      "task2_phase5_report_check.sh",
      "task3_grade_all.sh",
      "task3_phase0_env_check.sh",
      "task3_phase1_scaffold_check.sh",
      "task3_phase2_initial_failure_check.sh",
      "task3_phase3_final_pass_check.sh",
      "task3_phase4_behavior_check.sh",
      "task3_phase5_report_check.sh",
      "task4_grade_all.sh",
      "task4_phase0_env_check.sh",
      "task4_phase1_sources_notes_check.sh",
      "task4_phase2_report_comparison_check.sh",
      "task4_phase3_product_design_check.sh",
      "task4_phase4_citation_quality_check.sh",
      "task4_phase5_delivery_check.sh",
      "task5.yaml",
      "task6.yaml",
      "task7.yaml",
      "task8.yaml",
      "task9.yaml",
      "task5_grade_all.sh",
      "task6_grade_all.sh",
      "task7_grade_all.sh",
      "task8_grade_all.sh",
      "task9_grade_all.sh",
      "task5_source",
      "task5_tests",
      "task6_source",
      "task6_tests",
      "task7_source",
      "task7_tests",
      "task8_source",
      "task8_tests",
      "task9_source",
      "task9_tests",
    ];
    const copied = [];
    const missing = [];
    for (const entry of supportEntries) {
      const source = path.join(workspacePath, entry);
      if (!fs.existsSync(source)) continue;
      const containerPath = `${ANALYSIS_DOCKER_WORKSPACE}/${entry.replace(/\\/g, "/")}`;
      const existsResult = await this.runAnalysisShellCommand({
        command: "docker",
        args: ["exec", container.containerId, "bash", "-lc", `test -e ${shellQuoteSingle(containerPath)}`],
        cwd: workspacePath,
        timeoutMs: 120000,
      });
      if (existsResult.code === 0) continue;
      const stat = fs.statSync(source);
      if (stat.isDirectory()) {
        await this.runAnalysisShellCommand({
          command: "docker",
          args: ["exec", container.containerId, "bash", "-lc", `mkdir -p ${shellQuoteSingle(containerPath)}`],
          cwd: workspacePath,
          timeoutMs: 120000,
        });
      }
      const cpSource = stat.isDirectory() ? path.join(source, ".") : source;
      const cpTarget = stat.isDirectory()
        ? `${container.containerId}:${containerPath}/`
        : `${container.containerId}:${containerPath}`;
      const cpResult = await this.runAnalysisShellCommand({
        command: "docker",
        args: ["cp", cpSource, cpTarget],
        cwd: workspacePath,
        timeoutMs: 240000,
      });
      if (cpResult.code === 0) {
        copied.push(entry);
      } else {
        missing.push(`${entry}: ${compactMultiline(cpResult.output || cpResult.error, 400)}`);
      }
    }
    return {
      status: missing.length ? "failed" : "completed",
      envName,
      copied,
      missing,
      output: missing.join("\n"),
    };
  }

  async ensureAnalysisDockerEnvironment({ workspacePath, provider, model, key, analysisEnvName = "", reason = "" }) {
    const envName = analysisEnvName || analysisDockerEnvironmentName(provider, model, key);
    if (!workspacePath || this.shuttingDown) {
      return { status: "skipped", envName, reason: "workspace unavailable" };
    }

    const composePath = path.join(workspacePath, "docker-compose.yml");
    const composeText = readText(composePath);
    let fallbackReason = "";
    if (!composeText) {
      fallbackReason = "docker-compose.yml was missing after task1.";
    } else if (!analysisComposeHasService(composeText, envName)) {
      fallbackReason = `docker-compose.yml did not define the expected service ${envName}.`;
    } else if (!analysisComposeHasWorkspaceMount(composeText)) {
      fallbackReason = "docker-compose.yml did not mount the benchmark root as /workspace.";
    }

    let fallbackCreated = false;
    if (fallbackReason) {
      this.writeAnalysisFallbackDockerEnvironment(workspacePath, envName, fallbackReason);
      fallbackCreated = true;
    }

    const up = async () => this.runAnalysisShellCommand({
      command: "docker",
      args: ["compose", "up", "-d", "--build"],
      cwd: workspacePath,
      timeoutMs: 900000,
    });
    let upResult = await up();
    if (upResult.code !== 0 && !fallbackCreated) {
      this.writeAnalysisFallbackDockerEnvironment(
        workspacePath,
        envName,
        `Existing Docker environment failed to start: ${compactMultiline(upResult.output || upResult.error, 800)}`,
      );
      fallbackCreated = true;
      upResult = await up();
    }
    if (upResult.code !== 0) {
      return {
        status: "failed",
        envName,
        createdFallback: fallbackCreated,
        error: upResult.output || upResult.error || `docker compose up exited with code ${upResult.code}`,
      };
    }

    let container = await this.analysisDockerContainerId(envName, workspacePath);
    if (container.status !== "completed" && !fallbackCreated) {
      this.writeAnalysisFallbackDockerEnvironment(
        workspacePath,
        envName,
        `Expected Docker service ${envName} did not start from the model compose file.`,
      );
      fallbackCreated = true;
      upResult = await up();
      container = await this.analysisDockerContainerId(envName, workspacePath);
    }
    if (container.status !== "completed") {
      return {
        status: "failed",
        envName,
        createdFallback: fallbackCreated,
        error: container.output || `Docker container for ${envName} was not found.`,
      };
    }

    const initWorkspace = async () => this.runAnalysisShellCommand({
      command: "docker",
      args: [
        "compose",
        "exec",
        "-T",
        envName,
        "bash",
        "-lc",
        [
          `mkdir -p ${ANALYSIS_DOCKER_WORKSPACE}/projects ${ANALYSIS_DOCKER_WORKSPACE}/reports ${ANALYSIS_DOCKER_WORKSPACE}/logs ${ANALYSIS_DOCKER_WORKSPACE}/model_runs`,
          `test -d ${ANALYSIS_DOCKER_WORKSPACE}/projects`,
          `test -d ${ANALYSIS_DOCKER_WORKSPACE}/reports`,
          `test -d ${ANALYSIS_DOCKER_WORKSPACE}/logs`,
        ].join(" && "),
      ],
      cwd: workspacePath,
      timeoutMs: 240000,
    });
    let initResult = await initWorkspace();
    if (initResult.code !== 0 && !fallbackCreated) {
      this.writeAnalysisFallbackDockerEnvironment(
        workspacePath,
        envName,
        `Existing Docker service could not initialize /workspace: ${compactMultiline(initResult.output || initResult.error, 800)}`,
      );
      fallbackCreated = true;
      upResult = await up();
      if (upResult.code === 0) {
        container = await this.analysisDockerContainerId(envName, workspacePath);
        if (container.status === "completed") {
          initResult = await initWorkspace();
        }
      }
    }
    if (initResult.code !== 0) {
      return {
        status: "failed",
        envName,
        createdFallback: fallbackCreated,
        error: initResult.output || initResult.error || "Docker workspace initialization failed.",
      };
    }

    const supportCopy = await this.copyAnalysisBenchmarkSupportIntoDocker(workspacePath, envName);
    const requirementsInstall = await this.runAnalysisShellCommand({
      command: "docker",
      args: [
        "compose",
        "exec",
        "-T",
        envName,
        "bash",
        "-lc",
        [
          `cd ${ANALYSIS_DOCKER_WORKSPACE}`,
          "if test -f task_project_requirements.txt; then python3 -m pip install -r task_project_requirements.txt || python3 -m pip install --break-system-packages -r task_project_requirements.txt; fi",
        ].join(" && "),
      ],
      cwd: workspacePath,
      timeoutMs: 300000,
    });
    if (requirementsInstall.code !== 0) {
      return {
        status: "failed",
        envName,
        createdFallback: fallbackCreated,
        reason: fallbackReason || reason,
        error: requirementsInstall.output || requirementsInstall.error || "Analysis project requirements installation failed.",
        supportCopy,
      };
    }
    return {
      status: supportCopy.status === "failed" ? "failed" : "completed",
      envName,
      createdFallback: fallbackCreated,
      reason: fallbackReason || reason,
      output: compactMultiline(
        [upResult.output, supportCopy.output, requirementsInstall.output].filter(Boolean).join("\n"),
        1600,
      ),
      supportCopy,
      requirementsInstall,
    };
  }

  async syncAnalysisDockerArtifacts(workspacePath, envName, modelRunName = "") {
    const container = await this.analysisDockerContainerId(envName, workspacePath);
    if (container.status !== "completed" || !container.containerId) {
      return { status: "skipped", envName, reason: "container not available", output: container.output || "" };
    }
    const entries = ["projects", "reports", "logs"];
    if (modelRunName) {
      entries.push(`model_runs/${modelRunName}/results`);
    } else {
      entries.push("model_runs");
    }
    const copied = [];
    const failed = [];
    for (const entry of entries) {
      const containerPath = `${ANALYSIS_DOCKER_WORKSPACE}/${entry}`;
      const existsResult = await this.runAnalysisShellCommand({
        command: "docker",
        args: ["exec", container.containerId, "bash", "-lc", `test -e ${shellQuoteSingle(containerPath)}`],
        cwd: workspacePath,
        timeoutMs: 120000,
      });
      if (existsResult.code !== 0) continue;
      const target = path.join(workspacePath, ...entry.split("/"));
      mkdirp(target);
      const cpResult = await this.runAnalysisShellCommand({
        command: "docker",
        args: ["cp", `${container.containerId}:${containerPath}/.`, target],
        cwd: workspacePath,
        timeoutMs: 300000,
      });
      if (cpResult.code === 0) {
        copied.push(entry);
      } else {
        failed.push(`${entry}: ${compactMultiline(cpResult.output || cpResult.error, 400)}`);
      }
    }
    return {
      status: failed.length ? "failed" : "completed",
      envName,
      copied,
      output: failed.join("\n"),
    };
  }

  copyAnalysisDisplayArtifacts(workspacePath, taskId, modelRunName = "") {
    const target = path.join(analysisDisplayResultsDir(workspacePath), taskId);
    mkdirp(target);
    copyDirectoryRecursive(path.join(workspacePath, "logs"), path.join(target, "logs"));
    copyDirectoryRecursive(path.join(workspacePath, "reports"), path.join(target, "reports"));
    if (modelRunName) {
      copyDirectoryRecursive(
        path.join(workspacePath, "model_runs", modelRunName, "results"),
        path.join(target, "model_results"),
      );
    }
    return target;
  }

  async runAnalysisTaskBatchPostprocess({ workspacePath, task, analysisEnvName, modelRunName }) {
    const script = analysisTaskBatchScript(task?.id);
    if (!script) {
      return { status: "skipped", summary: "No batch script for task.", logPath: "" };
    }
    const scriptPath = path.join(workspacePath, script);
    if (!fs.existsSync(scriptPath)) {
      return { status: "skipped", summary: `${script} not found in analysis workspace.`, logPath: "" };
    }
    normalizeAnalysisWorkspaceScriptsInPlace(workspacePath);
    const bashCommand = [
      `export DOCKER_SERVICE=${shellQuoteSingle(analysisEnvName)}`,
      `export DOCKER_WORKSPACE=${shellQuoteSingle(ANALYSIS_DOCKER_WORKSPACE)}`,
      `export DOCKER_BENCHMARK_ROOT=${shellQuoteSingle(ANALYSIS_DOCKER_WORKSPACE)}`,
      `export MODEL_NAME=${shellQuoteSingle(modelRunName)}`,
      "export SUBMIT_INDEX='1'",
      `bash ${shellQuoteSingle(`./${script}`)}`,
    ].join("; ");
    const result = await this.runAnalysisShellCommand({
      command: "bash",
      args: ["-lc", bashCommand],
      cwd: workspacePath,
      timeoutMs: 900000,
      env: {
        DOCKER_SERVICE: analysisEnvName,
        DOCKER_WORKSPACE: ANALYSIS_DOCKER_WORKSPACE,
        DOCKER_BENCHMARK_ROOT: ANALYSIS_DOCKER_WORKSPACE,
        MODEL_NAME: modelRunName,
        SUBMIT_INDEX: "1",
      },
    });
    const logText = [
      `Task: ${task?.id || ""}`,
      `Script: ${script}`,
      `Docker service: ${analysisEnvName}`,
      `Model run: ${modelRunName}`,
      `Exit code: ${result.code == null ? "n/a" : result.code}`,
      result.signal ? `Signal: ${result.signal}` : "",
      result.error ? `Error: ${result.error}` : "",
      "",
      result.output || "",
      "",
    ].filter((line) => line !== "").join("\n");
    const logName = `${task?.id || "task"}_grade_all.log`;
    const logPath = path.join(workspacePath, "logs", logName);
    const reportLogPath = path.join(workspacePath, "reports", logName);
    const displayDir = path.join(analysisDisplayResultsDir(workspacePath), task?.id || "task");
    mkdirp(path.dirname(logPath));
    mkdirp(path.dirname(reportLogPath));
    mkdirp(displayDir);
    fs.writeFileSync(logPath, logText, "utf8");
    fs.writeFileSync(reportLogPath, logText, "utf8");
    fs.writeFileSync(path.join(displayDir, logName), logText, "utf8");
    const artifactsDir = this.copyAnalysisDisplayArtifacts(workspacePath, task?.id || "task", modelRunName);
    const status = result.code === 0 ? "completed" : "failed";
    return {
      status,
      code: result.code,
      logPath,
      artifactsDir,
      summary: `Batch post-processing ${status}: ${path.relative(workspacePath, logPath).replace(/\\/g, "/")}`,
      output: result.output,
    };
  }

  async removeAnalysisDockerContainer(envName, cwd = "") {
    const name = String(envName || "").trim();
    if (!name || this.shuttingDown) {
      return { status: "skipped", envName: name, output: "" };
    }
    const result = await this.runAnalysisShellCommand({
      command: "docker",
      args: ["rm", "-f", name],
      cwd: cwd || this.projectRoot,
      timeoutMs: 120000,
    });
    const output = String(result.output || result.error || "");
    if (result.code === 0) {
      return { status: "completed", envName: name, output };
    }
    if (isMissingDockerContainerOutput(output)) {
      return { status: "skipped", envName: name, output };
    }
    return { status: "failed", envName: name, error: output || `docker rm exited with code ${result.code}` };
  }

  async cleanupAnalysisDockerEnvironment(item, workspacePath) {
    const key = String(item?.key || "").trim();
    const envName = analysisDockerEnvironmentName(item?.provider, item?.model, key);
    if (this.shuttingDown || item?.stopRequested) {
      return { status: "skipped", envName, reason: "Redou Agent is closing" };
    }
    if (!key) {
      return { status: "skipped", envName, reason: "analysis key missing" };
    }

    const writeCleanupSummary = (message) => {
      this.updateAnalysisResult(key, (result) => ({
        ...result,
        updatedAt: isoNow(),
        summary: [result.summary, message].filter(Boolean).join("\n\n"),
      }));
      this.emitAnalysisEvent(item.webContents, { type: "changed", runId: item.runId });
    };

    const composePath = path.join(workspacePath || "", "docker-compose.yml");
    if (!workspacePath || !fs.existsSync(composePath)) {
      const fallback = await this.removeAnalysisDockerContainer(envName, workspacePath || this.projectRoot);
      if (fallback.status === "completed") {
        const message = `Cleaned stale Docker test container ${envName}.`;
        writeCleanupSummary(message);
        return { status: "completed", envName, output: fallback.output, fallback: "container" };
      }
      return { status: "skipped", envName, reason: "docker-compose.yml not found" };
    }

    try {
      const result = await this.runAnalysisShellCommand({
        command: "docker",
        args: ["compose", "down", "--volumes", "--rmi", "local", "--remove-orphans"],
        cwd: workspacePath,
        timeoutMs: 600000,
      });
      if (result.code === 0) {
        const message = `Cleaned Docker test environment ${envName}.`;
        writeCleanupSummary(message);
        return { status: "completed", envName, output: result.output };
      }
      const message = `Docker cleanup for ${envName} failed: ${compactMultiline(result.output || result.error, 800)}`;
      const fallback = await this.removeAnalysisDockerContainer(envName, workspacePath || this.projectRoot);
      if (fallback.status === "completed") {
        const fallbackMessage = `${message}\nCleaned stale Docker test container ${envName}.`;
        writeCleanupSummary(fallbackMessage);
        return { status: "completed", envName, output: fallback.output, fallback: "container" };
      }
      writeCleanupSummary(message);
      return { status: "failed", envName, error: result.output || result.error };
    } catch (error) {
      const message = `Docker cleanup for ${envName} failed: ${error instanceof Error ? error.message : String(error)}`;
      try {
        const fallback = await this.removeAnalysisDockerContainer(envName, workspacePath || this.projectRoot);
        if (fallback.status === "completed") {
          const fallbackMessage = `${message}\nCleaned stale Docker test container ${envName}.`;
          writeCleanupSummary(fallbackMessage);
          return { status: "completed", envName, output: fallback.output, fallback: "container" };
        }
      } catch {
        // Keep the original compose cleanup error as the visible failure.
      }
      writeCleanupSummary(message);
      return { status: "failed", envName, error: message };
    }
  }

  async runAnalysisModelBenchmark(item) {
    if (this.shuttingDown || item.stopRequested) {
      this.markAnalysisInterrupted(item, "Stopped because Redou Agent is closing.");
      return;
    }
    const workspacePath = this.prepareAnalysisWorkspace(item.key, item.runId);
    item.workspacePath = workspacePath;
    const analysisEnvName = analysisDockerEnvironmentName(item.provider, item.model, item.key);
    const modelRunName = analysisModelRunName(item.provider, item.model, item.key);
    try {
      const staleCleanup = await this.removeAnalysisDockerContainer(analysisEnvName, workspacePath);
      if (staleCleanup.status === "completed") {
        this.log(`Removed stale analysis Docker container ${analysisEnvName} before starting benchmark.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Could not pre-clean analysis Docker container ${analysisEnvName}: ${message}`);
    }
    this.updateAnalysisResult(item.key, (result) => ({
      ...result,
      status: "running",
      startedAt: isoNow(),
      updatedAt: isoNow(),
      workspacePath,
      summary: "Running analyze/task1-9 with Hermes Agent.",
    }));
    this.syncAnalysisWorkspaceStarted(item, workspacePath, analysisEnvName);
    this.emitAnalysisEvent(item.webContents, { type: "changed", runId: item.runId });

    let failed = false;
    let dockerReady = false;
    const ensureDockerReady = async (reason) => {
      if (dockerReady) {
        return { status: "completed", envName: analysisEnvName, cached: true };
      }
      const result = await this.ensureAnalysisDockerEnvironment({
        workspacePath,
        provider: item.provider,
        model: item.model,
        key: item.key,
        analysisEnvName,
        reason,
      });
      if (result.status === "failed") {
        throw new Error(`Docker test environment ${analysisEnvName} is unavailable: ${compactMultiline(result.error || result.output, 1000)}`);
      }
      dockerReady = result.status === "completed";
      return result;
    };
    const appendTaskSummary = (summary, extra) => [summary, extra].filter(Boolean).join("\n\n");
    const postProcessTask = async (task) => {
      await this.syncAnalysisDockerArtifacts(workspacePath, analysisEnvName, modelRunName);
      const batch = await this.runAnalysisTaskBatchPostprocess({
        workspacePath,
        task,
        analysisEnvName,
        modelRunName,
      });
      await this.syncAnalysisDockerArtifacts(workspacePath, analysisEnvName, modelRunName);
      this.copyAnalysisDisplayArtifacts(workspacePath, task.id, modelRunName);
      return batch;
    };

    for (const task of ANALYSIS_TASKS) {
      if (this.shuttingDown || item.stopRequested) {
        this.markAnalysisInterrupted(item, "Stopped because Redou Agent is closing.");
        return;
      }
      const startedAt = isoNow();
      this.syncAnalysisWorkspaceTaskStage(item, task, "running", "Running");
      this.updateAnalysisTask(item.key, task.id, () => ({
        status: "running",
        startedAt,
        completedAt: null,
        error: null,
        summary: "Running",
      }));
      this.emitAnalysisEvent(item.webContents, { type: "changed", runId: item.runId, taskId: task.id });

      try {
        if (task.id !== "task1") {
          await ensureDockerReady(`Starting ${task.id}.`);
        }
        const taskResult = await this.runAnalysisTaskProcess({
          ...item,
          workspacePath,
          task,
          prompt: this.analysisPromptForTask(task, item.provider, item.model, {
            key: item.key,
            analysisEnvName,
            modelRunName,
          }),
          modelRunName,
          postProcessBeforeEvaluation: task.id === "task1"
            ? null
            : async () => postProcessTask(task),
        });
        if (task.id === "task1" && taskResult.status !== "interrupted") {
          try {
            const ensureResult = await ensureDockerReady("Task1 completed; preparing Docker environment for remaining analysis tasks.");
            const batch = await postProcessTask(task);
            const details = [
              ensureResult.createdFallback ? `Scheduler created Docker test environment ${analysisEnvName}.` : "",
              batch.summary,
            ].filter(Boolean).join("\n");
            taskResult.summary = appendTaskSummary(taskResult.summary, details);
          } catch (postError) {
            failed = true;
            const message = postError instanceof Error ? postError.message : String(postError);
            taskResult.status = "failed";
            taskResult.error = appendTaskSummary(taskResult.error, message);
            taskResult.summary = appendTaskSummary(taskResult.summary, message);
          }
        }
        if (taskResult.status === "failed") {
          failed = true;
        }
        this.updateAnalysisTask(item.key, task.id, () => taskResult);
        this.syncAnalysisWorkspaceTaskStage(item, task, taskResult.status, taskResult.summary, taskResult);
      } catch (error) {
        if (this.shuttingDown || item.stopRequested) {
          this.markAnalysisInterrupted(item, "Stopped because Redou Agent is closing.");
          return;
        }
        failed = true;
        const message = error instanceof Error ? error.message : String(error);
        this.updateAnalysisTask(item.key, task.id, () => ({
          status: "failed",
          completedAt: isoNow(),
          error: message,
          summary: message,
          score: 0,
          sections: [],
        }));
        this.syncAnalysisWorkspaceTaskStage(item, task, "failed", message, {
          score: 0,
          durationMs: 0,
        });
      }
      this.updateAnalysisResult(item.key, (result) => ({
        ...result,
        totals: this.analysisTotals(result.tasks),
        abilityScores: this.analysisAbilityScores(result.tasks),
      }));
      this.emitAnalysisEvent(item.webContents, { type: "changed", runId: item.runId, taskId: task.id });
      if (this.shuttingDown || item.stopRequested) {
        this.markAnalysisInterrupted(item, "Stopped because Redou Agent is closing.");
        return;
      }
    }

    const finalResult = this.updateAnalysisResult(item.key, (result) => {
      const completedTasks = result.tasks.filter((task) => task.status === "completed").length;
      const totals = this.analysisTotals(result.tasks);
      const abilityScores = this.analysisAbilityScores(result.tasks);
      const overall = averageScore(Object.values(abilityScores).map((score, index) => ({
        id: String(index),
        label: String(index),
        score,
      })));
      return {
        ...result,
        status: failed ? "failed" : "completed",
        completedAt: isoNow(),
        updatedAt: isoNow(),
        totals,
        abilityScores,
        summary: `${completedTasks}/${ANALYSIS_TASKS.length} tasks completed. Overall capability score: ${overall}.`,
      };
    });
    this.syncAnalysisWorkspaceFinished(
      item,
      finalResult?.status || (failed ? "failed" : "completed"),
      finalResult?.summary || "",
      finalResult,
    );
    this.emitAnalysisEvent(item.webContents, { type: "changed", runId: item.runId });
  }

  runAnalysisTaskProcess({
    runId,
    key,
    provider,
    model,
    workspacePath,
    task,
    prompt,
    maxIterations,
    skipInlineEvaluation = false,
    preparedRunDir = "",
    modelRunName = "",
    postProcessBeforeEvaluation = null,
  }) {
    return new Promise((resolve, reject) => {
      if (this.shuttingDown) {
        resolve({
          id: task.id,
          title: task.title,
          capability: task.capability,
          status: "interrupted",
          startedAt: isoNow(),
          completedAt: isoNow(),
          durationMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          reasoningTokens: 0,
          apiCalls: 0,
          estimatedCostUsd: 0,
          score: 0,
          sections: [],
          summary: "Stopped because Redou Agent is closing.",
          error: "Stopped because Redou Agent is closing.",
        });
        return;
      }
      if (!this.pythonPath || !fs.existsSync(this.pythonPath)) {
        reject(new Error("Hermes Python runtime is unavailable."));
        return;
      }

      const adapterPath = path.join(__dirname, "..", "..", "hermes_adapter.py");
      const taskRunId = `${runId}:${task.id}`;
      const taskStartedAtMs = Date.now();
      const taskStartedAt = new Date(taskStartedAtMs).toISOString();
      const analysisEnvName = analysisDockerEnvironmentName(provider, model, key);
      const resolvedModelRunName = modelRunName || analysisModelRunName(provider, model, key);
      const metadata = {
        analysisRunId: runId,
        analysisKey: key,
        analysisTaskId: task.id,
        analysisTaskTitle: task.title,
        modelProvider: provider,
        model,
        analysisEnvName,
        ...(preparedRunDir ? { preparedRunDir } : {}),
        modelRunName: resolvedModelRunName,
      };
      const events = [];
      let finalAssistantText = "";
      let doneMetadata = {};
      let childError = null;

      const recordEvent = (rawEvent) => {
        const event = rawEvent && typeof rawEvent === "object"
          ? rawEvent
          : { type: "raw_log", content: String(rawEvent || "") };
        events.push(event);
        if (event.type === "assistant_message") {
          finalAssistantText = String(event.content || "").trim();
        }
        if (event.type === "done" && event.metadata && typeof event.metadata === "object") {
          doneMetadata = event.metadata;
        }
      };

      this.processManager.startJsonLineProcess({
        command: this.pythonPath,
        args: [adapterPath],
        options: {
          cwd: workspacePath,
          env: this.childEnv({
            HERMES_HOME: this.hermesHome,
            REDOU_APP_DATA_ROOT: this.appDataRoot(),
            REDOU_ANALYSIS_RUN_ID: runId,
            REDOU_ANALYSIS_TASK_ID: task.id,
            HERMES_INTERACTIVE: "1",
            HERMES_EXEC_ASK: "",
            PYTHONUTF8: "1",
            PYTHONUNBUFFERED: "1",
          }),
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
        input: {
          projectId: `analysis-${key}`,
          taskId: task.id,
          hermesProfile: "analysis",
          hermesSessionId: `redou-analysis-${key}-${task.id}-${Date.now().toString(36)}`,
          systemContext: "You are Hermes Agent running inside Redou Agent's local model benchmark harness.",
          userContext: prompt,
          attachments: [],
          metadata,
          riskConfirmed: true,
          model,
          provider,
          workspacePath,
          maxIterations: normalizeAnalysisMaxIterations(maxIterations, this.analysisDefaultMaxIterations()),
        },
        onStarted: (child) => {
          const activeAnalysisItem = this.activeAnalysisRuns.get(runId);
          if (activeAnalysisItem) {
            activeAnalysisItem.child = child;
            activeAnalysisItem.currentTaskId = task.id;
          }
        },
        onStdoutEvent: (event) => {
          recordEvent(event);
        },
        onStderrLine: (line) => {
          recordEvent({ type: "raw_log", content: redact(line), metadata: { stream: "stderr", folded: true } });
        },
        onError: (error) => {
          childError = error;
        },
        onExit: async ({ code, child }) => {
          try {
            const currentAnalysisItem = this.activeAnalysisRuns.get(runId);
            if (currentAnalysisItem?.child === child) {
              delete currentAnalysisItem.child;
              delete currentAnalysisItem.currentTaskId;
            }

            const stopped = this.shuttingDown || currentAnalysisItem?.stopRequested === true;
            let postProcessResult = null;
            if (!stopped && typeof postProcessBeforeEvaluation === "function") {
              try {
                postProcessResult = await postProcessBeforeEvaluation({
                  events,
                  finalAssistantText,
                  doneMetadata,
                });
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                postProcessResult = {
                  status: "failed",
                  summary: `Batch post-processing failed: ${message}`,
                  error: message,
                };
              }
            }

            const completedAtMs = Date.now();
            const durationMs = Math.max(0, completedAtMs - taskStartedAtMs);
            const errors = events
              .filter((event) => event.type === "error")
              .map((event) => event.message || event.content)
              .filter(Boolean);
            const failureSummary = finalAssistantText || compact(errors.join(" "), 600);
            const modelCallFailed = isAnalysisModelCallFailure(failureSummary);
            const evaluation = skipInlineEvaluation || modelCallFailed
              ? { score: 0, sections: [] }
              : this.evaluateAnalysisTask(task.id, workspacePath, events, finalAssistantText, {
                  analysisEnvName,
                  modelRunName: resolvedModelRunName,
                });
            const postProcessFailed = postProcessResult?.status === "failed";
            const status = analysisTaskProcessStatus({
              stopped,
              childError,
              exitCode: code,
              modelCallFailed,
              postProcessFailed,
              finalAssistantText,
            });
            const summary = stopped
              ? "Stopped because Redou Agent is closing."
              : [failureSummary, postProcessResult?.summary].filter(Boolean).join("\n\n");
            const taskResult = {
              id: task.id,
              title: task.title,
              capability: task.capability,
              status,
              startedAt: taskStartedAt,
              completedAt: new Date(completedAtMs).toISOString(),
              durationMs,
              inputTokens: toInt(doneMetadata.inputTokens),
              outputTokens: toInt(doneMetadata.outputTokens),
              cacheReadTokens: toInt(doneMetadata.cacheReadTokens),
              reasoningTokens: toInt(doneMetadata.reasoningTokens),
              apiCalls: toInt(doneMetadata.apiCalls),
              estimatedCostUsd: Number(doneMetadata.estimatedCostUsd || 0),
              score: evaluation.score,
              sections: evaluation.sections,
              summary,
              error: stopped
                ? "Stopped because Redou Agent is closing."
                : childError
                  ? childError.message
                  : modelCallFailed
                    ? failureSummary
                    : status === "failed"
                    ? [errors.join("\n") || (code !== 0 ? `Exited with code ${code}` : ""), postProcessResult?.error].filter(Boolean).join("\n") || null
                    : null,
            };
            resolve(taskResult);
          } catch (error) {
            reject(error);
          }
        },
      });
    });
  }

  evaluateAnalysisTask(taskId, workspacePath, events, finalAssistantText, context = {}) {
    const commands = commandText(events);
    const allEventText = `${commands}\n${events.map((event) => event.content || event.message || "").join("\n")}\n${finalAssistantText}`;
    if (isAnalysisModelCallFailure(allEventText)) {
      return { score: 0, sections: [] };
    }
    const analysisEnvName = String(context.analysisEnvName || "agent-lab").trim() || "agent-lab";
    const escapedEnvName = regexEscape(analysisEnvName);
    const gradeLogText = analysisTaskGradeLogText(workspacePath, taskId);
    const gradeLogScore = analysisFinalScoreFromLog(gradeLogText);
    const gradeLogSections = analysisTaskSectionsFromGradeLog(taskId, gradeLogText);
    if (["task1", "task2", "task3", "task4"].includes(taskId) && gradeLogSections.length > 0) {
      return { score: gradeLogScore ?? averageScore(gradeLogSections), sections: gradeLogSections };
    }
    if (taskId === "task1") {
      const dockerfile = pathExists(workspacePath, "Dockerfile");
      const compose = readRelativeText(workspacePath, "docker-compose.yml");
      const readme = readRelativeText(workspacePath, "README.md");
      const report = readRelativeText(workspacePath, "ENV_REPORT.md");
      const envCheck = readRelativeTextAny(workspacePath, ["logs/env_check.txt", "workspace/logs/env_check.txt"]);
      const dirs = [
        ["projects", "workspace/projects"],
        ["reports", "workspace/reports"],
        ["logs", "workspace/logs"],
      ].filter((rels) => pathExistsAny(workspacePath, rels)).length;
      const serviceRe = new RegExp(`(^|\\n)\\s{2}["']?${escapedEnvName}["']?\\s*:`, "m");
      const containerNameRe = new RegExp(`container_name\\s*:\\s*["']?${escapedEnvName}["']?\\b`, "i");
      const rootMountRe = /(?:^|\n)\s*-\s*(?:["']?(?:\.\/?|\$\{PWD\})["']?\s*:\s*["']?\/workspace\b|type:\s*bind[\s\S]{0,160}source:\s*["']?(?:\.\/?|\$\{PWD\})["']?[\s\S]{0,160}target:\s*["']?\/workspace\b)/i;
      const sections = [
        sectionScore("workspace_structure", "Workspace structure", (dockerfile ? 25 : 0) + (compose ? 25 : 0) + dirs * 16.7, `${dockerfile ? "Dockerfile" : ""} ${compose ? "compose" : ""} ${dirs}/3 dirs`),
        sectionScore("compose_contract", "Docker compose contract", (hasAny(compose, [serviceRe]) ? 25 : 0) + (hasAny(compose, [/\/workspace/]) ? 25 : 0) + (hasAny(compose, [rootMountRe]) ? 25 : 0) + (hasAny(compose, [containerNameRe]) ? 25 : 0), `${analysisEnvName} service/container and analysis root /workspace mount`),
        sectionScore("environment_verification", "Environment verification", 0, "Docker commands detected"),
        sectionScore("mount_evidence", "Workspace mount evidence", envCheck ? 100 : 0, envCheck ? "logs/env_check.txt exists" : "env_check.txt missing"),
        sectionScore("documentation", "README and ENV report", (readme.length > 400 ? 45 : readme ? 25 : 0) + (report.length > 600 ? 55 : report ? 30 : 0), "README.md and ENV_REPORT.md"),
      ];
      sections[2].score = clampScore(
        (hasAny(allEventText, [/docker compose up/i]) ? 34 : 0) +
        (hasAny(allEventText, [/docker compose ps/i]) ? 22 : 0) +
        (hasAny(allEventText, [/node -v|npm -v|python3 --version|pip --version|git --version|curl --version|wget --version/i]) ? 44 : 0),
      );
      return { score: gradeLogScore ?? averageScore(sections), sections };
    }

    if (taskId === "task2") {
      const projectDir = firstExistingRelativePath(workspacePath, ["projects/agent-task-board", "workspace/projects/agent-task-board"]);
      const files = listFilesRecursive(projectDir, 160);
      const combined = files
        .filter((file) => /\.(js|jsx|ts|tsx|html|css|json|md)$/i.test(file))
        .map((file) => readText(file))
        .join("\n");
      const report = readRelativeTextAny(workspacePath, ["reports/agent-task-board-report.md", "workspace/reports/agent-task-board-report.md"]);
      const sections = [
        sectionScore("project_created", "Project files", files.length >= 4 ? 100 : files.length * 20, `${files.length} files found`),
        sectionScore("features", "Task board features", (
          (hasAny(combined, [/sub.?task|子任务/i]) ? 20 : 0) +
          (hasAny(combined, [/Planner|Coder|Reviewer|Tester/i]) ? 20 : 0) +
          (hasAny(combined, [/pending|running|completed|failed|等待|执行|完成|失败/i]) ? 20 : 0) +
          (hasAny(combined, [/log|日志/i]) ? 20 : 0) +
          (hasAny(combined, [/progress|进度/i]) ? 20 : 0)
        ), "Expected board capabilities in source"),
        sectionScore("persistence", "Persistence", hasAny(combined, [/localStorage|indexedDB|fs\.|writeFile/i]) ? 100 : 0, "Persistent storage marker"),
        sectionScore("container_execution", "Container execution", hasContainerExecCommand(commands, analysisEnvName) ? 100 : 0, `${analysisEnvName} command usage`),
        sectionScore("verification", "Runtime verification", hasAny(commands, [/curl|npm run dev|npm start/i]) ? 100 : 0, "Runtime/curl command usage"),
        sectionScore("report", "Delivery report", report.length > 700 ? 100 : report ? 55 : 0, "agent-task-board-report.md"),
      ];
      return { score: gradeLogScore ?? averageScore(sections), sections };
    }

    if (taskId === "task3") {
      const projectDir = firstExistingRelativePath(workspacePath, ["projects/bug-fix-lab", "workspace/projects/bug-fix-lab"]);
      const files = listFilesRecursive(projectDir, 160);
      const combined = files
        .filter((file) => /\.(js|cjs|mjs|json|md)$/i.test(file))
        .map((file) => readText(file))
        .join("\n");
      const logText = readRelativeTextAny(workspacePath, ["logs/bug-fix-lab-test.log", "workspace/logs/bug-fix-lab-test.log"]);
      const report = readRelativeTextAny(workspacePath, ["reports/bug-fix-lab-report.md", "workspace/reports/bug-fix-lab-report.md"]);
      const testFileCount = files.filter((file) => /\.test\./i.test(file)).length;
      const testEvidenceText = `${logText}\n${report}`;
      const hasFailureEvidence = hasAny(testEvidenceText, [
        /\bfail(?:ed|ing)?\b/i,
        /\bnot ok\s+\d+/i,
        /\bAssertionError\b/i,
        /\bERR_ASSERTION\b/i,
        /\b\d+\s+failures?\b/i,
      ]);
      const hasPassEvidence = hasAny(testEvidenceText, [
        /\bpass(?:ed)?\b/i,
        /\bok\s+\d+/i,
        /\btests?\s+passed\b/i,
        /\ball tests pass(?:ed)?\b/i,
        /\b0\s+failures?\b/i,
      ]);
      const sections = [
        sectionScore("project_created", "Library project", pathExistsAny(workspacePath, ["projects/bug-fix-lab/package.json", "workspace/projects/bug-fix-lab/package.json"]) ? 100 : Math.min(80, files.length * 15), `${files.length} files found`),
        sectionScore("tests_created", "Tests created", testFileCount >= 2 ? 100 : testFileCount === 1 ? 50 : 0, "calculator/text tests"),
        sectionScore("bug_loop", "Failing-to-passing loop", (
          (hasFailureEvidence ? 45 : 0) +
          (hasPassEvidence ? 45 : 0) +
          (hasAny(report, [/bug|fix|修复|失败|通过/i]) ? 10 : 0)
        ), "Failure and pass evidence"),
        sectionScore("container_execution", "Container-only commands", hasContainerExecCommand(commands, analysisEnvName) ? 100 : 0, `${analysisEnvName} command usage`),
        sectionScore("log_report", "Log and report", (logText.length > 200 ? 45 : logText ? 25 : 0) + (report.length > 700 ? 55 : report ? 30 : 0), "test log and report"),
        sectionScore("function_coverage", "Required utility coverage", (
          (hasAny(combined, [/add\s*\(/]) ? 13 : 0) +
          (hasAny(combined, [/subtract\s*\(/]) ? 12 : 0) +
          (hasAny(combined, [/multiply\s*\(/]) ? 13 : 0) +
          (hasAny(combined, [/divide\s*\(/]) ? 12 : 0) +
          (hasAny(combined, [/reverseText\s*\(/]) ? 13 : 0) +
          (hasAny(combined, [/countWords\s*\(/]) ? 12 : 0) +
          (hasAny(combined, [/capitalizeWords\s*\(/]) ? 13 : 0) +
          (hasAny(combined, [/isPalindrome\s*\(/]) ? 12 : 0)
        ), "Required functions"),
      ];
      return { score: gradeLogScore ?? averageScore(sections), sections };
    }

    if (taskId === "task4") {
      const report = readRelativeTextAny(workspacePath, ["reports/chinese-agent-product-research.md", "workspace/reports/chinese-agent-product-research.md"]);
    const reportCheckRe = /\b(?:ls|test|stat|wc|head|cat)\b[^\r\n]*chinese-agent-product-research\.md/i;
    const sections = [
      sectionScore("report_saved", "Research report saved", report.length > 1500 ? 100 : report ? 55 : 0, "chinese-agent-product-research.md"),
      sectionScore("sources", "Source links", Math.min(100, countHttpLinks(report) * 12), `${countHttpLinks(report)} links`),
      sectionScore("comparison", "Comparison table", hasAny(report, [/\|.*Claude/i, /\|.*Cursor/i, /\|.*Codex/i]) ? 100 : hasAny(report, [/\|/]) ? 50 : 0, "Markdown table evidence"),
      sectionScore("product_plan", "Product plan", (
        (hasAny(report, [/MVP|产品|用户|场景|痛点|架构|路线图|risk|风险/i]) ? 45 : 0) +
        (hasAny(report, [/多模型|模型协作|大模型|小模型/i]) ? 25 : 0) +
        (hasAny(report, [/Claude Code|Codex|Cursor|Cline|OpenHands/i]) ? 30 : 0)
      ), "Plan sections"),
      sectionScore("container_check", "Container file check", report && hasContainerExecCommand(commands, analysisEnvName, [reportCheckRe]) ? 100 : 0, `${analysisEnvName} file verification`),
    ];
      return { score: gradeLogScore ?? averageScore(sections), sections };
    }

    const migratedMatch = /^task([5-9])$/.exec(taskId);
    if (migratedMatch) {
      const taskNumber = migratedMatch[1];
      const modelRunName = String(context.modelRunName || "unknown-model").trim() || "unknown-model";
      const runRel = `model_runs/${modelRunName}/task${taskNumber}`;
      const resultsRel = `model_runs/${modelRunName}/results`;
      let summary = null;
      for (const index of [3, 2, 1]) {
        summary = readRelativeJson(workspacePath, `${resultsRel}/task${taskNumber}_submit_${index}_summary.json`);
        if (summary) break;
      }
      const testRatio = analysisTestPassRatio(summary);
      const testScore = testRatio * 100;
      const testCounts = analysisTestCounts(summary);
      const testEvidence = testCounts
        ? `${testCounts.passedCount}/${testCounts.adjustedTotal} passed`
        : summary
          ? `metric=${testRatio}`
          : "summary json missing";
      const report = readRelativeText(workspacePath, `${resultsRel}/task${taskNumber}_report.md`);
      const runFiles = listFilesRecursive(path.join(workspacePath, "model_runs", modelRunName, `task${taskNumber}`), 220);
      const prepareRe = new RegExp(`task_project_prepare\\.py[^\\r\\n]*task\\s+${taskNumber}|task_project_prepare\\.py`, "i");
      const evaluateRe = new RegExp(`task_project_evaluate\\.py[^\\r\\n]*task\\s+${taskNumber}|task_project_evaluate\\.py`, "i");
      const sections = [
        sectionScore("working_copy", "Isolated working copy", runFiles.length > 0 ? 100 : 0, `${runFiles.length} files in ${runRel}`),
        sectionScore("automated_tests", "Automated hidden tests", testScore, testEvidence),
        sectionScore("official_submission", "Official evaluator run", summary ? 100 : hasAny(allEventText, [evaluateRe]) ? 50 : 0, "task_project_evaluate.py summary"),
        sectionScore("source_integrity", "Original source untouched", summary?.original_source_unchanged === true ? 100 : summary ? 20 : 0, "original source checksum"),
        sectionScore("container_execution", "Container-only commands", hasContainerExecCommand(commands, analysisEnvName, [prepareRe]) || hasContainerExecCommand(commands, analysisEnvName, [evaluateRe]) ? 100 : 0, `${analysisEnvName} prepare/evaluate usage`),
        sectionScore("report", "Delivery report", report.length > 1000 ? 100 : report ? 55 : 0, `task${taskNumber}_report.md`),
      ];
      return { score: summary ? clampScore(testScore) : 0, sections };
    }

    return { score: 0, sections: [] };
  }

  analysisTotals(tasks) {
    return this.analyticsService.analysisTotals(tasks);
  }

  analysisAbilityScores(tasks) {
    return this.analyticsService.analysisAbilityScores(tasks);
  }

  rootModelConfigBlock() {
    const configPath = path.join(this.hermesHome, "config.yaml");
    return topLevelYamlBlock(readText(configPath), "model") || "model:\n  provider: auto\n  model: ''";
  }

  rootMainModelSelection() {
    const block = this.rootModelConfigBlock();
    const selection = { provider: "", model: "" };
    const lines = block.split(/\r?\n/);
    const inlineModel = lines[0]?.match(/^model:\s+(.+)$/);
    if (inlineModel) {
      selection.model = yamlScalar(inlineModel[1]);
    }

    for (const line of lines.slice(1)) {
      const match = line.match(/^\s+([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
      if (!match) continue;
      const key = match[1];
      const value = yamlScalar(match[2]);
      if (key === "provider") {
        selection.provider = value;
      } else if ((key === "default" || key === "model") && value) {
        selection.model = value;
      }
    }
    return selection;
  }

  taskModelSelection(task) {
    return {
      provider: String(task?.model_provider || "").trim(),
      model: String(task?.model || "").trim(),
    };
  }

  recordedModelSelectionFromTask(task) {
    if (!task?.messagesPath) return { provider: "", model: "" };
    const { messages } = this.loadMessagesFile(task.messagesPath, { taskId: task.id });
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const metadata = messages[index]?.metadata;
      const eventMetadata = metadata?.event?.metadata;
      const candidates = [
        metadata,
        metadata?.context,
        eventMetadata,
        eventMetadata?.context,
      ].filter((item) => item && typeof item === "object");
      for (const candidate of candidates) {
        const provider = String(candidate.modelProvider || candidate.provider || "").trim();
        const model = String(candidate.model || "").trim();
        if (provider || model) {
          return { provider, model };
        }
      }
    }
    return { provider: "", model: "" };
  }

  modelSelectionForNewTask(project, body = {}) {
    const hasExplicitModel =
      Object.prototype.hasOwnProperty.call(body, "model_provider") ||
      Object.prototype.hasOwnProperty.call(body, "model");
    if (hasExplicitModel) {
      return {
        model_provider: String(body.model_provider || "").trim(),
        model: String(body.model || "").trim(),
      };
    }

    const state = this.getState();
    const currentTask =
      state.current_project_id === project.id
        ? project.tasks.find((task) => task.id === state.current_task_id)
        : null;
    const recentTask =
      currentTask ||
      [...project.tasks].sort(
        (left, right) => Number(right.updated_at || 0) - Number(left.updated_at || 0),
      )[0] ||
      null;
    const recentSelection = this.taskModelSelection(recentTask);
    if (recentSelection.provider || recentSelection.model) {
      return {
        model_provider: recentSelection.provider,
        model: recentSelection.model,
      };
    }
    const recordedSelection = this.recordedModelSelectionFromTask(recentTask);
    if (recordedSelection.provider || recordedSelection.model) {
      return {
        model_provider: recordedSelection.provider === "auto" ? "" : recordedSelection.provider,
        model: recordedSelection.model,
      };
    }

    const mainSelection = this.rootMainModelSelection();
    return {
      model_provider: mainSelection.provider === "auto" ? "" : mainSelection.provider,
      model: mainSelection.model,
    };
  }

  rootRuntimeConfigBlocks() {
    const configPath = path.join(this.hermesHome, "config.yaml");
    const text = readText(configPath);
    const blocks = [];
    for (const key of PROFILE_RUNTIME_CONFIG_KEYS) {
      const block = topLevelYamlBlock(text, key);
      if (block) blocks.push(block);
    }
    if (!blocks.some((block) => /^model:/m.test(block))) {
      blocks.unshift("model:\n  provider: auto\n  model: ''");
    }
    return blocks.join("\n");
  }

  existingProfileSkillsBlock(profileHome) {
    return topLevelYamlBlock(readText(path.join(profileHome, "config.yaml")), "skills");
  }

  renderManagedProfileSkillsConfig(profileHome) {
    const existingBlock = this.existingProfileSkillsBlock(profileHome);
    const disabled = uniqueStrings(yamlBlockListValues(existingBlock, "disabled"));
    const lines = ["skills:", "  disabled:"];
    if (disabled.length) {
      for (const name of disabled) {
        const rendered = /^[A-Za-z0-9._-]+$/.test(name) ? name : yamlString(name);
        lines.push(`    - ${rendered}`);
      }
    } else {
      lines.push("    []");
    }
    return lines.join("\n");
  }

  writeManagedProfileConfig(profileHome, workspacePath) {
    const configPath = path.join(profileHome, "config.yaml");
    const runtimeConfigBlocks = this.rootRuntimeConfigBlocks();
    const skillsConfigBlock = this.renderManagedProfileSkillsConfig(profileHome);
    const text = [
      "# Redou managed Hermes profile.",
      "# Redou stores project rules, task context, uploads, and task-packaged skills under the project .redou directory when a workspace is set.",
      runtimeConfigBlocks,
      skillsConfigBlock,
      "terminal:",
      `  cwd: ${yamlString(workspacePath || this.projectRoot)}`,
      "memory:",
      "  enabled: false",
      "approvals:",
      "  mode: manual",
      "",
    ].join("\n");

    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, text, "utf8");
      return;
    }

    const current = readText(configPath);
    if (current.startsWith("# Redou managed Hermes profile.")) {
      fs.writeFileSync(configPath, text, "utf8");
      return;
    }

    const workspacePathFile = path.join(profileHome, "redou-workspace.json");
    writeJsonAtomic(workspacePathFile, {
      workspacePath: workspacePath || this.projectRoot,
      note: "Non-managed config.yaml was left untouched; Redou binds this workspace through child process cwd and REDOU metadata.",
      updatedAt: isoNow(),
    });
  }

  ensureProjectHermesProfile(project) {
    const profileName = project.hermesProfile && project.hermesProfile !== "default"
      ? project.hermesProfile
      : this.desiredProjectProfileName(project.id);
    const profileHome = this.projectHermesHome(project);

    for (const dir of ["memories", "sessions", "skills", "skins", "logs", "plans", "workspace", "cron", "home"]) {
      mkdirp(path.join(profileHome, dir));
    }

    const workspacePath = project.path || project.workspace_path || "";
    const profileInfo = {
      name: profileName,
      projectId: project.id,
      projectName: project.name,
      workspacePath,
      appDataPath: project.appDataPath,
      contextPath: this.projectContextDir(project),
      hermesHomePath: profileHome,
      skillsPath: path.join(profileHome, REDOU_SKILLS_DIR),
      createdAt: isoNow(),
      memoryPolicy: "Redou project .redou files are primary. Hermes memory is project-local and auxiliary only.",
    };
    writeJsonAtomic(path.join(profileHome, "redou-profile.json"), profileInfo);
    writeJsonAtomic(path.join(profileHome, "profile.json"), profileInfo);
    this.writeManagedProfileConfig(profileHome, workspacePath);

    project.hermesProfile = profileName;
    project.hermesHomePath = profileHome;
    project.skillsPath = path.join(profileHome, REDOU_SKILLS_DIR);
    delete project.hermesProfileWarning;
    return profileName;
  }

  getChatProjects() {
    this.ensureInitialized();
    const state = this.getState();
    const projects = this.readAllProjects().map((project) => this.decorateProjectRuntime(project));
    const current = this.resolveCurrentChatSelection(projects, state);
    if (
      current.current_project_id !== (state.current_project_id || "") ||
      current.current_task_id !== (state.current_task_id || "")
    ) {
      this.saveState(current);
    }
    return {
      version: 2,
      current_project_id: current.current_project_id,
      current_task_id: current.current_task_id,
      projects,
    };
  }

  createChatProject(body = {}) {
    const name = compact(body.name, 120) || "New Project";
    const id = safeSegment(`${name}-${Date.now().toString(36)}`, `project-${Date.now().toString(36)}`);
    const createdAt = isoNow();
    const project = this.ensureProject({
      id,
      name,
      path: compact(body.workspace_path || body.path, 1000),
      hermesProfile: this.desiredProjectProfileName(id),
      createdAt,
      updatedAt: createdAt,
      tasks: [],
    });
    appendDedupeRules(project.rulesPath, [projectWorkspaceOutputRule(project.path || project.workspace_path)]);
    const task = this.ensureTask(project, {
      id: `task-${Date.now().toString(36)}`,
      projectId: project.id,
      title: "New Task",
      createdAt,
      updatedAt: createdAt,
    });
    const saved = this.writeProject({ ...project, tasks: [task] });
    this.saveState({ current_project_id: saved.id, current_task_id: task.id });
    this.log(`redou project open projectId=${project.id} projectPath=${redact(project.path)} hermesProfile=${project.hermesProfile}`);
    return { ok: true, project: saved };
  }

  updateChatProject(projectId, body = {}) {
    const project = this.readProject(projectId);
    if (!project) throw new Error("Project not found");
    const next = {
      ...project,
      name: body.name == null ? project.name : compact(body.name, 120) || project.name,
      path: body.workspace_path == null && body.path == null
        ? project.path
        : compact(body.workspace_path ?? body.path, 1000),
      updatedAt: isoNow(),
    };
    const saved = this.ensureProject(next);
    return { ok: true, project: saved };
  }

  deleteChatProject(projectId) {
    this.ensureInitialized();
    const project = this.readProject(projectId);
    if (!project) throw new Error("Project not found");
    if (this.hasActiveRunFor(project.id)) {
      throw new Error("Stop the running task before deleting this project.");
    }

    const deletedTaskIds = project.tasks.map((task) => task.id);
    this.removeAppDataDir(this.projectsDir(), this.projectDir(project.id), "project");

    const projects = this.readAllProjects();
    const nextProject = projects[0] || null;
    const nextTask = nextProject?.tasks?.[0] || null;
    this.saveState({
      current_project_id: nextProject?.id || "",
      current_task_id: nextTask?.id || "",
    });
    this.log(`redou project delete projectId=${project.id} taskCount=${deletedTaskIds.length}`);
    return {
      ok: true,
      deleted_project_id: project.id,
      deleted_task_ids: deletedTaskIds,
      current_project_id: nextProject?.id || "",
      current_task_id: nextTask?.id || "",
      projects,
    };
  }

  createChatTask(projectId, body = {}) {
    const project = this.readProject(projectId);
    if (!project) throw new Error("Project not found");
    const title = compact(body.title, 160) || "New Task";
    const id = safeSegment(`${title}-${Date.now().toString(36)}`, `task-${Date.now().toString(36)}`);
    const createdAt = isoNow();
    const modelSelection = this.modelSelectionForNewTask(project, body);
    const task = this.ensureTask(project, {
      id,
      projectId: project.id,
      title,
      createdAt,
      updatedAt: createdAt,
      model_provider: modelSelection.model_provider,
      model: modelSelection.model,
    });
    const saved = this.writeProject({
      ...project,
      updatedAt: isoNow(),
      tasks: [...project.tasks, task],
    });
    this.saveState({ current_project_id: project.id, current_task_id: task.id });
    this.log(`redou task open projectId=${project.id} taskId=${task.id} messagesPath=${redact(task.messagesPath)} loadedMessages=0`);
    return { ok: true, project: saved, task: saved.tasks.find((item) => item.id === task.id) || task };
  }

  updateChatTask(projectId, taskId, body = {}, options = {}) {
    const project = this.readProject(projectId);
    if (!project) throw new Error("Project not found");
    let selected = null;
    const tasks = project.tasks.map((task) => {
      if (task.id !== taskId) return task;
      selected = this.ensureTask(project, {
        ...task,
        title: body.title == null ? task.title : compact(body.title, 160) || task.title,
        hermesSessionId: body.hermesSessionId ?? body.session_id ?? task.hermesSessionId,
        session_id: body.hermesSessionId ?? body.session_id ?? task.session_id,
        model_provider: body.model_provider == null ? task.model_provider : body.model_provider || "",
        model: body.model == null ? task.model : body.model || "",
        updatedAt: isoNow(),
      });
      return selected;
    });
    if (!selected) throw new Error("Task not found");
    const saved = this.writeProject({ ...project, updatedAt: isoNow(), tasks });
    if (options.activate !== false) {
      this.saveState({ current_project_id: project.id, current_task_id: taskId });
    }
    return {
      ok: true,
      project: saved,
      task: saved.tasks.find((item) => item.id === taskId) || selected,
    };
  }

  deleteChatTask(projectId, taskId) {
    const project = this.readProject(projectId);
    if (!project) throw new Error("Project not found");
    const taskIndex = project.tasks.findIndex((task) => task.id === taskId);
    if (taskIndex < 0) throw new Error("Task not found");
    if (this.hasActiveRunFor(project.id, taskId)) {
      throw new Error("Stop the running task before deleting it.");
    }

    const task = project.tasks[taskIndex];
    const remainingTasks = project.tasks.filter((item) => item.id !== taskId);
    const saved = this.writeProject({
      ...project,
      updatedAt: isoNow(),
      tasks: remainingTasks,
    });
    this.removeAppDataDir(
      path.join(this.projectDir(project.id), "tasks"),
      this.taskDir(project.id, task.id),
      "task",
    );

    const nextTask =
      saved.tasks[Math.min(taskIndex, saved.tasks.length - 1)] || null;
    const state = this.getState();
    const stateProjectId = state.current_project_id || project.id;
    const stateTaskExists = saved.tasks.some((item) => item.id === state.current_task_id);
    const deletedCurrentTask =
      state.current_project_id === project.id && state.current_task_id === taskId;
    const currentTaskId =
      deletedCurrentTask || (state.current_project_id === project.id && !stateTaskExists)
        ? nextTask?.id || ""
        : state.current_task_id || "";
    this.saveState({
      current_project_id: stateProjectId,
      current_task_id: currentTaskId,
    });
    this.log(`redou task delete projectId=${project.id} taskId=${task.id}`);
    return {
      ok: true,
      project: saved,
      deleted_task_id: task.id,
      next_task: nextTask,
      current_project_id: stateProjectId,
      current_task_id: currentTaskId,
    };
  }

  findProjectAndTask(projectId, taskId) {
    const project = this.readProject(projectId);
    if (!project) return { project: null, task: null };
    const task = project.tasks.find((item) => item.id === taskId) || null;
    if (!task) return { project, task: null };
    return { project: this.ensureProject(project), task: this.ensureTask(project, task) };
  }

  loadMessagesFile(file, context = {}) {
    return this.logService.loadMessagesFile(file, context);
  }

  getChatTaskMessages(projectId, taskId) {
    const { project, task } = this.findProjectAndTask(projectId, taskId);
    if (!project || !task) {
      return {
        projectId,
        taskId,
        messagesPath: "",
        hermesSessionId: "",
        messages: [],
        warnings: ["Project or task metadata was not found."],
        is_active: false,
        active_run_id: null,
        queue_depth: 0,
        run_started_at: null,
        last_active: null,
      };
    }
    const { messages, warnings } = this.loadMessagesFile(task.messagesPath, { projectId, taskId });
    const runtime = this.taskRuntimeSnapshot(project.id, task.id);
    this.log(`redou task open projectId=${projectId} taskId=${taskId} messagesPath=${redact(task.messagesPath)} loadedMessages=${messages.length}`);
    return {
      projectId,
      taskId,
      messagesPath: task.messagesPath,
      hermesSessionId: task.hermesSessionId || "",
      messages,
      warnings,
      ...runtime,
    };
  }

  callHermesTaskSkillPackager(project, payload) { return this.skillService.callHermesTaskSkillPackager(project, payload); }

  packageTaskSkill(projectId, taskId) {
    return this.skillService.packageTaskSkill(
      projectId,
      taskId,
      (project, payload) => this.callHermesTaskSkillPackager(project, payload),
    );
  }

  setActiveChatTask(projectId, taskId) {
    const { project, task } = this.findProjectAndTask(projectId, taskId);
    if (!project || !task) throw new Error("Project or task not found");
    this.saveState({ current_project_id: project.id, current_task_id: task.id });
    this.log(`redou task selected projectId=${project.id} taskId=${task.id} messagesPath=${redact(task.messagesPath)}`);
    return { ok: true, project, task };
  }

  appendTaskMessage(projectId, taskId, role, content, metadata = {}, attachments = []) {
    return this.logService.appendTaskMessage(projectId, taskId, role, content, metadata, attachments);
  }

  appendTaskEventJsonl(task, event) {
    return this.logService.appendTaskEventJsonl(task, event);
  }

  readTaskEvents(task) {
    return this.logService.readTaskEvents(task);
  }

  updateUserInputEnvelopeStatus(projectId, taskId, envelopeId, patch = {}) {
    return this.logService.updateUserInputEnvelopeStatus(projectId, taskId, envelopeId, patch);
  }

  removeQueuedUserInputMessage(projectId, taskId, queueId) {
    return this.logService.removeQueuedUserInputMessage(projectId, taskId, queueId);
  }

  updateQueuedMessage(webContents, input = {}) {
    const projectId = String(input.projectId || "").trim();
    const taskId = String(input.taskId || "").trim();
    const queueId = String(input.queueId || "").trim();
    const action = String(input.action || "").trim().toLowerCase();
    if (!projectId || !taskId) throw new Error("Select a Project and Task before updating queued messages.");
    if (!queueId) throw new Error("Queued message id is required.");
    if (action !== "delete" && action !== "guide") {
      throw new Error("Queued message action must be delete or guide.");
    }

    const { project, task } = this.findProjectAndTask(projectId, taskId);
    if (!project || !task) throw new Error("Project or task not found");

    const key = this.taskQueueKey(projectId, taskId);
    const queue = this.taskQueues.get(key) || [];
    const index = queue.findIndex((item) => String(item?.id || "") === queueId);
    if (index < 0) {
      return {
        ok: false,
        message: "Queued message was not found. It may have already started.",
        queueDepth: this.queueDepth(projectId, taskId),
      };
    }

    const queued = queue[index];
    const emitTarget = webContents || queued.webContents;
    const activeRun = this.activeRunForTask(projectId, taskId);
    const removeFromQueue = () => {
      queue.splice(index, 1);
      if (queue.length > 0) {
        this.taskQueues.set(key, queue);
      } else {
        this.taskQueues.delete(key);
      }
    };

    if (action === "delete") {
      removeFromQueue();
      this.removeQueuedUserInputMessage(projectId, taskId, queueId);
      this.emitQueueUpdate(
        emitTarget,
        projectId,
        taskId,
        activeRun?.runId || queueId,
        "Queued message deleted.",
        { queueId, queueState: "deleted", activeRunId: activeRun?.runId || null },
      );
      return {
        ok: true,
        deleted: true,
        queueDepth: this.queueDepth(projectId, taskId),
      };
    }

    if (!activeRun) {
      return {
        ok: false,
        message: "No active run is available for guidance.",
        queueDepth: this.queueDepth(projectId, taskId),
      };
    }

    const queuedInput = queued.input && typeof queued.input === "object" ? queued.input : {};
    const attachments = Array.isArray(queuedInput.attachments) ? queuedInput.attachments : [];
    const runMode = normalizeRunMode(queuedInput.runMode || input.runMode, "execute");
    if (runMode !== "execute") {
      return {
        ok: false,
        message: "Plan requests cannot be converted into guidance.",
        queueDepth: this.queueDepth(projectId, taskId),
      };
    }
    if (attachments.length > 0) {
      return {
        ok: false,
        message: "Queued messages with attachments cannot be converted into guidance.",
        queueDepth: this.queueDepth(projectId, taskId),
      };
    }

    const userInput = String(queuedInput.userInput || "");
    const guideId = crypto.randomUUID();
    const consumedAt = isoNow();
    const envelope = createUserInputEnvelope({
      id: guideId,
      text: userInput,
      runId: activeRun.runId,
      deliveryMode: "guide",
      status: "completed",
      targetRunId: activeRun.runId,
      consumedAt,
    });
    try {
      this.writeRunControl(activeRun, {
        type: "steer",
        text: userInput,
        guideId,
        riskConfirmed: queuedInput.riskConfirmed === true,
      });
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        queueDepth: this.queueDepth(projectId, taskId),
      };
    }

    removeFromQueue();
    this.removeQueuedUserInputMessage(projectId, taskId, queueId);
    this.appendTaskMessage(projectId, taskId, "event", `Guidance for active run: ${redact(userInput)}`, {
      riskConfirmed: queuedInput.riskConfirmed === true,
      runMode,
      eventType: "control_event",
      controlEvent: true,
      controlEventType: "guide",
      deliveryMode: "guide",
      guideId,
      guidedRunId: activeRun.runId,
      inputEnvelope: envelope,
      convertedFromQueueId: queueId,
    });
    this.emitQueueUpdate(
      emitTarget,
      projectId,
      taskId,
      activeRun.runId,
      "Queued message inserted into the active run.",
      { queueId, guideId, guided: true, activeRunId: activeRun.runId, queueState: "guided" },
    );
    return {
      ok: true,
      guided: true,
      runId: activeRun.runId,
      queueDepth: this.queueDepth(projectId, taskId),
    };
  }

  getGlobalContextFile(kind) {
    return this.contextBuilder.getGlobalFile(kind);
  }

  updateGlobalContextFile(kind, content) {
    return this.contextBuilder.updateGlobalFile(kind, content);
  }

  getProjectContextFile(projectId, kind) {
    return this.contextBuilder.getProjectFile(projectId, kind);
  }

  updateProjectContextFile(projectId, kind, content) {
    return this.contextBuilder.updateProjectFile(projectId, kind, content);
  }

  getTaskContextFile(projectId, taskId, kind) {
    return this.contextBuilder.getTaskFile(projectId, taskId, kind);
  }

  updateTaskContextFile(projectId, taskId, kind, content) {
    return this.contextBuilder.updateTaskFile(projectId, taskId, kind, content);
  }

  extractTaskContextRules(projectId, taskId, target = "task") {
    return this.contextBuilder.extractTaskRules(projectId, taskId, target);
  }

  _getGlobalContextFile(kind) {
    return this.contextBuilder.getGlobalFile(kind);
  }

  _updateGlobalContextFile(kind, content) {
    return this.contextBuilder.updateGlobalFile(kind, content);
  }

  _getProjectContextFile(projectId, kind) {
    return this.contextBuilder.getProjectFile(projectId, kind);
  }

  _updateProjectContextFile(projectId, kind, content) {
    return this.contextBuilder.updateProjectFile(projectId, kind, content);
  }

  _getTaskContextFile(projectId, taskId, kind) {
    return this.contextBuilder.getTaskFile(projectId, taskId, kind);
  }

  _updateTaskContextFile(projectId, taskId, kind, content) {
    return this.contextBuilder.updateTaskFile(projectId, taskId, kind, content);
  }

  _extractTaskContextRules(projectId, taskId, target = "task") {
    return this.contextBuilder.extractTaskRules(projectId, taskId, target);
  }

  normalizeAttachmentRecord(record, uploadsPath) {
    return this.artifactService.normalizeAttachmentRecord(record, uploadsPath);
  }

  copyTaskAttachments(projectId, taskId, filePaths = []) {
    return this.artifactService.copyTaskAttachments(projectId, taskId, filePaths);
  }

  formatAttachmentSize(size) {
    return this.contextBuilder.formatAttachmentSize(size);
  }

  formatAttachmentLine(attachment) {
    return this.contextBuilder.formatAttachmentLine(attachment);
  }

  formatAttachmentsForContext(attachments = []) {
    return this.contextBuilder.formatAttachmentsForContext(attachments);
  }

  attachmentOnlyRequestText(attachments = []) {
    return this.contextBuilder.attachmentOnlyRequestText(attachments);
  }

  renderRecentMessages(messages) {
    return this.contextBuilder.renderRecentMessages(messages);
  }

  applyContextDirective(projectId, taskId, userInput) {
    return this.contextBuilder.applyContextDirective(projectId, taskId, userInput);
  }

  appendRawTurnLog(projectId, taskId, userInput, assistantText, options = {}) {
    return this.contextBuilder.appendRawTurnLog(projectId, taskId, userInput, assistantText, options);
  }

  updateTaskContextAfterTurn(projectId, taskId, userInput, assistantText, options = {}) {
    return this.contextBuilder.updateTaskContextAfterTurn(projectId, taskId, userInput, assistantText, options);
  }

  section(title, content) {
    return this.contextBuilder.section(title, content);
  }

  redouSystemContext() {
    return this.contextBuilder.redouSystemContext();
  }

  outputContract(taskType) {
    return this.contextBuilder.outputContract(taskType);
  }

  inferTaskType(input = {}) {
    const explicit = String(input.taskType || input.capability || "").trim().toLowerCase();
    if (["coding", "research", "experiment", "general"].includes(explicit)) return explicit;
    if (["implementation", "debugging", "environment"].includes(explicit)) return "coding";
    const text = String(input.userInput || "").toLowerCase();
    if (/(experiment|benchmark|metric|auc|rmse|accuracy|loss|实验|指标|评测)/i.test(text)) return "experiment";
    if (/(research|source|citation|compare|调查|研究|资料|证据)/i.test(text)) return "research";
    if (/(code|implement|fix|test|debug|file|实现|修改|修复|调试|测试|文件)/i.test(text)) return "coding";
    return "general";
  }

  rootModelContextTokens() {
    return this.contextBuilder.rootModelContextTokens();
  }

  buildRedouContextPack(parts) {
    return this.contextBuilder.buildRedouContextPack(parts);
  }

  developerRulesContext(project, task, currentRequestText, redactionStats, taskType = "general") {
    return this.contextBuilder.developerRulesContext(project, task, currentRequestText, redactionStats, taskType);
  }

  buildContextMessagesCandidate({
    project,
    task,
    allMessages,
    currentAttachmentText,
    effectiveUserInput,
    currentEnvelope,
    taskType,
    allowEmptyCurrentRequest = false,
    recentMessageLimit = RECENT_MESSAGE_LIMIT,
    attachmentMaxChars = 32000,
    structuredStateMaxChars = 120000,
  }) {
    return this.contextBuilder.buildContextMessagesCandidate({
      project,
      task,
      allMessages,
      currentAttachmentText,
      effectiveUserInput,
      currentEnvelope,
      taskType,
      allowEmptyCurrentRequest,
      recentMessageLimit,
      attachmentMaxChars,
      structuredStateMaxChars,
    });
  }

  buildContextCandidate({
    project,
    task,
    allMessages,
    currentAttachmentText,
    effectiveUserInput,
    currentEnvelope,
    taskType,
    allowEmptyCurrentRequest = false,
    recentMessageLimit = RECENT_MESSAGE_LIMIT,
    attachmentMaxChars = 32000,
    structuredStateMaxChars = 120000,
  }) {
    return this.contextBuilder.buildContextCandidate({
      project,
      task,
      allMessages,
      currentAttachmentText,
      effectiveUserInput,
      currentEnvelope,
      taskType,
      allowEmptyCurrentRequest,
      recentMessageLimit,
      attachmentMaxChars,
      structuredStateMaxChars,
    });
  }

  compactTaskContext(input = {}) {
    return this.contextBuilder.compactTaskContext(input);
  }

  runContextCompactModel(payload, project) {
    return this.contextBuilder.runCompressor(payload, project);
  }

  buildTaskContext(input = {}) {
    return this.contextBuilder.build(input);
  }

  _compactTaskContext({ project, task, budget, compactReason }) {
    return this.contextBuilder.compactTaskContext({ project, task, budget, compactReason });
  }

  _runContextCompactModel(payload, project) {
    if (!this.pythonPath || !fs.existsSync(this.pythonPath)) {
      return { ok: false, error: "Hermes Python runtime is unavailable for context compact." };
    }
    const compactorPath = path.join(__dirname, "..", "..", "redou_context_compactor.py");
    if (!fs.existsSync(compactorPath)) {
      return { ok: false, error: `Context compactor not found: ${compactorPath}` };
    }
    const result = this.processManager.spawnSync(this.pythonPath, [compactorPath], {
      cwd: project.path || this.projectRoot,
      env: this.childEnv({
        HERMES_HOME: this.projectHermesHome(project),
        REDOU_APP_DATA_ROOT: this.appDataRoot(),
        REDOU_PROJECT_ID: project.id,
        REDOU_TASK_ID: payload.taskId,
        REDOU_PROJECT_HERMES_HOME: this.projectHermesHome(project),
        REDOU_PROJECT_SKILLS_DIR: this.projectSkillsDir(project),
        REDOU_HERMES_PROFILE: project.hermesProfile,
        PYTHONUTF8: "1",
        PYTHONUNBUFFERED: "1",
      }),
      input: JSON.stringify(payload || {}),
      encoding: "utf8",
      shell: false,
      timeout: 180000,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
    if (result.error) {
      return { ok: false, error: result.error.message };
    }
    const stdout = String(result.stdout || "").trim();
    if (result.status !== 0 && !stdout) {
      return { ok: false, error: compactMultiline(result.stderr || `compact exited with code ${result.status}`, 1200) };
    }
    try {
      return JSON.parse(stdout);
    } catch (error) {
      return { ok: false, error: `compact returned invalid JSON: ${error.message}`, raw: stdout };
    }
  }

  _buildTaskContext(input = {}) {
    return this.contextBuilder._buildTaskContext(input);
  }

  emitToRenderer(webContents, payload) {
    this.eventBus.sendToRenderer(webContents, payload);
  }

  persistEvent(projectId, taskId, event) {
    if (event.type === "assistant_delta") return;
    const role = event.type === "assistant_message" ? "assistant" : "event";
    this.appendTaskMessage(projectId, taskId, role, eventContent(event), {
      event,
      eventType: event.type,
    });
    this.eventBus.publishPersistedTaskEvent({ projectId, taskId, event });
  }

  enqueueTaskMessage(webContents, input, options = {}) {
    const projectId = String(input.projectId || "").trim();
    const taskId = String(input.taskId || "").trim();
    const key = this.taskQueueKey(projectId, taskId);
    const queue = this.taskQueues.get(key) || [];
    const item = {
      id: options.queueId || crypto.randomUUID(),
      queuedAt: options.queuedAt || isoNow(),
      webContents,
      input: {
        ...input,
        projectId,
        taskId,
        userInput: String(input.userInput || ""),
        attachments: Array.isArray(input.attachments) ? input.attachments : [],
      },
      persistUser: options.persistUser !== false,
      source: options.source || "queue",
      envelope: options.envelope && typeof options.envelope === "object" ? options.envelope : null,
    };
    if (options.front) {
      queue.unshift(item);
    } else {
      queue.push(item);
    }
    this.taskQueues.set(key, queue);
    return item;
  }

  writeRunControl(run, command) {
    this.processManager.writeRunControl(run, command);
  }

  startNextQueuedMessage(projectId, taskId) {
    if (this.shuttingDown) return;
    if (this.activeRunForTask(projectId, taskId)) return;
    const key = this.taskQueueKey(projectId, taskId);
    const queue = this.taskQueues.get(key);
    if (!queue || queue.length === 0) {
      this.taskQueues.delete(key);
      return;
    }
    const next = queue.shift();
    if (queue.length === 0) {
      this.taskQueues.delete(key);
    }
    try {
      const response = this.startHermesRun(next.webContents, next.input, {
        persistUser: next.persistUser,
        deliveryMode: "queue",
        queueId: next.id,
        queuedAt: next.queuedAt,
        envelope: next.envelope || next.input.userInputEnvelope || null,
      });
      this.emitQueueUpdate(
        next.webContents,
        projectId,
        taskId,
        response.runId,
        "Queued message started.",
        { queueId: next.id, source: next.source, activeRunId: response.runId, queueState: "started" },
      );
      if (!response.ok) {
        setImmediate(() => this.startNextQueuedMessage(projectId, taskId));
      }
    } catch (error) {
      const runId = next.id;
      const event = {
        type: "error",
        message: error instanceof Error ? error.message : String(error),
        metadata: { runId, projectId, taskId, queueId: next.id },
      };
      this.emitToRenderer(next.webContents, { runId, projectId, taskId, event });
      this.persistEvent(projectId, taskId, event);
      setImmediate(() => this.startNextQueuedMessage(projectId, taskId));
    }
  }

  startHermesRun(webContents, input = {}, options = {}) {
    if (this.shuttingDown) {
      return { ok: false, warning: "Redou Agent is closing; no new Hermes run was started." };
    }
    const projectId = String(input.projectId || "").trim();
    const taskId = String(input.taskId || "").trim();
    const userInput = String(input.userInput || "");
    const runMode = normalizeRunMode(options.runMode || input.runMode, "execute");
    if (!projectId || !taskId) throw new Error("Select a Project and Task before sending.");

    const { project, task } = this.findProjectAndTask(projectId, taskId);
    if (!project || !task) throw new Error("Project or task not found");
    const attachments = Array.isArray(input.attachments)
      ? input.attachments
          .map((item) => this.normalizeAttachmentRecord(item, task.uploadsPath))
          .filter(Boolean)
      : [];
    if (!userInput.trim() && attachments.length === 0) throw new Error("Message is empty.");
    const contextDirective = input.contextDirectiveApplied
      ? null
      : userInput.trim()
        ? this.applyContextDirective(projectId, taskId, userInput)
        : null;
    const runId = options.runId || crypto.randomUUID();
    const deliveryMode = normalizeDeliveryMode(options.deliveryMode || input.deliveryMode, "new_turn");
    const currentEnvelope = createUserInputEnvelope({
      ...(input.userInputEnvelope && typeof input.userInputEnvelope === "object" ? input.userInputEnvelope : {}),
      ...(options.envelope && typeof options.envelope === "object" ? options.envelope : {}),
      text: userInput,
      runId,
      deliveryMode: deliveryMode === "guide" ? "queue" : deliveryMode,
      status: "consumed",
      consumedAt: isoNow(),
    });
    if (options.envelope?.id) {
      this.updateUserInputEnvelopeStatus(projectId, taskId, options.envelope.id, currentEnvelope);
    }
    const mainModel = this.rootMainModelSelection();
    const taskProvider = String(task.model_provider || "").trim();
    const taskModel = String(task.model || "").trim();
    const effectiveProvider = taskProvider || mainModel.provider || "";
    const effectiveModel = taskProvider ? taskModel : (taskModel || mainModel.model || "");
    const modelSource = taskProvider || taskModel ? "task" : "main";
    const built = this.buildTaskContext({
      projectId,
      taskId,
      userInput,
      attachments,
      maxRecentMessages: input.maxRecentMessages,
      provider: effectiveProvider,
      model: effectiveModel,
      modelContextTokens: input.modelContextTokens,
      deliveryMode,
      currentEnvelope,
    });
    if (!built.metadata.contextValidation?.ok) {
      const warning = `Context validation failed: ${built.metadata.contextValidation.errors.join("; ")}`;
      const event = {
        type: "error",
        message: warning,
        metadata: { runId, projectId, taskId, contextDebugReport: built.metadata.contextDebugReport },
      };
      this.emitToRenderer(webContents, { runId, projectId, taskId, event });
      this.persistEvent(projectId, taskId, event);
      this.updateUserInputEnvelopeStatus(projectId, taskId, currentEnvelope.id, {
        ...currentEnvelope,
        status: "cancelled",
      });
      return { ok: false, runId, warning, context: built.metadata };
    }
    const riskConfirmed = input.riskConfirmed === true;
    if (options.persistUser !== false) {
      this.appendTaskMessage(projectId, taskId, "user", userInput, {
        riskConfirmed,
        deliveryMode,
        runMode,
        inputEnvelope: currentEnvelope,
        ...(contextDirective ? { contextDirective } : {}),
        ...(options.queueId ? { queueId: options.queueId } : {}),
        ...(options.queuedAt ? { queuedAt: options.queuedAt } : {}),
      }, attachments);
    }
    const sessionId = task.hermesSessionId || `redou-${taskId}-${Date.now().toString(36)}`;
    this.updateChatTask(projectId, taskId, { hermesSessionId: sessionId });
    const runMetadata = {
      ...built.metadata,
      modelProvider: effectiveProvider,
      model: effectiveModel,
      modelSource,
      deliveryMode,
      runMode,
      currentRequestId: currentEnvelope.id,
      currentTurnId: currentEnvelope.turnId,
      queueDepth: this.queueDepth(projectId, taskId),
      ...(contextDirective ? { contextDirective } : {}),
      ...(options.queueId ? { queueId: options.queueId } : {}),
      ...(options.queuedAt ? { queuedAt: options.queuedAt } : {}),
    };
    this.log(`redou hermes call adapter=hermes profile=${project.hermesProfile} sessionId=${sessionId} projectId=${projectId} taskId=${taskId} modelProvider=${effectiveProvider || "-"} model=${effectiveModel || "-"} modelSource=${modelSource} projectPath=${redact(project.path)} messagesPath=${redact(task.messagesPath)} recentMessageCount=${built.metadata.recentMessageCount} includedFiles=${built.metadata.includedFiles.map(redact).join("|")} contextLength=${built.metadata.contextLength}`);

    const startedEvent = {
      type: "raw_log",
      content: "Hermes local runtime started.",
      metadata: { runId, projectId, taskId, context: runMetadata },
    };
    this.emitToRenderer(webContents, { runId, projectId, taskId, event: startedEvent });
    this.persistEvent(projectId, taskId, startedEvent);

    if (!this.pythonPath || !fs.existsSync(this.pythonPath)) {
      const warning = "Hermes Python runtime is unavailable. The message was saved locally, but no agent run was started.";
      this.log(`redou hermes fallback projectId=${projectId} taskId=${taskId}: ${warning}`);
      const event = { type: "error", message: warning, metadata: { runId, projectId, taskId } };
      this.emitToRenderer(webContents, { runId, projectId, taskId, event });
      this.persistEvent(projectId, taskId, event);
      this.updateUserInputEnvelopeStatus(projectId, taskId, currentEnvelope.id, {
        ...currentEnvelope,
        status: "cancelled",
      });
      return { ok: false, runId, warning, context: runMetadata };
    }

    const adapterPath = path.join(__dirname, "..", "..", "hermes_adapter.py");
    const runStartedAtMs = Date.now();
    const runStartedAt = new Date(runStartedAtMs).toISOString();
    let runRecord = null;
    let completed = false;
    let finalAssistantText = "";
    const activeCommands = new Map();

    const handleEvent = (rawEvent) => {
      const baseEvent = rawEvent && typeof rawEvent === "object"
        ? rawEvent
        : { type: "raw_log", content: String(rawEvent || "") };
      const event = {
        ...baseEvent,
        metadata: {
          ...(baseEvent.metadata || {}),
          runId,
          projectId,
          taskId,
          hermesProfile: project.hermesProfile,
          hermesSessionId: sessionId,
        },
      };
      if (event.type === "run_stage") {
        event.runId = event.runId || runId;
        event.projectId = event.projectId || projectId;
        event.taskId = event.taskId || taskId;
        event.turnId = event.turnId || currentEnvelope.turnId;
      }
      this.updateActiveRunFromEvent(runRecord, event);
      collectTurnArtifactFromEvent(runRecord.turnArtifacts, event);
      const command = event.type === "tool_start" ? inferCommandFromTool(event) : null;
      if (command) {
        const key = eventToolKey(event);
        if (key) activeCommands.set(key, command);
        recordTurnArtifact(runRecord.turnArtifacts, "commands", command);
        const commandEvent = {
          type: "command_start",
          command,
          cwd: project.path || this.projectRoot,
          metadata: event.metadata,
        };
        this.emitToRenderer(webContents, { runId, projectId, taskId, event: commandEvent });
        this.persistEvent(projectId, taskId, commandEvent);
      }
      if (event.type === "tool_output") {
        const commandForOutput = activeCommands.get(eventToolKey(event));
        if (commandForOutput) {
          const commandEvent = {
            type: "command_output",
            content: typeof event.output === "string" ? event.output : JSON.stringify(event.output ?? {}, null, 2),
            metadata: { ...event.metadata, command: commandForOutput },
          };
          this.emitToRenderer(webContents, { runId, projectId, taskId, event: commandEvent });
          this.persistEvent(projectId, taskId, commandEvent);
        }
        const fileEvent = inferFileChangedFromTool(event);
        if (fileEvent) {
          recordTurnArtifact(runRecord.turnArtifacts, "files", fileEvent.path || fileEvent.summary);
          const enrichedFileEvent = { ...fileEvent, metadata: event.metadata };
          this.emitToRenderer(webContents, { runId, projectId, taskId, event: enrichedFileEvent });
          this.persistEvent(projectId, taskId, enrichedFileEvent);
        }
      }
      if (event.type === "tool_end") {
        const key = eventToolKey(event);
        const commandForEnd = activeCommands.get(key);
        if (commandForEnd) {
          const commandEvent = {
            type: "command_end",
            success: event.success !== false,
            metadata: { ...event.metadata, command: commandForEnd },
          };
          this.emitToRenderer(webContents, { runId, projectId, taskId, event: commandEvent });
          this.persistEvent(projectId, taskId, commandEvent);
          activeCommands.delete(key);
        }
      }
      if (event.type === "assistant_message") {
        finalAssistantText = String(event.content || "").trim();
      }
      if (event.type === "done") {
        completed = true;
        const completedAtMs = Date.now();
        const startedAtMs = Number(runRecord.startedAtMs || Date.parse(runRecord.startedAt) || completedAtMs);
        const durationMs = Math.max(0, completedAtMs - startedAtMs);
        event.metadata = {
          ...(event.metadata || {}),
          startedAt: event.metadata?.startedAt || runRecord.startedAt,
          completedAt: event.metadata?.completedAt || new Date(completedAtMs).toISOString(),
          durationMs: event.metadata?.durationMs ?? durationMs,
          durationSeconds: event.metadata?.durationSeconds ?? Math.round(durationMs / 100) / 10,
        };
        if (runRecord.stopRequested) {
          this.updateUserInputEnvelopeStatus(projectId, taskId, currentEnvelope.id, {
            ...currentEnvelope,
            status: "cancelled",
          });
          event.metadata = {
            ...(event.metadata || {}),
            cancelled: true,
            stopRequested: true,
          };
        } else {
          const contextUpdate = runMode === "plan"
            ? null
            : this.updateTaskContextAfterTurn(
                projectId,
                taskId,
                userInput,
                finalAssistantText,
                { artifacts: runRecord.turnArtifacts, attachments },
              );
          this.updateUserInputEnvelopeStatus(projectId, taskId, currentEnvelope.id, {
            ...currentEnvelope,
            status: "completed",
          });
          if (runMode === "plan") {
            event.metadata = {
              ...(event.metadata || {}),
              planReviewRequired: true,
            };
          }
          if (contextUpdate) {
            event.metadata = {
              ...(event.metadata || {}),
              taskContextUpdated: true,
              taskContextPath: contextUpdate.path,
            };
          }
        }
        const pendingSteer =
          typeof event.metadata?.pendingSteer === "string"
            ? event.metadata.pendingSteer.trim()
            : "";
        if (pendingSteer) {
          const queued = this.enqueueTaskMessage(webContents, {
            projectId,
            taskId,
            userInput: pendingSteer,
            attachments: [],
            maxRecentMessages: input.maxRecentMessages,
            maxIterations: input.maxIterations,
            riskConfirmed: false,
          }, { persistUser: false, front: true, source: "guide-leftover" });
          this.emitQueueUpdate(
            webContents,
            projectId,
            taskId,
            runId,
            "Guidance arrived after the final answer and was moved to the next turn.",
            { queueId: queued.id, source: queued.source, queueState: "queued" },
          );
        }
      }
      this.emitToRenderer(webContents, { runId, projectId, taskId, event });
      this.persistEvent(projectId, taskId, event);
    };

    this.processManager.startJsonLineProcess({
      command: this.pythonPath,
      args: [adapterPath],
      options: {
        cwd: project.path || this.projectRoot,
        env: this.childEnv({
          HERMES_HOME: this.projectHermesHome(project),
          REDOU_APP_DATA_ROOT: this.appDataRoot(),
          REDOU_PROJECT_ID: projectId,
          REDOU_TASK_ID: taskId,
          REDOU_PROJECT_HERMES_HOME: this.projectHermesHome(project),
          REDOU_PROJECT_SKILLS_DIR: this.projectSkillsDir(project),
          REDOU_HERMES_PROFILE: project.hermesProfile,
          HERMES_INTERACTIVE: "1",
          HERMES_EXEC_ASK: "",
          REDOU_RUN_ID: runId,
          REDOU_TURN_ID: currentEnvelope.turnId,
          PYTHONUTF8: "1",
          PYTHONUNBUFFERED: "1",
        }),
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
      input: {
        projectId,
        taskId,
        hermesProfile: project.hermesProfile,
        hermesSessionId: sessionId,
        systemContext: built.systemContext,
        userContext: built.userContext,
        contextMessages: built.contextMessages,
        attachments,
        metadata: runMetadata,
        riskConfirmed,
        model: effectiveModel,
        provider: effectiveProvider,
        workspacePath: project.path || this.projectRoot,
        runMode,
        maxIterations: Number(input.maxIterations || 40),
      },
      onStarted: (child) => {
        runRecord = {
          child,
          projectId,
          taskId,
          webContents,
          startedAt: runStartedAt,
          startedAtMs: runStartedAtMs,
          lastActiveAtMs: runStartedAtMs,
          hermesSessionId: sessionId,
          model: effectiveModel,
          provider: effectiveProvider,
          contextTokens: toInt(runMetadata.contextTokens),
          inputTokens: 0,
          outputTokens: 0,
          outputEstimateTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          apiCalls: 0,
          estimatedCostUsd: 0,
          assistantDeltaText: "",
          stopRequested: false,
          currentRequestEnvelope: currentEnvelope,
          turnArtifacts: emptyTurnArtifacts(),
        };
        seedAttachmentArtifacts(runRecord.turnArtifacts, attachments);
        this.processManager.registerRun(runId, runRecord);
        this.eventBus.publishTaskStarted({ projectId, taskId, runId });
      },
      onStdoutEvent: (event) => {
        handleEvent(event);
      },
      onStderrLine: (line) => {
        handleEvent({ type: "raw_log", content: redact(line), metadata: { stream: "stderr", folded: true } });
      },
      onError: (error) => {
        handleEvent({ type: "error", message: error.message });
      },
      onExit: ({ code }) => {
        const run = this.activeRuns.get(runId);
        const stopRequested = run?.stopRequested === true || runRecord?.stopRequested === true || this.shuttingDown;
        if (!completed) {
          if (code === 0 || stopRequested) {
            handleEvent({ type: "done", metadata: { exitCode: code } });
          } else {
            handleEvent({ type: "error", message: `Hermes runtime exited with code ${code}` });
            handleEvent({ type: "done", metadata: { exitCode: code } });
          }
        }
        this.processManager.deleteRun(runId);
        if (!this.shuttingDown) {
          setImmediate(() => this.startNextQueuedMessage(projectId, taskId));
        }
      },
    });

    return { ok: true, runId, context: runMetadata };
  }

  sendMessage(webContents, input = {}) {
    const projectId = String(input.projectId || "").trim();
    const taskId = String(input.taskId || "").trim();
    const userInput = String(input.userInput || "");
    if (!projectId || !taskId) throw new Error("Select a Project and Task before sending.");

    const { project, task } = this.findProjectAndTask(projectId, taskId);
    if (!project || !task) throw new Error("Project or task not found");

    const attachments = Array.isArray(input.attachments)
      ? input.attachments
          .map((item) => this.normalizeAttachmentRecord(item, task.uploadsPath))
          .filter(Boolean)
      : [];
    if (!userInput.trim() && attachments.length === 0) throw new Error("Message is empty.");
    const activeRun = this.activeRunForTask(projectId, taskId);
    const deliveryMode = normalizeDeliveryMode(input.deliveryMode, activeRun ? "queue" : "new_turn");
    const runMode = normalizeRunMode(input.runMode, "execute");
    const riskConfirmed = input.riskConfirmed === true;

    if (activeRun && deliveryMode === "interrupt_replace") {
      const replacedRunId = activeRun.runId;
      const envelope = createUserInputEnvelope({
        text: userInput,
        deliveryMode: "interrupt_replace",
        status: "consumed",
        targetRunId: replacedRunId,
        consumedAt: isoNow(),
      });
      try {
        activeRun.stopRequested = true;
        const stored = this.activeRuns.get(replacedRunId);
        if (stored) {
          stored.stopRequested = true;
          stored.replacedByEnvelopeId = envelope.id;
        }
        this.processManager.terminate(activeRun.child, { force: true });
      } catch {
        // Best-effort replacement: the old run exit handler also observes stopRequested.
      }
      const event = {
        type: "error",
        message: "Run interrupted and replaced by a new user request.",
        metadata: {
          runId: replacedRunId,
          projectId,
          taskId,
          cancelled: true,
          stopRequested: true,
          replacementInputEnvelopeId: envelope.id,
        },
      };
      this.emitToRenderer(webContents, { runId: replacedRunId, projectId, taskId, event });
      this.persistEvent(projectId, taskId, event);
      return this.startHermesRun(webContents, {
        ...input,
        projectId,
        taskId,
        userInput,
        attachments,
        riskConfirmed,
        userInputEnvelope: envelope,
      }, { deliveryMode: "interrupt_replace", envelope });
    }

    if (activeRun && deliveryMode === "guide" && runMode === "execute" && attachments.length === 0) {
      const guideId = crypto.randomUUID();
      const envelope = createUserInputEnvelope({
        id: guideId,
        text: userInput,
        runId: activeRun.runId,
        deliveryMode: "guide",
        status: "consumed",
        targetRunId: activeRun.runId,
        consumedAt: isoNow(),
      });
      this.appendTaskMessage(projectId, taskId, "event", `Guidance for active run: ${redact(userInput)}`, {
        riskConfirmed,
        runMode,
        eventType: "control_event",
        controlEvent: true,
        controlEventType: "guide",
        deliveryMode: "guide",
        guideId,
        guidedRunId: activeRun.runId,
        inputEnvelope: envelope,
      });
      try {
        this.writeRunControl(activeRun, {
          type: "steer",
          text: userInput,
          guideId,
          riskConfirmed,
        });
        this.updateUserInputEnvelopeStatus(projectId, taskId, envelope.id, {
          ...envelope,
          status: "completed",
        });
        this.emitQueueUpdate(
          webContents,
          projectId,
          taskId,
          activeRun.runId,
          "Guidance inserted into the active run.",
          { guideId, guided: true, activeRunId: activeRun.runId, queueState: "guided" },
        );
        return {
          ok: true,
          runId: activeRun.runId,
          guided: true,
          queueDepth: this.queueDepth(projectId, taskId),
        };
      } catch (error) {
        this.updateUserInputEnvelopeStatus(projectId, taskId, envelope.id, {
          ...envelope,
          status: "cancelled",
        });
        const queued = this.enqueueTaskMessage(webContents, {
          ...input,
          projectId,
          taskId,
          userInput,
          attachments,
          riskConfirmed,
        }, { persistUser: true, front: true, source: "queue" });
        const warning = error instanceof Error ? error.message : String(error);
        this.emitQueueUpdate(
          webContents,
          projectId,
          taskId,
          activeRun.runId,
          "Guidance could not be inserted and was queued for the next turn.",
          { queueId: queued.id, guideId, warning, queueState: "queued" },
        );
        return {
          ok: true,
          runId: activeRun.runId,
          queued: true,
          queueId: queued.id,
          queueDepth: this.queueDepth(projectId, taskId),
          warning,
        };
      }
    }

    if (activeRun) {
      const envelope = createUserInputEnvelope({
        text: userInput,
        deliveryMode: "queue",
        status: "pending",
        targetRunId: activeRun.runId,
      });
      const queueId = envelope.id;
      const queuedAt = isoNow();
      this.appendTaskMessage(projectId, taskId, "user", userInput, {
        riskConfirmed,
        deliveryMode: "queue",
        requestedDeliveryMode: deliveryMode,
        runMode,
        queueId,
        queuedAt,
        inputEnvelope: envelope,
        ...(deliveryMode === "guide" && attachments.length > 0
          ? { guideFallbackReason: "attachments" }
          : {}),
      }, attachments);
      const queued = this.enqueueTaskMessage(webContents, {
        ...input,
        projectId,
        taskId,
        userInput,
        attachments,
        riskConfirmed,
        userInputEnvelope: envelope,
      }, { persistUser: false, queueId, queuedAt, source: "queue", envelope });
      this.emitQueueUpdate(
        webContents,
        projectId,
        taskId,
        activeRun.runId,
        deliveryMode === "guide" && attachments.length > 0
          ? "Attachments are queued for the next turn."
          : deliveryMode === "guide" && runMode === "plan"
            ? "Plan requests are queued for the next turn."
          : "Message queued for the next turn.",
        { queueId: queued.id, activeRunId: activeRun.runId, queueState: "queued" },
      );
      return {
        ok: true,
        runId: activeRun.runId,
        queued: true,
        queueId: queued.id,
        queueDepth: this.queueDepth(projectId, taskId),
        ...(deliveryMode === "guide" && attachments.length > 0
          ? { warning: "Guidance with attachments is queued for the next turn." }
          : deliveryMode === "guide" && runMode === "plan"
            ? { warning: "Plan requests are queued for the next turn." }
          : {}),
      };
    }

    return this.startHermesRun(webContents, {
      ...input,
      projectId,
      taskId,
      userInput,
      attachments,
      riskConfirmed,
    }, { deliveryMode: "new_turn" });
  }

  stopRun(runId, webContents) {
    return this.processManager.stopRun(runId, {
      webContents,
      emitToRenderer: (target, payload) => this.emitToRenderer(target, payload),
      persistEvent: (projectId, taskId, event) => this.persistEvent(projectId, taskId, event),
    });
  }

  stopTaskRun(projectId, taskId, webContents) {
    const run = this.activeRunForTask(projectId, taskId);
    if (!run) return { ok: false, message: "No active run for this task." };
    return this.stopRun(run.runId, webContents);
  }
}

module.exports = {
  RedouLocalService,
  ContextValidator,
  SecretRedactor,
  ToolLogSummarizer,
  TaskStateManager,
  compressTaskContext,
  analysisTaskProcessStatus,
};
