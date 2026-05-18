const { EventEmitter } = require("events");

const REDOU_EVENTS = Object.freeze({
  TASK_STARTED: "task:started",
  TASK_UPDATED: "task:updated",
  TASK_COMPLETED: "task:completed",
  LOG_APPENDED: "log:appended",
  SCHEDULE_TRIGGERED: "schedule:triggered",
  RUN_STOPPED: "run:stopped",
});

function createEventBus() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(100);

  return {
    on: (...args) => emitter.on(...args),
    once: (...args) => emitter.once(...args),
    off: (...args) => emitter.off(...args),
    emit: (...args) => emitter.emit(...args),
    listenerCount: (...args) => emitter.listenerCount(...args),
  };
}

module.exports = {
  REDOU_EVENTS,
  createEventBus,
};
