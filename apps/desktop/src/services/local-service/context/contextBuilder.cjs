class ContextBuilder {
  constructor({ host }) {
    if (!host) throw new Error("ContextBuilder requires a host service.");
    this.host = host;
  }

  getGlobalFile(kind) {
    return this.host._getGlobalContextFile(kind);
  }

  updateGlobalFile(kind, content) {
    return this.host._updateGlobalContextFile(kind, content);
  }

  getProjectFile(projectId, kind) {
    return this.host._getProjectContextFile(projectId, kind);
  }

  updateProjectFile(projectId, kind, content) {
    return this.host._updateProjectContextFile(projectId, kind, content);
  }

  getTaskFile(projectId, taskId, kind) {
    return this.host._getTaskContextFile(projectId, taskId, kind);
  }

  updateTaskFile(projectId, taskId, kind, content) {
    return this.host._updateTaskContextFile(projectId, taskId, kind, content);
  }

  extractTaskRules(projectId, taskId, target = "task") {
    return this.host._extractTaskContextRules(projectId, taskId, target);
  }

  build(input = {}) {
    return this.host._buildTaskContext(input);
  }

  compactTaskContext(input = {}) {
    return this.host._compactTaskContext(input);
  }

  runCompressor(payload, project) {
    return this.host._runContextCompactModel(payload, project);
  }

  ruleExtractor() {
    return {
      extract: (projectId, taskId, target = "task") => this.extractTaskRules(projectId, taskId, target),
    };
  }

  contextCompressor() {
    return {
      compact: (input = {}) => this.compactTaskContext(input),
      runModel: (payload, project) => this.runCompressor(payload, project),
    };
  }
}

module.exports = {
  ContextBuilder,
};
