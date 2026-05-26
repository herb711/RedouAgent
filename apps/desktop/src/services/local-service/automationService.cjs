'use strict';

const path = require('node:path');
const { createDefaultTask } = require('../../core/models/task.cjs');
const { REDOU_CODEX_RUNTIME_ID } = require('../../runtimes/redou-codex/redouCodexRuntimeConfig.cjs');
const { enqueueTaskTurn, startRuntimeTurn } = require('../../orchestrator/taskQueue.cjs');
const { readJsonFile, writeJsonFile } = require('../../platform/filesystem/jsonFile.cjs');
const { appendJsonl, readJsonl } = require('../../platform/filesystem/jsonlFile.cjs');

const SCHEDULE_TYPES = new Set(['once', 'daily', 'weekly', 'monthly', 'interval', 'rrule', 'condition_watch']);
const TIMING_MODES = new Set(['exact_schedule', 'flexible_schedule', 'condition_watch']);
const CREATED_BY = new Set(['user', 'model']);
const CREATED_FROM = new Set(['settings', 'conversation', 'automation_page', 'tool_call']);
const REPLY_TARGETS = new Set(['bound_conversation', 'automation_log_only', 'system_notification']);
const WEEKDAY_NAMES = new Map([
  ['SU', 0],
  ['SUN', 0],
  ['MO', 1],
  ['MON', 1],
  ['TU', 2],
  ['TUE', 2],
  ['WE', 3],
  ['WED', 3],
  ['TH', 4],
  ['THU', 4],
  ['FR', 5],
  ['FRI', 5],
  ['SA', 6],
  ['SAT', 6],
]);

function nowIso() {
  return new Date().toISOString();
}

function automationId() {
  return `automation:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function runId() {
  return `automation-run:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function storePath(dependencies = {}) {
  return path.join(dependencies.dataRoot || process.cwd(), 'automations.json');
}

function runsPath(dependencies = {}) {
  return path.join(dependencies.dataRoot || process.cwd(), 'automation-runs.jsonl');
}

function cleanString(value) {
  return String(value || '').trim();
}

function nullableString(value) {
  const text = cleanString(value);
  return text || null;
}

function boolFrom(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') return /^(1|true|yes|on|active)$/i.test(value);
  return Boolean(value);
}

function positiveInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function dateOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoOrNull(value) {
  const date = dateOrNull(value);
  return date ? date.toISOString() : null;
}

function inferScheduleType(input = {}) {
  const explicit = cleanString(input.scheduleType || input.schedule_type);
  if (SCHEDULE_TYPES.has(explicit)) return explicit;
  if (input.rrule) return 'rrule';
  const text = cleanString(input.scheduleText || input.schedule || input.rrule).toLowerCase();
  if (!text || text === 'manual') return 'once';
  if (text.includes('condition')) return 'condition_watch';
  if (text.startsWith('rrule:') || text.includes('freq=')) return 'rrule';
  if (text.includes('daily')) return 'daily';
  if (text.includes('weekly') || /\b(mon|tue|wed|thu|fri|sat|sun|mo|tu|we|th|fr|sa|su)\b/i.test(text)) return 'weekly';
  if (text.includes('monthly')) return 'monthly';
  if (text === 'hourly' || /\bevery\s+\d+\s+(minute|minutes|hour|hours|day|days)\b/i.test(text)) return 'interval';
  return 'once';
}

function timingModeFor(scheduleType, input = {}) {
  const explicit = cleanString(input.timingMode || input.timing_mode);
  if (TIMING_MODES.has(explicit)) return explicit;
  if (scheduleType === 'condition_watch') return 'condition_watch';
  if (scheduleType === 'interval') return 'flexible_schedule';
  return 'exact_schedule';
}

function parseTimeParts(input = {}) {
  const date = dateOrNull(input.startAt || input.start_at || input.nextRunAt || input.next_run_at);
  if (date) return { hour: date.getHours(), minute: date.getMinutes() };
  const text = cleanString(input.scheduleText || input.schedule || input.rrule);
  const match = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!match) return { hour: 9, minute: 0 };
  return {
    hour: Math.min(23, Math.max(0, Number(match[1]))),
    minute: Math.min(59, Math.max(0, Number(match[2]))),
  };
}

