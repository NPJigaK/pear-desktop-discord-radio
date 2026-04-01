import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';

import {
  buildFfmpegRelayArguments,
  buildFfmpegRelaySmokeTestArguments,
  createRunCommand,
  discoverFfmpeg,
  probeFfmpegPcmEncodeReadiness,
} from '../../src/audio/index.js';
import type {
  FfmpegPcmEncodeReadiness,
  SpawnFfmpegRelayOptions,
} from '../../src/audio/index.js';

type AssertTrue<T extends true> = T;
type AssertFalse<T extends false> = T;

type HasKey<TObject, TKey extends PropertyKey> =
  TKey extends keyof TObject ? true : false;

type IsExact<TActual, TExpected> = (
  (<TValue>() => TValue extends TActual ? 1 : 2) extends
    (<TValue>() => TValue extends TExpected ? 1 : 2)
    ? ((<TValue>() => TValue extends TExpected ? 1 : 2) extends
        (<TValue>() => TValue extends TActual ? 1 : 2)
        ? true
        : false)
    : false
);

const pcmEncodeReadinessExample: FfmpegPcmEncodeReadiness = {
  status: 'pass',
  detail: 'PCM Ogg/Opus encode smoke test succeeded.',
};

void pcmEncodeReadinessExample;

type BuildFfmpegRelayArgumentsParameters = AssertTrue<
  IsExact<Parameters<typeof buildFfmpegRelayArguments>, []>
>;
type BuildFfmpegRelaySmokeTestArgumentsParameters = AssertTrue<
  IsExact<Parameters<typeof buildFfmpegRelaySmokeTestArguments>, [{
    readonly sampleRate: number;
    readonly channels: number;
    readonly bitsPerSample: number;
  }]>
>;
type SpawnFfmpegRelayOptionsDropDshowDevice = AssertFalse<
  HasKey<SpawnFfmpegRelayOptions, 'ffmpegDshowAudioDevice'>
>;
type RemovedDirectShowTypeExports = [
  // @ts-expect-error Removed DirectShow type export must stay absent.
  import('../../src/audio/index.js').CheckConfiguredDirectShowAudioDeviceOptions,
  // @ts-expect-error Removed DirectShow type export must stay absent.
  import('../../src/audio/index.js').ConfiguredDirectShowAudioDeviceCheck,
  // @ts-expect-error Removed DirectShow type export must stay absent.
  import('../../src/audio/index.js').DirectShowAudioDeviceEnumeration,
  // @ts-expect-error Removed DirectShow type export must stay absent.
  import('../../src/audio/index.js').EnumerateDirectShowAudioDevicesOptions,
  // @ts-expect-error Removed DirectShow type export must stay absent.
  import('../../src/audio/index.js').ProbeDirectShowCaptureReadinessOptions,
];

const typeAssertions: [
  BuildFfmpegRelayArgumentsParameters,
  BuildFfmpegRelaySmokeTestArgumentsParameters,
  SpawnFfmpegRelayOptionsDropDshowDevice,
] = [true, true, false];

void typeAssertions;
void (0 as unknown as RemovedDirectShowTypeExports);

test('audio index no longer exports DirectShow-era helpers', async () => {
  const audio = await import('../../src/audio/index.js');

  for (const deadExport of [
    'checkConfiguredDirectShowAudioDevice',
    'enumerateDirectShowAudioDevices',
    'parseDirectShowAudioDeviceNames',
    'probeDirectShowCaptureReadiness',
  ]) {
    assert.equal(deadExport in audio, false, `${deadExport} should not be exported`);
  }
});

