const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { RedouLocalService } = require("../src/services/redouLocalService.cjs");

function makeService() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "redou-attachments-"));
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
  return { root, service };
}

function createProjectAndTask(service, workspacePath = "") {
  const created = service.createChatProject({
    name: "Attachment Project",
    workspace_path: workspacePath,
  });
  const project = created.project;
  const task = project.tasks[0];
  assert.ok(project.id);
  assert.ok(task.id);
  return { project, task };
}

test("copyTaskAttachments stores image and file metadata for a task", () => {
  const { root, service } = makeService();
  const { project, task } = createProjectAndTask(service);
  const imagePath = path.join(root, "screen shot.png");
  const notePath = path.join(root, "notes.txt");
  fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(notePath, "plain text");

  const result = service.copyTaskAttachments(project.id, task.id, [imagePath, notePath]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.attachments.length, 2);
  assert.equal(result.attachments[0].name, "screen shot.png");
  assert.equal(result.attachments[0].mimeType, "image/png");
  assert.match(result.attachments[0].relativePath, /^uploads[\\/]/);
  assert.ok(fs.existsSync(result.attachments[0].storedPath));
  assert.equal(result.attachments[1].name, "notes.txt");
  assert.equal(result.attachments[1].mimeType, "text/plain");
});

test("buildTaskContext exposes current and historical attachment paths", () => {
  const { root, service } = makeService();
  const { project, task } = createProjectAndTask(service);
  const imagePath = path.join(root, "diagram.jpg");
  fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff]));
  const { attachments } = service.copyTaskAttachments(project.id, task.id, [imagePath]);

  const first = service.buildTaskContext({
    projectId: project.id,
    taskId: task.id,
    userInput: "Please inspect this image.",
    attachments,
  });

  assert.match(first.userContext, /## 5\. Attachments/);
  assert.match(first.userContext, /\[image\] diagram\.jpg/);
  assert.match(first.userContext, /storedPath=/);
  assert.equal(first.metadata.attachmentCount, 1);
  assert.equal(first.metadata.imageAttachmentCount, 1);
  assert.ok(first.metadata.includedFiles.includes(attachments[0].storedPath));

  service.appendTaskMessage(project.id, task.id, "user", "Earlier upload", {}, attachments);
  const second = service.buildTaskContext({
    projectId: project.id,
    taskId: task.id,
    userInput: "What changed?",
  });

  assert.match(second.userContext, /## 4\. Recent Conversation/);
  assert.match(second.userContext, /Attachments:/);
  assert.match(second.userContext, /diagram\.jpg/);
});

test("sendMessage accepts attachment-only messages and persists the transfer", () => {
  const { root, service } = makeService();
  const { project, task } = createProjectAndTask(service);
  const filePath = path.join(root, "report.pdf");
  fs.writeFileSync(filePath, "%PDF-1.7");
  const { attachments } = service.copyTaskAttachments(project.id, task.id, [filePath]);

  const built = service.buildTaskContext({
    projectId: project.id,
    taskId: task.id,
    userInput: "",
    attachments,
  });
  assert.match(built.userContext, /The user sent 1 file without additional text/);
  assert.match(built.userContext, /report\.pdf/);

  const response = service.sendMessage(null, {
    projectId: project.id,
    taskId: task.id,
    userInput: "",
    attachments,
  });

  assert.equal(response.ok, false);
  assert.match(response.warning || "", /Python runtime is unavailable/);

  const loaded = service.getChatTaskMessages(project.id, task.id);
  const userMessage = loaded.messages.find((message) => message.role === "user");
  assert.ok(userMessage);
  assert.equal(userMessage.content, "");
  assert.equal(userMessage.attachments.length, 1);
  assert.equal(userMessage.attachments[0].name, "report.pdf");
});

test("childEnv prefers Redou-managed Hermes .env over stale process env", () => {
  const { service } = makeService();
  const previous = process.env.XIAOMI_API_KEY;
  process.env.XIAOMI_API_KEY = "stale-parent-key";
  try {
    fs.mkdirSync(service.hermesHome, { recursive: true });
    fs.writeFileSync(
      path.join(service.hermesHome, ".env"),
      "XIAOMI_API_KEY=fresh-redou-key\n",
      "utf8",
    );

    const env = service.childEnv();

    assert.equal(env.XIAOMI_API_KEY, "fresh-redou-key");
  } finally {
    if (previous === undefined) {
      delete process.env.XIAOMI_API_KEY;
    } else {
      process.env.XIAOMI_API_KEY = previous;
    }
  }
});

