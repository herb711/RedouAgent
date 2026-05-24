#!/usr/bin/env node
// Redou-owned entry point. This wrapper never resolves or launches a system
// `codex`; it only runs a binary from this runtime tree or cargo for this tree.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runtimeRoot = path.resolve(__dirname, "..", "..");
const redouProjectRoot = path.resolve(runtimeRoot, "..", "..");
const redouCodexHome = process.env.REDOU_CODEX_HOME || path.join(redouProjectRoot, ".redou", "redou-codex");
const manifestPath = path.join(runtimeRoot, "codex-rs", "Cargo.toml");
const exeName = process.platform === "win32" ? "redou-codex.exe" : "redou-codex";
const releaseBinary = path.join(runtimeRoot, "codex-rs", "target", "release", exeName);
const debugBinary = path.join(runtimeRoot, "codex-rs", "target", "debug", exeName);
const isCargoFallback = !existsSync(releaseBinary) && !existsSync(debugBinary);
const allowCargoFallback =
  process.env.REDOU_CODEX_DEV_MODE === "1" || process.env.REDOU_CODEX_ALLOW_CARGO_FALLBACK === "1";

function commandForRuntime() {
  if (existsSync(releaseBinary)) return { command: releaseBinary, args: process.argv.slice(2) };
  if (existsSync(debugBinary)) return { command: debugBinary, args: process.argv.slice(2) };
  if (!allowCargoFallback) {
    console.error(`REDOU_CODEX_RUNTIME_NOT_FOUND: ${exeName}`);
    process.exit(1);
  }
  return {
    command: "cargo",
    args: [
      "run",
      "--manifest-path",
      manifestPath,
      "-p",
      "redou-codex-cli",
      "--bin",
      "redou-codex",
      "--",
      ...process.argv.slice(2),
    ],
  };
}

const resolved = commandForRuntime();
if (!isCargoFallback) {
  console.error(`redou-codex exe: ${resolved.command}`);
}
if (!existsSync(redouCodexHome)) {
  mkdirSync(redouCodexHome, { recursive: true });
}

const env = {
  ...process.env,
  REDOU_CODEX_RUNTIME: "1",
  REDOU_PROJECT_ROOT: redouProjectRoot,
  REDOU_CODEX_HOME: redouCodexHome,
  CODEX_HOME: redouCodexHome,
  REDOU_CODEX_MANAGED_PACKAGE_ROOT: realpathSync(runtimeRoot),
};

const child = spawn(resolved.command, resolved.args, {
  stdio: "inherit",
  env,
  windowsHide: true,
});

child.on("error", (err) => {
  const details = err && err.message ? err.message : String(err);
  if (isCargoFallback) {
    console.error(
      `REDOU_CODEX_START_FAILED: cargo fallback for project-local redou-codex could not start. ${details}`,
    );
  } else {
    console.error(`REDOU_CODEX_START_FAILED: redou-codex binary could not start. ${details}`);
  }
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