test('discoverFfmpeg prefers the app-managed binary before fallback candidates', async () => {
  const commands: Array<readonly [string, readonly string[]]> = [];

  const result = await discoverFfmpeg({
    appManagedExecutablePath: 'E:\\github\\pear-desktop-discord-radio\\.cache\\ffmpeg\\ffmpeg\\bin\\ffmpeg.exe',
    ffmpegPath: 'C:\\ffmpeg\\bin\\ffmpeg.exe',
    fileExists(executablePath) {
      return executablePath.startsWith('E:\\github\\pear-desktop-discord-radio\\.cache\\ffmpeg');
    },
    runCommand: async (command, args) => {
      commands.push([command, args]);
      return {
        exitCode: 0,
        stdout: 'ffmpeg version 7.1',
        stderr: '',
      };
    },
  });

  assert.deepStrictEqual(commands, [
    ['E:\\github\\pear-desktop-discord-radio\\.cache\\ffmpeg\\ffmpeg\\bin\\ffmpeg.exe', ['-version']],
  ]);
  assert.equal(result.status, 'pass');
  assert.equal(
    result.executablePath,
    'E:\\github\\pear-desktop-discord-radio\\.cache\\ffmpeg\\ffmpeg\\bin\\ffmpeg.exe',
  );
  assert.equal(result.source, 'app-managed');
});

test('discoverFfmpeg falls back to FFMPEG_PATH when the app-managed binary is unavailable', async () => {
  const commands: Array<readonly [string, readonly string[]]> = [];

  const result = await discoverFfmpeg({
    appManagedExecutablePath: 'E:\\github\\pear-desktop-discord-radio\\.cache\\ffmpeg\\ffmpeg\\bin\\ffmpeg.exe',
    ffmpegPath: 'C:\\ffmpeg\\bin\\ffmpeg.exe',
    fileExists(executablePath) {
      return executablePath === 'C:\\ffmpeg\\bin\\ffmpeg.exe';
    },
    runCommand: async (command, args) => {
      commands.push([command, args]);
      return {
        exitCode: 0,
        stdout: 'ffmpeg version 7.2',
        stderr: '',
      };
    },
  });

  assert.deepStrictEqual(commands, [
    ['C:\\ffmpeg\\bin\\ffmpeg.exe', ['-version']],
  ]);
  assert.equal(result.status, 'pass');
  assert.equal(result.executablePath, 'C:\\ffmpeg\\bin\\ffmpeg.exe');
  assert.equal(result.source, 'env');
  assert.equal(result.attempts[0]?.source, 'app-managed');
  assert.equal(result.attempts[0]?.status, 'fail');
});

test('discoverFfmpeg falls back to ffmpeg on PATH when earlier candidates fail', async () => {
  const commands: Array<readonly [string, readonly string[]]> = [];

  const result = await discoverFfmpeg({
    appManagedExecutablePath: 'E:\\github\\pear-desktop-discord-radio\\.cache\\ffmpeg\\ffmpeg\\bin\\ffmpeg.exe',
    ffmpegPath: 'C:\\ffmpeg\\bin\\ffmpeg.exe',
    fileExists(executablePath) {
      return executablePath !== 'E:\\github\\pear-desktop-discord-radio\\.cache\\ffmpeg\\ffmpeg\\bin\\ffmpeg.exe';
    },
    runCommand: async (command, args) => {
      commands.push([command, args]);
      if (command === 'C:\\ffmpeg\\bin\\ffmpeg.exe') {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'broken override',
        };
      }

      return {
        exitCode: 0,
        stdout: 'ffmpeg version 7.2',
        stderr: '',
      };
    },
  });

  assert.deepStrictEqual(commands, [
    ['C:\\ffmpeg\\bin\\ffmpeg.exe', ['-version']],
    ['ffmpeg', ['-version']],
  ]);
  assert.equal(result.status, 'pass');
  assert.equal(result.executablePath, 'ffmpeg');
  assert.equal(result.source, 'path');
  assert.deepStrictEqual(
    result.attempts.map((attempt) => [attempt.source, attempt.status]),
    [
      ['app-managed', 'fail'],
      ['env', 'fail'],
      ['path', 'pass'],
    ],
  );
});

