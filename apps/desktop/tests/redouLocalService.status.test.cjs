const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { RedouLocalService } = require("../src/services/redouLocalService.cjs");

function makeService() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "redou-status-"));
  const app = {
    getPath(name) {
      assert.equal(name, "userData");
      return path.join(root, "userData");
    },
  };
  const service = new RedouLocalService({
    app,
    projectRoot: root,
    hermesHome: path.join(root, "hermes-home"),
    log: () => {},
  });
  service.ensureInitialized();
  const { project } = service.createChatProject({ name: "Status Project" });
  const task = project.tasks[0];
  return { root, service, project, task };
}

test("desktop status and sessions reflect active runs", () => {
  const { service, project, task } = makeService();
  const runId = "run-active";
  service.activeRuns.set(runId, {
    projectId: project.id,
    taskId: task.id,
    startedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
    lastActiveAtMs: Date.now(),
    contextTokens: 1234,
    outputEstimateTokens: 42,
    child: { pid: 4242 },
  });

  const status = service.getStatus();
  assert.equal(status.active_sessions, 1);
  assert.equal(status.gateway_running, true);
  assert.equal(status.gateway_pid, 4242);

  const sessions = service.getSessions(10, 0);
  assert.equal(sessions.total, 1);
  assert.equal(sessions.sessions[0].is_active, true);
  assert.equal(sessions.sessions[0].input_tokens, 1234);
  assert.equal(sessions.sessions[0].output_tokens, 42);
});

test("chat project task runtime snapshots are scoped by task id", () => {
  const { service, project, task } = makeService();
  const otherTask = service.createChatTask(project.id, { title: "Other Task" }).task;
  const runId = "run-task-one";
  service.activeRuns.set(runId, {
    projectId: project.id,
    taskId: task.id,
    startedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
    lastActiveAtMs: Date.now(),
    child: { pid: 4242 },
  });

  const response = service.getChatProjects();
  const savedProject = response.projects.find((item) => item.id === project.id);
  const runningTask = savedProject.tasks.find((item) => item.id === task.id);
  const idleTask = savedProject.tasks.find((item) => item.id === otherTask.id);

  assert.equal(runningTask.is_active, true);
  assert.equal(runningTask.active_run_id, runId);
  assert.equal(idleTask.is_active, false);
  assert.equal(idleTask.active_run_id, null);

  assert.equal(service.getChatTaskMessages(project.id, task.id).is_active, true);
  assert.equal(service.getChatTaskMessages(project.id, otherTask.id).is_active, false);
});

test("chat project task runtime status distinguishes running completed and interrupted tasks", () => {
  const { service, project, task: completedTask } = makeService();
  const interruptedTask = service.createChatTask(project.id, { title: "Stopped Task" }).task;
  const runningTask = service.createChatTask(project.id, { title: "Running Task" }).task;

  service.appendTaskMessage(project.id, completedTask.id, "assistant", "Done.", {
    eventType: "assistant_message",
    event: { type: "assistant_message", content: "Done." },
  });
  service.appendTaskMessage(project.id, completedTask.id, "event", "done", {
    eventType: "done",
    event: { type: "done", metadata: { completed: true } },
  });

  service.appendTaskMessage(project.id, interruptedTask.id, "event", "Run stopped by user.", {
    eventType: "error",
    event: { type: "error", message: "Run stopped by user." },
  });
  service.appendTaskMessage(project.id, interruptedTask.id, "event", "done", {
    eventType: "done",
    event: { type: "done", metadata: { exitCode: 1 } },
  });

  service.activeRuns.set("run-live", {
    projectId: project.id,
    taskId: runningTask.id,
    startedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
    lastActiveAtMs: Date.now(),
    child: { pid: 4242 },
  });

  const response = service.getChatProjects();
  const savedProject = response.projects.find((item) => item.id === project.id);
  const byId = new Map(savedProject.tasks.map((item) => [item.id, item]));

  assert.equal(byId.get(completedTask.id).runtime_status, "completed");
  assert.equal(byId.get(interruptedTask.id).runtime_status, "interrupted");
  assert.equal(byId.get(runningTask.id).runtime_status, "running");
});

test("desktop analytics and session messages use local task logs", () => {
  const { service, project, task } = makeService();
  service.appendTaskMessage(project.id, task.id, "user", "Inspect the project.");
  service.appendTaskMessage(project.id, task.id, "event", "Hermes local runtime started.", {
    eventType: "raw_log",
    event: {
      type: "raw_log",
      metadata: {
        runId: "run-complete",
        context: {
          modelProvider: "openai",
          model: "gpt-test",
          contextTokens: 800,
        },
      },
    },
  });
  service.appendTaskMessage(project.id, task.id, "event", "tool started: terminal", {
    eventType: "tool_start",
    event: {
      type: "tool_start",
      name: "terminal",
      input: { command: "npm test" },
      metadata: { runId: "run-complete", toolCallId: "tool-1" },
    },
  });
  service.appendTaskMessage(project.id, task.id, "assistant", "Done.", {
    eventType: "assistant_message",
    event: {
      type: "assistant_message",
      content: "Done.",
      metadata: {
        runId: "run-complete",
        inputTokens: 100,
        outputTokens: 25,
        apiCalls: 2,
      },
    },
  });
  service.appendTaskMessage(project.id, task.id, "event", "done", {
    eventType: "done",
    event: {
      type: "done",
      metadata: {
        runId: "run-complete",
        inputTokens: 100,
        outputTokens: 25,
        cacheReadTokens: 7,
        reasoningTokens: 3,
        apiCalls: 2,
      },
    },
  });

  const sessions = service.getSessions(10, 0);
  assert.equal(sessions.sessions[0].tool_call_count, 1);
  assert.equal(sessions.sessions[0].input_tokens, 100);
  assert.equal(sessions.sessions[0].output_tokens, 25);

  const analytics = service.getUsageAnalytics(7);
  assert.equal(analytics.totals.total_input, 100);
  assert.equal(analytics.totals.total_output, 25);
  assert.equal(analytics.totals.total_cache_read, 7);
  assert.equal(analytics.totals.total_reasoning, 3);
  assert.equal(analytics.totals.total_api_calls, 2);

  const messages = service.getSessionMessages(sessions.sessions[0].id);
  assert.equal(messages.messages.some((message) => message.role === "user"), true);
  assert.equal(
    messages.messages.some((message) => message.tool_calls?.[0]?.function?.name === "terminal"),
    true,
  );
});

