const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { RedouLocalService } = require("./services/redouLocalService.cjs");

const PRODUCT_NAME = "Redou Agent";
const PYTHON_ENV = "REDOU_PYTHON";

let mainWindow = null;
let localService = null;
let statusLines = [];
let logFile = null;
let rendererLoaded = false;
let shutdownComplete = false;

function projectRoot() {
  return path.resolve(__dirname, "..", "..", "..");
}

function hermesRoot() {
  return path.join(projectRoot(), "vendor", "hermes");
}

function runtimeRoot() {
  return path.join(app.getPath("userData"), "runtime");
}

function hermesHome() {
  return path.join(app.getPath("userData"), "hermes-home");
}

function withRuntimePath(env = process.env) {
  const extras = [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python312"),
    "C:\\Program Files\\nodejs",
  ].filter(Boolean);
  return {
    ...env,
    PATH: [...extras, env.PATH || ""].join(path.delimiter),
    PYTHONUTF8: "1",
    PYTHONUNBUFFERED: "1",
    HERMES_HOME: hermesHome(),
    REDOU_APP_DATA_ROOT: localService ? localService.appDataRoot() : path.join(app.getPath("userData"), "appData"),
    HERMES_PYTHON_SRC_ROOT: hermesRoot(),
    REDOU_PROJECT_ROOT: projectRoot(),
    HERMES_VENDOR_ROOT: hermesRoot(),
    PYTHONPATH: [hermesRoot(), env.PYTHONPATH || ""].filter(Boolean).join(path.delimiter),
    HERMES_QUIET: "1",
  };
}

function getLocalService() {
  if (!localService) {
    localService = new RedouLocalService({
      app,
      projectRoot: projectRoot(),
      hermesRoot: hermesRoot(),
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
    const result = localService.stopAllHermesActivity(reason);
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

  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(hermesHome(), { recursive: true });

  if (!fs.existsSync(venvPython)) {
    const python = resolvePython();
    pushStatus("Creating Python virtual environment...");
    await runLogged(python, ["-m", "venv", venvDir]);
  }

  if (!fs.existsSync(marker)) {
    pushStatus("Installing Redou Agent Python dependencies...");
    await runLogged(venvPython, ["-m", "pip", "install", "--upgrade", "pip"]);
    await runLogged(venvPython, ["-m", "pip", "install", "-e", hermesRoot()]);
    fs.writeFileSync(
      marker,
      JSON.stringify({ createdAt: new Date().toISOString() }, null, 2),
      "utf8",
    );
  }

  return venvPython;
}

async function ensureNodeRuntime() {
  const webDir = path.join(hermesRoot(), "web");
  const webEntry = path.join(hermesRoot(), "hermes_cli", "web_dist", "index.html");

  if (!fs.existsSync(webEntry)) {
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
