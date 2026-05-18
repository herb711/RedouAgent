class LifecycleService {
  constructor({ host }) {
    if (!host) throw new Error("LifecycleService requires a host service.");
    this.host = host;
  }

  markAnalysisInterrupted(item, reason) {
    return this.host._markAnalysisInterrupted(item, reason);
  }

  stopAllHermesActivity(reason) {
    return this.host._stopAllHermesActivity(reason);
  }
}

module.exports = {
  LifecycleService,
};