function parseIntervalMinutes(input = {}) {
  const explicit = Number(input.intervalMinutes || input.interval_minutes);
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  const text = cleanString(input.scheduleText || input.schedule || '').toLowerCase();
  if (text === 'hourly') return 60;
  const match = text.match(/\bevery\s+(\d+)\s+(minute|minutes|hour|hours|day|days)\b/i);
  if (!match) return input.scheduleType === 'condition_watch' ? 60 : 0;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith('hour')) return amount * 60;
  if (unit.startsWith('day')) return amount * 24 * 60;
  return amount;
}

function parseWeeklyDays(input = {}) {
  const raw = input.weekdays || input.weekday || input.byday || input.byDay;
  const values = Array.isArray(raw) ? raw : cleanString(raw).split(/[,\s]+/);
  const parsed = values
    .map((value) => {
      if (value === undefined || value === null || value === '') return null;
      const numeric = Number(value);
      if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 6) return numeric;
      return WEEKDAY_NAMES.get(cleanString(value).toUpperCase()) ?? null;
    })
    .filter((value) => value !== null);
  if (parsed.length) return Array.from(new Set(parsed)).sort();
  const start = dateOrNull(input.startAt || input.start_at);
  return [start ? start.getDay() : 1];
}

function parseRrule(rrule = '') {
  const text = cleanString(rrule).replace(/^RRULE:/i, '');
  const parts = {};
  for (const pair of text.split(';')) {
    const [key, value] = pair.split('=');
    if (!key || value === undefined) continue;
    parts[key.trim().toUpperCase()] = value.trim();
  }
  return parts;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date, months) {
  const next = new Date(date);
  const day = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const maxDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, maxDay));
  return next;
}

function dailyNextRunAt(task, fromDate) {
  const { hour, minute } = parseTimeParts(task);
  const interval = Math.max(1, positiveInt(task.interval || task.scheduleInterval, 1));
  let next = new Date(fromDate);
  next.setHours(hour, minute, 0, 0);
  while (next <= fromDate) next = addDays(next, interval);
  return next.toISOString();
}

function weeklyNextRunAt(task, fromDate) {
  const { hour, minute } = parseTimeParts(task);
  const interval = Math.max(1, positiveInt(task.interval || task.scheduleInterval, 1));
  const weekdays = parseWeeklyDays(task);
  let best = null;
  for (let offset = 0; offset < 7 * interval + 7; offset += 1) {
    const candidate = addDays(fromDate, offset);
    if (!weekdays.includes(candidate.getDay())) continue;
    candidate.setHours(hour, minute, 0, 0);
    if (candidate <= fromDate) continue;
    if (!best || candidate < best) best = candidate;
  }
  return (best || addDays(fromDate, 7 * interval)).toISOString();
}

function monthlyNextRunAt(task, fromDate) {
  const { hour, minute } = parseTimeParts(task);
  const start = dateOrNull(task.startAt);
  const day = Math.min(31, Math.max(1, positiveInt(task.monthDay || task.month_day, start ? start.getDate() : 1)));
  const interval = Math.max(1, positiveInt(task.interval || task.scheduleInterval, 1));
  let next = new Date(fromDate);
  next.setDate(1);
  next.setHours(hour, minute, 0, 0);
  for (let index = 0; index < 24; index += interval) {
    const candidate = addMonths(next, index);
    const maxDay = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate();
    candidate.setDate(Math.min(day, maxDay));
    if (candidate > fromDate) return candidate.toISOString();
  }
  return addMonths(fromDate, interval).toISOString();
}

function intervalNextRunAt(task, fromDate) {
  const minutes = parseIntervalMinutes(task);
  if (!minutes) return null;
  const base = dateOrNull(task.lastRunAt) || dateOrNull(task.startAt) || dateOrNull(task.createdAt) || fromDate;
  let next = new Date(base.getTime() + minutes * 60000);
  while (next <= fromDate) next = new Date(next.getTime() + minutes * 60000);
  return next.toISOString();
}

