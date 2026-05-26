const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  REDOU_CODEX_RUNTIME_NOT_FOUND,
  buildRedouCodexClientOptions,
  buildRedouCodexEnv,
  buildThreadResumeParams,
  buildThreadStartParams,
  buildTurnStartParams,
  checkRedouCodexAvailability,
  createRedouCodexRuntimeAdapter,
  defaultRedouCodexCommand,
  defaultRedouCodexHome,
  inspectRedouCodexCommand,
  inspectRedouCodexRuntimeReadiness,
  readRedouModelConfig,
  renderRedouCodexUserConfig,
  resolveRedouCodexCommand,
  resolveRedouCodexLaunch,
  spawnTargetFor,
} = require('../src/runtimes/redou-codex/index.cjs');

const { createModelConfigStore } = require('../src/core/store/modelConfigStore.cjs');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function redouCodexExeName() {
  return process.platform === 'win32' ? 'redou-codex.exe' : 'redou-codex';
}

function writeFakeRedouCodexExe(runtimeRoot, mode = 'release') {
  const exe = path.join(runtimeRoot, 'codex-rs', 'target', mode, redouCodexExeName());
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, '', 'utf8');
  return exe;
}

test('redou-codex default command resolves to the project-local runtime executable', () => {
  const command = defaultRedouCodexCommand({ workspaceRoot: repoRoot });
  const expectedExe = redouCodexExeName();

  assert.equal(command, path.join(repoRoot, 'runtimes', 'redou-codex', 'codex-rs', 'target', 'release', expectedExe));
  assert.equal(defaultRedouCodexHome({ workspaceRoot: repoRoot }), path.join(repoRoot, '.redou', 'redou-codex'));
});

test('REDOU_CODEX_COMMAND must be an explicit redou-codex path', () => {
  assert.throws(
    () => resolveRedouCodexCommand({ env: { REDOU_CODEX_COMMAND: 'codex' } }),
    (error) => error.code === REDOU_CODEX_RUNTIME_NOT_FOUND,
  );

  assert.throws(
    () => resolveRedouCodexCommand({ env: { REDOU_CODEX_COMMAND: 'redou-codex' } }),
    (error) => error.code === REDOU_CODEX_RUNTIME_NOT_FOUND,
  );

  assert.throws(
    () => resolveRedouCodexCommand({ env: { REDOU_CODEX_COMMAND: path.join(repoRoot, 'runtimes', 'redou-codex', 'bin', 'redou-codex.cmd') } }),
    (error) => error.code === REDOU_CODEX_RUNTIME_NOT_FOUND,
  );
});

test('WindowsApps command paths are never accepted as Redou runtimes', () => {
  const probe = inspectRedouCodexCommand('C:\\Users\\alice\\AppData\\Local\\Microsoft\\WindowsApps\\redou-codex.exe');

  assert.equal(probe.ok, false);
  assert.equal(probe.code, REDOU_CODEX_RUNTIME_NOT_FOUND);
});

test('app-server launch resolves direct redou-codex executable and fixed args', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redou-runtime-exe-'));
  const exe = writeFakeRedouCodexExe(root);

  const launch = resolveRedouCodexLaunch({
    runtimeRoot: root,
    args: ['--not-app-server'],
    allowCargoFallback: false,
  });

  assert.equal(launch.command, exe);
  assert.deepEqual(launch.args, ['app-server']);
  assert.equal(launch.actualExecutablePath, exe);
  assert.equal(launch.mode, 'release');
  assert.equal(inspectRedouCodexRuntimeReadiness(exe).ok, true);
});

test('production launch reports missing redou-codex executable without cargo fallback', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redou-runtime-missing-build-'));

  assert.throws(
    () => resolveRedouCodexLaunch({
      runtimeRoot: root,
      env: { Path: '', PATH: '' },
      allowCargoFallback: false,
    }),
    (error) => {
      assert.equal(error.code, REDOU_CODEX_RUNTIME_NOT_FOUND);
      assert.match(error.message, /redou-codex/);
      return true;
    },
  );
});

test('development launch allows project cargo fallback only when enabled', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redou-runtime-cargo-'));
  const cargoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redou-cargo-path-'));
  fs.writeFileSync(path.join(cargoDir, process.platform === 'win32' ? 'cargo.exe' : 'cargo'), '', 'utf8');

  const launch = resolveRedouCodexLaunch({
    runtimeRoot: root,
    env: process.platform === 'win32' ? { Path: cargoDir } : { PATH: cargoDir },
    allowCargoFallback: true,
  });

  assert.equal(launch.command, 'cargo');
  assert.equal(launch.mode, 'cargo-fallback');
  assert.deepEqual(launch.args.slice(-2), ['--', 'app-server']);
});

