'use strict';

function formatLogEntry(entry = {}) {
  return { ...entry, formattedAt: new Date().toISOString() };
}

module.exports = { formatLogEntry };
