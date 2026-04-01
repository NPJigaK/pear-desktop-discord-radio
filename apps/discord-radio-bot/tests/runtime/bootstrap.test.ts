import assert from 'node:assert/strict';
import test from 'node:test';

import { startRuntime } from '../../src/runtime/bootstrap.js';
import type { DoctorReport } from '../../src/preflight/index.js';

type RuntimeStopHandle = {
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
};

function createDoctorReport(
  source: 'app-managed' | 'env' | 'path',
  executablePath: string,
): DoctorReport {
  return {
    platform: 'win32',
    checks: {
      pearHostExact: { status: 'pass', detail: 'ok' },
      pearAuthReachable: { status: 'pass', detail: 'ok' },
      pearWebSocketReachable: { status: 'pass', detail: 'ok' },
      exportProviderReady: {
        status: 'pass',
        detail: 'Connectable plugin export bootstrap was discovered.',
        sessionId: 'plugin-session-123',
        bootstrapPath:
          'C:\\temp\\pear-direct-audio-export\\plugin-session-123.json',
        pipePath: '\\\\.\\pipe\\pear-direct-audio',
        streamState: 'waiting-for-client',
        droppedFrameCount: 0,
      },
      exportPcmContractReady: {
        status: 'pass',
        detail: 'Export provider PCM contract is ready for FFmpeg relay (48000 Hz, 2 channels, 16 bits).',
        pcm: {
          sampleRate: 48_000,
          channels: 2,
          bitsPerSample: 16,
        },
      },
      ffmpegDiscoverable: {
        status: 'pass',
        detail: 'ffmpeg version 8.0.1',
        executablePath,
        source,
      },
      ffmpegEncodeReady: {
        status: 'pass',
        detail: 'FFmpeg encode smoke test succeeded.',
      },
    },
    fullPass: true,
  };
}

type SignalHandler = () => void;

function createSignalHub() {
  const handlers = new Map<string, SignalHandler[]>();

  return {
    on(event: string, handler: SignalHandler) {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
      return this;
    },
    off(event: string, handler: SignalHandler) {
      const existing = handlers.get(event) ?? [];
      handlers.set(
        event,
        existing.filter((candidate) => candidate !== handler),
      );
      return this;
    },
    emit(event: string) {
      for (const handler of handlers.get(event) ?? []) {
        handler();
      }
    },
  };
}

test('startRuntime boots preflight, Pear coordination, and Discord runtime without syncing commands', async () => {
  const calls: string[] = [];
  const signalHub = createSignalHub();
  const voiceSessionInputs: Array<{
    ffmpegPath?: string | undefined;
    ffmpegSource?: string | undefined;
  }> = [];

  const runtime = await startRuntime({
    env: {
      DISCORD_TOKEN: 'discord-token',
      DISCORD_APPLICATION_ID: 'app-1',
      DISCORD_GUILD_ID: 'guild-1',
      DISCORD_CONTROLLER_USER_ID: 'user-1',
      PEAR_CLIENT_ID: 'pear-client',
    },
    signalSource: signalHub,
    loadConfig(env: Readonly<Record<string, string | undefined>>) {
      calls.push('load-config');
      return {
        discordToken: String(env.DISCORD_TOKEN),
        discordApplicationId: String(env.DISCORD_APPLICATION_ID),
        discordGuildId: String(env.DISCORD_GUILD_ID),
        discordControllerUserId: String(env.DISCORD_CONTROLLER_USER_ID),
        pearClientId: String(env.PEAR_CLIENT_ID),
        pearHost: '127.0.0.1',
        pearPort: 26538,
        logLevel: 'debug',
      };
    },
    createLogger() {
      calls.push('create-logger');
      return {
        child() {
          return this;
        },
        info() {
          calls.push('log-info');
        },
        warn() {
          calls.push('log-warn');
        },
        error() {
          calls.push('log-error');
        },
        debug() {
          calls.push('log-debug');
        },
      };
    },
    async assertRuntimePreflight() {
      calls.push('preflight');
      return createDoctorReport(
        'app-managed',
        'E:\\github\\pear-desktop-discord-radio\\.cache\\ffmpeg\\ffmpeg\\bin\\ffmpeg.exe',
      );
    },
    createLiveVoiceSession(input) {
      voiceSessionInputs.push(input);
      return {
        async join() {
          return 'joined';
        },
        async leave() {
          return 'left';
        },
        getState() {
          return {
            voice: 'idle',
            relay: 'stopped',
          } as const;
        },
      };
    },
    async createPearRuntimeState() {
      calls.push('create-pear');
      return {
        async start() {
          calls.push('pear-start');
        },
        async stop() {
          calls.push('pear-stop');
        },
        getState() {
          return {
            status: 'ready',
          } as const;
        },
      };
    },
    async createDiscordRuntime() {
      calls.push('create-discord');
      return {
        async start() {
          calls.push('discord-start');
        },
        async stop() {
          calls.push('discord-stop');
        },
      } satisfies RuntimeStopHandle;
    },
    async syncCommands() {
      calls.push('sync-commands');
    },
  });

  assert.deepStrictEqual(calls, [
    'load-config',
    'create-logger',
    'preflight',
    'log-info',
    'log-info',
    'create-pear',
    'pear-start',
    'create-discord',
    'discord-start',
    'log-info',
  ]);
  assert.equal(voiceSessionInputs.length, 1);
  assert.equal(
    voiceSessionInputs[0]?.ffmpegPath,
    'E:\\github\\pear-desktop-discord-radio\\.cache\\ffmpeg\\ffmpeg\\bin\\ffmpeg.exe',
  );
  assert.equal(voiceSessionInputs[0]?.ffmpegSource, 'app-managed');
  assert.equal(
    'helperPath' in (voiceSessionInputs[0] ?? {}),
    false,
  );
  assert.equal(
    'pearPort' in (voiceSessionInputs[0] ?? {}),
    false,
  );

  signalHub.emit('SIGINT');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepStrictEqual(calls, [
    'load-config',
    'create-logger',
    'preflight',
    'log-info',
    'log-info',
    'create-pear',
    'pear-start',
    'create-discord',
    'discord-start',
    'log-info',
    'log-info',
    'discord-stop',
    'pear-stop',
    'log-info',
  ]);

  await runtime.stop();
  assert.equal(calls.includes('sync-commands'), false);
});

