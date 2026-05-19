const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { autoUpdater } = require("electron-updater");
const { RedouLocalService } = require("./services/redouLocalService.cjs");

const PRODUCT_NAME = "Redou Agent";
const PYTHON_ENV = "REDOU_PYTHON";
const GIT_BASH_ENV = "HERMES_GIT_BASH_PATH";

let mainWindow = null;
let localService = null;
let statusLines = [];
let logFile = null;
let rendererLoaded = false;
let shutdownComplete = false;
let activePythonHermesRoot = null;
let gitBashLookupComplete = false;
let cachedGitBashPath = "";
let updaterConfigured = false;
let updateInProgress = false;

function projectRoot() {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return path.resolve(__dirname, "..", "..", "..");
}

function hermesRoot() {
  return path.join(projectRoot(), "vendor", "hermes");
}

function pythonHermesRoot() {
  return activePythonHermesRoot || hermesRoot();
}

function runtimeRoot() {
  return path.join(app.getPath("userData"), "runtime");
}

function desktopAssetPath(...segments) {
  return path.join(__dirname, "..", "assets", ...segments);
}

function windowIconPath() {
  return desktopAssetPath("icons", "redou-agent.ico");
}

function hermesHome() {
  return path.join(app.getPath("userData"), "hermes-home");
}

function isWslBashLauncher(candidate) {
  const normalized = path.normalize(String(candidate || "")).toLowerCase();
  return (
    normalized.endsWith("\\windows\\system32\\bash.exe")
    || normalized.endsWith("\\microsoft\\windowsapps\\bash.exe")
  );
}

function collectCommandOutput(command, args) {
  try {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status !== 0 || !result.stdout) return [];
    return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function addGitBashCandidates(candidates, gitPath) {
  if (!gitPath || !path.isAbsolute(gitPath)) return;
  const gitRoot = path.dirname(path.dirname(gitPath));
  candidates.push(path.join(gitRoot, "bin", "bash.exe"));
  candidates.push(path.join(gitRoot, "usr", "bin", "bash.exe"));
}

function resolveGitBashPath(options = {}) {
  const required = Boolean(options.required);
  if (process.platform !== "win32") return "";
  if (gitBashLookupComplete) {
    if (required && !cachedGitBashPath) throw new Error(gitBashMissingMessage());
    return cachedGitBashPath;
  }

  const candidates = [
    process.env[GIT_BASH_ENV],
    path.join(process.env.LOCALAPPDATA || "", "hermes", "git", "bin", "bash.exe"),
    path.join(process.env.LOCALAPPDATA || "", "hermes", "git", "usr", "bin", "bash.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "bin", "bash.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Git", "bin", "bash.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Git", "bin", "bash.exe"),
  ].filter(Boolean);

  for (const gitPath of collectCommandOutput("where.exe", ["git.exe"])) {
    addGitBashCandidates(candidates, gitPath);
  }
  for (const bashPath of collectCommandOutput("where.exe", ["bash.exe"])) {
    if (!isWslBashLauncher(bashPath)) candidates.push(bashPath);
  }

  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || !path.isAbsolute(candidate)) continue;
    const normalized = path.normalize(candidate);
    const key = normalized.toLowerCase();
    if (seen.has(key) || isWslBashLauncher(normalized)) continue;
    seen.add(key);
    if (fs.existsSync(normalized)) {
      cachedGitBashPath = normalized;
      process.env[GIT_BASH_ENV] = normalized;
      break;
    }
  }

  gitBashLookupComplete = true;
  if (required && !cachedGitBashPath) throw new Error(gitBashMissingMessage());
  return cachedGitBashPath;
}

function gitBashMissingMessage() {
  return [
    "Git for Windows (Git Bash) was not found.",
    "Redou/Hermes uses Git Bash to run local terminal tools on Windows.",
    "Install Git for Windows, or set HERMES_GIT_BASH_PATH to your bash.exe path, then restart Redou Agent.",
  ].join(" ");
}

function gitRuntimePathExtras(gitBashPath) {
  if (!gitBashPath) return [];
  const bashDir = path.dirname(gitBashPath);
  const bashParent = path.dirname(bashDir);
  const gitRoot = path.basename(bashParent).toLowerCase() === "usr"
    ? path.dirname(bashParent)
    : bashParent;
  return [
    bashDir,
    path.join(gitRoot, "cmd"),
    path.join(gitRoot, "usr", "bin"),
    path.join(gitRoot, "mingw64", "bin"),
  ];
}

