const DEFAULT_BOOTSTRAP_HEARTBEAT_INTERVAL_MS = 5_000;

export function createBootstrapHeartbeat({
  intervalMs = DEFAULT_BOOTSTRAP_HEARTBEAT_INTERVAL_MS,
  onTick,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  let timer;

  return {
    start() {
      if (timer !== undefined) {
        return;
      }

      timer = setIntervalFn(() => {
        onTick();
      }, intervalMs);
    },
    stop() {
      if (timer === undefined) {
        return;
      }

      clearIntervalFn(timer);
      timer = undefined;
    },
    isRunning() {
      return timer !== undefined;
    },
  };
}