test("analysis benchmarks expose live duration for active runs", () => {
  const { service } = makeService();
  const startedAt = new Date(Date.now() - 5_000).toISOString();
  const key = "openai--gpt-live";
  const runId = "run-live";

  service.activeAnalysisRun = { key, runId };
  service.writeAnalysisStore({
    version: 1,
    updatedAt: new Date().toISOString(),
    results: [
      {
        id: key,
        key,
        runId,
        provider: "openai",
        model: "gpt-live",
        agent: "Hermes Agent",
        status: "running",
        startedAt,
        updatedAt: startedAt,
        tasks: [
          {
            id: "task1",
            title: "Docker environment lab",
            capability: "environment",
            status: "running",
            startedAt,
            durationMs: 0,
            score: 0,
            sections: [],
          },
        ],
      },
    ],
  });

  const benchmarks = service.getAnalysisBenchmarks();
  const liveTask = benchmarks.results[0].tasks[0];
  assert.ok(liveTask.durationMs >= 4_000);
  assert.ok(benchmarks.results[0].totals.durationMs >= 4_000);

  const persistedTask = service.readAnalysisStore().results[0].tasks[0];
  assert.equal(persistedTask.durationMs, 0);
});

test("analysis benchmarks expose the migrated task1 through task9 suite", () => {
  const { service } = makeService();
  const benchmarks = service.getAnalysisBenchmarks();
  const taskIds = benchmarks.tasks.map((task) => task.id);

  assert.deepEqual(taskIds, [
    "task1",
    "task2",
    "task3",
    "task4",
    "task5",
    "task6",
    "task7",
    "task8",
    "task9",
  ]);
  assert.equal(benchmarks.tasks.some((task) => task.harness), false);
});

test("analysis benchmarks expose the eight current ability dimensions", () => {
  const { service } = makeService();
  const section = (id, score) => ({ id, label: id, score, evidence: "" });

  service.writeAnalysisStore({
    version: 1,
    results: [
      {
        provider: "openai",
        model: "gpt-capability",
        abilityScores: {
          environment: 1,
          implementation: 2,
          debugging: 3,
          research: 4,
          verification: 5,
          documentation: 6,
        },
        tasks: [
          {
            id: "task1",
            title: "Docker environment lab",
            status: "completed",
            score: 100,
            sections: [
              section("environment_verification", 100),
              section("documentation", 100),
            ],
          },
          {
            id: "task2",
            title: "Small project build",
            status: "completed",
            score: 90,
            sections: [
              section("project_created", 100),
              section("features", 90),
              section("persistence", 80),
              section("container_execution", 100),
              section("verification", 90),
              section("report", 80),
            ],
          },
          {
            id: "task3",
            title: "Debug and repair loop",
            status: "completed",
            score: 70,
            sections: [
              section("container_execution", 100),
              section("bug_loop", 70),
              section("log_report", 80),
              section("function_coverage", 85),
            ],
          },
          {
            id: "task4",
            title: "Research and product plan",
            status: "completed",
            score: 75,
            sections: [
              section("report_saved", 80),
              section("sources", 70),
              section("comparison", 75),
              section("product_plan", 80),
              section("container_check", 100),
            ],
          },
          {
            id: "task5",
            title: "Peewee ORM industrial bug fixing",
            status: "completed",
            score: 70,
            sections: [
              section("container_execution", 100),
              section("automated_tests", 70),
              section("official_submission", 100),
              section("report", 80),
            ],
          },
          {
            id: "task6",
            title: "Bottle plugin extension",
            status: "completed",
            score: 80,
            sections: [
              section("container_execution", 100),
              section("automated_tests", 80),
              section("official_submission", 100),
              section("report", 80),
            ],
          },
          {
            id: "task7",
            title: "Markdown parser implementation",
            status: "completed",
            score: 75,
            sections: [
              section("container_execution", 100),
              section("automated_tests", 75),
              section("official_submission", 100),
              section("report", 80),
            ],
          },
          {
            id: "task8",
            title: "Click CLI framework bug fixing",
            status: "completed",
            score: 65,
            sections: [
              section("container_execution", 100),
              section("automated_tests", 65),
              section("official_submission", 100),
              section("report", 80),
            ],
          },
          {
            id: "task9",
            title: "Jinja2 custom extension development",
            status: "completed",
            score: 85,
            sections: [
              section("container_execution", 100),
              section("automated_tests", 85),
              section("official_submission", 100),
              section("report", 80),
            ],
          },
        ],
      },
    ],
  });

  const abilityScores = service.getAnalysisBenchmarks().results[0].abilityScores;
  assert.deepEqual(Object.keys(abilityScores), [
    "environmentConstraints",
    "projectDelivery",
    "debugRepair",
    "frameworkExtension",
    "parsingEdgeCases",
    "verificationIteration",
    "researchProduct",
    "documentationReproducibility",
  ]);
  assert.equal(abilityScores.environment, undefined);
  assert.ok(abilityScores.environmentConstraints > 0);
  assert.ok(abilityScores.frameworkExtension > 0);
});
