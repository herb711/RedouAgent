'use strict';

const EXTENSION_KINDS = Object.freeze(['plugin', 'skill', 'mcp', 'app']);
const EXTENSION_SOURCES = Object.freeze([
  'system',
  'bundled',
  'user',
  'project',
  'git',
  'market',
  'community',
]);
const EXTENSION_STATUSES = Object.freeze(['ready', 'disabled', 'error', 'missing-config', 'testing']);

function extensionId(kind, id) {
  return `${kind}:${String(id || '').trim()}`;
}

function extensionKindFromId(id) {
  const [kind] = String(id || '').split(':');
  return EXTENSION_KINDS.includes(kind) ? kind : null;
}

function rawIdFromExtensionId(id) {
  const text = String(id || '');
  const kind = extensionKindFromId(text);
  return kind ? text.slice(kind.length + 1) : text;
}

module.exports = {
  EXTENSION_KINDS,
  EXTENSION_SOURCES,
  EXTENSION_STATUSES,
  extensionId,
  extensionKindFromId,
  rawIdFromExtensionId,
};
