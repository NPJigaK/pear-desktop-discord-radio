import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertRuntimePreflight,
  loadDoctorConfig,
  probePearWebSocketReachability,
  runDoctor,
} from '../../src/preflight/index.js';
import type { DoctorDependencies, DoctorReport } from '../../src/preflight/index.js';

const doctorConfig = {
  pearHost: '127.0.0.1',
  pearPort: 26538,
  pearClientId: 'pear-client-id',
};

type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;

const helperDiscoverableRemoved: HasKey<DoctorReport['checks'], 'helperDiscoverable'> = false;
const helperLoopbackReadyRemoved: HasKey<DoctorReport['checks'], 'helperLoopbackReady'> = false;
const discoverLoopbackHelperRemoved: HasKey<DoctorDependencies, 'discoverLoopbackHelper'> = false;
const probeLoopbackHelperRemoved: HasKey<DoctorDependencies, 'probeLoopbackHelper'> = false;

void helperDiscoverableRemoved;
void helperLoopbackReadyRemoved;
void discoverLoopbackHelperRemoved;
void probeLoopbackHelperRemoved;

function createPluginExportBootstrap() {
  return {
    version: 1 as const,
    kind: 'plugin' as const,
    transport: 'named-pipe' as const,
    sessionId: 'plugin-session-123',
    bootstrapPath:
      'C:\\temp\\pear-direct-audio-export\\plugin-session-123.json',
    bootstrapWrittenAt: '2026-03-31T00:00:00.000Z',
    pipePath: '\\\\.\\pipe\\pear-direct-audio',
    streamState: 'waiting-for-client' as const,
    droppedFrameCount: 0,
    pcm: {
      sampleRate: 48_000,
      channels: 2,
      bitsPerSample: 16,
    },
  };
}

function createPluginExportBootstrapCandidate(
  overrides: Partial<ReturnType<typeof createPluginExportBootstrap>> = {},
) {
  const mergedPcm =
    overrides.pcm === undefined
      ? createPluginExportBootstrap().pcm
      : {
        ...createPluginExportBootstrap().pcm,
        ...overrides.pcm,
      };

  return {
    ...createPluginExportBootstrap(),
    ...overrides,
    pcm: mergedPcm,
  };
}

test('runDoctor reports fullPass when export provider bootstrap and ffmpeg readiness succeed on supported Windows', async () => {
  const report = await runDoctor(doctorConfig, {
    platform: 'win32',
    osRelease: '10.0.22631',
    probePearAuth: async () => undefined,
    probePearWebSocket: async () => undefined,
    findConnectablePluginExportBootstrapCandidate: async () =>
      createPluginExportBootstrapCandidate(),
    discoverFfmpeg: async () => ({
      status: 'pass',
      detail: 'ffmpeg version 8.1',
      executablePath:
        'E:\\github\\pear-desktop-discord-radio\\.cache\\ffmpeg\\ffmpeg\\bin\\ffmpeg.exe',
      source: 'app-managed',
      attempts: [],
    }),
    probeFfmpegPcmEncodeReadiness: async () => ({
      status: 'pass',
      detail: 'PCM Ogg/Opus encode smoke test succeeded.',
    }),
  });

  assert.equal(report.checks.pearHostExact.status, 'pass');
  assert.equal(report.checks.pearAuthReachable.status, 'pass');
  assert.equal(report.checks.pearWebSocketReachable.status, 'pass');
  assert.equal(report.checks.windowsRequirementSatisfied?.status, 'pass');
  assert.equal(report.checks.exportProviderReady?.status, 'pass');
  assert.equal(
    report.checks.exportProviderReady?.bootstrapPath,
    'C:\\temp\\pear-direct-audio-export\\plugin-session-123.json',
  );
  assert.equal(
    report.checks.exportProviderReady?.pipePath,
    '\\\\.\\pipe\\pear-direct-audio',
  );
  assert.equal(report.checks.exportProviderReady?.streamState, 'waiting-for-client');
  assert.equal(report.checks.exportProviderReady?.droppedFrameCount, 0);
  assert.equal(report.checks.exportPcmContractReady?.status, 'pass');
  assert.equal(report.checks.exportPcmContractReady?.pcm?.sampleRate, 48_000);
  assert.equal(report.checks.exportPcmContractReady?.pcm?.channels, 2);
  assert.equal(report.checks.exportPcmContractReady?.pcm?.bitsPerSample, 16);
  assert.equal(report.checks.ffmpegDiscoverable.status, 'pass');
  assert.equal(report.checks.ffmpegDiscoverable.source, 'app-managed');
  assert.equal(
    report.checks.ffmpegDiscoverable.executablePath,
    'E:\\github\\pear-desktop-discord-radio\\.cache\\ffmpeg\\ffmpeg\\bin\\ffmpeg.exe',
  );
  assert.equal(report.checks.ffmpegEncodeReady?.status, 'pass');
  assert.equal(report.fullPass, true);
});

