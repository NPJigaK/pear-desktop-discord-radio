import assert from 'node:assert/strict';
import test from 'node:test';

import { createPearRuntimeStateCoordinator } from '../../src/pear/runtime-state.js';

class FakePearSocket extends EventTarget {
  emitClose(): void {
    this.dispatchEvent(new Event('close'));
  }

  emitError(): void {
    this.dispatchEvent(new Event('error'));
  }
}

type PearRuntimeMessageListener = (message: {
  readonly type: 'VIDEO_CHANGED';
  readonly song: {
    readonly videoId: string;
    readonly title: string;
  };
  readonly position: number;
}) => void;

type ScheduledTask = {
  readonly delayMs: number;
  readonly run: () => void | Promise<void>;
};

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function createScheduler() {
  const tasks: ScheduledTask[] = [];

  return {
    schedule(task: () => void | Promise<void>, delayMs: number) {
      tasks.push({ run: task, delayMs });
      return {
        cancel() {
          const index = tasks.findIndex((entry) => entry.run === task);
          if (index >= 0) {
            tasks.splice(index, 1);
          }
        },
      };
    },
    tasks,
  };
}

test('Pear runtime state reports offline before startup', async () => {
  const runtimeState = createPearRuntimeStateCoordinator({
    pearClient: {
      async getCurrentSong() {
        return null;
      },
    },
    pearWebSocketClient: {
      async connect() {
        throw new Error('should not connect');
      },
      subscribe() {
        return () => undefined;
      },
      close() {
        return undefined;
      },
    },
    logger: {
      child() {
        return this;
      },
      info() {
        return undefined;
      },
      warn() {
        return undefined;
      },
      error() {
        return undefined;
      },
      debug() {
        return undefined;
      },
    },
  });

  assert.deepStrictEqual(runtimeState.getRuntimeState(), {
    status: 'offline',
  });
  assert.deepStrictEqual(runtimeState.getState(), {
    status: 'offline',
  });
});

test('Pear runtime state reports connecting while startup is pending', async () => {
  const songSnapshot = createDeferred<{
    readonly videoId: string;
    readonly title: string;
  } | null>();
  const socket = new FakePearSocket();

  const runtimeState = createPearRuntimeStateCoordinator({
    pearClient: {
      async getCurrentSong() {
        return songSnapshot.promise;
      },
    },
    pearWebSocketClient: {
      async connect() {
        return socket as unknown as WebSocket;
      },
      subscribe() {
        return () => undefined;
      },
      close() {
        return undefined;
      },
    },
    logger: {
      child() {
        return this;
      },
      info() {
        return undefined;
      },
      warn() {
        return undefined;
      },
      error() {
        return undefined;
      },
      debug() {
        return undefined;
      },
    },
  });

  const startPromise = runtimeState.start();

  assert.deepStrictEqual(runtimeState.getRuntimeState(), {
    status: 'connecting',
  });
  assert.deepStrictEqual(runtimeState.getState(), {
    status: 'connecting',
  });

  songSnapshot.resolve({
    videoId: 'song-1',
    title: 'Angel',
  });
  await startPromise;
});

test('Pear runtime state cleans up and returns offline when the initial REST snapshot fails', async () => {
  const socket = new FakePearSocket();
  const subscribeCalls: number[] = [];
  let connectCalls = 0;
  let first = true;

  const runtimeState = createPearRuntimeStateCoordinator({
    pearClient: {
      async getCurrentSong() {
        if (first) {
          first = false;
          throw new Error('rest snapshot failed');
        }

        return {
          videoId: 'song-1',
          title: 'Angel',
        };
      },
    },
    pearWebSocketClient: {
      async connect() {
        connectCalls += 1;
        return socket as unknown as WebSocket;
      },
      subscribe() {
        subscribeCalls.push(1);
        return () => undefined;
      },
      close() {
        return undefined;
      },
    },
    logger: {
      child() {
        return this;
      },
      info() {
        return undefined;
      },
      warn() {
        return undefined;
      },
      error() {
        return undefined;
      },
      debug() {
        return undefined;
      },
    },
  });

  await assert.rejects(runtimeState.start(), /rest snapshot failed/);
  assert.deepStrictEqual(runtimeState.getRuntimeState(), {
    status: 'offline',
  });
  assert.deepStrictEqual(runtimeState.getState(), {
    status: 'offline',
  });

  await runtimeState.start();
  assert.deepStrictEqual(runtimeState.getRuntimeState(), {
    status: 'ready',
    song: {
      videoId: 'song-1',
      title: 'Angel',
    },
  });
  assert.deepStrictEqual(subscribeCalls, [1]);
  assert.equal(connectCalls, 1);
});

