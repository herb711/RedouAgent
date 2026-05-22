const fs = require("fs");
const path = require("path");
const { isRunLogicallyActive } = require("../processes/processManager.cjs");
const {
  GLOBAL_RULES_FILE,
  GLOBAL_USER_FILE,
  PROJECT_RULES_FILE,
  REDOU_CONTEXT_DIR,
  REDOU_SKILLS_DIR,
  REDOU_TASKS_DIR,
  TASK_CONTEXT_FILE,
  TASK_EVENTS_FILE,
  TASK_MESSAGES_FILE,
  TASK_RULES_FILE,
  TASK_STATE_FILE,
  TASK_UPLOADS_DIR,
} = require("../constants.cjs");
const { compact, safeSegment } = require("../shared/textUtils.cjs");
const { assertChildPath, ensureEmptyFile, ensureTextFile, mkdirp, readText } = require("../shared/fileUtils.cjs");
const { isoNow, timestampMs, timestampSeconds } = require("../shared/timeUtils.cjs");
const { desktopSourcePath } = require("../shared/desktopPaths.cjs");
const { readDotEnv, sanitizeEnvValue } = require("../analysis/benchmarkUtils.cjs");
const {
  defaultTaskState,
  readTaskStateFile,
  redact,
  renderTaskContextMarkdown,
  writeTaskStateFiles,
} = require("../context/contextUtils.cjs");

function sanitizeChildEnv(env) {
  const clean = {};
  for (const [key, value] of Object.entries(env || {})) {
    if (!key || key.includes("\0") || value === undefined || value === null) continue;
    clean[key] = sanitizeEnvValue(value);
  }
  return clean;
}

class RuntimeCoreMethods {
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

  defaultProjectSeedPath() {
    return path.join(this.appDataRoot(), "default-project.seeded");
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
      if (!isRunLogicallyActive(run)) continue;
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
    return projects.sort((a, b) => {
      const rightTime = timestampMs(b.updatedAt) ?? timestampSeconds(b.updated_at || b.created_at, 0) * 1000;
      const leftTime = timestampMs(a.updatedAt) ?? timestampSeconds(a.updated_at || a.created_at, 0) * 1000;
      return rightTime - leftTime;
    });
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
    const cleanBaseEnv = sanitizeChildEnv(baseEnv);
    const pythonPath = [this.hermesRoot, cleanBaseEnv.PYTHONPATH || ""].filter(Boolean).join(path.delimiter);
    return sanitizeChildEnv({
      ...cleanBaseEnv,
      PYTHONPATH: pythonPath,
      HERMES_PYTHON_SRC_ROOT: this.hermesRoot,
      HERMES_VENDOR_ROOT: this.hermesRoot,
      REDOU_PROJECT_ROOT: this.projectRoot,
    });
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
    const bridgePath = desktopSourcePath("dashboard_bridge.py");
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

}

function installRuntimeCoreMethods(target) {
  for (const name of Object.getOwnPropertyNames(RuntimeCoreMethods.prototype)) {
    if (name === "constructor") continue;
    Object.defineProperty(target.prototype, name, Object.getOwnPropertyDescriptor(RuntimeCoreMethods.prototype, name));
  }
}

module.exports = { installRuntimeCoreMethods };
