const { spawn, spawnSync } = require("child_process");

function terminateProcessTree(child, { force = true } = {}) {
  if (!child || child.killed) return;
  const pid = child.pid;
  try {
    if (process.platform === "win32" && pid) {
      const args = ["/PID", String(pid), "/T"];
      if (force) args.push("/F");
      const result = spawnSync("taskkill", args, {
        windowsHide: true,
        stdio: "ignore",
      });
      if (result.status === 0) return;
    } else if (pid) {
      spawnSync("pkill", [force ? "-KILL" : "-TERM", "-P", String(pid)], {
        stdio: "ignore",
      });
    }
  } catch {
    // Fall through to child.kill below.
  }
  try {
    child.kill(force ? "SIGKILL" : "SIGTERM");
  } catch {
    // Best effort.
  }
}

class ProcessManager {
  constructor({ activeRuns = new Map(), eventBus = null, log = null } = {}) {
    this.activeRuns = activeRuns;
    this.eventBus = eventBus;
    this.log = typeof log === "function" ? log : () => {};
  }

  spawn(command, args = [], options = {}) {
    return spawn(command, args, options);
  }

  spawnSync(command, args = [], options = {}) {
    return spawnSync(command, args, options);
  }

  terminate(child, options = {}) {
    terminateProcessTree(child, options);
  }

  stopRun(runId, { webContents = null, emitToRenderer, persistEvent } = {}) {
    const run = this.activeRuns.get(runId);
    if (!run) return { ok: false, message: "Run not found" };
    try {
      run.stopRequested = true;
      terminateProcessTree(run.child, { force: true });
    } catch {
      // Best effort.
    }
    const event = {
      type: "error",
      message: "Run stopped by user.",
      metadata: { runId, projectId: run.projectId, taskId: run.taskId },
    };
    if (typeof emitToRenderer === "function") {
      emitToRenderer(webContents, {
        runId,
        projectId: run.projectId,
        taskId: run.taskId,
        event,
      });
    }
    if (typeof persistEvent === "function") {
      persistEvent(run.projectId, run.taskId, event);
    }
    this.eventBus?.emit("run:stopped", { runId, projectId: run.projectId, taskId: run.taskId });
    return { ok: true };
  }
}

module.exports = {
  ProcessManager,
  terminateProcessTree,
};