test('runDoctor probes ffmpeg with the discovered export-provider PCM contract', async () => {
  const ffmpegProbeCalls: Array<{
    executablePath: string;
    pcm: {
      sampleRate: number;
      channels: number;
      bitsPerSample: number;
    };
  }> = [];

  const report = await runDoctor(doctorConfig, {
    platform: 'win32',
    osRelease: '10.0.22631',
    probePearAuth: async () => undefined,
    probePearWebSocket: async () => undefined,
    findConnectablePluginExportBootstrapCandidate: async () =>
      createPluginExportBootstrapCandidate({
        pcm: {
          sampleRate: 44_100,
          channels: 2,
          bitsPerSample: 16,
        },
      }),
    discoverFfmpeg: async () => ({
      status: 'pass',
      detail: 'ffmpeg version 8.1',
      executablePath: 'C:\\ffmpeg\\bin\\ffmpeg.exe',
      source: 'env',
      attempts: [],
    }),
    probeFfmpegPcmEncodeReadiness: async (
      _config,
      executablePath,
      pcm,
    ) => {
      ffmpegProbeCalls.push({ executablePath, pcm });
      return {
        status: 'pass',
        detail: 'PCM Ogg/Opus encode smoke test succeeded.',
      };
    },
  });

  assert.equal(report.checks.exportPcmContractReady?.status, 'pass');
  assert.deepStrictEqual(ffmpegProbeCalls, [
    {
      executablePath: 'C:\\ffmpeg\\bin\\ffmpeg.exe',
      pcm: {
        sampleRate: 44_100,
        channels: 2,
        bitsPerSample: 16,
      },
    },
  ]);
});

test('runDoctor never reports fullPass on non-Windows even when export provider and ffmpeg checks pass', async () => {
  const report = await runDoctor(doctorConfig, {
    platform: 'linux',
    osRelease: '6.8.12',
    probePearAuth: async () => undefined,
    probePearWebSocket: async () => undefined,
    findConnectablePluginExportBootstrapCandidate: async () =>
      createPluginExportBootstrapCandidate(),
    discoverFfmpeg: async () => ({
      status: 'pass',
      detail: 'ffmpeg version 8.1',
      executablePath: 'ffmpeg',
      source: 'path',
      attempts: [],
    }),
    probeFfmpegPcmEncodeReadiness: async () => ({
      status: 'pass',
      detail: 'PCM Ogg/Opus encode smoke test succeeded.',
    }),
  });

  assert.equal(report.checks.pearHostExact.status, 'pass');
  assert.equal(report.checks.pearAuthReachable.status, 'pass');
  assert.equal(report.checks.pearWebSocketReachable.status, 'pass');
  assert.equal(report.checks.windowsRequirementSatisfied?.status, 'fail');
  assert.match(report.checks.windowsRequirementSatisfied?.detail ?? '', /Windows 11/u);
  assert.equal(report.checks.exportProviderReady?.status, 'pass');
  assert.equal(report.checks.exportPcmContractReady?.status, 'pass');
  assert.equal(report.checks.ffmpegDiscoverable.status, 'pass');
  assert.equal(report.checks.ffmpegEncodeReady?.status, 'pass');
  assert.equal(report.fullPass, false);
});

test('runDoctor fails the Windows runtime requirement on Windows 10 even when export provider checks pass', async () => {
  const report = await runDoctor(doctorConfig, {
    platform: 'win32',
    osRelease: '10.0.19045',
    probePearAuth: async () => undefined,
    probePearWebSocket: async () => undefined,
    findConnectablePluginExportBootstrapCandidate: async () =>
      createPluginExportBootstrapCandidate(),
    discoverFfmpeg: async () => ({
      status: 'pass',
      detail: 'ffmpeg version 8.1',
      executablePath: 'ffmpeg.exe',
      source: 'app-managed',
      attempts: [],
    }),
    probeFfmpegPcmEncodeReadiness: async () => ({
      status: 'pass',
      detail: 'PCM Ogg/Opus encode smoke test succeeded.',
    }),
  });

  assert.equal(report.checks.windowsRequirementSatisfied?.status, 'fail');
  assert.match(report.checks.windowsRequirementSatisfied?.detail ?? '', /Windows 11/u);
  assert.equal(report.checks.exportProviderReady?.status, 'pass');
  assert.equal(report.checks.exportPcmContractReady?.status, 'pass');
  assert.equal(report.checks.ffmpegEncodeReady?.status, 'pass');
  assert.equal(report.fullPass, false);
});