function withRuntimePath(env = process.env) {
  const gitBashPath = resolveGitBashPath();
  const extras = [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python312"),
    "C:\\Program Files\\nodejs",
    ...gitRuntimePathExtras(gitBashPath),
  ].filter(Boolean);
  const runtimeEnv = {
    ...env,
    PATH: [...extras, env.PATH || ""].join(path.delimiter),
    PYTHONUTF8: "1",
    PYTHONUNBUFFERED: "1",
    HERMES_HOME: hermesHome(),
    REDOU_APP_DATA_ROOT: localService ? localService.appDataRoot() : path.join(app.getPath("userData"), "appData"),
    HERMES_PYTHON_SRC_ROOT: pythonHermesRoot(),
    REDOU_PROJECT_ROOT: projectRoot(),
    HERMES_VENDOR_ROOT: pythonHermesRoot(),
    PYTHONPATH: [pythonHermesRoot(), env.PYTHONPATH || ""].filter(Boolean).join(path.delimiter),
    HERMES_QUIET: "1",
  };
  if (gitBashPath) {
    runtimeEnv[GIT_BASH_ENV] = gitBashPath;
  }
  return runtimeEnv;
}

function getLocalService() {
  if (!localService) {
    localService = new RedouLocalService({
      app,
      projectRoot: projectRoot(),
      hermesRoot: pythonHermesRoot(),
      hermesHome: hermesHome(),
      log: pushStatus,
    });
  }
  return localService;
}

function stopHermesActivityForShutdown(reason = "Redou Agent is closing; stopping Hermes local runtime.") {
  if (shutdownComplete || !localService) return;
  shutdownComplete = true;
  try {
    const result = typeof localService.dispose === "function"
      ? localService.dispose(reason)
      : localService.stopAllHermesActivity(reason);
    const stoppedCount =
      (result.stoppedRuns?.length || 0) + (result.stoppedAnalysisRuns?.length || 0);
    if (stoppedCount > 0 || result.queuedMessages > 0 || result.queuedAnalysisRuns > 0) {
      pushStatus(
        `Stopped Hermes activity before exit: runs=${stoppedCount}, queued=${result.queuedMessages || 0}, analysisQueued=${result.queuedAnalysisRuns || 0}`,
      );
    }
  } catch (error) {
    pushStatus(`Hermes shutdown cleanup failed: ${error && error.stack ? error.stack : String(error)}`);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderStatus(title = "Starting") {
  if (rendererLoaded) return;
  if (!mainWindow) return;
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${PRODUCT_NAME}</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #061612;
      color: #f5f0df;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(840px, calc(100vw - 48px));
      border: 1px solid rgba(245, 240, 223, .24);
      background: rgba(4, 22, 18, .86);
      padding: 32px;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 24px;
      letter-spacing: 0;
      font-weight: 700;
    }
    p {
      margin: 0 0 22px;
      color: rgba(245, 240, 223, .72);
    }
    pre {
      margin: 0;
      min-height: 260px;
      max-height: 54vh;
      overflow: auto;
      white-space: pre-wrap;
      color: #b9d8ca;
      font: 13px/1.55 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
    }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p>Preparing the native Redou Agent runtime.</p>
    <pre>${escapeHtml(statusLines.join("\n"))}</pre>
  </main>
</body>
</html>`;
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function pushStatus(line) {
  statusLines.push(line);
  statusLines = statusLines.slice(-120);
  if (logFile) {
    try {
      fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`, "utf8");
    } catch (_error) {
      // Logging must never stop app startup.
    }
  }
  renderStatus(line || "Starting Redou Agent");
}

