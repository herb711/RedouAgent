'use strict';

const { REDOU_CODEX_ERROR_CODES } = require('./redouCodexErrors.cjs');

function mapRedouCodexError(error) {
  const message = error && error.message ? error.message : 'Unknown Codex error';
  const lower = message.toLowerCase();
  let code = error && error.code ? error.code : REDOU_CODEX_ERROR_CODES.UNKNOWN;
  if (code === 'ENOENT') code = REDOU_CODEX_ERROR_CODES.EXECUTABLE_NOT_FOUND;
  else if (code === 'EACCES' || code === 'EPERM' || lower.includes('access is denied') || lower.includes('permission denied')) code = REDOU_CODEX_ERROR_CODES.START_FAILED;
  else if (code === 'INITIALIZE_FAILED') code = REDOU_CODEX_ERROR_CODES.START_FAILED;
  else if (code === 'REQUEST_TIMEOUT') code = REDOU_CODEX_ERROR_CODES.TIMEOUT;
  else if (code === 'PROTOCOL_ERROR') code = REDOU_CODEX_ERROR_CODES.PROTOCOL_ERROR;
  return {
    code,
    message,
    cause: error || null,
  };
}

module.exports = { mapRedouCodexError };
