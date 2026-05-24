'use strict';

async function buildFileContext(input = {}) {
  // TODO: summarize selected files and workspace hints within the context budget.
  return { selectedFiles: input.selectedFiles || [] };
}

module.exports = { buildFileContext };
