import assert from 'node:assert/strict';
import test from 'node:test';

import { createBootstrapHeartbeat } from './bootstrap-heartbeat.js';

test('createBootstrapHeartbeat starts exactly one interval and invokes the tick callback', () => {
  const timers = [];
  const cleared = [];
  let tickCount = 0;

  const heartbeat = createBootstrapHeartbeat({
    intervalMs: 5_000,
    onTick() {
      tickCount += 1;
    },
    setIntervalFn(callback, intervalMs) {
      const timer = {
        callback,
        intervalMs,
      };
      timers.push(timer);
      return timer;
    },
    clearIntervalFn(timer) {
      cleared.push(timer);
    },
  });

  heartbeat.start();
  heartbeat.start();

  assert.equal(heartbeat.isRunning(), true);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].intervalMs, 5_000);

  timers[0].callback();
  assert.equal(tickCount, 1);

  heartbeat.stop();
  assert.equal(heartbeat.isRunning(), false);
  assert.deepEqual(cleared, [timers[0]]);
});

test('createBootstrapHeartbeat stop is idempotent before and after start', () => {
  const cleared = [];

  const heartbeat = createBootstrapHeartbeat({
    onTick() {
      return undefined;
    },
    setIntervalFn(callback, intervalMs) {
      return { callback, intervalMs };
    },
    clearIntervalFn(timer) {
      cleared.push(timer);
    },
  });

  heartbeat.stop();
  heartbeat.start();
  heartbeat.stop();
  heartbeat.stop();

  assert.equal(cleared.length, 1);
});