test('discoverFfmpeg points users to pnpm bootstrap:ffmpeg when no candidate works', async () => {
  const commands: Array<readonly [string, readonly string[]]> = [];
  const result = await discoverFfmpeg({
    appManagedExecutablePath: 'E:\\github\\pear-desktop-discord-radio\\.cache\\ffmpeg\\ffmpeg\\bin\\ffmpeg.exe',
    ffmpegPath: 'C:\\ffmpeg\\bin\\ffmpeg.exe',
    fileExists() {
      return false;
    },
    runCommand: async (command, args) => {
      commands.push([command, args]);
      return {
        exitCode: null,
        stdout: '',
        stderr: '',
        error: new Error('spawn ffmpeg ENOENT'),
      };
    },
  });

  assert.deepStrictEqual(commands, [
    ['ffmpeg', ['-version']],
  ]);
  assert.equal(result.status, 'fail');
  assert.match(result.detail, /pnpm bootstrap:ffmpeg/);
  assert.match(result.detail, /FFMPEG_PATH/);
  assert.match(result.detail, /PATH/);
});

test('buildFfmpegRelayArguments consumes PCM from stdin', () => {
  assert.deepStrictEqual(buildFfmpegRelayArguments(), [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-nostdin',
    '-f',
    's16le',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-i',
    'pipe:0',
    '-vn',
    '-acodec',
    'libopus',
    '-b:a',
    '128k',
    '-vbr',
    'on',
    '-frame_duration',
    '20',
    '-application',
    'audio',
    '-f',
    'ogg',
    'pipe:1',
  ]);
});

test('buildFfmpegRelaySmokeTestArguments emits the one-second smoke-test shape for the provided PCM contract', () => {
  assert.deepStrictEqual(buildFfmpegRelaySmokeTestArguments({
    sampleRate: 44_100,
    channels: 2,
    bitsPerSample: 16,
  }), [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-f',
    's16le',
    '-ar',
    '44100',
    '-ac',
    '2',
    '-i',
    'pipe:0',
    '-vn',
    '-acodec',
    'libopus',
    '-b:a',
    '128k',
    '-vbr',
    'on',
    '-frame_duration',
    '20',
    '-application',
    'audio',
    '-t',
    '1',
    '-f',
    'ogg',
    'pipe:1',
  ]);
});

test('createRunCommand spawns ffmpeg with windowsHide enabled', async () => {
  const spawnCalls: Array<{
    command: string;
    args: readonly string[];
    options: Readonly<Record<string, unknown>>;
  }> = [];
  type FakeChildProcess = EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: EventEmitter & {
      end: (input?: string | Uint8Array) => void;
    };
  };

  const fakeSpawn = (
    command: string,
    args: readonly string[],
    options: Readonly<Record<string, unknown>>,
  ): FakeChildProcess => {
    spawnCalls.push({ command, args, options });

    const child = new EventEmitter() as FakeChildProcess;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new EventEmitter() as FakeChildProcess['stdin'];
    child.stdin.end = () => {
      queueMicrotask(() => {
        child.emit('close', 0);
      });
    };

    return child;
  };

  const run = createRunCommand(fakeSpawn as unknown as typeof import('node:child_process').spawn);

  const result = await run('ffmpeg.exe', ['-version']);

  assert.equal(result.exitCode, 0);
  assert.deepStrictEqual(spawnCalls, [
    {
      command: 'ffmpeg.exe',
      args: ['-version'],
      options: {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    },
  ]);
});

test('probeFfmpegPcmEncodeReadiness runs a short PCM encode smoke test for the provided PCM contract', async () => {
  const commands: Array<readonly [string, readonly string[], number]> = [];

  const result = await probeFfmpegPcmEncodeReadiness({
    executablePath: 'ffmpeg.exe',
    pcm: {
      sampleRate: 44_100,
      channels: 2,
      bitsPerSample: 16,
    },
    runCommand: async (command, args, stdin) => {
      commands.push([command, args, Buffer.byteLength(stdin ?? '')]);
      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
      };
    },
  });

  assert.equal(result.status, 'pass');
  assert.match(result.detail, /PCM Ogg\/Opus encode smoke test succeeded/u);
  assert.deepStrictEqual(commands, [
    ['ffmpeg.exe', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-f',
      's16le',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-i',
      'pipe:0',
      '-vn',
      '-acodec',
      'libopus',
      '-b:a',
      '128k',
      '-vbr',
      'on',
      '-frame_duration',
      '20',
      '-application',
      'audio',
      '-t',
      '1',
      '-f',
      'ogg',
      'pipe:1',
    ], 176400],
  ]);
});
