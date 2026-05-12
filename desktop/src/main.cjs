const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const PRODUCT_NAME = "Redou Agent";
const DEFAULT_PORT = 9119;
const PYTHON_ENV = "REDOU_PYTHON";

let mainWindow = null;
let backendProcess = null;
let backendPort = null;
let statusLines = [];
let logFile = null;

function projectRoot() {
  return path.resolve(__dirname, "..", "..");
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
    HERMES_DASHBOARD_DESKTOP: "1",
    HERMES_QUIET: "1",
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderStatus(title = "Starting") {
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
    await runLogged(venvPython, ["-m", "pip", "install", "-e", ".[web,pty]"]);
    fs.writeFileSync(
      marker,
      JSON.stringify({ createdAt: new Date().toISOString() }, null, 2),
      "utf8",
    );
  }

  return venvPython;
}

async function ensureNodeRuntime() {
  const tuiDir = path.join(projectRoot(), "ui-tui");
  const tuiEntry = path.join(tuiDir, "dist", "entry.js");

  if (!fs.existsSync(tuiEntry)) {
    const npm = resolveNpm();
    pushStatus("Installing Redou Agent TUI dependencies...");
    await runLogged(npm, ["install", "--no-fund", "--no-audit", "--progress=false"], {
      cwd: tuiDir,
    });
    pushStatus("Building Redou Agent TUI...");
    await runLogged(npm, ["run", "build"], { cwd: tuiDir });
  }
}

function getFreePort(start = DEFAULT_PORT) {
  return new Promise((resolve, reject) => {
    let port = start;
    const tryPort = () => {
      const server = net.createServer();
      server.once("error", () => {
        port += 1;
        if (port > start + 100) reject(new Error("No free local port found."));
        else tryPort();
      });
      server.once("listening", () => {
        server.close(() => resolve(port));
      });
      server.listen(port, "127.0.0.1");
    };
    tryPort();
  });
}

function waitForDashboard(port, timeoutMs = 120000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error("Timed out waiting for the Redou Agent runtime."));
        return;
      }
      const req = http.get(
        {
          host: "127.0.0.1",
          port,
          path: "/api/status",
          timeout: 2000,
        },
        (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) resolve();
          else setTimeout(tick, 800);
        },
      );
      req.on("error", () => setTimeout(tick, 800));
      req.on("timeout", () => {
        req.destroy();
        setTimeout(tick, 800);
      });
    };
    tick();
  });
}

async function startBackend(python) {
  backendPort = await getFreePort();
  pushStatus(`Starting Redou Agent runtime on 127.0.0.1:${backendPort}...`);

  backendProcess = spawn(
    python,
    [
      "-m",
      "hermes_cli.main",
      "dashboard",
      "--host",
      "127.0.0.1",
      "--port",
      String(backendPort),
      "--no-open",
      "--tui",
    ],
    {
      cwd: projectRoot(),
      env: withRuntimePath(process.env),
      windowsHide: true,
      shell: false,
    },
  );

  backendProcess.stdout.on("data", (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
      pushStatus(line);
    }
  });
  backendProcess.stderr.on("data", (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
      pushStatus(line);
    }
  });
  backendProcess.on("exit", (code) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      pushStatus(`Redou Agent runtime exited with code ${code}.`);
    }
  });

  await waitForDashboard(backendPort);
  return `http://127.0.0.1:${backendPort}`;
}

async function boot() {
  try {
    renderStatus("Starting Redou Agent");
    const python = await ensurePythonRuntime();
    await ensureNodeRuntime();
    const url = await startBackend(python);
    pushStatus(`Opening ${url}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.loadURL(url);
    }
  } catch (error) {
    pushStatus("");
    pushStatus(error && error.stack ? error.stack : String(error));
    renderStatus("Redou Agent could not start");
  }
}

function stopBackend() {
  if (!backendProcess || backendProcess.killed) return;
  try {
    backendProcess.kill();
  } catch (_error) {
    // Best effort during app shutdown.
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

app.on("before-quit", stopBackend);

app.on("window-all-closed", () => {
  stopBackend();
  if (process.platform !== "darwin") app.quit();
});