test('Pear runtime state clears song data and returns offline when websocket connect fails', async () => {
  const runtimeState = createPearRuntimeStateCoordinator({
    pearClient: {
      async getCurrentSong() {
        return {
          videoId: 'song-1',
          title: 'Angel',
        };
      },
    },
    pearWebSocketClient: {
      async connect() {
        throw new Error('ws connect failed');
      },
      subscribe() {
        return () => undefined;
      },
      close() {
        return undefined;
      },
    },
    logger: {
      child() {
        return this;
      },
      info() {
        return undefined;
      },
      warn() {
        return undefined;
      },
      error() {
        return undefined;
      },
      debug() {
        return undefined;
      },
    },
  });

  await assert.rejects(runtimeState.start(), /ws connect failed/);
  assert.deepStrictEqual(runtimeState.getRuntimeState(), {
    status: 'offline',
  });
  assert.deepStrictEqual(runtimeState.getState(), {
    status: 'offline',
  });
});

test('Pear runtime state seeds now-playing from REST and reports ready after websocket startup', async () => {
  const socket = new FakePearSocket();
  let subscribedListener: PearRuntimeMessageListener | undefined;

  const runtimeState = createPearRuntimeStateCoordinator({
    pearClient: {
      async getCurrentSong() {
        return {
          videoId: 'song-1',
          title: 'Angel',
          subtitle: 'Massive Attack',
        };
      },
    },
    pearWebSocketClient: {
      async connect() {
        return socket as unknown as WebSocket;
      },
      subscribe(listener: PearRuntimeMessageListener) {
        subscribedListener = listener as typeof subscribedListener;
        return () => {
          subscribedListener = undefined;
        };
      },
      close() {
        return undefined;
      },
    },
    logger: {
      child() {
        return this;
      },
      info() {
        return undefined;
      },
      warn() {
        return undefined;
      },
      error() {
        return undefined;
      },
      debug() {
        return undefined;
      },
    },
  });

  await runtimeState.start();

  assert.deepStrictEqual(runtimeState.getRuntimeState(), {
    status: 'ready',
    song: {
      videoId: 'song-1',
      title: 'Angel',
      subtitle: 'Massive Attack',
    },
  });
  assert.deepStrictEqual(runtimeState.getState(), {
    status: 'ready',
    song: {
      videoId: 'song-1',
      title: 'Angel',
      subtitle: 'Massive Attack',
    },
  });

  subscribedListener?.({
    type: 'VIDEO_CHANGED',
    position: 12,
    song: {
      videoId: 'song-2',
      title: 'Teardrop',
    },
  });

  assert.deepStrictEqual(runtimeState.getRuntimeState(), {
    status: 'ready',
    song: {
      videoId: 'song-2',
      title: 'Teardrop',
    },
  });
});

