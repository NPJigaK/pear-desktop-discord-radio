export function createBootstrapHeartbeat(input: {
  readonly intervalMs?: number;
  readonly onTick: () => void;
  readonly setIntervalFn?: typeof setInterval;
  readonly clearIntervalFn?: typeof clearInterval;
}): {
  start(): void;
  stop(): void;
  isRunning(): boolean;
};
