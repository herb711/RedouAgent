'use strict';

const path = require('node:path');
const { createDefaultTask } = require('../core/models/task.cjs');
const { REDOU_CODEX_RUNTIME_ID } = require('../runtimes/redou-codex/redouCodexRuntimeConfig.cjs');
const { startRuntimeTurn } = require('../orchestrator/taskQueue.cjs');
const { readJsonFile, writeJsonFile } = require('../platform/filesystem/jsonFile.cjs');

const CHANNELS = Object.freeze([
  'redou:automations:list',
  'redou:automations:create',
  'redou:automations:update',
  'redou:automations:delete',
  'redou:automations:run',
]);

function ok(data, warnings = []) {
  return { ok: true, data, error: null, warnings };
}

function fail(error) {
  return {
    ok: false,
    data: null,
    error: {
      code: error && error.code ? error.code : 'IPC_ERROR',
      message: error && error.message ? error.message : String(error),
      details: error && error.details ? error.details : null,
    },
    warnings: [],
  };
}

function handle(ipcMain, channel, handler) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return ok(await handler(payload || {}));
    } catch (error) {
      return fail(error);
    }
  });
}

function storePath(dependencies = {}) {
  return path.join(dependencies.dataRoot || process.cwd(), 'automations.json');
}

function automationId() {
  return `automation:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function normalizeAutomation(input = {}) {
  const now = new Date().toISOString();
  return {
    id: String(input.id || automationId()),
    name: String(input.name || 'Untitled automation').trim() || 'Untitled automation',
    prompt: String(input.prompt || '').trim(),
    schedule: String(input.schedule || input.rrule || '').trim() || 'manual',
    status: String(input.status || 'ACTIVE').toUpperCase() === 'PAUSED' ? 'PAUSED' : 'ACTIVE',
    projectId: input.projectId ? String(input.projectId) : null,
    createdAt: input.createdAt || now,
    updatedAt: now,
    lastRunAt: input.lastRunAt || null,
    lastTaskId: input.lastTaskId || null,
  };
}

async function readAutomations(dependencies = {}) {
  const value = await readJsonFile(storePath(dependencies), []);
  return Array.isArray(value) ? value.map(normalizeAutomation) : [];
}

async function writeAutomations(dependencies = {}, automations = []) {
  await writeJsonFile(storePath(dependencies), automations);
  return automations;
}

async function listAutomations(_payload = {}, dependencies = {}) {
  const automations = await readAutomations(dependencies);
  return { automations };
}

async function createAutomation(payload = {}, dependencies = {}) {
  if (!String(payload.prompt || '').trim()) {
    const error = new Error('Automation prompt is required.');
    error.code = 'AUTOMATION_PROMPT_REQUIRED';
    throw error;
  }
  const automations = await readAutomations(dependencies);
  const automation = normalizeAutomation(payload);
  await writeAutomations(dependencies, [automation, ...automations]);
  return { automations: [automation, ...automations], automation };
}

async function updateAutomation(payload = {}, dependencies = {}) {
  const id = String(payload.id || '');
  if (!id) {
    const error = new Error('Automation id is required.');
    error.code = 'AUTOMATION_ID_REQUIRED';
    throw error;
  }
  const automations = await readAutomations(dependencies);
  let updated = null;
  const next = automations.map((automation) => {
    if (automation.id !== id) return automation;
    updated = normalizeAutomation({ ...automation, ...payload, id, createdAt: automation.createdAt });
    return updated;
  });
  if (!updated) {
    const error = new Error(`Automation not found: ${id}`);
    error.code = 'AUTOMATION_NOT_FOUND';
    throw error;
  }
  await writeAutomations(dependencies, next);
  return { automations: next, automation: updated };
}

async function deleteAutomation(payload = {}, dependencies = {}) {
  const id = String(payload.id || '');
  if (!id) {
    const error = new Error('Automation id is required.');
    error.code = 'AUTOMATION_ID_REQUIRED';
    throw error;
  }
  const automations = await readAutomations(dependencies);
  const next = automations.filter((automation) => automation.id !== id);
  await writeAutomations(dependencies, next);
  return { automations: next, deleted: id };
}

async function runAutomation(payload = {}, dependencies = {}) {
  const id = String(payload.id || '');
  const automations = await readAutomations(dependencies);
  const automation = automations.find((item) => item.id === id);
  if (!automation) {
    const error = new Error(`Automation not found: ${id}`);
    error.code = 'AUTOMATION_NOT_FOUND';
    throw error;
  }
  let task = null;
  let runResult = null;
  if (dependencies.taskStore && typeof dependencies.taskStore.save === 'function') {
    task = await dependencies.taskStore.save(createDefaultTask({
      projectId: automation.projectId || payload.projectId || null,
      title: automation.name,
      userInput: automation.prompt,
      runtime: REDOU_CODEX_RUNTIME_ID,
      metadata: {
        automationId: automation.id,
        automationSchedule: automation.schedule,
      },
    }));
    if (payload.start !== false && dependencies.runtimeRegistry) {
      runResult = await startRuntimeTurn({
        taskId: task.id,
        userInput: automation.prompt,
      }, dependencies, { deliveryMode: 'new_turn' });
    }
  }
  const lastRunAt = new Date().toISOString();
  const next = automations.map((item) => item.id === id
    ? normalizeAutomation({ ...item, lastRunAt, lastTaskId: task ? task.id : null, createdAt: item.createdAt })
    : item);
  await writeAutomations(dependencies, next);
  return {
    automations: next,
    automation: next.find((item) => item.id === id),
    task,
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
  const match = schedule.match(/\bdaily\s+(\d{1,2}):(\d{2})\b/i);
  if (!match) return false;
  const due = new Date(now);
  due.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (now < due) return false;
  if (!lastRunAt) return true;
  const last = new Date(lastRunAt);
  return !sameLocalDate(last, now);
}

function intervalDue(schedule, lastRunAt, now) {
  const normalized = schedule.toLowerCase();
  const minutes = normalized === 'hourly'
    ? 60
    : Number((normalized.match(/every\s+(\d+)\s+minutes?/) || [])[1] || 0);
  if (!minutes) return false;
  if (!lastRunAt) return true;
  return minutesBetween(now, new Date(lastRunAt)) >= minutes;
}

function isAutomationDue(automation, now = new Date()) {
  if (!automation || automation.status !== 'ACTIVE') return false;
  const schedule = String(automation.schedule || '').trim();
  if (!schedule || schedule === 'manual') return false;
  return intervalDue(schedule, automation.lastRunAt, now) || dailyDue(schedule, automation.lastRunAt, now);
}

async function scanDueAutomations(dependencies = {}, now = new Date()) {
  const automations = await readAutomations(dependencies);
  const due = automations.filter((automation) => isAutomationDue(automation, now));
  const triggered = [];
  for (const automation of due) {
    triggered.push(await runAutomation({ id: automation.id }, dependencies));
  }
  return { triggered };
}

function startAutomationScheduler(dependencies = {}, options = {}) {
  const intervalMs = Math.max(0, Number(options.intervalMs || 60000));
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

function registerAutomationIpc(ipcMain, dependencies = {}) {
  if (!ipcMain) return CHANNELS;
  handle(ipcMain, 'redou:automations:list', async (payload) => listAutomations(payload, dependencies));
  handle(ipcMain, 'redou:automations:create', async (payload) => createAutomation(payload, dependencies));
  handle(ipcMain, 'redou:automations:update', async (payload) => updateAutomation(payload, dependencies));
  handle(ipcMain, 'redou:automations:delete', async (payload) => deleteAutomation(payload, dependencies));
  handle(ipcMain, 'redou:automations:run', async (payload) => runAutomation(payload, dependencies));
  return CHANNELS;
}

module.exports = {
  CHANNELS,
  createAutomation,
  deleteAutomation,
  isAutomationDue,
  listAutomations,
  normalizeAutomation,
  registerAutomationIpc,
  runAutomation,
  scanDueAutomations,
  startAutomationScheduler,
  updateAutomation,
};
