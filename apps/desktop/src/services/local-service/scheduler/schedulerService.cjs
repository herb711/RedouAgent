const { REDOU_EVENTS } = require("../eventBus.cjs");

class SchedulerService {
  constructor({ dashboardBridge, eventBus = null } = {}) {
    if (typeof dashboardBridge !== "function") {
      throw new Error("SchedulerService requires a dashboardBridge function.");
    }
    this.dashboardBridge = dashboardBridge;
    this.eventBus = eventBus;
  }

  list() {
    return this.dashboardBridge("cron_list");
  }

  create(job) {
    const result = this.dashboardBridge("cron_create", job && typeof job === "object" ? job : {});
    this.eventBus?.emit(REDOU_EVENTS.TASK_UPDATED, { source: "scheduler", action: "create", job: result });
    return result;
  }

  pause(id) {
    const result = this.dashboardBridge("cron_pause", { id });
    this.eventBus?.emit(REDOU_EVENTS.TASK_UPDATED, { source: "scheduler", action: "pause", id });
    return result;
  }

  resume(id) {
    const result = this.dashboardBridge("cron_resume", { id });
    this.eventBus?.emit(REDOU_EVENTS.TASK_UPDATED, { source: "scheduler", action: "resume", id });
    return result;
  }

  trigger(id) {
    const result = this.dashboardBridge("cron_trigger", { id });
    this.eventBus?.emit(REDOU_EVENTS.SCHEDULE_TRIGGERED, { id, result });
    return result;
  }

  delete(id) {
    const result = this.dashboardBridge("cron_delete", { id });
    this.eventBus?.emit(REDOU_EVENTS.TASK_UPDATED, { source: "scheduler", action: "delete", id });
    return result;
  }
}

module.exports = {
  SchedulerService,
};