test('startRuntime warns when runtime falls back to a non-app-managed ffmpeg source', async () => {
  const entries: Array<{
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    payload?: Readonly<Record<string, unknown>> | undefined;
  }> = [];

  const runtime = await startRuntime({
    env: {
      DISCORD_TOKEN: 'discord-token',
      DISCORD_APPLICATION_ID: 'app-1',
      DISCORD_GUILD_ID: 'guild-1',
      DISCORD_CONTROLLER_USER_ID: 'user-1',
      PEAR_CLIENT_ID: 'pear-client',
    },
    loadConfig(env: Readonly<Record<string, string | undefined>>) {
      return {
        discordToken: String(env.DISCORD_TOKEN),
        discordApplicationId: String(env.DISCORD_APPLICATION_ID),
        discordGuildId: String(env.DISCORD_GUILD_ID),
        discordControllerUserId: String(env.DISCORD_CONTROLLER_USER_ID),
        pearClientId: String(env.PEAR_CLIENT_ID),
        pearHost: '127.0.0.1',
        pearPort: 26538,
        logLevel: 'debug',
      };
    },
    createLogger() {
      return {
        child() {
          return this;
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
    },
    async assertRuntimePreflight() {
      return createDoctorReport('env', 'C:\\ffmpeg\\bin\\ffmpeg.exe');
    },
    createLiveVoiceSession() {
      return {
        async join() {
          return 'joined';
        },
        async leave() {
          return 'left';
        },
        getState() {
          return {
            voice: 'idle',
            relay: 'stopped',
          } as const;
        },
      };
    },
    async createPearRuntimeState() {
      return {
        async start() {
          return undefined;
        },
        async stop() {
          return undefined;
        },
        getState() {
          return {
            status: 'ready',
          } as const;
        },
      };
    },
    async createDiscordRuntime() {
      return {
        async start() {
          return undefined;
        },
        async stop() {
          return undefined;
        },
      } satisfies RuntimeStopHandle;
    },
  });

  await runtime.stop();

  assert.deepStrictEqual(entries.slice(0, 3), [
    {
      level: 'info',
      message: 'Audio export provider selected for runtime.',
      payload: {
        kind: 'plugin',
        transport: 'named-pipe',
      },
    },
    {
      level: 'info',
      message: 'FFmpeg selected for runtime.',
      payload: {
        source: 'env',
        executablePath: 'C:\\ffmpeg\\bin\\ffmpeg.exe',
      },
    },
    {
      level: 'warn',
      message: 'Runtime is using a fallback FFmpeg source.',
      payload: {
        source: 'env',
        executablePath: 'C:\\ffmpeg\\bin\\ffmpeg.exe',
      },
    },
  ]);
});

test('startRuntime still stops Pear when Discord shutdown fails', async () => {
  const calls: string[] = [];

  const runtime = await startRuntime({
    env: {
      DISCORD_TOKEN: 'discord-token',
      DISCORD_APPLICATION_ID: 'app-1',
      DISCORD_GUILD_ID: 'guild-1',
      DISCORD_CONTROLLER_USER_ID: 'user-1',
      PEAR_CLIENT_ID: 'pear-client',
    },
    loadConfig(env: Readonly<Record<string, string | undefined>>) {
      return {
        discordToken: String(env.DISCORD_TOKEN),
        discordApplicationId: String(env.DISCORD_APPLICATION_ID),
        discordGuildId: String(env.DISCORD_GUILD_ID),
        discordControllerUserId: String(env.DISCORD_CONTROLLER_USER_ID),
        pearClientId: String(env.PEAR_CLIENT_ID),
        pearHost: '127.0.0.1',
        pearPort: 26538,
        logLevel: 'debug',
      };
    },
    createLogger() {
      return {
        child() {
          return this;
        },
        info() {
          calls.push('log-info');
        },
        warn() {
          calls.push('log-warn');
        },
        error() {
          calls.push('log-error');
        },
        debug() {
          calls.push('log-debug');
        },
      };
    },
    async assertRuntimePreflight() {
      return undefined;
    },
    async createPearRuntimeState() {
      calls.push('create-pear');
      return {
        async start() {
          calls.push('pear-start');
        },
        async stop() {
          calls.push('pear-stop');
        },
        getState() {
          return {
            status: 'ready',
          } as const;
        },
      };
    },
    async createDiscordRuntime() {
      calls.push('create-discord');
      return {
        async start() {
          calls.push('discord-start');
        },
        async stop() {
          calls.push('discord-stop');
          throw new Error('discord shutdown failed');
        },
      } satisfies RuntimeStopHandle;
    },
  });

  await assert.doesNotReject(runtime.stop());
  assert.deepStrictEqual(calls, [
    'log-info',
    'create-pear',
    'pear-start',
    'create-discord',
    'discord-start',
    'log-info',
    'discord-stop',
    'log-error',
    'pear-stop',
    'log-info',
  ]);
});

test('startRuntime preserves the startup error when Discord startup fails and Pear cleanup fails', async () => {
  const calls: string[] = [];

  const runtimeError = new Error('discord startup failed');

  await assert.rejects(startRuntime({
    env: {
      DISCORD_TOKEN: 'discord-token',
      DISCORD_APPLICATION_ID: 'app-1',
      DISCORD_GUILD_ID: 'guild-1',
      DISCORD_CONTROLLER_USER_ID: 'user-1',
      PEAR_CLIENT_ID: 'pear-client',
    },
    loadConfig(env: Readonly<Record<string, string | undefined>>) {
      return {
        discordToken: String(env.DISCORD_TOKEN),
        discordApplicationId: String(env.DISCORD_APPLICATION_ID),
        discordGuildId: String(env.DISCORD_GUILD_ID),
        discordControllerUserId: String(env.DISCORD_CONTROLLER_USER_ID),
        pearClientId: String(env.PEAR_CLIENT_ID),
        pearHost: '127.0.0.1',
        pearPort: 26538,
        logLevel: 'debug',
      };
    },
    createLogger() {
      return {
        child() {
          return this;
        },
        info() {
          calls.push('log-info');
        },
        warn() {
          calls.push('log-warn');
        },
        error() {
          calls.push('log-error');
        },
        debug() {
          calls.push('log-debug');
        },
      };
    },
    async assertRuntimePreflight() {
      return undefined;
    },
    async createPearRuntimeState() {
      calls.push('create-pear');
      return {
        async start() {
          calls.push('pear-start');
        },
        async stop() {
          calls.push('pear-stop');
          throw new Error('pear cleanup failed');
        },
        getState() {
          return {
            status: 'ready',
          } as const;
        },
      };
    },
    async createDiscordRuntime() {
      calls.push('create-discord');
      return {
        async start() {
          calls.push('discord-start');
          throw runtimeError;
        },
        async stop() {
          calls.push('discord-stop');
        },
      } satisfies RuntimeStopHandle;
    },
  }), /discord startup failed/);

  assert.deepStrictEqual(calls, [
    'log-info',
    'create-pear',
    'pear-start',
    'create-discord',
    'discord-start',
    'pear-stop',
    'log-error',
  ]);
});