function createWindow() {
  rendererLoaded = false;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    title: PRODUCT_NAME,
    icon: windowIconPath(),
    backgroundColor: "#061612",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function formatErrorMessage(error) {
  if (!error) return "Unknown error";
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function configureAutoUpdater() {
  if (updaterConfigured) return;
  updaterConfigured = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (message) => pushStatus(`[update] ${message}`),
    warn: (message) => pushStatus(`[update] ${message}`),
    error: (message) => pushStatus(`[update] ${message}`),
    debug: (message) => pushStatus(`[update] ${message}`),
  };
  autoUpdater.on("checking-for-update", () => pushStatus("Checking for Redou Agent updates..."));
  autoUpdater.on("update-available", (info) =>
    pushStatus(`Redou Agent update available: ${info.version || "unknown"}`),
  );
  autoUpdater.on("update-not-available", () =>
    pushStatus(`Redou Agent is already up to date (${app.getVersion()}).`),
  );
  autoUpdater.on("download-progress", (progress) => {
    const percent = Number.isFinite(progress?.percent) ? progress.percent.toFixed(1) : "?";
    pushStatus(`Downloading Redou Agent update... ${percent}%`);
  });
  autoUpdater.on("update-downloaded", (info) =>
    pushStatus(`Redou Agent update downloaded: ${info.version || "unknown"}`),
  );
  autoUpdater.on("error", (error) =>
    pushStatus(`Redou Agent update failed: ${formatErrorMessage(error)}`),
  );
}

async function handleAppUpdate() {
  if (!app.isPackaged) {
    return {
      name: "redou-update",
      ok: false,
      pid: 0,
      message: "Updates are only available in the packaged Redou Agent app.",
    };
  }
  if (updateInProgress) {
    return {
      name: "redou-update",
      ok: false,
      pid: 0,
      message: "An update check is already running.",
    };
  }

  updateInProgress = true;
  configureAutoUpdater();
  try {
    const checkResult = await autoUpdater.checkForUpdates();
    const updateInfo = checkResult?.updateInfo;
    if (!updateInfo || updateInfo.version === app.getVersion()) {
      return {
        name: "redou-update",
        ok: true,
        pid: 0,
        message: `Redou Agent is already up to date (${app.getVersion()}).`,
      };
    }

    await autoUpdater.downloadUpdate();
    const version = updateInfo.version || "the latest version";
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["Restart and install", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Redou Agent update ready",
      message: `Redou Agent ${version} is ready to install.`,
      detail: "Redou Agent will close and restart to finish the update.",
      noLink: true,
    });

    if (result.response === 0) {
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
      return {
        name: "redou-update",
        ok: true,
        pid: 0,
        message: `Installing Redou Agent ${version}.`,
      };
    }

    return {
      name: "redou-update",
      ok: true,
      pid: 0,
      message: `Redou Agent ${version} was downloaded and will install when the app exits.`,
    };
  } catch (error) {
    return {
      name: "redou-update",
      ok: false,
      pid: 0,
      message: formatErrorMessage(error),
    };
  } finally {
    updateInProgress = false;
  }
}

ipcMain.handle("redou:pick-directory", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
    title: "Select project workspace",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("redou:pick-files", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    title: "Select local attachments",
  });
  if (result.canceled || result.filePaths.length === 0) return [];
  return result.filePaths;
});

ipcMain.handle("redou:paths:open", async (_event, targetPath) => {
  const rawPath = String(targetPath || "").trim();
  if (!rawPath) {
    return { ok: false, message: "Path is empty." };
  }

  const resolvedPath = path.resolve(rawPath);
  if (!fs.existsSync(resolvedPath)) {
    return { ok: false, message: `Path not found: ${resolvedPath}` };
  }

  const errorMessage = await shell.openPath(resolvedPath);
  if (errorMessage) {
    return { ok: false, message: errorMessage, path: resolvedPath };
  }
  return { ok: true, path: resolvedPath };
});

ipcMain.handle("redou:app:update", () => handleAppUpdate());

ipcMain.handle("redou:projects:list", () => getLocalService().getChatProjects());

ipcMain.handle("redou:projects:create", (_event, body) =>
  getLocalService().createChatProject(body),
);

ipcMain.handle("redou:projects:update", (_event, projectId, body) =>
  getLocalService().updateChatProject(projectId, body),
);

ipcMain.handle("redou:projects:delete", (_event, projectId) =>
  getLocalService().deleteChatProject(projectId),
);

ipcMain.handle("redou:tasks:create", (_event, projectId, body) =>
  getLocalService().createChatTask(projectId, body),
);

ipcMain.handle("redou:tasks:update", (_event, projectId, taskId, body) =>
  getLocalService().updateChatTask(projectId, taskId, body),
);