test('Windows redou-codex cmd wrapper spawn target executes without literal quote escaping', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redou cmd quote-'));
  const script = path.join(root, 'redou-codex.cmd');
  fs.writeFileSync(script, '@echo off\r\necho REDOU_CMD_OK %*\r\nexit /b 7\r\n', 'utf8');

  const target = spawnTargetFor(script, ['app-server']);
  const result = spawnSync(target.command, target.args, {
    encoding: 'utf8',
    windowsVerbatimArguments: Boolean(target.windowsVerbatimArguments),
  });

  assert.equal(result.status, 7);
  assert.match(result.stdout, /REDOU_CMD_OK "?app-server"?/);
  assert.equal(result.stderr, '');
});

test('availability returns REDOU_CODEX_RUNTIME_NOT_FOUND without falling back to system codex', async () => {
  const availability = await checkRedouCodexAvailability({
    command: 'codex',
    env: {},
  });

  assert.equal(availability.available, false);
  assert.equal(availability.lastError.code, REDOU_CODEX_RUNTIME_NOT_FOUND);
});

test('runtime adapter reports invalid REDOU_CODEX_COMMAND through availability instead of construction', async () => {
  const adapter = createRedouCodexRuntimeAdapter({
    clientOptions: {
      command: 'codex',
      env: {},
    },
  });

  const availability = await adapter.getAvailability();

  assert.equal(adapter.getId(), 'redou-codex');
  assert.equal(availability.available, false);
  assert.equal(availability.lastError.code, REDOU_CODEX_RUNTIME_NOT_FOUND);
});

test('Redou model config is isolated behind REDOU_MODEL_* env', () => {
  const config = readRedouModelConfig({
    REDOU_MODEL_PROVIDER: 'openai-compatible',
    REDOU_MODEL_BASE_URL: 'https://model.example/v1',
    REDOU_MODEL_API_KEY: 'redou-key',
    REDOU_MODEL_NAME: 'redou-model',
  });

  assert.equal(config.complete, true);
  const env = buildRedouCodexEnv({
    modelConfig: config,
    redouCodexHome: 'D:\\redou-home',
    extraEnv: {
      OPENAI_API_KEY: 'official-key',
      CODEX_ACCESS_TOKEN: 'official-token',
    },
  });

  assert.equal(env.REDOU_PROJECT_ROOT, repoRoot);
  assert.equal(env.REDOU_CODEX_HOME, 'D:\\redou-home');
  assert.equal(env.CODEX_HOME, 'D:\\redou-home');
  assert.equal(env.REDOU_CODEX_RUNTIME, '1');
  assert.equal(env.REDOU_MODEL_PROVIDER, 'openai-compatible');
  assert.equal(env.REDOU_MODEL_BASE_URL, 'https://model.example/v1');
  assert.equal(env.REDOU_MODEL_API_KEY, 'redou-key');
  assert.equal(env.REDOU_MODEL_NAME, 'redou-model');
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.CODEX_ACCESS_TOKEN, undefined);
});

test('Redou Codex home cannot be overridden by inherited child env', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'redou-codex-home-'));
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'redou-runtime-home-'));
  writeFakeRedouCodexExe(runtimeRoot);
  const staleHome = path.join(os.tmpdir(), 'stale-codex-home');
  const config = readRedouModelConfig({
    REDOU_MODEL_PROVIDER: 'openai-compatible',
    REDOU_MODEL_BASE_URL: 'https://model.example/v1',
    REDOU_MODEL_API_KEY: 'redou-key',
    REDOU_MODEL_NAME: 'redou-model',
  });

  const env = buildRedouCodexEnv({
    modelConfig: config,
    redouCodexHome: tempHome,
    extraEnv: {
      CODEX_HOME: staleHome,
      REDOU_CODEX_HOME: staleHome,
      REDOU_PROJECT_ROOT: staleHome,
      OPENAI_API_KEY: 'official-key',
      CODEX_ACCESS_TOKEN: 'official-token',
    },
  });

  assert.equal(env.CODEX_HOME, tempHome);
  assert.equal(env.REDOU_CODEX_HOME, tempHome);
  assert.equal(env.REDOU_PROJECT_ROOT, repoRoot);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.CODEX_ACCESS_TOKEN, undefined);

  const clientOptions = buildRedouCodexClientOptions({
    workspaceRoot: repoRoot,
    runtimeRoot,
    redouCodexHome: tempHome,
    modelConfig: config,
    childEnv: {
      CODEX_HOME: staleHome,
      REDOU_CODEX_HOME: staleHome,
      REDOU_PROJECT_ROOT: staleHome,
      OPENAI_API_KEY: 'official-key',
      CODEX_ACCESS_TOKEN: 'official-token',
    },
  });

  assert.equal(clientOptions.env.CODEX_HOME, tempHome);
  assert.equal(clientOptions.env.REDOU_CODEX_HOME, tempHome);
  assert.equal(clientOptions.env.REDOU_PROJECT_ROOT, repoRoot);
  assert.equal(clientOptions.env.OPENAI_API_KEY, undefined);
  assert.equal(clientOptions.env.CODEX_ACCESS_TOKEN, undefined);
  assert.equal(clientOptions.command, path.join(runtimeRoot, 'codex-rs', 'target', 'release', redouCodexExeName()));
  assert.deepEqual(clientOptions.args, ['app-server']);
});

