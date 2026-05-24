'use strict';

async function buildAttachmentContext(input = {}) {
  // TODO: normalize user attachments and metadata for runtime input.
  return { attachments: input.attachments || [] };
}

module.exports = { buildAttachmentContext };