ipcMain.handle("redou:tasks:delete", (_event, projectId, taskId) =>
  getLocalService().deleteChatTask(projectId, taskId),
);

ipcMain.handle("redou:tasks:select", (_event, projectId, taskId) =>
  getLocalService().setActiveChatTask(projectId, taskId),
);

ipcMain.handle("redou:tasks:messages", (_event, projectId, taskId) =>
  getLocalService().getChatTaskMessages(projectId, taskId),
);

ipcMain.handle("redou:tasks:package-skill", (_event, projectId, taskId) =>
  getLocalService().packageTaskSkill(projectId, taskId),
);

ipcMain.handle("redou:tasks:extract-rules", (_event, projectId, taskId, target) =>
  getLocalService().extractTaskContextRules(projectId, taskId, target),
);

ipcMain.handle("redou:sessions:list", (_event, limit, offset) =>
  getLocalService().getSessions(limit, offset),
);

ipcMain.handle("redou:sessions:messages", (_event, sessionId) =>
  getLocalService().getSessionMessages(sessionId),
);

ipcMain.handle("redou:tasks:attachments:copy", (_event, projectId, taskId, filePaths) =>
  getLocalService().copyTaskAttachments(projectId, taskId, filePaths),
);

ipcMain.handle("redou:context:global:get", (_event, kind) =>
  getLocalService().getGlobalContextFile(kind),
);

ipcMain.handle("redou:context:global:update", (_event, kind, content) =>
  getLocalService().updateGlobalContextFile(kind, content),
);

ipcMain.handle("redou:context:project:get", (_event, projectId, kind) =>
  getLocalService().getProjectContextFile(projectId, kind),
);

ipcMain.handle("redou:context:project:update", (_event, projectId, kind, content) =>
  getLocalService().updateProjectContextFile(projectId, kind, content),
);

ipcMain.handle("redou:context:task:get", (_event, projectId, taskId, kind) =>
  getLocalService().getTaskContextFile(projectId, taskId, kind),
);

ipcMain.handle("redou:context:task:update", (_event, projectId, taskId, kind, content) =>
  getLocalService().updateTaskContextFile(projectId, taskId, kind, content),
);

ipcMain.handle("redou:context:task:build", (_event, input) =>
  getLocalService().buildTaskContext(input),
);

ipcMain.handle("redou:chat:send", (event, input) =>
  getLocalService().sendMessage(event.sender, input),
);

ipcMain.handle("redou:chat:queue:update", (event, input) =>
  getLocalService().updateQueuedMessage(event.sender, input),
);

ipcMain.handle("redou:chat:stop", (event, runId) =>
  getLocalService().stopRun(runId, event.sender),
);

ipcMain.handle("redou:chat:stop-task", (event, projectId, taskId) =>
  getLocalService().stopTaskRun(projectId, taskId, event.sender),
);

ipcMain.handle("redou:status", () => getLocalService().getStatus());

