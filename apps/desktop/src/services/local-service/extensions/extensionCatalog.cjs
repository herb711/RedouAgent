'use strict';

const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { defaultRedouCodexHome } = require('../../../runtimes/redou-codex/redouCodexRuntimeConfig.cjs');

const CONFIG_TOML = 'config.toml';
const SKILL_SETTINGS = 'skill-settings.json';
const MCP_METADATA = 'redou-mcp-metadata.json';

function redouCodexHome(dependencies = {}) {
  return path.resolve(
    dependencies.redouCodexHome
      || dependencies.settings?.redouCodex?.redouCodexHome
      || process.env.REDOU_CODEX_HOME
      || process.env.CODEX_HOME
      || defaultRedouCodexHome({ workspaceRoot: dependencies.workspaceRoot }),
  );
}

function redouConfigPath(dependencies = {}) {
  return path.join(redouCodexHome(dependencies), CONFIG_TOML);
}

function mcpMetadataPath(dependencies = {}) {
  return path.join(redouCodexHome(dependencies), MCP_METADATA);
}

async function readText(filePath, fallback = '') {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
}

async function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function tomlString(value) {
  return JSON.stringify(String(value ?? ''));
}

function tomlKey(key) {
  const text = String(key || '');
  return /^[A-Za-z0-9_-]+$/.test(text) ? text : tomlString(text);
}

function stripComment(line) {
  let quoted = false;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && quoted && quote === '"') {
      escaped = true;
      continue;
    }
    if ((char === '"' || char === "'") && (!quoted || quote === char)) {
      quoted = !quoted;
      quote = quoted ? char : '';
      continue;
    }
    if (char === '#' && !quoted) return line.slice(0, index).trimEnd();
  }
  return line.trimEnd();
}

function parseTomlHeader(line) {
  const trimmed = line.trim();
  const array = trimmed.startsWith('[[') && trimmed.endsWith(']]');
  if (!array && !(trimmed.startsWith('[') && trimmed.endsWith(']'))) return null;
  const body = array ? trimmed.slice(2, -2) : trimmed.slice(1, -1);
  const parts = [];
  let current = '';
  let quoted = false;
  let escaped = false;
  for (const char of body) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quoted) {
      current += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (char === '.' && !quoted) {
      parts.push(parseTomlBareKey(current.trim()));
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(parseTomlBareKey(current.trim()));
  return { array, parts };
}

function parseTomlBareKey(value) {
  const text = String(value || '').trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1);
  return text;
}

function splitTomlArray(value) {
  const body = String(value || '').trim().replace(/^\[/, '').replace(/\]$/, '');
  const items = [];
  let current = '';
  let quoted = false;
  let quote = '';
  let escaped = false;
  for (const char of body) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quoted && quote === '"') {
      current += char;
      escaped = true;
      continue;
    }
    if ((char === '"' || char === "'") && (!quoted || quote === char)) {
      quoted = !quoted;
      quote = quoted ? char : '';
      current += char;
      continue;
    }
    if (char === ',' && !quoted) {
      items.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

function parseInlineTable(value) {
  const body = String(value || '').trim().replace(/^\{/, '').replace(/\}$/, '');
  const entries = splitTomlArray(`[${body}]`);
  const table = {};
  for (const entry of entries) {
    const index = entry.indexOf('=');
    if (index < 0) continue;
    const key = parseTomlBareKey(entry.slice(0, index).trim());
    table[key] = parseTomlValue(entry.slice(index + 1).trim());
  }
  return table;
}

function parseTomlValue(value) {
  const text = stripComment(String(value || '')).trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1);
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text.startsWith('[') && text.endsWith(']')) return splitTomlArray(text).map(parseTomlValue);
  if (text.startsWith('{') && text.endsWith('}')) return parseInlineTable(text);
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function assignNested(target, parts, key, value, array = false) {
  let node = target;
  for (const part of parts) {
    if (!node[part] || typeof node[part] !== 'object') node[part] = {};
    node = node[part];
  }
  if (array) {
    if (!Array.isArray(node.__items)) node.__items = [];
    const item = {};
    node.__items.push(item);
    return item;
  }
  node[key] = value;
  return node;
}

