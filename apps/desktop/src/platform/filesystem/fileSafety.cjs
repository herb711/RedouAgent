'use strict';

const path = require('node:path');

function assertPathAllowed(targetPath, policy = {}) {
  const roots = (policy.roots || policy.allowedRoots || [policy.root || process.cwd()]).filter(Boolean);
  const resolvedTarget = path.resolve(targetPath);
  const allowed = roots.some((root) => {
    const resolvedRoot = path.resolve(root);
    const relative = path.relative(resolvedRoot, resolvedTarget);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
  if (!allowed) throw new Error(`Path is outside allowed roots: ${resolvedTarget}`);
  return resolvedTarget;
}

module.exports = { assertPathAllowed };