test('Pear runtime state transitions ready to degraded and back to ready when one reconnect attempt succeeds', async () => {
  const scheduler = createScheduler();
  const firstSocket = new FakePearSocket();
  const secondSocket = new FakePearSocket();
  const sockets = [firstSocket, secondSocket];
  let connectCalls = 0;

  const runtimeState = createPearRuntimeStateCoordinator({
    pearClient: {
      async getCurrentSong() {
        return {
          videoId: 'song-1',
          title: 'Angel',
        };
      },
    },
    pearWebSocketClient: {
      async connect() {
        const socket = sockets[connectCalls];
        connectCalls += 1;
        if (socket === undefined) {
          throw new Error('Unexpected reconnect');
        }

        return socket as unknown as WebSocket;
      },
      subscribe() {
        return () => undefined;
      },
      close() {
        return undefined;
      },
    },
    scheduleReconnect: scheduler.schedule,
    reconnectDelayMs: 25,
    logger: {
      child() {
        return this;
      },
      info() {
        return undefined;
      },
      warn() {
        return undefined;
      },
      error() {
        return undefined;
      },
      debug() {
        return undefined;
      },
    },
  });

  await runtimeState.start();
  firstSocket.emitClose();

  assert.deepStrictEqual(runtimeState.getRuntimeState(), {
    status: 'degraded',
    staleReason: 'Pear websocket disconnected.',
    song: {
      videoId: 'song-1',
      title: 'Angel',
    },
  });
  assert.deepStrictEqual(runtimeState.getState(), {
    status: 'degraded',
    staleReason: 'Pear websocket disconnected.',
    song: {
      videoId: 'song-1',
      title: 'Angel',
    },
  });
  assert.deepStrictEqual(
    scheduler.tasks.map((task) => task.delayMs),
    [25],
  );

  await scheduler.tasks[0]?.run();

  assert.deepStrictEqual(runtimeState.getRuntimeState(), {
    status: 'ready',
    song: {
      videoId: 'song-1',
      title: 'Angel',
    },
  });
  assert.equal(connectCalls, 2);
});

test('Pear runtime state stays degraded with a stale reason when reconnect fails', async () => {
  const scheduler = createScheduler();
  const firstSocket = new FakePearSocket();
  let connectCalls = 0;

  const runtimeState = createPearRuntimeStateCoordinator({
    pearClient: {
      async getCurrentSong() {
        return {
          videoId: 'song-1',
          title: 'Angel',
        };
      },
    },
    pearWebSocketClient: {
      async connect() {
        connectCalls += 1;
        if (connectCalls === 1) {
          return firstSocket as unknown as WebSocket;
        }

        throw new Error('reconnect failed');
      },
      subscribe() {
        return () => undefined;
      },
      close() {
        return undefined;
      },
    },
    scheduleReconnect: scheduler.schedule,
    reconnectDelayMs: 0,
    logger: {
      child() {
        return this;
      },
      info() {
        return undefined;
      },
      warn() {
        return undefined;
      },
      error() {
        return undefined;
      },
      debug() {
        return undefined;
      },
    },
  });

  await runtimeState.start();
  firstSocket.emitError();
  await scheduler.tasks[0]?.run();

  assert.deepStrictEqual(runtimeState.getRuntimeState(), {
    status: 'degraded',
    staleReason: 'Pear websocket reconnect failed: reconnect failed',
    song: {
      videoId: 'song-1',
      title: 'Angel',
    },
  });
  assert.deepStrictEqual(runtimeState.getState(), {
    status: 'degraded',
    staleReason: 'Pear websocket reconnect failed: reconnect failed',
    song: {
      videoId: 'song-1',
      title: 'Angel',
    },
  });
});

test('Pear runtime state clears song data when stopped', async () => {
  const runtimeState = createPearRuntimeStateCoordinator({
    pearClient: {
      async getCurrentSong() {
        return {
          videoId: 'song-1',
          title: 'Angel',
        };
      },
    },
    pearWebSocketClient: {
      async connect() {
        return new FakePearSocket() as unknown as WebSocket;
      },
      subscribe() {
        return () => undefined;
      },
      close() {
        return undefined;
      },
    },
    logger: {
      child() {
        return this;
      },
      info() {
        return undefined;
      },
      warn() {
        return undefined;
      },
      error() {
        return undefined;
      },
      debug() {
        return undefined;
      },
    },
  });

  await runtimeState.start();
  await runtimeState.stop();

  assert.deepStrictEqual(runtimeState.getRuntimeState(), {
    status: 'offline',
  });
  assert.deepStrictEqual(runtimeState.getState(), {
    status: 'offline',
  });
});