function rruleNextRunAt(task, fromDate) {
  const parts = parseRrule(task.rrule || task.scheduleText);
  const freq = cleanString(parts.FREQ).toUpperCase();
  const interval = Math.max(1, positiveInt(parts.INTERVAL, 1));
  const hour = positiveInt(parts.BYHOUR, parseTimeParts(task).hour);
  const minute = positiveInt(parts.BYMINUTE, parseTimeParts(task).minute);
  const withParts = { ...task, interval, scheduleInterval: interval, startAt: task.startAt };
  if (freq === 'HOURLY') return intervalNextRunAt({ ...withParts, scheduleText: `every ${interval} hours` }, fromDate);
  if (freq === 'DAILY') return dailyNextRunAt({ ...withParts, startAt: task.startAt, scheduleText: `daily ${hour}:${String(minute).padStart(2, '0')}` }, fromDate);
  if (freq === 'WEEKLY') {
    const weekdays = cleanString(parts.BYDAY).split(',').map((day) => WEEKDAY_NAMES.get(day.toUpperCase())).filter((day) => day !== undefined);
    return weeklyNextRunAt({ ...withParts, weekdays, scheduleText: `weekly ${hour}:${String(minute).padStart(2, '0')}` }, fromDate);
  }
  if (freq === 'MONTHLY') {
    return monthlyNextRunAt({ ...withParts, monthDay: positiveInt(parts.BYMONTHDAY, undefined), scheduleText: `monthly ${hour}:${String(minute).padStart(2, '0')}` }, fromDate);
  }
  return null;
}

function computeNextRunAt(task, from = new Date()) {
  if (!task || !task.enabled) return null;
  const fromDate = dateOrNull(from) || new Date();
  const scheduleType = inferScheduleType(task);
  if (scheduleType === 'once') {
    const start = dateOrNull(task.startAt || task.nextRunAt);
    if (!start || task.lastRunAt) return null;
    return start > fromDate ? start.toISOString() : fromDate.toISOString();
  }
  if (scheduleType === 'daily') return dailyNextRunAt(task, fromDate);
  if (scheduleType === 'weekly') return weeklyNextRunAt(task, fromDate);
  if (scheduleType === 'monthly') return monthlyNextRunAt(task, fromDate);
  if (scheduleType === 'interval' || scheduleType === 'condition_watch') return intervalNextRunAt(task, fromDate);
  if (scheduleType === 'rrule') return rruleNextRunAt(task, fromDate);
  return null;
}