ipcMain.handle("redou:config:get", () => getLocalService().getConfig());
ipcMain.handle("redou:config:defaults", () => getLocalService().getConfigDefaults());
ipcMain.handle("redou:config:schema", () => getLocalService().getConfigSchema());
ipcMain.handle("redou:config:save", (_event, config) => getLocalService().saveConfig(config));
ipcMain.handle("redou:config:raw:get", () => getLocalService().getConfigRaw());
ipcMain.handle("redou:config:raw:save", (_event, yamlText) =>
  getLocalService().saveConfigRaw(yamlText),
);
ipcMain.handle("redou:skills:list", () => getLocalService().getSkills());
ipcMain.handle("redou:skills:toggle", (_event, name, enabled, scope) =>
  getLocalService().toggleSkill(name, enabled, scope),
);
ipcMain.handle("redou:skills:delete", (_event, skill) =>
  getLocalService().deleteSkill(skill),
);
ipcMain.handle("redou:skills:merge", (_event, skills) =>
  getLocalService().mergeSkills(skills),
);
ipcMain.handle("redou:toolsets:list", () => getLocalService().getToolsets());
ipcMain.handle("redou:model-info", () => getLocalService().getModelInfo());
ipcMain.handle("redou:model-setup-catalog", () => getLocalService().getModelSetupCatalog());
ipcMain.handle("redou:model-options", () => getLocalService().getModelOptions());
ipcMain.handle("redou:model-auxiliary", () => getLocalService().getAuxiliaryModels());
ipcMain.handle("redou:model-set", (_event, body) => getLocalService().setModelAssignment(body));
ipcMain.handle("redou:model-setup-refresh", (_event, body) =>
  getLocalService().refreshModelSetupModels(body),
);
ipcMain.handle("redou:model-setup", (_event, body) => getLocalService().setupMainModel(body));
ipcMain.handle("redou:analytics:models", (_event, days) =>
  getLocalService().getModelsAnalytics(days),
);
ipcMain.handle("redou:analytics:usage", (_event, days) =>
  getLocalService().getUsageAnalytics(days),
);
ipcMain.handle("redou:logs", (_event, params) => getLocalService().getLogs(params));
ipcMain.handle("redou:cron:list", () => getLocalService().getCronJobs());
ipcMain.handle("redou:cron:create", (_event, job) => getLocalService().createCronJob(job));
ipcMain.handle("redou:cron:pause", (_event, id) => getLocalService().pauseCronJob(id));
ipcMain.handle("redou:cron:resume", (_event, id) => getLocalService().resumeCronJob(id));
ipcMain.handle("redou:cron:trigger", (_event, id) => getLocalService().triggerCronJob(id));
ipcMain.handle("redou:cron:delete", (_event, id) => getLocalService().deleteCronJob(id));
ipcMain.handle("redou:theme:list", () => getLocalService().getThemes());
ipcMain.handle("redou:theme:set", (_event, name) => getLocalService().setTheme(name));
ipcMain.handle("redou:language:get", () => getLocalService().getLanguage());
ipcMain.handle("redou:language:set", (_event, language) =>
  getLocalService().setLanguage(language),
);
ipcMain.handle("redou:plugins:manifests", () => getLocalService().getDashboardPlugins());
ipcMain.handle("redou:plugins:rescan", () => getLocalService().rescanDashboardPlugins());
ipcMain.handle("redou:plugins:hub", () => getLocalService().getPluginsHub());
ipcMain.handle("redou:plugins:install", (_event, body) =>
  getLocalService().installAgentPlugin(body),
);
ipcMain.handle("redou:plugins:enable", (_event, name) =>
  getLocalService().enableAgentPlugin(name),
);
ipcMain.handle("redou:plugins:disable", (_event, name) =>
  getLocalService().disableAgentPlugin(name),
);
ipcMain.handle("redou:plugins:update", (_event, name) =>
  getLocalService().updateAgentPlugin(name),
);
ipcMain.handle("redou:plugins:remove", (_event, name) =>
  getLocalService().removeAgentPlugin(name),
);
ipcMain.handle("redou:plugins:providers:save", (_event, body) =>
  getLocalService().savePluginProviders(body),
);
ipcMain.handle("redou:plugins:visibility", (_event, name, hidden) =>
  getLocalService().setPluginVisibility(name, hidden),
);
ipcMain.handle("redou:analysis:benchmarks", () =>
  getLocalService().getAnalysisBenchmarks(),
);
ipcMain.handle("redou:analysis:start", (event, body) =>
  getLocalService().startAnalysisBenchmarks(event.sender, body),
);

function commandWorks(command, args = ["--version"], options = {}) {
  const usesShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  const result = spawnSync(command, args, {
    ...options,
    env: withRuntimePath(options.env || process.env),
    encoding: "utf8",
    shell: usesShell,
    windowsHide: true,
  });
  return result.status === 0;
}

function resolvePython() {
  const candidates = [
    process.env[PYTHON_ENV],
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python312", "python.exe"),
    "C:\\Program Files\\Python312\\python.exe",
    "python.exe",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.includes("WindowsApps")) continue;
    if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;
    if (commandWorks(candidate)) return candidate;
  }

  throw new Error(
    `Python 3.12 was not found. Install Python 3.12 or set ${PYTHON_ENV} to python.exe.`,
  );
}

function resolveNpm() {
  const candidates = [
    path.join("C:\\Program Files\\nodejs", "npm.cmd"),
    "npm.cmd",
    "npm",
  ];
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;
    if (commandWorks(candidate)) return candidate;
  }
  throw new Error("npm was not found. Install Node.js LTS.");
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function safeRemoveRuntimeChild(targetPath) {
  const runtimePath = path.resolve(runtimeRoot());
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget === runtimePath || !resolvedTarget.startsWith(`${runtimePath}${path.sep}`)) {
    throw new Error(`Refusing to remove path outside runtime root: ${resolvedTarget}`);
  }
  fs.rmSync(resolvedTarget, { recursive: true, force: true });
}

