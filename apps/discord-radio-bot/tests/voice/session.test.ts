import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { createVoiceSession } from '../../src/voice/session.js';

type RelayProcessName = 'helper' | 'ffmpeg';

class FakeAudioExport {
  private readonly fatalListeners = new Set<(error: Error) => void>();
  private readonly endedListeners = new Set<
    (event: { reason: 'stopped' | 'producer-ended' | 'pipe-closed' }) => void
  >();

  public readonly stream = new PassThrough();

  public stopped = false;

  async stop(): Promise<void> {
    this.stopped = true;
    this.emitEnded('stopped');
  }

  onFatalError(listener: (error: Error) => void): void {
    this.fatalListeners.add(listener);
  }

  onEnded(
    listener: (event: { reason: 'stopped' | 'producer-ended' | 'pipe-closed' }) => void,
  ): void {
    this.endedListeners.add(listener);
  }

  emitFatal(error: Error): void {
    for (const listener of this.fatalListeners) {
      listener(error);
    }
  }

  emitEnded(reason: 'stopped' | 'producer-ended' | 'pipe-closed'): void {
    for (const listener of this.endedListeners) {
      listener({ reason });
    }
  }
}

class FakeVoiceConnection {
  private readonly disconnectListeners = new Set<() => void>();

  public readonly subscriptions: unknown[] = [];

  public destroyed = false;

  on(event: 'disconnect', listener: () => void): this {
    if (event === 'disconnect') {
      this.disconnectListeners.add(listener);
    }

    return this;
  }

  off(event: 'disconnect', listener: () => void): this {
    if (event === 'disconnect') {
      this.disconnectListeners.delete(listener);
    }

    return this;
  }

  subscribe(player: unknown): boolean {
    this.subscriptions.push(player);
    return true;
  }

  destroy(): void {
    this.destroyed = true;
  }

  emitDisconnect(): void {
    for (const listener of this.disconnectListeners) {
      listener();
    }
  }
}

class FakeRelayProcess {
  private readonly exitListeners = new Set<
    (event: {
      process: RelayProcessName;
      exitCode: number | null;
    }) => void
  >();
  private readonly errorListeners = new Set<
    (event: {
      process: RelayProcessName;
      error: Error;
    }) => void
  >();

  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();

  public killed = false;

  on(
    event: 'exit' | 'error',
    listener:
      | ((event: {
        process: RelayProcessName;
        exitCode: number | null;
      }) => void)
      | ((event: {
        process: RelayProcessName;
        error: Error;
      }) => void),
  ): this {
    if (event === 'exit') {
      this.exitListeners.add(listener as (event: {
        process: RelayProcessName;
        exitCode: number | null;
      }) => void);
    } else {
      this.errorListeners.add(listener as (event: {
        process: RelayProcessName;
        error: Error;
      }) => void);
    }

    return this;
  }

  off(
    event: 'exit' | 'error',
    listener:
      | ((event: {
        process: RelayProcessName;
        exitCode: number | null;
      }) => void)
      | ((event: {
        process: RelayProcessName;
        error: Error;
      }) => void),
  ): this {
    if (event === 'exit') {
      this.exitListeners.delete(listener as (event: {
        process: RelayProcessName;
        exitCode: number | null;
      }) => void);
    } else {
      this.errorListeners.delete(listener as (event: {
        process: RelayProcessName;
        error: Error;
      }) => void);
    }

    return this;
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }

  emitExit(process: RelayProcessName, exitCode: number | null): void {
    for (const listener of this.exitListeners) {
      listener({
        process,
        exitCode,
      });
    }
  }

  emitError(process: RelayProcessName, error: Error): void {
    for (const listener of this.errorListeners) {
      listener({
        process,
        error,
      });
    }
  }
}

function createScheduler() {
  const tasks: Array<() => void | Promise<void>> = [];

  return {
    schedule(task: () => void | Promise<void>) {
      tasks.push(task);
      return {
        cancel() {
          const index = tasks.indexOf(task);
          if (index >= 0) {
            tasks.splice(index, 1);
          }
        },
      };
    },
    tasks,
  };
}

type JoinVoiceChannelInput = {
  readonly channelId: string;
  readonly guildId: string;
  readonly adapterCreator: unknown;
  readonly selfDeaf: boolean;
};

type CreateAudioResourceOptions = {
  readonly inputType: string;
};