test('Redou model config renders as user-level Codex provider config', () => {
  const toml = renderRedouCodexUserConfig({
    providers: [{
      id: 'openrouter',
      runtimeProviderId: 'redou-openrouter',
      label: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'redou-key',
    }],
    selected: { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4.5' },
  });

  assert.match(toml, /model_provider = "redou-openrouter"/);
  assert.match(toml, /model = "anthropic\/claude-sonnet-4\.5"/);
  assert.match(toml, /\[model_providers\.redou-openrouter\]/);
  assert.match(toml, /experimental_bearer_token = "redou-key"/);
  assert.match(toml, /cli_auth_credentials_store = "file"/);
});

test('model config store writes the provider config into Redou Codex home', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redou-model-store-'));
  const dataRoot = path.join(root, 'data');
  const redouCodexHome = path.join(root, 'redou-codex-home');
  const store = createModelConfigStore({ dataRoot, redouCodexHome });

  await store.saveProvider({
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: 'redou-key',
    selectedModel: 'anthropic/claude-sonnet-4.5',
    models: ['anthropic/claude-sonnet-4.5'],
  });
  const runtimeModel = await store.resolveRuntimeModel();

  assert.equal(runtimeModel.model, 'anthropic/claude-sonnet-4.5');
  assert.equal(runtimeModel.modelProvider, 'redou-openrouter');
  assert.equal(store.runtimeConfigPath, path.join(redouCodexHome, 'config.toml'));

  const toml = fs.readFileSync(store.runtimeConfigPath, 'utf8');
  assert.match(toml, /model_provider = "redou-openrouter"/);
  assert.match(toml, /\[model_providers\.redou-openrouter\]/);
  assert.match(toml, /base_url = "https:\/\/openrouter\.ai\/api\/v1"/);
  assert.doesNotMatch(toml, /chatgpt\.com\/backend-api\/codex/);
  assert.equal(fs.existsSync(path.join(root, '.codex', 'config.toml')), false);
});

test('thread start and resume params pass Redou provider selection to the runtime', () => {
  const input = {
    model: 'kimi-k2.5',
    modelProvider: 'redou-moonshot',
    config: {
      'model_providers.redou-moonshot': {
        base_url: 'https://api.moonshot.cn/v1',
      },
    },
    task: {
      id: 'task-1',
      title: 'Plan target',
      runtime: 'redou-codex',
      redouCodexThreadId: 'thread-1',
    },
  };

  assert.equal(buildThreadStartParams(input).modelProvider, 'redou-moonshot');
  assert.equal(buildThreadStartParams(input).config, input.config);
  assert.equal(buildThreadResumeParams(input).modelProvider, 'redou-moonshot');
  assert.equal(buildThreadResumeParams(input).config, input.config);
});

test('thread params include Redou autonomy guardrails', () => {
  const params = buildThreadStartParams({
    task: {
      id: 'task-autonomy',
      title: 'Investigate server state',
      runtime: 'redou-codex',
    },
  });

  assert.match(params.developerInstructions, /Continue working until the user request is actually handled/);
  assert.match(params.developerInstructions, /Do not end a turn by saying you will inspect/);
});

test('turn context serializes structured environment without object placeholders', () => {
  const params = buildTurnStartParams({
    threadId: 'thread-1',
    userInput: 'Check the server',
    contextPackage: {
      environment: {
        cwd: 'D:\\work\\project',
        shell: 'powershell',
      },
      metadata: {
        projectName: 'DoGame',
      },
    },
  });
  const text = params.input[0].text;

  assert.doesNotMatch(text, /\[object Object\]/);
  assert.equal(params.cwd, 'D:\\work\\project');
  assert.match(text, /"cwd": "D:\\\\work\\\\project"/);
  assert.match(text, /"shell": "powershell"/);
});

test('missing Redou model config reports the expected missing keys', () => {
  const config = readRedouModelConfig({});

  assert.equal(config.complete, false);
  assert.deepEqual(config.missing, [
    'REDOU_MODEL_PROVIDER',
    'REDOU_MODEL_BASE_URL',
    'REDOU_MODEL_API_KEY',
    'REDOU_MODEL_NAME',
  ]);
});
