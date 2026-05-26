const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const extensionService = require('../src/services/local-service/extensions/extensionService.cjs');

function tempDeps(prefix = 'redou-extensions-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    root,
    deps: {
      workspaceRoot: root,
      dataRoot: path.join(root, 'data'),
      redouCodexHome: path.join(root, 'redou-codex'),
    },
  };
}

function readConfig(deps) {
  return fs.readFileSync(path.join(deps.redouCodexHome, 'config.toml'), 'utf8');
}

test('MCP servers are stored in redou-codex config.toml mcp_servers', async () => {
  const { deps } = tempDeps();

  const result = await extensionService.addMcpServer(deps, {
    name: 'docs',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    env: { DOCS_TOKEN: '${DOCS_TOKEN}' },
    startupTimeoutSec: 12,
  });

  assert.equal(result.server.name, 'docs');
  const text = readConfig(deps);
  assert.match(text, /\[mcp_servers\.docs\]/);
  assert.match(text, /command = "npx"/);
  assert.match(text, /args = \["-y", "@modelcontextprotocol\/server-filesystem"\]/);
  assert.match(text, /DOCS_TOKEN = "\$\{DOCS_TOKEN\}"/);
  assert.match(text, /startup_timeout_sec = 12/);

  const listed = await extensionService.listMcpServers(deps);
  assert.deepEqual(listed.servers.map((server) => server.name), ['docs']);
});

test('MiniMax built-in plugin is registered in the existing extension catalog', async () => {
  const { deps } = tempDeps();

  const listed = await extensionService.listExtensions(deps, { kind: 'plugin' });
  const minimax = listed.find((item) => item.id === 'plugin:minimax@redou');

  assert.ok(minimax);
  assert.equal(minimax.kind, 'plugin');
  assert.equal(minimax.name, 'minimax');
  assert.equal(minimax.title, 'MiniMax 多模态');
  assert.equal(minimax.source, 'bundled');
  assert.equal(minimax.status, 'missing-config');
  assert.ok(minimax.tags.includes('MiniMax'));
});

test('MiniMax plugin appears in the plugin marketplace list', async () => {
  const { deps } = tempDeps();

  const catalog = await extensionService.listExtensionCatalog(deps, { kind: 'plugin' });
  const minimax = catalog.find((item) => item.id === 'plugin:minimax@redou');

  assert.ok(minimax);
  assert.equal(minimax.description, '通过 MiniMax 官方 HTTP API 生成语音和图片，支持 Token Plan 或普通 API Key。');
  assert.equal(minimax.raw.raw.provider, 'minimax');
  assert.deepEqual(minimax.raw.raw.tools.map((tool) => tool.name), [
    'minimax.health_check',
    'minimax.text_to_audio',
    'minimax.text_to_image',
  ]);
});

test('MCP updates preserve supported advanced config fields', async () => {
  const { deps } = tempDeps();
  fs.mkdirSync(deps.redouCodexHome, { recursive: true });
  fs.writeFileSync(path.join(deps.redouCodexHome, 'config.toml'), [
    'model = "redou-model"',
    '',
    '[mcp_servers.linear]',
    'url = "https://old.example/mcp"',
    'bearer_token_env_var = "LINEAR_TOKEN"',
    'enabled = false',
    'startup_timeout_sec = 5',
    'tool_timeout_sec = 45',
    '',
    '[mcp_servers.linear.env_http_headers]',
    'X-API-Key = "LINEAR_HEADER"',
    '',
    '[mcp_servers.linear.http_headers]',
    'X-App = "Redou"',
    '',
  ].join('\n'), 'utf8');

  await extensionService.updateMcpServer(deps, 'linear', {
    name: 'linear',
    transport: 'streamable_http',
    url: 'https://new.example/mcp',
    enabled: true,
  });

  const text = readConfig(deps);
  assert.match(text, /model = "redou-model"/);
  assert.match(text, /\[mcp_servers\.linear\]/);
  assert.match(text, /url = "https:\/\/new\.example\/mcp"/);
  assert.match(text, /bearer_token_env_var = "LINEAR_TOKEN"/);
  assert.match(text, /startup_timeout_sec = 5/);
  assert.match(text, /tool_timeout_sec = 45/);
  assert.match(text, /\[mcp_servers\.linear\.env_http_headers\]/);
  assert.match(text, /X-API-Key = "LINEAR_HEADER"/);
  assert.match(text, /\[mcp_servers\.linear\.http_headers\]/);
  assert.match(text, /X-App = "Redou"/);
  assert.doesNotMatch(text, /enabled = false/);
});