test('loadDoctorConfig allows non-Windows doctor runs without capture-specific config', () => {
  const config = loadDoctorConfig({
    PEAR_CLIENT_ID: 'pear-client-id',
    PEAR_HOST: '127.0.0.1',
    PEAR_PORT: '26538',
  });

  assert.deepStrictEqual(config, {
    pearHost: '127.0.0.1',
    pearPort: 26538,
    pearClientId: 'pear-client-id',
    ffmpegPath: undefined,
  });
});

test('loadDoctorConfig does not require Windows capture config on Windows', () => {
  const config = loadDoctorConfig({
    PEAR_CLIENT_ID: 'pear-client-id',
    PEAR_HOST: '127.0.0.1',
    PEAR_PORT: '26538',
  });

  assert.deepStrictEqual(config, {
    pearHost: '127.0.0.1',
    pearPort: 26538,
    pearClientId: 'pear-client-id',
    ffmpegPath: undefined,
  });
});

test('assertRuntimePreflight fails fast when no connectable export provider bootstrap is discoverable', async () => {
  await assert.rejects(
    async () =>
      assertRuntimePreflight(doctorConfig, {
        platform: 'win32',
        osRelease: '10.0.22631',
        probePearAuth: async () => undefined,
        probePearWebSocket: async () => undefined,
        findConnectablePluginExportBootstrapCandidate: async () => {
          throw new Error('No connectable plugin export bootstrap found.');
        },
        discoverFfmpeg: async () => ({
          status: 'pass',
          detail: 'ffmpeg version 8.1',
          executablePath: 'ffmpeg.exe',
          source: 'app-managed',
          attempts: [],
        }),
        probeFfmpegPcmEncodeReadiness: async () => {
          throw new Error('should not run when export provider bootstrap is unavailable');
        },
      }),
    /Runtime preflight failed: No connectable plugin export bootstrap found\./u,
  );
});

test('probePearWebSocketReachability closes a late-opening socket after timeout', async () => {
  let closeCalls = 0;
  let connectStarted = false;
  let releaseOpen: (() => void) | undefined;

  await assert.rejects(
    async () =>
      probePearWebSocketReachability(doctorConfig, {
        timeoutMs: 1,
        createPearClient: () => ({
          authenticate: async () => 'token',
        }),
        createWebSocketClient: () => ({
          connect: async () => {
            connectStarted = true;
            await new Promise<void>((resolve) => {
              releaseOpen = resolve;
            });

            return {
              close: () => undefined,
            } as WebSocket;
          },
          close: () => {
            closeCalls += 1;
          },
        }),
      }),
    /Timed out waiting for Pear websocket/,
  );

  assert.equal(connectStarted, true);
  assert.equal(closeCalls, 1);
  releaseOpen?.();
});

test('runDoctor still reports pass when app-managed ffmpeg is unavailable but FFMPEG_PATH works', async () => {
  const report = await runDoctor(doctorConfig, {
    platform: 'win32',
    osRelease: '10.0.22631',
    probePearAuth: async () => undefined,
    probePearWebSocket: async () => undefined,
    findConnectablePluginExportBootstrapCandidate: async () =>
      createPluginExportBootstrapCandidate(),
    discoverFfmpeg: async () => ({
      status: 'pass',
      detail: 'ffmpeg version 8.1',
      executablePath: 'C:\\ffmpeg\\bin\\ffmpeg.exe',
      source: 'env',
      attempts: [
        {
          source: 'app-managed',
          executablePath:
            'E:\\github\\pear-desktop-discord-radio\\.cache\\ffmpeg\\ffmpeg\\bin\\ffmpeg.exe',
          status: 'fail',
          detail: 'App-managed ffmpeg binary was not found.',
        },
        {
          source: 'env',
          executablePath: 'C:\\ffmpeg\\bin\\ffmpeg.exe',
          status: 'pass',
          detail: 'ffmpeg version 7.1',
        },
      ],
    }),
    probeFfmpegPcmEncodeReadiness: async () => ({
      status: 'pass',
      detail: 'PCM Ogg/Opus encode smoke test succeeded.',
    }),
  });

  assert.equal(report.checks.exportProviderReady?.status, 'pass');
  assert.equal(report.checks.exportPcmContractReady?.status, 'pass');
  assert.equal(report.checks.ffmpegDiscoverable.status, 'pass');
  assert.equal(report.checks.ffmpegDiscoverable.source, 'env');
  assert.equal(report.checks.ffmpegEncodeReady?.status, 'pass');
  assert.equal(report.fullPass, true);
});

