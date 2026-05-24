'use strict';

async function buildRulesContext(input = {}) {
  // TODO: load project, task, system, and developer rules from explicit sources.
  return {
    projectRules: input.projectRules || [],
    taskRules: input.taskRules || [],
    systemRules: input.systemRules || [],
    developerRules: input.developerRules || [],
  };
}

module.exports = { buildRulesContext };