function shouldCopyHermesRuntimePath(sourcePath) {
  const name = path.basename(sourcePath).toLowerCase();
  if (
    name === ".git"
    || name === "__pycache__"
    || name === "node_modules"
    || name === ".pytest_cache"
    || name === ".mypy_cache"
    || name === ".ruff_cache"
    || name.endsWith(".egg-info")
    || name.endsWith(".pyc")
    || name.endsWith(".pyo")
  ) {
    return false;
  }
  return true;
}

function preparePackagedHermesInstallSource() {
  if (!app.isPackaged) {
    activePythonHermesRoot = hermesRoot();
    return activePythonHermesRoot;
  }

  const sourceRoot = hermesRoot();
  const targetRoot = path.join(runtimeRoot(), "hermes-install-source");
  const manifestPath = path.join(targetRoot, ".redou-source.json");
  const appVersion = typeof app.getVersion === "function" ? app.getVersion() : "unknown";
  const pyprojectPath = path.join(sourceRoot, "pyproject.toml");
  const pyprojectStat = fs.statSync(pyprojectPath);
  const expectedManifest = {
    appVersion,
    sourceRoot,
    pyprojectMtimeMs: Math.trunc(pyprojectStat.mtimeMs),
  };
  const currentManifest = readJsonFile(manifestPath);
  const hasUsableCopy =
    currentManifest
    && currentManifest.appVersion === expectedManifest.appVersion
    && currentManifest.sourceRoot === expectedManifest.sourceRoot
    && currentManifest.pyprojectMtimeMs === expectedManifest.pyprojectMtimeMs
    && fs.existsSync(path.join(targetRoot, "pyproject.toml"));

  if (!hasUsableCopy) {
    pushStatus("Preparing writable Hermes runtime source...");
    safeRemoveRuntimeChild(targetRoot);
    fs.mkdirSync(path.dirname(targetRoot), { recursive: true });
    fs.cpSync(sourceRoot, targetRoot, {
      recursive: true,
      dereference: true,
      filter: shouldCopyHermesRuntimePath,
    });
    const readmePath = path.join(targetRoot, "README.md");
    if (!fs.existsSync(readmePath)) {
      fs.writeFileSync(
        readmePath,
        "# Redou Agent Hermes Runtime\n\nBundled Hermes runtime staged by Redou Agent.\n",
        "utf8",
      );
    }
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ ...expectedManifest, createdAt: new Date().toISOString() }, null, 2),
      "utf8",
    );
  }

  activePythonHermesRoot = targetRoot;
  return activePythonHermesRoot;
}

function hermesInstallSourceStamp(installSource) {
  const stagedManifest = readJsonFile(path.join(installSource, ".redou-source.json"));
  if (stagedManifest?.appVersion && stagedManifest?.pyprojectMtimeMs) {
    return `${stagedManifest.appVersion}:${stagedManifest.pyprojectMtimeMs}`;
  }
  try {
    const pyprojectStat = fs.statSync(path.join(installSource, "pyproject.toml"));
    const appVersion = typeof app.getVersion === "function" ? app.getVersion() : "unknown";
    return `${appVersion}:${Math.trunc(pyprojectStat.mtimeMs)}`;
  } catch {
    return "unknown";
  }
}

function pythonRuntimeMarkerMatches(markerPath, installSource, installSourceStamp) {
  const marker = readJsonFile(markerPath);
  if (!marker) return false;
  const appVersion = typeof app.getVersion === "function" ? app.getVersion() : "unknown";
  return (
    marker.appVersion === appVersion
    && marker.hermesSourceRoot === installSource
    && marker.hermesSourceStamp === installSourceStamp
  );
}