function createLoggerRecorder() {
  const entries: Array<{
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    payload?: Readonly<Record<string, unknown>> | undefined;
  }> = [];

  const logger = {
    child() {
      return logger;
    },
    info(message: string, payload?: Readonly<Record<string, unknown>>) {
      entries.push({ level: 'info', message, payload });
    },
    warn(message: string, payload?: Readonly<Record<string, unknown>>) {
      entries.push({ level: 'warn', message, payload });
    },
    error(message: string, payload?: Readonly<Record<string, unknown>>) {
      entries.push({ level: 'error', message, payload });
    },
    debug(message: string, payload?: Readonly<Record<string, unknown>>) {
      entries.push({ level: 'debug', message, payload });
    },
  };

  return {
    logger,
    entries,
  };
}

test('voice session joins a voice channel, waits for ready, and starts an Ogg/Opus relay', async () => {
  const joinCalls: Array<{
    channelId: string;
    guildId: string;
    adapterCreator: unknown;
    selfDeaf: boolean;
  }> = [];
  const resourceCalls: Array<{
    stream: PassThrough;
    inputType: string;
  }> = [];
  const connection = new FakeVoiceConnection();
  const relay = new FakeRelayProcess();

  const session = createVoiceSession({
    ffmpegPath: 'ffmpeg.exe',
    joinVoiceChannel(input: JoinVoiceChannelInput) {
      joinCalls.push(input);
      return connection;
    },
    async waitForVoiceReady() {
      return undefined;
    },
    createAudioPlayer() {
      return {
        play() {
          return undefined;
        },
        stop() {
          return undefined;
        },
      };
    },
    createAudioResource(stream: unknown, options: CreateAudioResourceOptions) {
      resourceCalls.push({
        stream: stream as PassThrough,
        inputType: options.inputType,
      });
      return {
        kind: 'resource',
      };
    },
    spawnRelay() {
      return relay;
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

  const message = await session.join({
    guildId: 'guild-1',
    voiceAdapterCreator: {
      kind: 'adapter',
    },
    channel: {
      id: 'voice-1',
      name: 'Desk Radio',
    },
  });

  assert.equal(message, 'Joined Desk Radio and started the relay.');
  assert.deepStrictEqual(joinCalls, [
    {
      channelId: 'voice-1',
      guildId: 'guild-1',
      adapterCreator: {
        kind: 'adapter',
      },
      selfDeaf: false,
    },
  ]);
  assert.deepStrictEqual(resourceCalls, [
    {
      stream: relay.stdout,
      inputType: 'ogg/opus',
    },
  ]);
  assert.deepStrictEqual(session.getState(), {
    voice: 'connected',
    relay: 'running',
  });
});

test('voice session moves to a new channel without restarting the relay', async () => {
  const joinCalls: Array<{
    channelId: string;
    guildId: string;
    adapterCreator: unknown;
    selfDeaf: boolean;
  }> = [];
  const resourceCalls: Array<{
    stream: PassThrough;
    inputType: string;
  }> = [];
  const firstConnection = new FakeVoiceConnection();
  const secondConnection = new FakeVoiceConnection();
  const connections = [firstConnection, secondConnection];
  const relay = new FakeRelayProcess();
  let joinCallsCount = 0;

  const session = createVoiceSession({
    ffmpegPath: 'ffmpeg.exe',
    joinVoiceChannel(input: JoinVoiceChannelInput) {
      joinCalls.push(input);
      const connection = connections[joinCallsCount];
      joinCallsCount += 1;
      if (connection === undefined) {
        throw new Error('Unexpected voice join');
      }

      return connection;
    },
    async waitForVoiceReady() {
      return undefined;
    },
    createAudioPlayer() {
      return {
        play() {
          return undefined;
        },
        stop() {
          return undefined;
        },
      };
    },
    createAudioResource(stream: unknown, options: CreateAudioResourceOptions) {
      resourceCalls.push({
        stream: stream as PassThrough,
        inputType: options.inputType,
      });
      return {
        kind: 'resource',
      };
    },
    spawnRelay() {
      return relay;
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

  const firstMessage = await session.join({
    guildId: 'guild-1',
    voiceAdapterCreator: {
      kind: 'adapter',
    },
    channel: {
      id: 'voice-1',
      name: 'Desk Radio',
    },
  });
  const secondMessage = await session.join({
    guildId: 'guild-1',
    voiceAdapterCreator: {
      kind: 'adapter',
    },
    channel: {
      id: 'voice-2',
      name: 'Studio',
    },
  });

  assert.equal(firstMessage, 'Joined Desk Radio and started the relay.');
  assert.equal(secondMessage, 'Moved to Studio and kept the relay running.');
  assert.deepStrictEqual(joinCalls, [
    {
      channelId: 'voice-1',
      guildId: 'guild-1',
      adapterCreator: {
        kind: 'adapter',
      },
      selfDeaf: false,
    },
    {
      channelId: 'voice-2',
      guildId: 'guild-1',
      adapterCreator: {
        kind: 'adapter',
      },
      selfDeaf: false,
    },
  ]);
  assert.deepStrictEqual(resourceCalls, [
    {
      stream: relay.stdout,
      inputType: 'ogg/opus',
    },
  ]);
  assert.equal(firstConnection.destroyed, true);
  assert.equal(secondConnection.destroyed, false);
  assert.deepStrictEqual(secondConnection.subscriptions.length, 1);
  assert.deepStrictEqual(session.getState(), {
    voice: 'connected',
    relay: 'running',
  });
});

test('voice session reports joining state for duplicate joins while the initial join is still in progress', async () => {
  const joinCalls: JoinVoiceChannelInput[] = [];
  const resourceCalls: Array<{
    stream: PassThrough;
    inputType: string;
  }> = [];
  const connection = new FakeVoiceConnection();
  const relay = new FakeRelayProcess();
  let resolveReady: (() => void) | undefined;

  const session = createVoiceSession({
    ffmpegPath: 'ffmpeg.exe',
    joinVoiceChannel(input: JoinVoiceChannelInput) {
      joinCalls.push(input);
      return connection;
    },
    async waitForVoiceReady() {
      await new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
    },
    createAudioPlayer() {
      return {
        play() {
          return undefined;
        },
        stop() {
          return undefined;
        },
      };
    },
    createAudioResource(stream: unknown, options: CreateAudioResourceOptions) {
      resourceCalls.push({
        stream: stream as PassThrough,
        inputType: options.inputType,
      });
      return {
        kind: 'resource',
      };
    },
    spawnRelay() {
      return relay;
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

  const firstJoinPromise = session.join({
    guildId: 'guild-1',
    voiceAdapterCreator: {
      kind: 'adapter',
    },
    channel: {
      id: 'voice-1',
      name: 'Desk Radio',
    },
  });

  assert.deepStrictEqual(session.getState(), {
    voice: 'joining',
    relay: 'stopped',
  });

  const sameChannelJoinMessage = await session.join({
    guildId: 'guild-1',
    voiceAdapterCreator: {
      kind: 'adapter',
    },
    channel: {
      id: 'voice-1',
      name: 'Desk Radio',
    },
  });

  const differentChannelJoinMessage = await session.join({
    guildId: 'guild-1',
    voiceAdapterCreator: {
      kind: 'adapter',
    },
    channel: {
      id: 'voice-2',
      name: 'Studio',
    },
  });

  assert.equal(sameChannelJoinMessage, 'Already joining Desk Radio.');
  assert.equal(differentChannelJoinMessage, 'Already joining Desk Radio.');
  assert.deepStrictEqual(joinCalls, [
    {
      channelId: 'voice-1',
      guildId: 'guild-1',
      adapterCreator: {
        kind: 'adapter',
      },
      selfDeaf: false,
    },
  ]);
  assert.deepStrictEqual(session.getState(), {
    voice: 'joining',
    relay: 'stopped',
  });

  resolveReady?.();

  const firstJoinMessage = await firstJoinPromise;

  assert.equal(firstJoinMessage, 'Joined Desk Radio and started the relay.');
  assert.deepStrictEqual(resourceCalls, [
    {
      stream: relay.stdout,
      inputType: 'ogg/opus',
    },
  ]);
  assert.equal(connection.destroyed, false);
  assert.deepStrictEqual(session.getState(), {
    voice: 'connected',
    relay: 'running',
  });
});

test('voice session fails the move when the relay dies before the replacement voice connection is ready', async () => {
  const firstConnection = new FakeVoiceConnection();
  const secondConnection = new FakeVoiceConnection();
  const connections = [firstConnection, secondConnection];
  const relay = new FakeRelayProcess();
  let joinCalls = 0;
  let readyCallCount = 0;
  let resolveSecondReady: (() => void) | undefined;

  const session = createVoiceSession({
    ffmpegPath: 'ffmpeg.exe',
    joinVoiceChannel() {
      const connection = connections[joinCalls];
      joinCalls += 1;
      if (connection === undefined) {
        throw new Error('Unexpected voice join');
      }

      return connection;
    },
    async waitForVoiceReady() {
      readyCallCount += 1;
      if (readyCallCount === 1) {
        return undefined;
      }

      await new Promise<void>((resolve) => {
        resolveSecondReady = resolve;
      });
    },
    createAudioPlayer() {
      return {
        play() {
          return undefined;
        },
        stop() {
          return undefined;
        },
      };
    },
    createAudioResource() {
      return {
        kind: 'resource',
      };
    },
    spawnRelay() {
      return relay;
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

  await session.join({
    guildId: 'guild-1',
    voiceAdapterCreator: {
      kind: 'adapter',
    },
    channel: {
      id: 'voice-1',
      name: 'Desk Radio',
    },
  });

  const movePromise = session.join({
    guildId: 'guild-1',
    voiceAdapterCreator: {
      kind: 'adapter',
    },
    channel: {
      id: 'voice-2',
      name: 'Studio',
    },
  });

  assert.deepStrictEqual(session.getState(), {
    voice: 'reconnecting',
    relay: 'running',
  });

  relay.emitError('helper', new Error('relay died during move'));
  resolveSecondReady?.();

  await assert.rejects(movePromise, {
    message: 'Voice move was interrupted before the replacement connection became ready.',
  });
  assert.equal(firstConnection.destroyed, true);
  assert.equal(secondConnection.destroyed, true);
  assert.deepStrictEqual(session.getState(), {
    voice: 'idle',
    relay: 'failed',
  });
});

test('voice session leave is idempotent and tears down relay before voice', async () => {
  const teardownCalls: string[] = [];
  const connection = new FakeVoiceConnection();
  const relay = new FakeRelayProcess();

  const session = createVoiceSession({
    ffmpegPath: 'ffmpeg.exe',
    joinVoiceChannel() {
      return connection;
    },
    async waitForVoiceReady() {
      return undefined;
    },
    createAudioPlayer() {
      return {
        play() {
          return undefined;
        },
        stop() {
          teardownCalls.push('player-stop');
          return undefined;
        },
      };
    },
    createAudioResource() {
      return {
        kind: 'resource',
      };
    },
    spawnRelay() {
      const originalKill = relay.kill.bind(relay);
      relay.kill = () => {
        teardownCalls.push('relay-kill');
        return originalKill();
      };
      const originalDestroy = connection.destroy.bind(connection);
      connection.destroy = () => {
        teardownCalls.push('voice-destroy');
        originalDestroy();
      };
      return relay;
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

  await session.join({
    guildId: 'guild-1',
    voiceAdapterCreator: {
      kind: 'adapter',
    },
    channel: {
      id: 'voice-1',
      name: 'Desk Radio',
    },
  });

  const firstLeave = await session.leave();
  const secondLeave = await session.leave();

  assert.equal(firstLeave, 'Left the voice channel and stopped the relay.');
  assert.equal(secondLeave, 'Already idle.');
  assert.deepStrictEqual(teardownCalls, [
    'relay-kill',
    'player-stop',
    'voice-destroy',
  ]);
  assert.deepStrictEqual(session.getState(), {
    voice: 'idle',
    relay: 'stopped',
  });
});

test('voice session makes one bounded reconnect attempt after a disconnect', async () => {
  const scheduler = createScheduler();
  const firstConnection = new FakeVoiceConnection();
  const secondConnection = new FakeVoiceConnection();
  const connections = [firstConnection, secondConnection];
  let joinCalls = 0;

  const session = createVoiceSession({
    ffmpegPath: 'ffmpeg.exe',
    joinVoiceChannel() {
      const connection = connections[joinCalls];
      joinCalls += 1;
      if (connection === undefined) {
        throw new Error('Unexpected voice join');
      }

      return connection;
    },
    async waitForVoiceReady() {
      return undefined;
    },
    createAudioPlayer() {
      return {
        play() {
          return undefined;
        },
        stop() {
          return undefined;
        },
      };
    },
    createAudioResource() {
      return {
        kind: 'resource',
      };
    },
    spawnRelay() {
      return new FakeRelayProcess();
    },
    scheduleRecovery(task: () => void | Promise<void>) {
      return scheduler.schedule(task);
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

  await session.join({
    guildId: 'guild-1',
    voiceAdapterCreator: {
      kind: 'adapter',
    },
    channel: {
      id: 'voice-1',
      name: 'Desk Radio',
    },
  });

  firstConnection.emitDisconnect();

  assert.deepStrictEqual(session.getState(), {
    voice: 'reconnecting',
    relay: 'running',
  });
  await scheduler.tasks[0]?.();

  assert.deepStrictEqual(session.getState(), {
    voice: 'connected',
    relay: 'running',
  });
  assert.equal(joinCalls, 2);
});

test('voice session restarts the relay once and disconnects cleanly if the restart fails', async () => {
  const scheduler = createScheduler();
  const connection = new FakeVoiceConnection();
  const firstRelay = new FakeRelayProcess();
  let spawnCalls = 0;
  const { logger, entries } = createLoggerRecorder();

  const session = createVoiceSession({
    ffmpegSource: 'env',
    ffmpegPath: 'ffmpeg.exe',
    joinVoiceChannel() {
      return connection;
    },
    async waitForVoiceReady() {
      return undefined;
    },
    createAudioPlayer() {
      return {
        play() {
          return undefined;
        },
        stop() {
          return undefined;
        },
      };
    },
    createAudioResource() {
      return {
        kind: 'resource',
      };
    },
    spawnRelay() {
      spawnCalls += 1;
      if (spawnCalls === 1) {
        return firstRelay;
      }

      throw new Error('ffmpeg restart failed');
    },
    scheduleRecovery(task: () => void | Promise<void>) {
      return scheduler.schedule(task);
    },
    logger,
  });

  await session.join({
    guildId: 'guild-1',
    voiceAdapterCreator: {
      kind: 'adapter',
    },
    channel: {
      id: 'voice-1',
      name: 'Desk Radio',
    },
  });

  firstRelay.stderr.write('helper stream ended\n');
  firstRelay.emitExit('helper', 1);

  assert.deepStrictEqual(session.getState(), {
    voice: 'connected',
    relay: 'restarting',
  });
  await scheduler.tasks[0]?.();

  assert.deepStrictEqual(session.getState(), {
    voice: 'idle',
    relay: 'failed',
  });
  assert.equal(connection.destroyed, true);
  assert.equal(spawnCalls, 2);
  assert.deepStrictEqual(entries.filter((entry) => entry.level === 'error'), [
    {
      level: 'error',
      message: 'Audio relay exited.',
      payload: {
        ffmpegSource: 'env',
        ffmpegExecutablePath: 'ffmpeg.exe',
        relayProcess: 'helper',
        exitCode: 1,
        stderrTail: 'helper stream ended',
      },
    },
    {
      level: 'error',
      message: 'Relay restart failed.',
      payload: {
        ffmpegSource: 'env',
        ffmpegExecutablePath: 'ffmpeg.exe',
        error: 'ffmpeg restart failed',
        reason: 'relay-restart-failed',
      },
    },
  ]);
});

test('voice session recovers from relay error without crashing', async () => {
  const scheduler = createScheduler();
  const connection = new FakeVoiceConnection();
  const firstRelay = new FakeRelayProcess();
  const secondRelay = new FakeRelayProcess();
  const relays = [firstRelay, secondRelay];
  let spawnCalls = 0;

  const session = createVoiceSession({
    ffmpegPath: 'ffmpeg.exe',
    joinVoiceChannel() {
      return connection;
    },
    async waitForVoiceReady() {
      return undefined;
    },
    createAudioPlayer() {
      return {
        play() {
          return undefined;
        },
        stop() {
          return undefined;
        },
      };
    },
    createAudioResource() {
      return {
        kind: 'resource',
      };
    },
    spawnRelay() {
      const relay = relays[spawnCalls];
      spawnCalls += 1;
      if (relay === undefined) {
        throw new Error('Unexpected spawn');
      }

      return relay;
    },
    scheduleRecovery(task: () => void | Promise<void>) {
      return scheduler.schedule(task);
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

  await session.join({
    guildId: 'guild-1',
    voiceAdapterCreator: {
      kind: 'adapter',
    },
    channel: {
      id: 'voice-1',
      name: 'Desk Radio',
    },
  });

  firstRelay.emitError('ffmpeg', new Error('ffmpeg spawn failed'));

  assert.deepStrictEqual(session.getState(), {
    voice: 'connected',
    relay: 'restarting',
  });

  await scheduler.tasks[0]?.();

  assert.deepStrictEqual(session.getState(), {
    voice: 'connected',
    relay: 'running',
  });
  assert.equal(spawnCalls, 2);
});

test('voice session does not report a running relay if it fails while voice reconnecting', async () => {
  const scheduler = createScheduler();
  const connection = new FakeVoiceConnection();
  const relay = new FakeRelayProcess();

  const session = createVoiceSession({
    ffmpegPath: 'ffmpeg.exe',
    joinVoiceChannel() {
      return connection;
    },
    async waitForVoiceReady() {
      return undefined;
    },
    createAudioPlayer() {
      return {
        play() {
          return undefined;
        },
        stop() {
          return undefined;
        },
      };
    },
    createAudioResource() {
      return {
        kind: 'resource',
      };
    },
    spawnRelay() {
      return relay;
    },
    scheduleRecovery(task: () => void | Promise<void>) {
      return scheduler.schedule(task);
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

  await session.join({
    guildId: 'guild-1',
    voiceAdapterCreator: {
      kind: 'adapter',
    },
    channel: {
      id: 'voice-1',
      name: 'Desk Radio',
    },
  });

  connection.emitDisconnect();
  relay.emitError('ffmpeg', new Error('relay died during reconnect'));

  assert.deepStrictEqual(session.getState(), {
    voice: 'idle',
    relay: 'failed',
  });
});

test('voice session restarts the pipeline when the audio export ends unexpectedly', async () => {
  const scheduler = createScheduler();
  const connection = new FakeVoiceConnection();
  const firstExport = new FakeAudioExport();
  const secondExport = new FakeAudioExport();
  const exports = [firstExport, secondExport];
  const firstRelay = new FakeRelayProcess();
  const secondRelay = new FakeRelayProcess();
  const relays = [firstRelay, secondRelay];
  const relayInputs: Array<{
    exportStream: PassThrough | undefined;
    sampleRate: number | undefined;
  }> = [];
  let exportStarts = 0;
  let relayStarts = 0;

  const session = createVoiceSession({
    ffmpegPath: 'ffmpeg.exe',
    async startAudioExport() {
      const nextExport = exports[exportStarts];
      exportStarts += 1;
      if (nextExport === undefined) {
        throw new Error('Unexpected export start');
      }

      return {
        ready: {
          kind: 'plugin',
          transport: 'named-pipe',
          pcm: {
            sampleRate: 44_100,
            channels: 2,
            bitsPerSample: 16,
          },
        },
        running: nextExport,
        diagnostics: {
          audioExportBootstrapPath: `C:\\temp\\pear-direct-audio-export\\session-${exportStarts}.json`,
        },
      };
    },
    joinVoiceChannel() {
      return connection;
    },
    async waitForVoiceReady() {
      return undefined;
    },
    createAudioPlayer() {
      return {
        play() {
          return undefined;
        },
        stop() {
          return undefined;
        },
      };
    },
    createAudioResource() {
      return {
        kind: 'resource',
      };
    },
    spawnRelay(input) {
      relayInputs.push({
        exportStream: input.exportStream as PassThrough | undefined,
        sampleRate: input.pcm?.sampleRate,
      });
      const relay = relays[relayStarts];
      relayStarts += 1;
      if (relay === undefined) {
        throw new Error('Unexpected relay start');
      }

      return relay;
    },
    scheduleRecovery(task: () => void | Promise<void>) {
      return scheduler.schedule(task);
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

  await session.join({
    guildId: 'guild-1',
    voiceAdapterCreator: {
      kind: 'adapter',
    },
    channel: {
      id: 'voice-1',
      name: 'Desk Radio',
    },
  });

  firstExport.emitEnded('producer-ended');

  assert.deepStrictEqual(session.getState(), {
    voice: 'connected',
    relay: 'restarting',
  });

  await scheduler.tasks[0]?.();

  assert.deepStrictEqual(session.getState(), {
    voice: 'connected',
    relay: 'running',
  });
  assert.equal(firstExport.stopped, true);
  assert.equal(exportStarts, 2);
  assert.equal(relayStarts, 2);
  assert.deepStrictEqual(relayInputs, [
    {
      exportStream: firstExport.stream,
      sampleRate: 44_100,
    },
    {
      exportStream: secondExport.stream,
      sampleRate: 44_100,
    },
  ]);
});

test('voice session fails when the audio export emits a fatal error during voice reconnect', async () => {
  const scheduler = createScheduler();
  const connection = new FakeVoiceConnection();
  const audioExport = new FakeAudioExport();
  const relay = new FakeRelayProcess();

  const session = createVoiceSession({
    ffmpegPath: 'ffmpeg.exe',
    async startAudioExport() {
      return {
        ready: {
          kind: 'plugin',
          transport: 'named-pipe',
          pcm: {
            sampleRate: 48_000,
            channels: 2,
            bitsPerSample: 16,
          },
        },
        running: audioExport,
      };
    },
    joinVoiceChannel() {
      return connection;
    },
    async waitForVoiceReady() {
      return undefined;
    },
    createAudioPlayer() {
      return {
        play() {
          return undefined;
        },
        stop() {
          return undefined;
        },
      };
    },
    createAudioResource() {
      return {
        kind: 'resource',
      };
    },
    spawnRelay() {
      return relay;
    },
    scheduleRecovery(task: () => void | Promise<void>) {
      return scheduler.schedule(task);
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

  await session.join({
    guildId: 'guild-1',
    voiceAdapterCreator: {
      kind: 'adapter',
    },
    channel: {
      id: 'voice-1',
      name: 'Desk Radio',
    },
  });

  connection.emitDisconnect();
  audioExport.emitFatal(new Error('named pipe disconnected'));

  assert.deepStrictEqual(session.getState(), {
    voice: 'idle',
    relay: 'failed',
  });
  assert.equal(scheduler.tasks.length, 0);
});

test('voice session join fails when the audio export emits a fatal error during startup', async () => {
  const connection = new FakeVoiceConnection();
  const audioExport = new FakeAudioExport();

  const session = createVoiceSession({
    ffmpegPath: 'ffmpeg.exe',
    async startAudioExport() {
      return {
        ready: {
          kind: 'plugin',
          transport: 'named-pipe',
          pcm: {
            sampleRate: 48_000,
            channels: 2,
            bitsPerSample: 16,
          },
        },
        running: audioExport,
      };
    },
    joinVoiceChannel() {
      return connection;
    },
    async waitForVoiceReady() {
      return undefined;
    },
    createAudioPlayer() {
      return {
        play() {
          return undefined;
        },
        stop() {
          return undefined;
        },
      };
    },
    createAudioResource() {
      return {
        kind: 'resource',
      };
    },
    spawnRelay() {
      audioExport.emitFatal(new Error('named pipe disconnected'));
      return new FakeRelayProcess();
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

  await assert.rejects(
    () =>
      session.join({
        guildId: 'guild-1',
        voiceAdapterCreator: {
          kind: 'adapter',
        },
        channel: {
          id: 'voice-1',
          name: 'Desk Radio',
        },
      }),
    /named pipe disconnected/u,
  );
  assert.deepStrictEqual(session.getState(), {
    voice: 'idle',
    relay: 'stopped',
  });
});

test('voice session join fails when the audio export ends during startup', async () => {
  const connection = new FakeVoiceConnection();
  const audioExport = new FakeAudioExport();

  const session = createVoiceSession({
    ffmpegPath: 'ffmpeg.exe',
    async startAudioExport() {
      return {
        ready: {
          kind: 'plugin',
          transport: 'named-pipe',
          pcm: {
            sampleRate: 48_000,
            channels: 2,
            bitsPerSample: 16,
          },
        },
        running: audioExport,
      };
    },
    joinVoiceChannel() {
      return connection;
    },
    async waitForVoiceReady() {
      return undefined;
    },
    createAudioPlayer() {
      return {
        play() {
          return undefined;
        },
        stop() {
          return undefined;
        },
      };
    },
    createAudioResource() {
      return {
        kind: 'resource',
      };
    },
    spawnRelay() {
      audioExport.emitEnded('producer-ended');
      return new FakeRelayProcess();
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

  await assert.rejects(
    () =>
      session.join({
        guildId: 'guild-1',
        voiceAdapterCreator: {
          kind: 'adapter',
        },
        channel: {
          id: 'voice-1',
          name: 'Desk Radio',
        },
      }),
    /producer-ended/u,
  );
  assert.deepStrictEqual(session.getState(), {
    voice: 'idle',
    relay: 'stopped',
  });
});

test('voice session fails the restart when the replacement audio export emits a fatal error during restart startup', async () => {
  const scheduler = createScheduler();
  const connection = new FakeVoiceConnection();
  const firstExport = new FakeAudioExport();
  const secondExport = new FakeAudioExport();
  const exports = [firstExport, secondExport];
  const firstRelay = new FakeRelayProcess();
  const { logger, entries } = createLoggerRecorder();
  let exportStarts = 0;
  let relayStarts = 0;

  const session = createVoiceSession({
    ffmpegPath: 'ffmpeg.exe',
    async startAudioExport() {
      const nextExport = exports[exportStarts];
      exportStarts += 1;
      if (nextExport === undefined) {
        throw new Error('Unexpected export start');
      }

      return {
        ready: {
          kind: 'plugin',
          transport: 'named-pipe',
          pcm: {
            sampleRate: 48_000,
            channels: 2,
            bitsPerSample: 16,
          },
        },
        running: nextExport,
      };
    },
    joinVoiceChannel() {
      return connection;
    },
    async waitForVoiceReady() {
      return undefined;
    },
    createAudioPlayer() {
      return {
        play() {
          return undefined;
        },
        stop() {
          return undefined;
        },
      };
    },
    createAudioResource() {
      return {
        kind: 'resource',
      };
    },
    spawnRelay() {
      relayStarts += 1;
      if (relayStarts === 1) {
        return firstRelay;
      }

      secondExport.emitFatal(new Error('replacement export died'));
      return new FakeRelayProcess();
    },
    scheduleRecovery(task: () => void | Promise<void>) {
      return scheduler.schedule(task);
    },
    logger,
  });

  await session.join({
    guildId: 'guild-1',
    voiceAdapterCreator: {
      kind: 'adapter',
    },
    channel: {
      id: 'voice-1',
      name: 'Desk Radio',
    },
  });

  firstExport.emitEnded('producer-ended');

  assert.deepStrictEqual(session.getState(), {
    voice: 'connected',
    relay: 'restarting',
  });

  await scheduler.tasks[0]?.();

  assert.deepStrictEqual(session.getState(), {
    voice: 'idle',
    relay: 'failed',
  });
  assert.equal(exportStarts, 2);
  assert.equal(relayStarts, 2);
  assert.equal(
    entries.some((entry) => entry.message === 'Relay restart succeeded.'),
    false,
  );
  assert.deepStrictEqual(entries.filter((entry) => entry.level === 'error'), [
    {
      level: 'error',
      message: 'Audio export provider ended.',
      payload: {
        ffmpegSource: 'path',
        ffmpegExecutablePath: 'ffmpeg.exe',
        audioExportEndedReason: 'producer-ended',
        audioExportKind: 'plugin',
        audioExportTransport: 'named-pipe',
        audioExportSampleRate: 48_000,
      },
    },
    {
      level: 'error',
      message: 'Relay restart failed.',
      payload: {
        ffmpegSource: 'path',
        ffmpegExecutablePath: 'ffmpeg.exe',
        error: 'Audio export provider emitted a fatal error during startup: replacement export died',
        reason: 'relay-restart-failed',
      },
    },
  ]);
});

test('voice session export path passes only export-shaped relay input', async () => {
  const connection = new FakeVoiceConnection();
  const audioExport = new FakeAudioExport();
  let relayInput:
    | {
      exportStream: PassThrough | undefined;
      pcmSampleRate: number | undefined;
      hasHelperPath: boolean;
      hasPearPort: boolean;
    }
    | undefined;

  const session = createVoiceSession({
    ffmpegPath: 'ffmpeg.exe',
    async startAudioExport() {
      return {
        ready: {
          kind: 'plugin',
          transport: 'named-pipe',
          pcm: {
            sampleRate: 44_100,
            channels: 2,
            bitsPerSample: 16,
          },
        },
        running: audioExport,
      };
    },
    joinVoiceChannel() {
      return connection;
    },
    async waitForVoiceReady() {
      return undefined;
    },
    createAudioPlayer() {
      return {
        play() {
          return undefined;
        },
        stop() {
          return undefined;
        },
      };
    },
    createAudioResource() {
      return {
        kind: 'resource',
      };
    },
    spawnRelay(input) {
      relayInput = {
        exportStream: input.exportStream as PassThrough | undefined,
        pcmSampleRate: input.pcm?.sampleRate,
        hasHelperPath: 'helperPath' in input,
        hasPearPort: 'pearPort' in input,
      };
      return new FakeRelayProcess();
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

  await session.join({
    guildId: 'guild-1',
    voiceAdapterCreator: {
      kind: 'adapter',
    },
    channel: {
      id: 'voice-1',
      name: 'Desk Radio',
    },
  });

  assert.deepStrictEqual(relayInput, {
    exportStream: audioExport.stream,
    pcmSampleRate: 44_100,
    hasHelperPath: false,
    hasPearPort: false,
  });
});