test('MCP update can rename a server', async () => {
  const { deps } = tempDeps();
  await extensionService.addMcpServer(deps, {
    name: 'docs',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    env: { DOCS_TOKEN: 'secret' },
  });

  const result = await extensionService.updateMcpServer(deps, 'docs', {
    name: 'docs-renamed',
    transport: 'stdio',
    command: 'uvx',
    raw: undefined,
  });

  assert.equal(result.server.name, 'docs-renamed');
  const text = readConfig(deps);
  assert.doesNotMatch(text, /\[mcp_servers\.docs\]/);
  assert.match(text, /\[mcp_servers\.docs-renamed\]/);
  assert.match(text, /command = "uvx"/);
  assert.match(text, /DOCS_TOKEN = "secret"/);
});

test('MCP display name is stored separately from the runtime server name', async () => {
  const { deps } = tempDeps();
  await extensionService.addMcpServer(deps, {
    name: 'minimax',
    displayName: 'MiniMax Coding Plan',
    transport: 'stdio',
    command: 'uvx',
    args: ['minimax-coding-plan-mcp', '-y'],
  });

  const text = readConfig(deps);
  assert.match(text, /\[mcp_servers\.minimax\]/);
  assert.doesNotMatch(text, /MiniMax Coding Plan/);
  assert.doesNotMatch(text, /displayName/);

  const metadata = JSON.parse(fs.readFileSync(path.join(deps.redouCodexHome, 'redou-mcp-metadata.json'), 'utf8'));
  assert.equal(metadata.servers.minimax.displayName, 'MiniMax Coding Plan');

  const listed = await extensionService.listExtensions(deps, { kind: 'mcp' });
  assert.equal(listed[0].name, 'minimax');
  assert.equal(listed[0].title, 'MiniMax Coding Plan');
});

test('MCP toggle and test operate through the unified service', async () => {
  const { deps } = tempDeps();
  const serverPath = path.join(deps.workspaceRoot, 'fake-mcp-server.cjs');
  fs.writeFileSync(serverPath, `
let buffer = '';
function send(message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n');
}
function handle(message) {
  if (!message || !message.id) return;
  if (message.method === 'initialize') {
    send({
      id: message.id,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'fake-mcp', version: '1.0.0' },
        capabilities: { tools: {} },
      },
    });
    return;
  }
  if (message.method === 'tools/list') {
    send({
      id: message.id,
      result: {
        tools: [
          { name: 'voice_clone', description: 'Create speech', inputSchema: { type: 'object' } },
          { name: 'text_to_image', description: 'Create image', inputSchema: { type: 'object' } },
        ],
      },
    });
    return;
  }
  send({ id: message.id, error: { code: -32601, message: 'method not found' } });
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf('\\n');
  while (index !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) handle(JSON.parse(line));
    index = buffer.indexOf('\\n');
  }
});
`, 'utf8');

  await extensionService.addMcpServer(deps, {
    name: 'local-shell',
    transport: 'stdio',
    command: process.execPath,
    args: [serverPath],
    enabled: true,
  });

  await extensionService.toggleMcpServer(deps, 'local-shell', false);
  let servers = (await extensionService.listMcpServers(deps)).servers;
  assert.equal(servers.find((server) => server.name === 'local-shell').enabled, false);
  assert.match(readConfig(deps), /enabled = false/);

  await extensionService.toggleMcpServer(deps, 'local-shell', true);
  servers = (await extensionService.listMcpServers(deps)).servers;
  assert.equal(servers.find((server) => server.name === 'local-shell').enabled, true);
  assert.doesNotMatch(readConfig(deps), /enabled = false/);

  const tested = await extensionService.testMcpServer(deps, { name: 'local-shell' });
  assert.equal(tested.lastTest.ok, true);
  assert.equal(tested.lastTest.toolCount, 2);
  assert.deepEqual(tested.lastTest.tools.map((tool) => tool.name), ['voice_clone', 'text_to_image']);
});

test('createSkill writes a SKILL.md scaffold without overwriting existing skills', async () => {
  const { deps } = tempDeps();

  const created = await extensionService.createSkill(deps, {
    name: '代码巡检',
    description: '检查代码质量、风险和缺失验证。',
    location: 'user',
  });

  const skillPath = created.skill.path;
  const body = fs.readFileSync(skillPath, 'utf8');
  assert.match(body, /^# 代码巡检/m);
  assert.match(body, /## 用途/);
  assert.match(body, /检查代码质量、风险和缺失验证。/);
  assert.match(body, /## 工作流程/);

  await assert.rejects(
    () => extensionService.createSkill(deps, { name: '代码巡检', location: 'user' }),
    (error) => error.code === 'SKILL_EXISTS',
  );
});