test('runDoctor fails when the export provider PCM contract is incompatible with the ffmpeg relay path', async () => {
  const report = await runDoctor(doctorConfig, {
    platform: 'win32',
    osRelease: '10.0.22631',
    probePearAuth: async () => undefined,
    probePearWebSocket: async () => undefined,
    findConnectablePluginExportBootstrapCandidate: async () => createPluginExportBootstrapCandidate({
      pcm: {
        sampleRate: 48_000,
        channels: 2,
        bitsPerSample: 24,
      },
    }),
    discoverFfmpeg: async () => ({
      status: 'pass',
      detail: 'ffmpeg version 8.1',
      executablePath: 'C:\\ffmpeg\\bin\\ffmpeg.exe',
      source: 'env',
      attempts: [],
    }),
    probeFfmpegPcmEncodeReadiness: async () => {
      throw new Error('should not run when export PCM contract is incompatible');
    },
  });

  assert.equal(report.checks.exportProviderReady?.status, 'pass');
  assert.equal(report.checks.exportPcmContractReady?.status, 'fail');
  assert.match(
    report.checks.exportPcmContractReady?.detail ?? '',
    /Unsupported PCM bit depth/u,
  );
  assert.equal(report.checks.ffmpegDiscoverable.status, 'pass');
  assert.equal(report.checks.ffmpegEncodeReady?.status, 'fail');
  assert.match(
    report.checks.ffmpegEncodeReady?.detail ?? '',
    /export PCM contract is incomplete/u,
  );
  assert.equal(report.fullPass, false);
});

test('runDoctor reports bootstrap readiness separately from PCM-contract readiness on a production-shaped malformed bootstrap', async () => {
  const report = await runDoctor(doctorConfig, {
    platform: 'win32',
    osRelease: '10.0.22631',
    probePearAuth: async () => undefined,
    probePearWebSocket: async () => undefined,
    findConnectablePluginExportBootstrapCandidate: async () => createPluginExportBootstrapCandidate({
      pcm: {
        sampleRate: 48_000,
        channels: 2,
        bitsPerSample: 24,
      },
    }),
    discoverFfmpeg: async () => ({
      status: 'pass',
      detail: 'ffmpeg version 8.1',
      executablePath: 'C:\\ffmpeg\\bin\\ffmpeg.exe',
      source: 'env',
      attempts: [],
    }),
    probeFfmpegPcmEncodeReadiness: async () => {
      throw new Error('should not run when export PCM contract is incompatible');
    },
  });

  assert.equal(report.checks.exportProviderReady?.status, 'pass');
  assert.equal(
    report.checks.exportProviderReady?.bootstrapPath,
    'C:\\temp\\pear-direct-audio-export\\plugin-session-123.json',
  );
  assert.equal(report.checks.exportPcmContractReady?.status, 'fail');
  assert.match(
    report.checks.exportPcmContractReady?.detail ?? '',
    /Unsupported PCM bit depth/u,
  );
});

test('runDoctor fails when ffmpeg cannot encode the export provider PCM relay path', async () => {
  const report = await runDoctor(doctorConfig, {
    platform: 'win32',
    osRelease: '10.0.22631',
    probePearAuth: async () => undefined,
    probePearWebSocket: async () => undefined,
    findConnectablePluginExportBootstrapCandidate: async () =>
      createPluginExportBootstrapCandidate(),
    discoverFfmpeg: async () => ({
      status: 'pass',
      detail: 'ffmpeg version 8.1',
      executablePath: 'C:\\ffmpeg\\bin\\ffmpeg.exe',
      source: 'env',
      attempts: [],
    }),
    probeFfmpegPcmEncodeReadiness: async () => ({
      status: 'fail',
      detail: "PCM Ogg/Opus encode smoke test failed: Unknown encoder 'libopus'",
    }),
  });

  assert.equal(report.checks.exportProviderReady?.status, 'pass');
  assert.equal(report.checks.exportPcmContractReady?.status, 'pass');
  assert.equal(report.checks.ffmpegDiscoverable.status, 'pass');
  assert.equal(report.checks.ffmpegEncodeReady?.status, 'fail');
  assert.match(report.checks.ffmpegEncodeReady?.detail ?? '', /libopus/);
  assert.equal(report.fullPass, false);
});