function inferScheduleText(input = {}, scheduleType) {
  const existing = cleanString(input.scheduleText || input.schedule || input.rrule);
  if (existing) return existing;
  if (scheduleType === 'once') return 'once';
  if (scheduleType === 'interval') return 'hourly';
  if (scheduleType === 'condition_watch') return 'condition watch every 60 minutes';
  const { hour, minute } = parseTimeParts(input);
  return `${scheduleType} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeAutomation(input = {}) {
  const now = nowIso();
  const createdAt = isoOrNull(input.createdAt || input.created_at) || now;
  const scheduleType = inferScheduleType(input);
  const statusText = cleanString(input.status).toUpperCase();
  const enabled = input.enabled !== undefined
    ? boolFrom(input.enabled)
    : statusText === 'PAUSED'
      ? false
      : true;
  const title = cleanString(input.title || input.name) || 'Untitled automation';
  const createdBy = CREATED_BY.has(cleanString(input.createdBy || input.created_by)) ? cleanString(input.createdBy || input.created_by) : 'user';
  const createdFrom = CREATED_FROM.has(cleanString(input.createdFrom || input.created_from)) ? cleanString(input.createdFrom || input.created_from) : 'automation_page';
  const conversationId = nullableString(input.conversationId || input.conversation_id || input.taskId || input.task_id);
  const replyTarget = REPLY_TARGETS.has(cleanString(input.replyTarget || input.reply_target))
    ? cleanString(input.replyTarget || input.reply_target)
    : conversationId
      ? 'bound_conversation'
      : 'automation_log_only';
  const task = {
    id: String(input.id || automationId()),
    title,
    name: title,
    description: cleanString(input.description),
    prompt: cleanString(input.prompt),
    enabled,
    status: enabled ? 'ACTIVE' : 'PAUSED',
    scheduleType,
    scheduleText: inferScheduleText(input, scheduleType),
    schedule: inferScheduleText(input, scheduleType),
    rrule: nullableString(input.rrule),
    startAt: isoOrNull(input.startAt || input.start_at),
    nextRunAt: isoOrNull(input.nextRunAt || input.next_run_at),
    lastRunAt: isoOrNull(input.lastRunAt || input.last_run_at),
    timezone: cleanString(input.timezone) || Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
    timingMode: timingModeFor(scheduleType, input),
    intervalMinutes: parseIntervalMinutes({ ...input, scheduleType }),
    weekdays: parseWeeklyDays(input),
    monthDay: positiveInt(input.monthDay || input.month_day, dateOrNull(input.startAt || input.start_at)?.getDate() || 1),
    createdBy,
    createdFrom,
    projectId: nullableString(input.projectId || input.project_id),
    conversationId,
    sourceMessageId: nullableString(input.sourceMessageId || input.source_message_id),
    sourceUserMessageId: nullableString(input.sourceUserMessageId || input.source_user_message_id),
    sourceAssistantMessageId: nullableString(input.sourceAssistantMessageId || input.source_assistant_message_id),
    sourceModel: nullableString(input.sourceModel || input.source_model),
    replyTarget,
    exposeResultInConversation: boolFrom(input.exposeResultInConversation ?? input.expose_result_in_conversation, replyTarget === 'bound_conversation'),
    requireConfirmationBeforeRun: boolFrom(input.requireConfirmationBeforeRun ?? input.require_confirmation_before_run, false),
    maxRetries: positiveInt(input.maxRetries ?? input.max_retries, 0),
    retryCount: positiveInt(input.retryCount ?? input.retry_count, 0),
    createdAt,
    updatedAt: isoOrNull(input.updatedAt || input.updated_at) || now,
    lastTaskId: nullableString(input.lastTaskId || input.last_task_id),
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
  };
  return task;
}

function normalizeAutomationPatch(existing, payload) {
  const merged = {
    ...existing,
    ...payload,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: nowIso(),
  };
  if (payload.status !== undefined && payload.enabled === undefined) {
    merged.enabled = cleanString(payload.status).toUpperCase() !== 'PAUSED';
  }
  const normalized = normalizeAutomation(merged);
  const scheduleTouched = [
    'enabled',
    'status',
    'scheduleType',
    'scheduleText',
    'schedule',
    'rrule',
    'startAt',
    'nextRunAt',
    'intervalMinutes',
    'weekdays',
    'monthDay',
  ].some((key) => Object.prototype.hasOwnProperty.call(payload, key));
  normalized.updatedAt = merged.updatedAt;
  if (scheduleTouched && payload.nextRunAt === undefined) {
    normalized.nextRunAt = computeNextRunAt(normalized, new Date());
  }
  return normalized;
}

async function readAutomations(dependencies = {}) {
  const value = await readJsonFile(storePath(dependencies), []);
  return Array.isArray(value)
    ? value.map((item) => {
        const normalized = normalizeAutomation(item);
        if (normalized.enabled && !normalized.nextRunAt) normalized.nextRunAt = computeNextRunAt(normalized, new Date());
        return normalized;
      })
    : [];
}

async function writeAutomations(dependencies = {}, automations = []) {
  await writeJsonFile(storePath(dependencies), automations.map(normalizeAutomation));
  return automations.map(normalizeAutomation);
}

function filterAutomations(automations, filter = {}) {
  const projectId = nullableString(filter.projectId || filter.project_id);
  const conversationId = nullableString(filter.conversationId || filter.conversation_id || filter.taskId || filter.task_id);
  return automations.filter((automation) => {
    if (projectId && automation.projectId && automation.projectId !== projectId) return false;
    if (conversationId && automation.conversationId !== conversationId) return false;
    return true;
  });
}

async function listAutomationRuns(payload = {}, dependencies = {}) {
  const automationIdValue = nullableString(payload.id || payload.automationId || payload.automation_id);
  const limit = Math.max(1, Math.min(200, positiveInt(payload.limit, 25)));
  const runs = await readJsonl(runsPath(dependencies));
  const filtered = automationIdValue ? runs.filter((run) => run.automationId === automationIdValue) : runs;
  return {
    runs: filtered
      .sort((a, b) => String(b.startedAt || b.createdAt || '').localeCompare(String(a.startedAt || a.createdAt || '')))
      .slice(0, limit),
  };
}

async function appendAutomationRun(dependencies = {}, run = {}) {
  const record = {
    id: run.id || runId(),
    automationId: run.automationId || null,
    status: run.status || 'started',
    trigger: run.trigger || 'manual',
    startedAt: run.startedAt || nowIso(),
    finishedAt: run.finishedAt || null,
    taskId: run.taskId || null,
    projectId: run.projectId || null,
    conversationId: run.conversationId || null,
    turnId: run.turnId || null,
    error: run.error || null,
    retryAttempt: positiveInt(run.retryAttempt, 0),
    details: run.details || null,
  };
  await appendJsonl(runsPath(dependencies), record);
  return record;
}

async function listAutomations(payload = {}, dependencies = {}) {
  const automations = filterAutomations(await readAutomations(dependencies), payload);
  return { automations };
}

async function getAutomation(payload = {}, dependencies = {}) {
  const id = String(payload.id || payload.automationId || '');
  if (!id) throw automationError('Automation id is required.', 'AUTOMATION_ID_REQUIRED');
  const automations = await readAutomations(dependencies);
  const automation = automations.find((item) => item.id === id);
  if (!automation) throw automationError(`Automation not found: ${id}`, 'AUTOMATION_NOT_FOUND');
  const runs = await listAutomationRuns({ id, limit: payload.limit || 25 }, dependencies);
  return { automation, ...runs };
}

function automationError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

async function createAutomation(payload = {}, dependencies = {}) {
  if (!cleanString(payload.prompt)) {
    throw automationError('Automation prompt is required.', 'AUTOMATION_PROMPT_REQUIRED');
  }
  const automations = await readAutomations(dependencies);
  const automation = normalizeAutomation({
    createdBy: 'user',
    createdFrom: 'automation_page',
    ...payload,
  });
  if (automation.enabled && !automation.nextRunAt) automation.nextRunAt = computeNextRunAt(automation, new Date());
  const next = [automation, ...automations.filter((item) => item.id !== automation.id)];
  await writeAutomations(dependencies, next);
  return { automations: filterAutomations(next, payload), automation };
}

async function createAutomationFromTool(args = {}, context = {}, dependencies = {}) {
  const settings = await automationSettings(dependencies);
  if (!settings.allowModelCreate || !settings.exposeToolToModel) {
    throw automationError('Automation tool access is disabled in settings.', 'AUTOMATION_TOOL_DISABLED');
  }
  const payload = {
    ...args,
    title: args.title || args.name || cleanString(args.prompt).slice(0, 72) || 'Automation from conversation',
    createdBy: 'model',
    createdFrom: 'tool_call',
    projectId: context.projectId || args.projectId || null,
    conversationId: context.conversationId || context.taskId || args.conversationId || null,
    sourceMessageId: context.sourceMessageId || context.callId || null,
    sourceUserMessageId: context.sourceUserMessageId || null,
    sourceAssistantMessageId: context.sourceAssistantMessageId || context.callId || null,
    sourceModel: context.sourceModel || null,
    replyTarget: 'bound_conversation',
    exposeResultInConversation: true,
  };
  return createAutomation(payload, dependencies);
}

async function updateAutomation(payload = {}, dependencies = {}) {
  const id = String(payload.id || payload.automationId || '');
  if (!id) throw automationError('Automation id is required.', 'AUTOMATION_ID_REQUIRED');
  const automations = await readAutomations(dependencies);
  let updated = null;
  const next = automations.map((automation) => {
    if (automation.id !== id) return automation;
    updated = normalizeAutomationPatch(automation, payload);
    return updated;
  });
  if (!updated) throw automationError(`Automation not found: ${id}`, 'AUTOMATION_NOT_FOUND');
  await writeAutomations(dependencies, next);
  return { automations: filterAutomations(next, payload), automation: updated };
}

async function deleteAutomation(payload = {}, dependencies = {}) {
  const id = String(payload.id || payload.automationId || '');
  if (!id) throw automationError('Automation id is required.', 'AUTOMATION_ID_REQUIRED');
  const automations = await readAutomations(dependencies);
  const next = automations.filter((automation) => automation.id !== id);
  await writeAutomations(dependencies, next);
  return { automations: filterAutomations(next, payload), deleted: id };
}

function automationPrompt(automation, run) {
  const lines = [
    `[Automation: ${automation.title}]`,
    `Triggered at: ${run.startedAt}`,
    '',
    automation.prompt,
  ];
  return lines.join('\n');
}

function automationMetadata(automation, run) {
  return {
    id: automation.id,
    runId: run.id,
    title: automation.title,
    scheduleType: automation.scheduleType,
    scheduleText: automation.scheduleText,
    triggeredAt: run.startedAt,
    createdBy: automation.createdBy,
  };
}

function isRuntimeFailure(result) {
  const status = cleanString(result && result.status).toLowerCase();
  return status === 'error' || status === 'failed' || status === 'unavailable';
}

async function emitAutomationEvent(dependencies = {}, automation, run, event = {}) {
  const sink = dependencies.eventSink || dependencies.ingestRuntimeEvent;
  if (!sink) return null;
  const payload = {
    automationId: automation.id,
    automationTitle: automation.title,
    runId: run.id,
    trigger: run.trigger,
    status: event.status || run.status,
    turnId: event.turnId || run.turnId || null,
    taskId: event.taskId || run.taskId || automation.conversationId || null,
    startedAt: run.startedAt,
    finishedAt: event.finishedAt || run.finishedAt || null,
    error: event.error || null,
  };
  const agentEvent = {
    taskId: payload.taskId,
    projectId: automation.projectId || run.projectId || null,
    runtime: REDOU_CODEX_RUNTIME_ID,
    type: event.type || 'automation_run',
    level: event.level || 'info',
    title: event.title || 'Automation',
    message: event.message || automation.title,
    payload,
    metadata: {
      automation: automationMetadata(automation, run),
      automationId: automation.id,
      automationRunId: run.id,
      turnId: payload.turnId,
    },
  };
  if (typeof sink === 'function') return sink(agentEvent);
  if (typeof sink.ingestRuntimeEvent === 'function') return sink.ingestRuntimeEvent(agentEvent);
  if (typeof sink.ingest === 'function') return sink.ingest(agentEvent);
  return null;
}

async function saveAutomationAfterRun(dependencies, automation, patch = {}, filter = {}) {
  const automations = await readAutomations(dependencies);
  let saved = null;
  const next = automations.map((item) => {
    if (item.id !== automation.id) return item;
    saved = normalizeAutomationPatch(item, patch);
    return saved;
  });
  await writeAutomations(dependencies, next);
  return { automations: filterAutomations(next, filter), automation: saved || normalizeAutomation({ ...automation, ...patch }) };
}

async function runAutomation(payload = {}, dependencies = {}) {
  const id = String(payload.id || payload.automationId || '');
  const trigger = cleanString(payload.trigger) || 'manual';
  const automations = await readAutomations(dependencies);
  const automation = automations.find((item) => item.id === id);
  if (!automation) throw automationError(`Automation not found: ${id}`, 'AUTOMATION_NOT_FOUND');

  const startedRun = await appendAutomationRun(dependencies, {
    automationId: automation.id,
    status: automation.requireConfirmationBeforeRun && !payload.confirmed ? 'pending_confirmation' : 'started',
    trigger,
    projectId: automation.projectId || payload.projectId || null,
    conversationId: automation.conversationId || payload.conversationId || null,
    taskId: automation.conversationId || payload.conversationId || null,
    retryAttempt: automation.retryCount || 0,
  });

  if (automation.requireConfirmationBeforeRun && !payload.confirmed) {
    await emitAutomationEvent(dependencies, automation, startedRun, {
      type: 'automation_run_pending_confirmation',
      title: 'Automation waiting for confirmation',
      message: `${automation.title} is waiting for confirmation before running.`,
      status: 'pending_confirmation',
    });
    return {
      ...(await saveAutomationAfterRun(dependencies, automation, {
        nextRunAt: computeNextRunAt({ ...automation, lastRunAt: startedRun.startedAt }, new Date(startedRun.startedAt)),
      }, payload)),
      run: startedRun,
      skipped: true,
    };
  }

  const targetTaskId = automation.replyTarget === 'bound_conversation' && automation.exposeResultInConversation
    ? (automation.conversationId || payload.conversationId || null)
    : null;
  let task = null;
  let runResult = null;
  let runStatus = 'completed';
  let errorText = null;

  try {
    if (targetTaskId && dependencies.taskStore && typeof dependencies.taskStore.get === 'function') {
      task = await dependencies.taskStore.get(targetTaskId);
      if (!task) throw automationError(`Bound conversation not found: ${targetTaskId}`, 'AUTOMATION_CONVERSATION_NOT_FOUND');
      const turnInput = {
        taskId: targetTaskId,
        projectId: automation.projectId || task.projectId || payload.projectId || null,
        userInput: automationPrompt(automation, startedRun),
        userMessageId: `automation-message:${startedRun.id}`,
        deliveryMode: 'automation',
        automation: automationMetadata(automation, startedRun),
      };
      if (task.status === 'running') {
        runResult = await enqueueTaskTurn(turnInput, dependencies);
        runStatus = 'queued';
      } else {
        runResult = await startRuntimeTurn(turnInput, dependencies, {
          id: turnInput.userMessageId,
          deliveryMode: 'automation',
        });
        if (isRuntimeFailure(runResult)) {
          runStatus = 'failed';
          errorText = runResult.error || runResult.message || 'Automation runtime request failed.';
        }
      }
    } else if (automation.replyTarget !== 'automation_log_only' && dependencies.taskStore && typeof dependencies.taskStore.save === 'function') {
      task = await dependencies.taskStore.save(createDefaultTask({
        projectId: automation.projectId || payload.projectId || null,
        title: automation.title,
        userInput: automation.prompt,
        runtime: REDOU_CODEX_RUNTIME_ID,
        metadata: {
          automationId: automation.id,
          automationRunId: startedRun.id,
          automationSchedule: automation.scheduleText,
        },
      }));
      runResult = payload.start === false ? null : await startRuntimeTurn({
        taskId: task.id,
        projectId: task.projectId,
        userInput: automationPrompt(automation, startedRun),
        userMessageId: `automation-message:${startedRun.id}`,
        deliveryMode: 'automation',
        automation: automationMetadata(automation, startedRun),
      }, dependencies, {
        id: `automation-message:${startedRun.id}`,
        deliveryMode: 'automation',
      });
      if (isRuntimeFailure(runResult)) {
        runStatus = 'failed';
        errorText = runResult.error || runResult.message || 'Automation runtime request failed.';
      }
    } else {
      runStatus = 'logged';
      await emitAutomationEvent(dependencies, automation, startedRun, {
        type: 'automation_run_logged',
        title: 'Automation logged',
        message: `${automation.title} ran in log-only mode.`,
        status: 'logged',
      });
    }
  } catch (error) {
    runStatus = 'failed';
    errorText = error && error.message ? error.message : String(error);
  }

  const finishedAt = nowIso();
  const completedRun = await appendAutomationRun(dependencies, {
    id: startedRun.id,
    automationId: automation.id,
    status: runStatus,
    trigger,
    startedAt: startedRun.startedAt,
    finishedAt,
    projectId: automation.projectId || payload.projectId || null,
    conversationId: targetTaskId,
    taskId: task ? task.id : targetTaskId,
    turnId: runResult && runResult.activeTurnId ? runResult.activeTurnId : null,
    error: errorText,
    retryAttempt: automation.retryCount || 0,
    details: runResult,
  });

  const failed = runStatus === 'failed';
  const shouldRetry = failed && automation.retryCount < automation.maxRetries;
  const lastRunAt = finishedAt;
  const retryCount = shouldRetry ? automation.retryCount + 1 : 0;
  const enabled = automation.scheduleType === 'once' && !shouldRetry ? false : automation.enabled;
  const retryDelay = new Date(Date.now() + Math.max(1, retryCount) * 5 * 60000).toISOString();
  const nextRunAt = shouldRetry
    ? retryDelay
    : computeNextRunAt({ ...automation, enabled, lastRunAt, retryCount: 0 }, new Date(finishedAt));

  await emitAutomationEvent(dependencies, automation, completedRun, {
    type: failed ? 'automation_run_failed' : 'automation_run_completed',
    level: failed ? 'error' : 'info',
    title: failed ? 'Automation failed' : 'Automation run',
    message: failed ? (errorText || `${automation.title} failed.`) : `${automation.title} dispatched.`,
    status: runStatus,
    turnId: completedRun.turnId,
    taskId: completedRun.taskId,
    error: errorText,
    finishedAt,
  });

  const saved = await saveAutomationAfterRun(dependencies, automation, {
    enabled,
    status: enabled ? 'ACTIVE' : 'PAUSED',
    lastRunAt,
    nextRunAt,
    retryCount,
    lastTaskId: task ? task.id : automation.lastTaskId,
  }, payload);

  return {
    ...saved,
    task,
    run: completedRun,
    runResult,
  };
}

function minutesBetween(a, b) {
  return Math.floor((a.getTime() - b.getTime()) / 60000);
}

function sameLocalDate(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function dailyDue(schedule, lastRunAt, now) {
  const match = cleanString(schedule).match(/\bdaily\s+(\d{1,2}):(\d{2})\b/i);
  if (!match) return false;
  const due = new Date(now);
  due.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (now < due) return false;
  if (!lastRunAt) return true;
  const last = new Date(lastRunAt);
  return !sameLocalDate(last, now);
}

function intervalDue(schedule, lastRunAt, now) {
  const normalized = cleanString(schedule).toLowerCase();
  const minutes = normalized === 'hourly'
    ? 60
    : Number((normalized.match(/every\s+(\d+)\s+minutes?/) || [])[1] || 0);
  if (!minutes) return false;
  if (!lastRunAt) return true;
  return minutesBetween(now, new Date(lastRunAt)) >= minutes;
}

function isAutomationDue(automation, now = new Date()) {
  const task = normalizeAutomation(automation || {});
  if (!task.enabled || task.status !== 'ACTIVE') return false;
  const next = dateOrNull(task.nextRunAt);
  if (next) return next <= now;
  const schedule = cleanString(task.schedule || task.scheduleText);
  if (!schedule || schedule === 'manual') return false;
  return intervalDue(schedule, task.lastRunAt, now) || dailyDue(schedule, task.lastRunAt, now);
}

async function scanDueAutomations(dependencies = {}, now = new Date()) {
  const automations = await readAutomations(dependencies);
  const due = automations.filter((automation) => isAutomationDue(automation, now));
  const triggered = [];
  for (const automation of due) {
    triggered.push(await runAutomation({ id: automation.id, trigger: 'schedule' }, dependencies));
  }
  return { triggered };
}

async function recoverEnabledAutomations(dependencies = {}, now = new Date()) {
  const automations = await readAutomations(dependencies);
  const recovered = automations.map((automation) => {
    if (!automation.enabled) return automation;
    if (automation.nextRunAt) return automation;
    return normalizeAutomationPatch(automation, { nextRunAt: computeNextRunAt(automation, now) });
  });
  await writeAutomations(dependencies, recovered);
  return recovered;
}

function startAutomationScheduler(dependencies = {}, options = {}) {
  const intervalMs = Math.max(0, Number(options.intervalMs || 60000));
  recoverEnabledAutomations(dependencies).catch(() => {});
  if (!intervalMs) return { dispose() {} };
  const timer = setInterval(() => {
    scanDueAutomations(dependencies).catch(() => {});
  }, intervalMs);
  timer.unref?.();
  return {
    dispose() {
      clearInterval(timer);
    },
  };
}

function automationToolDescriptor() {
  return {
    namespace: 'automation',
    name: 'create',
    description: 'Create a Redou automation bound to the current conversation. Use this when the user asks to be reminded later, run a recurring task, check a condition on a schedule, or follow up at a future time.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: 'Short user-visible automation name.' },
        description: { type: 'string', description: 'Optional explanation for the automation.' },
        prompt: { type: 'string', description: 'The exact prompt Redou should run when the automation fires.' },
        scheduleType: {
          type: 'string',
          enum: ['once', 'daily', 'weekly', 'monthly', 'interval', 'rrule', 'condition_watch'],
          description: 'The scheduling mode.',
        },
        scheduleText: { type: 'string', description: 'Human-readable schedule, such as daily 09:00 or every 60 minutes.' },
        rrule: { type: 'string', description: 'Optional RRULE string for advanced schedules.' },
        startAt: { type: 'string', description: 'ISO datetime for the first or one-time run.' },
        timezone: { type: 'string', description: 'IANA timezone name if known.' },
        replyTarget: {
          type: 'string',
          enum: ['bound_conversation', 'automation_log_only', 'system_notification'],
          description: 'Where execution results should go. Model-created tasks should use bound_conversation.',
        },
        exposeResultInConversation: { type: 'boolean' },
        requireConfirmationBeforeRun: { type: 'boolean' },
        maxRetries: { type: 'integer', minimum: 0, maximum: 10 },
      },
      required: ['prompt', 'scheduleType'],
    },
    deferLoading: false,
  };
}

async function automationSettings(dependencies = {}) {
  const defaults = {
    allowModelCreate: false,
    exposeToolToModel: false,
  };
  const store = dependencies.appSettingsStore;
  if (!store || typeof store.get !== 'function') return defaults;
  const settings = await store.get();
  return {
    ...defaults,
    ...(settings.automation || {}),
  };
}

async function dynamicAutomationTools(dependencies = {}) {
  const settings = await automationSettings(dependencies);
  return settings.allowModelCreate && settings.exposeToolToModel ? [automationToolDescriptor()] : [];
}

module.exports = {
  automationSettings,
  automationToolDescriptor,
  computeNextRunAt,
  createAutomation,
  createAutomationFromTool,
  deleteAutomation,
  dynamicAutomationTools,
  getAutomation,
  isAutomationDue,
  listAutomationRuns,
  listAutomations,
  normalizeAutomation,
  readAutomations,
  recoverEnabledAutomations,
  runAutomation,
  scanDueAutomations,
  startAutomationScheduler,
  storePath,
  updateAutomation,
  writeAutomations,
};
