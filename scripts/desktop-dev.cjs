'use strict';

const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const path = require('node:path');

const workspaceRoot = path.resolve(__dirname, '..');
const desktopRoot = path.join(workspaceRoot, 'apps', 'desktop');
const rendererRoot = path.join(desktopRoot, 'renderer');

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findPort(start) {
  for (let port = start; port < start + 40; port += 1) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free renderer dev port found near ${start}.`);
}

function spawnLogged(label, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd || workspaceRoot,
    env: { ...process.env, ...(options.env || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  return child;
}

function waitForUrl(url, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    function probe() {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(probe, 350);
      });
      req.setTimeout(1200, () => {
        req.destroy();
      });
    }
    probe();
  });
}

async function main() {
  const configuredUrl = process.env.REDOU_RENDERER_URL;
  const port = configuredUrl ? null : await findPort(Number(process.env.REDOU_RENDERER_PORT || 5173));
  const rendererUrl = configuredUrl || `http://127.0.0.1:${port}`;
  const rendererArgs = configuredUrl
    ? ['--prefix', rendererRoot, 'run', 'dev', '--', '--host', '127.0.0.1']
    : ['--prefix', rendererRoot, 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'];
  const renderer = spawnLogged('renderer', npmCommand(), rendererArgs, { cwd: workspaceRoot });
  let electron = null;

  function shutdown(code = 0) {
    if (electron && !electron.killed) electron.kill();
    if (!renderer.killed) renderer.kill();
    process.exit(code);
  }

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  renderer.on('exit', (code) => {
    if (!electron) shutdown(code || 1);
  });

  await waitForUrl(rendererUrl);
  electron = spawnLogged('electron', npmCommand(), ['--prefix', desktopRoot, 'run', 'dev'], {
    cwd: workspaceRoot,
    env: {
      REDOU_RENDERER_URL: rendererUrl,
      NODE_ENV: 'development',
    },
  });
  electron.on('exit', (code) => shutdown(code || 0));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
