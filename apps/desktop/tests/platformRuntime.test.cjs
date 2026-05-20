const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");

const {
  describePlatformPrerequisites,
  isWindowsShellScript,
  runtimePathExtras,
  venvPythonPath,
} = require("../src/platformRuntime.cjs");

test("platform runtime resolves the managed venv python path for the host OS", () => {
  const venvDir = path.join("runtime", "venv");
  const pythonPath = venvPythonPath(venvDir);

  if (process.platform === "win32") {
    assert.equal(pythonPath, path.join(venvDir, "Scripts", "python.exe"));
  } else {
    assert.equal(pythonPath, path.join(venvDir, "bin", "python"));
  }
});

test("platform runtime only treats cmd and bat files as Windows shell scripts", () => {
  assert.equal(isWindowsShellScript("npm.cmd"), process.platform === "win32");
  assert.equal(isWindowsShellScript("install.bat"), process.platform === "win32");
  assert.equal(isWindowsShellScript("npm"), false);
});

test("platform runtime exposes path extras and dependency guidance", () => {
  assert.ok(Array.isArray(runtimePathExtras()));
  assert.match(describePlatformPrerequisites(), /Python|python3/);
});