test("projects and tasks use only the current Redou markdown files", () => {
  const { root, service } = makeService();
  const workspacePath = path.join(root, "workspace");
  fs.mkdirSync(workspacePath, { recursive: true });
  const { project, task } = createProjectAndTask(service, workspacePath);
  const projectRulesPath = path.join(workspacePath, ".redou", "PROJECT_RULES.md");
  const taskRulesPath = path.join(workspacePath, ".redou", "tasks", task.id, "TASK_RULES.md");
  const taskContextPath = path.join(workspacePath, ".redou", "tasks", task.id, "TASK_CONTEXT.md");

  const loaded = service.readProject(project.id);
  const projectFile = service.getProjectContextFile(project.id, "rules");
  const taskContextFile = service.getTaskContextFile(project.id, task.id, "context");

  assert.equal(projectFile.kind, "rules");
  assert.equal(projectFile.path, projectRulesPath);
  assert.equal(loaded.rulesPath, projectRulesPath);
  assert.equal(loaded.tasks[0].rulesPath, taskRulesPath);
  assert.equal(loaded.tasks[0].contextPath, taskContextPath);
  assert.equal(fs.existsSync(projectRulesPath), true);
  assert.equal(fs.existsSync(taskRulesPath), true);
  assert.equal(fs.existsSync(taskContextPath), true);
  assert.equal(path.basename(taskContextFile.path), "TASK_CONTEXT.md");
  assert.match(taskContextFile.content, /## A\. Structured State/);
  assert.match(taskContextFile.content, /## B\. Raw Turn Log/);
});

test("updateTaskContextAfterTurn appends lightweight raw turn log only", () => {
  const { service } = makeService();
  const { project, task } = createProjectAndTask(service);

  const result = service.updateTaskContextAfterTurn(
    project.id,
    task.id,
    "请帮我实现这个功能，必须保持 IPC 边界。",
    "Changed desktop/src/services/redouLocalService.cjs and ran npm test; one check failed with Error.",
    {
      artifacts: {
        files: ["desktop/src/services/redouLocalService.cjs"],
        commands: ["npm --prefix desktop test"],
        errors: ["Error: sample failure"],
        attachments: [],
      },
    },
  );

  assert.ok(result);
  const content = fs.readFileSync(task.contextPath, "utf8");
  assert.match(content, /## A\. Structured State/);
  assert.match(content, /## B\. Raw Turn Log/);
  assert.match(content, /User Request:\n请帮我实现这个功能/);
  assert.match(content, /Assistant Summary:\nChanged desktop\/src\/services\/redouLocalService\.cjs/);
  assert.match(content, /- files:\n  - desktop\/src\/services\/redouLocalService\.cjs/);
  assert.match(content, /- commands:\n  - npm --prefix desktop test/);
  assert.match(content, /- constraints:\n  - 必须/);
  assert.match(content, /- todos:\n  - 帮我/);
  assert.doesNotMatch(content, /## Recent Turn Summaries/);
});

test("buildTaskContext uses dynamic budget and compacts oversized task context", () => {
  const { root, service } = makeService();
  const workspacePath = path.join(root, "workspace");
  fs.mkdirSync(workspacePath, { recursive: true });
  const { project, task } = createProjectAndTask(service, workspacePath);
  service.runContextCompactModel = () => ({
    ok: true,
    result: {
      project_rules_to_add: ["Long-lived project compact rule."],
      task_rules_to_add: ["Current task compact rule."],
      compressed_task_context: [
        "# Task Context",
        "",
        "## A. Structured State",
        "",
        "### Current Brief",
        "",
        "Compacted brief.",
        "",
        "### Active Constraints",
        "",
        "Current task compact rule.",
        "",
        "### Todo List",
        "",
        "- Continue the request.",
        "",
        "### Progress Summary",
        "",
        "Oversized raw context was compacted.",
        "",
        "### Evidence and Artifacts",
        "",
        "None.",
        "",
        "### Open Issues",
        "",
        "None.",
        "",
        "---",
        "",
        "## B. Raw Turn Log",
        "",
      ].join("\n"),
    },
  });
  service.updateTaskContextFile(
    project.id,
    task.id,
    "context",
    [
      "# Task Context",
      "",
      "## A. Structured State",
      "",
      "### Current Brief",
      "",
      String.fromCharCode(0x6d4b).repeat(30000),
      "",
      "### Active Constraints",
      "",
      "### Todo List",
      "",
      "### Progress Summary",
      "",
      "### Evidence and Artifacts",
      "",
      "### Open Issues",
      "",
      "---",
      "",
      "## B. Raw Turn Log",
      "",
    ].join("\n"),
  );

  const built = service.buildTaskContext({
    projectId: project.id,
    taskId: task.id,
    userInput: "Use the current task context.",
    modelContextTokens: 24000,
  });

  assert.notEqual(built.metadata.contextMaxTokens, 200000);
  assert.equal(built.metadata.modelContextTokens, 24000);
  assert.equal(built.metadata.contextCompressed, true);
  assert.equal(built.metadata.contextCompression.succeeded, true);
  assert.ok(built.metadata.contextTokens <= built.metadata.contextMaxTokens);
  assert.ok(built.metadata.contextPercent <= 100);
  assert.match(fs.readFileSync(project.rulesPath, "utf8"), /Long-lived project compact rule/);
  assert.match(fs.readFileSync(task.rulesPath, "utf8"), /Current task compact rule/);
  assert.match(fs.readFileSync(task.contextPath, "utf8"), /Compacted brief/);
});