function parseToml(text) {
  const root = {};
  let current = root;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    const header = parseTomlHeader(line);
    if (header) {
      if (header.array) {
        current = assignNested(root, header.parts, '', {}, true);
      } else {
        let node = root;
        for (const part of header.parts) {
          if (!node[part] || typeof node[part] !== 'object') node[part] = {};
          node = node[part];
        }
        current = node;
      }
      continue;
    }
    const index = line.indexOf('=');
    if (index < 0) continue;
    current[parseTomlBareKey(line.slice(0, index).trim())] = parseTomlValue(line.slice(index + 1).trim());
  }
  return root;
}

function topLevelFamilyFromHeader(line) {
  const header = parseTomlHeader(line);
  return header?.parts?.[0] || null;
}

function stripTomlFamilies(text, families) {
  const familySet = new Set(families);
  const lines = String(text || '').split(/\r?\n/);
  const kept = [];
  let skipping = false;
  for (const line of lines) {
    const family = topLevelFamilyFromHeader(line);
    if (family) skipping = familySet.has(family);
    if (!skipping) kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function extractTomlFamilies(text, families) {
  const familySet = new Set(families);
  const lines = String(text || '').split(/\r?\n/);
  const blocks = [];
  let current = [];
  let taking = false;
  function flush() {
    const block = current.join('\n').trim();
    if (block) blocks.push(block);
    current = [];
  }
  for (const line of lines) {
    const family = topLevelFamilyFromHeader(line);
    if (family) {
      if (taking) flush();
      taking = familySet.has(family);
    }
    if (taking) current.push(line);
  }
  if (taking) flush();
  return blocks;
}

function mergeGeneratedConfigWithPreservedBlocks(generatedText, existingText) {
  const preserved = extractTomlFamilies(existingText, ['features', 'skills', 'mcp_servers', 'plugins', 'marketplaces', 'apps']);
  const base = stripTomlFamilies(generatedText, ['features', 'skills', 'mcp_servers', 'plugins', 'marketplaces', 'apps']).trimEnd();
  return `${[base, ...preserved].filter(Boolean).join('\n\n')}\n`;
}

async function readRedouConfig(dependencies = {}) {
  const configPath = redouConfigPath(dependencies);
  const text = await readText(configPath, '');
  return { configPath, text, parsed: parseToml(text) };
}

async function writeRedouConfig(dependencies = {}, text) {
  const configPath = redouConfigPath(dependencies);
  await writeText(configPath, text);
  return { configPath, text };
}

function normalizeMcpServer(name, input = {}) {
  const transport = input.transport || input.transportType || (input.url ? 'streamable_http' : 'stdio');
  const args = Array.isArray(input.args)
    ? input.args.map(String).filter(Boolean)
    : String(input.args || '').split(/\s+/).filter(Boolean);
  const env = input.env && typeof input.env === 'object' && !Array.isArray(input.env)
    ? Object.fromEntries(Object.entries(input.env).filter(([key]) => key).map(([key, value]) => [String(key), String(value)]))
    : {};
  const timeout = Number(input.timeoutSec ?? input.startup_timeout_sec ?? input.startupTimeoutSec ?? input.timeout);
  return {
    name: String(input.name || name || '').trim(),
    displayName: String(input.displayName || input.display_name || input.redouDisplayName || input.redou_display_name || '').trim(),
    transport: transport === 'http' ? 'http' : transport === 'streamable_http' ? 'streamable_http' : 'stdio',
    command: String(input.command || '').trim(),
    args,
    env,
    inheritEnv: input.inheritEnv === undefined ? true : Boolean(input.inheritEnv),
    url: String(input.url || '').trim(),
    enabled: input.enabled === undefined ? true : Boolean(input.enabled),
    startupTimeoutSec: Number.isFinite(timeout) && timeout > 0 ? timeout : undefined,
    toolTimeoutSec: Number.isFinite(Number(input.toolTimeoutSec)) ? Number(input.toolTimeoutSec) : undefined,
    raw: isPlainObject(input.raw) ? input.raw : input,
  };
}

function serverFromToml(name, cfg = {}) {
  const transport = cfg.command ? 'stdio' : cfg.url ? 'streamable_http' : 'stdio';
  return normalizeMcpServer(name, {
    ...cfg,
    name,
    transport,
    command: cfg.command || '',
    url: cfg.url || '',
    args: Array.isArray(cfg.args) ? cfg.args : [],
    env: cfg.env || {},
    enabled: cfg.enabled === undefined ? true : Boolean(cfg.enabled),
    startupTimeoutSec: cfg.startup_timeout_sec || cfg.startup_timeout_ms && Number(cfg.startup_timeout_ms) / 1000,
    toolTimeoutSec: cfg.tool_timeout_sec,
  });
}

async function readMcpServers(dependencies = {}) {
  const { configPath, parsed } = await readRedouConfig(dependencies);
  const metadata = await readMcpMetadata(dependencies);
  const servers = parsed.mcp_servers && typeof parsed.mcp_servers === 'object' ? parsed.mcp_servers : {};
  return Object.entries(servers)
    .filter(([, cfg]) => cfg && typeof cfg === 'object' && !Array.isArray(cfg))
    .map(([name, cfg]) => ({
      ...serverFromToml(name, cfg),
      displayName: metadata.servers?.[name]?.displayName || '',
      configPath,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function readMcpMetadata(dependencies = {}) {
  const metadata = await readJson(mcpMetadataPath(dependencies), { servers: {} });
  const servers = metadata && typeof metadata.servers === 'object' && !Array.isArray(metadata.servers)
    ? metadata.servers
    : {};
  return {
    servers: Object.fromEntries(
      Object.entries(servers)
        .filter(([name, entry]) => name && entry && typeof entry === 'object' && !Array.isArray(entry))
        .map(([name, entry]) => [name, {
          displayName: String(entry.displayName || entry.display_name || '').trim(),
        }])
    ),
  };
}

async function writeMcpMetadata(dependencies = {}, servers = []) {
  const entries = {};
  for (const server of servers) {
    const name = String(server.name || '').trim();
    const displayName = String(server.displayName || '').trim();
    if (!name || !displayName || displayName === name) continue;
    entries[name] = { displayName };
  }
  await writeText(mcpMetadataPath(dependencies), `${JSON.stringify({ servers: entries }, null, 2)}\n`);
  return { servers: entries };
}

function serializeTomlValue(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(serializeTomlValue).join(', ')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([key, entryValue]) => key && entryValue !== undefined && entryValue !== null)
      .map(([key, entryValue]) => `${tomlKey(key)} = ${serializeTomlValue(entryValue)}`);
    return `{ ${entries.join(', ')} }`;
  }
  return tomlString(value);
}

function serializeKeyValues(values = {}) {
  return Object.entries(values)
    .filter(([key, value]) => key && value !== undefined && value !== null && String(value) !== '')
    .map(([key, value]) => `${tomlKey(key)} = ${serializeTomlValue(value)}`);
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isSerializableTomlValue(value) {
  return value === null
    || ['string', 'number', 'boolean'].includes(typeof value)
    || Array.isArray(value);
}

function sanitizeRawMcpConfig(server) {
  const raw = isPlainObject(server.raw) ? { ...server.raw } : {};
  for (const key of ['name', 'displayName', 'display_name', 'redouDisplayName', 'redou_display_name', 'raw', 'transport', 'configPath', 'inheritEnv', 'transportType']) {
    delete raw[key];
  }
  for (const key of ['startupTimeoutSec', 'toolTimeoutSec', 'timeoutSec', 'timeout']) {
    delete raw[key];
  }
  if (server.transport === 'stdio') {
    delete raw.url;
    delete raw.bearer_token;
    delete raw.bearer_token_env_var;
    delete raw.http_headers;
    delete raw.env_http_headers;
    raw.command = server.command;
    raw.args = server.args || [];
    if (server.env && Object.keys(server.env).length) raw.env = server.env;
    else delete raw.env;
  } else {
    delete raw.command;
    delete raw.args;
    delete raw.env;
    delete raw.env_vars;
    delete raw.cwd;
    raw.url = server.url;
  }
  if (server.enabled === false) raw.enabled = false;
  else delete raw.enabled;
  if (server.startupTimeoutSec) raw.startup_timeout_sec = server.startupTimeoutSec;
  else delete raw.startup_timeout_sec;
  if (server.toolTimeoutSec) raw.tool_timeout_sec = server.toolTimeoutSec;
  else if (server.toolTimeoutSec === undefined) delete raw.tool_timeout_sec;
  return raw;
}

function serializeTomlTable(prefix, table, lines) {
  for (const [key, value] of Object.entries(table)) {
    if (!key || value === undefined || value === null || isPlainObject(value)) continue;
    if (isSerializableTomlValue(value)) lines.push(`${tomlKey(key)} = ${serializeTomlValue(value)}`);
  }
  for (const [key, value] of Object.entries(table)) {
    if (!key || !isPlainObject(value)) continue;
    lines.push('');
    lines.push(`[${prefix}.${tomlKey(key)}]`);
    serializeTomlTable(`${prefix}.${tomlKey(key)}`, value, lines);
  }
}

function serializeMcpServers(servers = []) {
  const lines = [];
  for (const input of servers) {
    const server = normalizeMcpServer(input.name, input);
    if (!server.name) continue;
    server.raw = isPlainObject(input.raw) ? input.raw : input;
    const prefix = `mcp_servers.${tomlKey(server.name)}`;
    const config = sanitizeRawMcpConfig(server);
    lines.push(`[${prefix}]`);
    serializeTomlTable(prefix, config, lines);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

async function writeMcpServers(dependencies = {}, servers = []) {
  const { text } = await readRedouConfig(dependencies);
  const base = stripTomlFamilies(text, ['mcp_servers']);
  const mcpText = serializeMcpServers(servers);
  const next = `${[base, mcpText].filter(Boolean).join('\n\n')}\n`;
  await writeRedouConfig(dependencies, next);
  await writeMcpMetadata(dependencies, servers);
  return readMcpServers(dependencies);
}

function normalizePluginConfig(id, cfg = {}, catalogItem = {}) {
  const [name, marketplace = catalogItem.marketplace || 'local'] = String(id || '').split('@');
  const manifest = catalogItem.manifest || {};
  return {
    id,
    name: manifest.name || name || id,
    title: manifest.title || manifest.displayName || catalogItem.title || manifest.name || name || id,
    description: manifest.description || catalogItem.description || '',
    version: manifest.version || catalogItem.version || '',
    marketplace,
    source: catalogItem.source,
    category: catalogItem.category || manifest.category || 'System',
    tags: Array.isArray(manifest.tags) ? manifest.tags : [],
    path: cfg.path || catalogItem.path || '',
    enabled: cfg.enabled === undefined
      ? catalogItem.enabled === undefined ? true : Boolean(catalogItem.enabled)
      : Boolean(cfg.enabled),
    installed: Boolean(cfg.installed || cfg.enabled !== undefined || cfg.path || catalogItem.installed),
    authRequired: catalogItem.authRequired || catalogItem.policy?.authentication === 'ON_INSTALL',
    canRemove: catalogItem.canRemove,
    canUpdate: catalogItem.canUpdate,
    status: catalogItem.status,
    statusMessage: catalogItem.statusMessage,
    raw: catalogItem.raw || { config: cfg, catalog: catalogItem },
  };
}

async function readPluginConfigs(dependencies = {}) {
  const { parsed } = await readRedouConfig(dependencies);
  const plugins = parsed.plugins && typeof parsed.plugins === 'object' ? parsed.plugins : {};
  return Object.fromEntries(Object.entries(plugins).filter(([, cfg]) => cfg && typeof cfg === 'object'));
}

async function readMarketplaceCatalog(root) {
  const manifestPath = path.join(root, '.agents', 'plugins', 'marketplace.json');
  const manifest = JSON.parse(await readText(manifestPath, '{}'));
  const marketplace = manifest.name || path.basename(root);
  const plugins = Array.isArray(manifest.plugins) ? manifest.plugins : [];
  return plugins.map((plugin) => {
    const rel = plugin.source?.path || `./plugins/${plugin.name}`;
    const pluginPath = path.resolve(root, rel);
    const pluginJsonPath = path.join(pluginPath, '.codex-plugin', 'plugin.json');
    let pluginJson = {};
    try {
      pluginJson = JSON.parse(fsSync.readFileSync(pluginJsonPath, 'utf8'));
    } catch {
      pluginJson = {};
    }
    const id = `${plugin.name}@${marketplace}`;
    return normalizePluginConfig(id, {}, {
      ...plugin,
      id,
      marketplace,
      path: pluginPath,
      manifest: pluginJson,
      category: plugin.category || pluginJson.category,
      authRequired: plugin.policy?.authentication === 'ON_INSTALL',
    });
  });
}

async function listPluginCatalog(dependencies = {}) {
  const home = redouCodexHome(dependencies);
  const roots = [
    path.join(home, '.tmp', 'plugins'),
    path.join(home, '.tmp', 'bundled-marketplaces', 'openai-bundled'),
  ];
  const configured = await readPluginConfigs(dependencies);
  const byId = new Map();
  for (const root of roots) {
    if (!fsSync.existsSync(path.join(root, '.agents', 'plugins', 'marketplace.json'))) continue;
    try {
      for (const plugin of await readMarketplaceCatalog(root)) {
        const cfg = configured[plugin.id] || {};
        byId.set(plugin.id, normalizePluginConfig(plugin.id, cfg, plugin.raw.catalog));
      }
    } catch {
      // A broken marketplace should not hide locally configured plugins.
    }
  }
  for (const [id, cfg] of Object.entries(configured)) {
    if (!byId.has(id)) byId.set(id, normalizePluginConfig(id, cfg));
  }
  return Array.from(byId.values()).sort((a, b) => a.title.localeCompare(b.title));
}

function serializePlugins(pluginsById = {}) {
  const lines = [];
  for (const [id, cfg] of Object.entries(pluginsById).sort(([a], [b]) => a.localeCompare(b))) {
    const prefix = `plugins.${tomlKey(id)}`;
    lines.push(`[${prefix}]`);
    const safeCfg = isPlainObject(cfg) ? { ...cfg } : {};
    if (safeCfg.path) lines.push(`path = ${tomlString(safeCfg.path)}`);
    lines.push(`enabled = ${safeCfg.enabled === false ? 'false' : 'true'}`);
    delete safeCfg.path;
    delete safeCfg.enabled;
    serializeTomlTable(prefix, safeCfg, lines);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

async function writePluginConfigs(dependencies = {}, pluginsById = {}) {
  const { text } = await readRedouConfig(dependencies);
  const base = stripTomlFamilies(text, ['plugins']);
  const pluginText = serializePlugins(pluginsById);
  const next = `${[base, pluginText].filter(Boolean).join('\n\n')}\n`;
  await writeRedouConfig(dependencies, next);
  return readPluginConfigs(dependencies);
}

function skillSettingsPath(dependencies = {}) {
  return path.join(dependencies.dataRoot || redouCodexHome(dependencies), SKILL_SETTINGS);
}

async function readSkillSettings(dependencies = {}) {
  try {
    const value = JSON.parse(await readText(skillSettingsPath(dependencies), '{"disabled":[]}'));
    return { disabled: Array.isArray(value.disabled) ? value.disabled.map(String) : [] };
  } catch {
    return { disabled: [] };
  }
}

async function writeSkillSettings(dependencies = {}, settings) {
  await writeText(skillSettingsPath(dependencies), JSON.stringify(settings, null, 2));
}

function skillRoots(dependencies = {}) {
  const home = os.homedir();
  return Array.from(new Set([
    path.join(redouCodexHome(dependencies), 'skills'),
    process.env.CODEX_HOME ? path.join(process.env.CODEX_HOME, 'skills') : null,
    home ? path.join(home, '.codex', 'skills') : null,
    dependencies.workspaceRoot ? path.join(dependencies.workspaceRoot, '.codex', 'skills') : null,
    dependencies.dataRoot ? path.join(dependencies.dataRoot, 'skills') : null,
  ].filter(Boolean).map((entry) => path.resolve(entry))));
}

async function findSkillFiles(root) {
  const results = [];
  async function walk(dir, depth = 0) {
    if (depth > 5) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === 'SKILL.md') {
        results.push(full);
      } else if (entry.isDirectory() && (entry.name === '.system' || !entry.name.startsWith('.')) && entry.name !== 'node_modules') {
        await walk(full, depth + 1);
      }
    }
  }
  await walk(root);
  return results;
}

function parseFrontmatter(text = '') {
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end === -1) return {};
  const data = {};
  for (const line of text.slice(3, end).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) data[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return data;
}

function firstMarkdownParagraph(text = '') {
  return String(text || '')
    .replace(/^---[\s\S]*?\n---/, '')
    .split(/\r?\n\r?\n/)
    .map((part) => part.replace(/^#+\s*/, '').trim())
    .find(Boolean) || '';
}

function skillSource(skillPath, root, dependencies = {}) {
  const normalized = path.resolve(skillPath).toLowerCase();
  const projectRoot = dependencies.workspaceRoot ? path.resolve(dependencies.workspaceRoot).toLowerCase() : '';
  if (normalized.includes(`${path.sep}skills${path.sep}.system${path.sep}`.toLowerCase())) return 'system';
  if (projectRoot && normalized.startsWith(projectRoot) && normalized.includes(`${path.sep}.codex${path.sep}skills${path.sep}`.toLowerCase())) return 'project';
  if (normalized.includes(`${path.sep}.tmp${path.sep}`.toLowerCase()) || normalized.includes(`${path.sep}runtimes${path.sep}`.toLowerCase())) return 'bundled';
  if (path.resolve(root).toLowerCase().includes(`${path.sep}.codex${path.sep}skills`.toLowerCase())) return 'user';
  return 'user';
}

async function listSkills(dependencies = {}) {
  const settings = await readSkillSettings(dependencies);
  const disabled = new Set(settings.disabled);
  const roots = skillRoots(dependencies);
  const skills = [];
  for (const root of roots) {
    for (const file of await findSkillFiles(root)) {
      const text = await readText(file, '');
      const fm = parseFrontmatter(text);
      const dir = path.dirname(file);
      const rel = path.relative(root, dir).replace(/\\/g, '/');
      const name = String(fm.name || rel.split('/').filter(Boolean).join(':') || path.basename(dir));
      const id = file;
      skills.push({
        id,
        name,
        title: fm.title || name,
        description: fm.description || firstMarkdownParagraph(text).slice(0, 240),
        path: file,
        root,
        source: skillSource(file, root, dependencies),
        enabled: !disabled.has(id) && !disabled.has(name),
        category: fm.category || undefined,
      });
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

function slugify(value, fallback = 'extension') {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || fallback;
}

async function createSkill(dependencies = {}, input = {}) {
  const name = String(input.name || input.title || '').trim();
  if (!name) {
    const error = new Error('Skill name is required.');
    error.code = 'SKILL_NAME_REQUIRED';
    throw error;
  }
  const location = input.location === 'project' ? 'project' : 'user';
  const baseDir = location === 'project'
    ? path.join(dependencies.workspaceRoot || process.cwd(), '.codex', 'skills')
    : path.join(redouCodexHome(dependencies), 'skills');
  const skillDir = path.join(baseDir, slugify(input.id || name, 'skill'));
  const skillPath = path.join(skillDir, 'SKILL.md');
  if (fsSync.existsSync(skillPath)) {
    const error = new Error(`Skill already exists: ${skillPath}`);
    error.code = 'SKILL_EXISTS';
    throw error;
  }
  const description = String(input.description || '描述这个技能适合处理什么任务。').trim();
  const body = [
    `# ${name}`,
    '',
    '## 用途',
    '',
    description,
    '',
    '## 使用方式',
    '',
    '当用户提出相关任务时，按照以下流程执行。',
    '',
    '## 工作流程',
    '',
    '1. 理解任务目标',
    '2. 检查相关文件或上下文',
    '3. 制定执行计划',
    '4. 执行修改或生成结果',
    '5. 验证结果',
    '',
    '## 注意事项',
    '',
    '- 不要进行无关修改',
    '- 遇到不确定信息先检查上下文',
    '- 输出结果要可验证',
    '',
  ].join('\n');
  await writeText(skillPath, body);
  return { skill: { id: skillPath, name, title: name, description, path: skillPath, source: location, enabled: true } };
}

async function createPlugin(dependencies = {}, input = {}) {
  const name = String(input.name || '').trim();
  if (!name) {
    const error = new Error('Plugin name is required.');
    error.code = 'PLUGIN_NAME_REQUIRED';
    throw error;
  }
  const baseDir = path.resolve(input.directory || path.join(redouCodexHome(dependencies), 'plugins', 'local'));
  const pluginDir = path.join(baseDir, slugify(input.id || name, 'plugin'));
  const manifestPath = path.join(pluginDir, '.codex-plugin', 'plugin.json');
  if (fsSync.existsSync(manifestPath)) {
    const error = new Error(`Plugin already exists: ${manifestPath}`);
    error.code = 'PLUGIN_EXISTS';
    throw error;
  }
  const manifest = {
    id: slugify(input.id || name, 'plugin'),
    name,
    description: String(input.description || ''),
    version: '0.1.0',
    author: String(input.author || ''),
    skills: [],
    mcpServers: [],
    enabled: true,
  };
  await writeText(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  if (input.includeSkills) await fs.mkdir(path.join(pluginDir, 'skills'), { recursive: true });
  if (input.includeReadme !== false) {
    await writeText(path.join(pluginDir, 'README.md'), `# ${name}\n\n${manifest.description}\n`);
  }
  const pluginId = `${manifest.id}@local`;
  const configs = await readPluginConfigs(dependencies);
  configs[pluginId] = { path: pluginDir, enabled: true };
  await writePluginConfigs(dependencies, configs);
  return { plugin: normalizePluginConfig(pluginId, configs[pluginId], { path: pluginDir, manifest }) };
}

module.exports = {
  createPlugin,
  createSkill,
  listPluginCatalog,
  listSkills,
  mergeGeneratedConfigWithPreservedBlocks,
  normalizeMcpServer,
  parseFrontmatter,
  parseToml,
  readMcpServers,
  readPluginConfigs,
  readRedouConfig,
  redouCodexHome,
  redouConfigPath,
  serializeMcpServers,
  stripTomlFamilies,
  tomlString,
  writeMcpServers,
  writePluginConfigs,
  writeRedouConfig,
  readSkillSettings,
  writeSkillSettings,
};