function runLogged(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const usesShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
    pushStatus(`> ${command} ${args.join(" ")}`);
    const child = spawn(command, args, {
      cwd: options.cwd || projectRoot(),
      env: withRuntimePath(options.env || process.env),
      windowsHide: true,
      shell: usesShell,
    });

    child.stdout.on("data", (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
        pushStatus(line);
      }
    });
    child.stderr.on("data", (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
        pushStatus(line);
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function ensurePythonRuntime() {
  const root = runtimeRoot();
  const venvDir = path.join(root, "venv");
  const venvPython = path.join(venvDir, "Scripts", "python.exe");
  const marker = path.join(root, "python-ready.json");
  const hermesInstallSource = preparePackagedHermesInstallSource();
  const hermesSourceStamp = hermesInstallSourceStamp(hermesInstallSource);
  let createdVenv = false;

  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(hermesHome(), { recursive: true });

  if (!fs.existsSync(venvPython)) {
    const python = resolvePython();
    pushStatus("Creating Python virtual environment...");
    await runLogged(python, ["-m", "venv", venvDir]);
    createdVenv = true;
  }

  if (createdVenv || !pythonRuntimeMarkerMatches(marker, hermesInstallSource, hermesSourceStamp)) {
    pushStatus("Installing Redou Agent Python dependencies...");
    await runLogged(venvPython, ["-m", "pip", "install", "--upgrade", "pip"]);
    const hermesInstallArgs = app.isPackaged
      ? ["-m", "pip", "install", hermesInstallSource]
      : ["-m", "pip", "install", "-e", hermesInstallSource];
    await runLogged(venvPython, hermesInstallArgs);
    fs.writeFileSync(
      marker,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          appVersion: typeof app.getVersion === "function" ? app.getVersion() : "unknown",
          hermesSourceRoot: hermesInstallSource,
          hermesSourceStamp,
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  return venvPython;
}

async function ensureNodeRuntime() {
  const webDir = path.join(hermesRoot(), "web");
  const webEntry = path.join(hermesRoot(), "hermes_cli", "web_dist", "index.html");

  if (fs.existsSync(webEntry)) {
    return;
  }

  if (app.isPackaged) {
    throw new Error(
      `Bundled renderer was not found: ${webEntry}. Rebuild the installer with the Hermes runtime and prebuilt renderer included.`,
    );
  }

  if (!fs.existsSync(webDir)) {
    throw new Error(`Renderer source directory was not found: ${webDir}`);
  }

  const npm = resolveNpm();
  if (!fs.existsSync(path.join(webDir, "node_modules"))) {
    pushStatus("Installing Redou Agent renderer dependencies...");
    await runLogged(npm, ["install", "--no-fund", "--no-audit", "--progress=false"], {
      cwd: webDir,
    });
  }
  pushStatus("Building Redou Agent renderer...");
  await runLogged(npm, ["run", "build"], { cwd: webDir });
}

async function loadRenderer() {
  const indexPath = path.join(hermesRoot(), "hermes_cli", "web_dist", "index.html");
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Renderer build not found: ${indexPath}`);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.loadFile(indexPath, { hash: "/workspace" });
    rendererLoaded = true;
  }
}

async function boot() {
  try {
    renderStatus("Starting Redou Agent");
    const gitBash = resolveGitBashPath({ required: true });
    if (gitBash) pushStatus(`Git Bash ready at ${gitBash}`);
    const python = await ensurePythonRuntime();
    const service = getLocalService();
    service.setPythonPath(python);
    service.ensureInitialized();
    await ensureNodeRuntime();
    pushStatus("Opening local Renderer UI");
    await loadRenderer();
  } catch (error) {
    rendererLoaded = false;
    pushStatus("");
    pushStatus(error && error.stack ? error.stack : String(error));
    renderStatus("Redou Agent could not start");
  }
}

app.whenReady().then(() => {
  const logDir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logDir, { recursive: true });
  logFile = path.join(logDir, "desktop-main.log");
  fs.writeFileSync(logFile, `${new Date().toISOString()} ${PRODUCT_NAME} boot\n`, "utf8");

  process.on("uncaughtException", (error) => {
    pushStatus(error && error.stack ? error.stack : String(error));
  });
  process.on("unhandledRejection", (error) => {
    pushStatus(error && error.stack ? error.stack : String(error));
  });

  Menu.setApplicationMenu(null);
  createWindow();
  boot();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      boot();
    }
  });
});

app.on("before-quit", () => {
  stopHermesActivityForShutdown();
});

app.on("will-quit", () => {
  stopHermesActivityForShutdown();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    stopHermesActivityForShutdown();
    app.quit();
  }
});
