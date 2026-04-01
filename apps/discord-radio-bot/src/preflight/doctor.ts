import { release as readOsRelease } from 'node:os';

import {
  discoverFfmpeg,
  findConnectablePluginExportBootstrapCandidate,
  probeFfmpegPcmEncodeReadiness,
} from '../audio/index.js';
import type {
  PluginExportBootstrapCandidate,
  PluginExportReadyResult,
} from '../audio/index.js';
import { PearClient, PearWebSocketClient } from '../pear/index.js';
import type {
  DoctorCheck,
  DoctorConfig,
  DoctorDependencies,
  DoctorReport,
} from './types.js';

const MIN_WINDOWS_11_BUILD = 22_000;

function toCheck(status: DoctorCheck['status'], detail: string): DoctorCheck {
  return { status, detail };
}

async function defaultProbePearAuth(config: DoctorConfig): Promise<void> {
  const client = new PearClient({
    host: '127.0.0.1',
    port: config.pearPort,
    clientId: config.pearClientId,
  });
  await client.authenticate();
}

type ReachabilityPearClient = Pick<PearClient, 'authenticate'>;
type ReachabilityWebSocketClient = Pick<PearWebSocketClient, 'connect' | 'close'>;

export interface ProbePearWebSocketReachabilityOptions {
  readonly timeoutMs?: number | undefined;
  readonly createPearClient?:
    | ((config: DoctorConfig) => ReachabilityPearClient)
    | undefined;
  readonly createWebSocketClient?:
    | ((config: DoctorConfig, pearClient: ReachabilityPearClient) => ReachabilityWebSocketClient)
    | undefined;
}

function createDefaultPearClient(config: DoctorConfig): ReachabilityPearClient {
  return new PearClient({
    host: '127.0.0.1',
    port: config.pearPort,
    clientId: config.pearClientId,
  });
}

function createDefaultWebSocketClient(
  config: DoctorConfig,
  pearClient: ReachabilityPearClient,
): ReachabilityWebSocketClient {
  return new PearWebSocketClient({
    host: '127.0.0.1',
    port: config.pearPort,
    getAccessToken: () => pearClient.authenticate(),
  });
}

export async function probePearWebSocketReachability(
  config: DoctorConfig,
  options: ProbePearWebSocketReachabilityOptions = {},
): Promise<void> {
  const pearClient = options.createPearClient?.(config) ?? createDefaultPearClient(config);
  const wsClient =
    options.createWebSocketClient?.(config, pearClient) ??
    createDefaultWebSocketClient(config, pearClient);
  const timeoutMs = options.timeoutMs ?? 2_000;

  let closed = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const closeClient = () => {
    if (closed) {
      return;
    }

    closed = true;
    wsClient.close();
  };

  try {
    await Promise.race([
      wsClient.connect(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          closeClient();
          reject(new Error('Timed out waiting for Pear websocket'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    closeClient();
  }
}

async function defaultProbePearWebSocket(config: DoctorConfig): Promise<void> {
  await probePearWebSocketReachability(config);
}

async function defaultDiscoverFfmpeg(config: DoctorConfig) {
  return discoverFfmpeg({
    ffmpegPath: config.ffmpegPath,
  });
}

async function defaultFindConnectablePluginExportBootstrapCandidate() {
  return findConnectablePluginExportBootstrapCandidate();
}

async function defaultProbeFfmpegPcmEncodeReadiness(
  config: DoctorConfig,
  executablePath: string,
  pcm: PluginExportReadyResult['pcm'],
) {
  void config;
  return probeFfmpegPcmEncodeReadiness({
    executablePath,
    pcm,
  });
}

function readWindowsBuildNumber(osReleaseValue: string): number | undefined {
  const parts = osReleaseValue.split('.');
  if (parts.length < 3) {
    return undefined;
  }

  const build = Number(parts[2]);
  if (!Number.isInteger(build) || build <= 0) {
    return undefined;
  }

  return build;
}

function buildWindowsRequirementCheck(
  platform: NodeJS.Platform,
  osReleaseValue: string,
): DoctorCheck {
  if (platform !== 'win32') {
    return toCheck('fail', 'v1.1 runtime requires native Windows 11.');
  }

  const build = readWindowsBuildNumber(osReleaseValue);
  if (build === undefined) {
    return toCheck(
      'fail',
      `Windows 11 or newer is required, but the Windows release could not be parsed from ${osReleaseValue}.`,
    );
  }

  if (build < MIN_WINDOWS_11_BUILD) {
    return toCheck(
      'fail',
      `Windows 11 or newer is required; detected Windows release ${osReleaseValue}.`,
    );
  }

  return toCheck('pass', `Windows 11 or newer runtime detected (${osReleaseValue}).`);
}

function normalizeExportPcmSnapshot(pcm: PluginExportBootstrapCandidate['pcm']) {
  return {
    sampleRate: Number.isInteger(pcm.sampleRate) ? pcm.sampleRate : undefined,
    channels: Number.isInteger(pcm.channels) ? pcm.channels : undefined,
    bitsPerSample: Number.isInteger(pcm.bitsPerSample) ? pcm.bitsPerSample : undefined,
  };
}

function buildExportPcmContractCheck(
  pcm: PluginExportBootstrapCandidate['pcm'],
): NonNullable<DoctorReport['checks']['exportPcmContractReady']> {
  const snapshot = normalizeExportPcmSnapshot(pcm);

  if (snapshot.sampleRate === undefined || snapshot.sampleRate <= 0) {
    return {
      status: 'fail',
      detail: 'Export provider PCM contract must declare a positive integer sample rate.',
      pcm: snapshot,
    };
  }

  if (snapshot.channels !== 2) {
    return {
      status: 'fail',
      detail: `FFmpeg relay requires stereo PCM from the export provider, but received ${String(snapshot.channels ?? 'unknown')} channel(s).`,
      pcm: snapshot,
    };
  }

  if (snapshot.bitsPerSample !== 16) {
    return {
      status: 'fail',
      detail: `Unsupported PCM bit depth for FFmpeg relay: ${String(snapshot.bitsPerSample ?? 'unknown')}.`,
      pcm: snapshot,
    };
  }

  return {
    status: 'pass',
    detail: `Export provider PCM contract is ready for FFmpeg relay (${snapshot.sampleRate} Hz, ${snapshot.channels} channels, ${snapshot.bitsPerSample} bits).`,
    pcm: snapshot,
  };
}

function toRelayPcm(
  check: DoctorReport['checks']['exportPcmContractReady'],
): PluginExportReadyResult['pcm'] | undefined {
  if (
    check?.status !== 'pass' ||
    check.pcm?.sampleRate === undefined ||
    check.pcm.channels === undefined ||
    check.pcm.bitsPerSample === undefined
  ) {
    return undefined;
  }

  return {
    sampleRate: check.pcm.sampleRate,
    channels: check.pcm.channels,
    bitsPerSample: check.pcm.bitsPerSample,
  };
}

function firstProblemDetail(report: DoctorReport): string {
  const orderedChecks = [
    report.checks.pearHostExact,
    report.checks.pearAuthReachable,
    report.checks.pearWebSocketReachable,
    report.checks.windowsRequirementSatisfied,
    report.checks.exportProviderReady,
    report.checks.exportPcmContractReady,
    report.checks.ffmpegDiscoverable,
    report.checks.ffmpegEncodeReady,
  ].filter((check): check is DoctorCheck => check !== undefined);

  const firstProblem = orderedChecks.find((check) => check.status !== 'pass');
  return firstProblem?.detail ?? 'Doctor report did not produce a Windows full pass.';
}

export async function runDoctor(
  config: DoctorConfig,
  dependencies: DoctorDependencies = {},
): Promise<DoctorReport> {
  const platform = dependencies.platform ?? process.platform;
  const osReleaseValue = dependencies.osRelease ?? readOsRelease();
  const probePearAuth = dependencies.probePearAuth ?? defaultProbePearAuth;
  const probePearWebSocket =
    dependencies.probePearWebSocket ?? defaultProbePearWebSocket;
  const findConnectablePluginExportBootstrapCandidateImpl =
    dependencies.findConnectablePluginExportBootstrapCandidate ??
    defaultFindConnectablePluginExportBootstrapCandidate;
  const discoverFfmpegImpl =
    dependencies.discoverFfmpeg ?? defaultDiscoverFfmpeg;
  const probeFfmpegPcmEncodeReadinessImpl =
    dependencies.probeFfmpegPcmEncodeReadiness ??
    defaultProbeFfmpegPcmEncodeReadiness;

  const pearHostExact =
    config.pearHost === '127.0.0.1'
      ? toCheck('pass', 'PEAR_HOST is exactly 127.0.0.1.')
      : toCheck('fail', 'PEAR_HOST must be exactly 127.0.0.1.');

  let pearAuthReachable: DoctorCheck;
  let pearWebSocketReachable: DoctorCheck;

  if (pearHostExact.status === 'fail') {
    pearAuthReachable = toCheck(
      'fail',
      'Pear auth check was skipped because PEAR_HOST is invalid.',
    );
    pearWebSocketReachable = toCheck(
      'fail',
      'Pear websocket check was skipped because PEAR_HOST is invalid.',
    );
  } else {
    try {
      await probePearAuth(config);
      pearAuthReachable = toCheck('pass', 'Pear auth endpoint responded.');
    } catch (error) {
      pearAuthReachable = toCheck(
        'fail',
        error instanceof Error ? error.message : 'Pear auth endpoint failed.',
      );
    }

    try {
      await probePearWebSocket(config);
      pearWebSocketReachable = toCheck(
        'pass',
        'Pear websocket endpoint accepted a connection.',
      );
    } catch (error) {
      pearWebSocketReachable = toCheck(
        'fail',
        error instanceof Error
          ? error.message
          : 'Pear websocket endpoint failed.',
      );
    }
  }

  const windowsRequirementSatisfied = buildWindowsRequirementCheck(
    platform,
    osReleaseValue,
  );

  let exportProviderReady: DoctorReport['checks']['exportProviderReady'];
  let exportPcmContractReady: DoctorReport['checks']['exportPcmContractReady'];

  try {
    const bootstrap = await findConnectablePluginExportBootstrapCandidateImpl();
    exportProviderReady = {
      status: 'pass',
      detail: 'Connectable plugin export bootstrap was discovered.',
      sessionId: bootstrap.sessionId,
      bootstrapPath: bootstrap.bootstrapPath,
      pipePath: bootstrap.pipePath,
      streamState: bootstrap.streamState,
      droppedFrameCount: bootstrap.droppedFrameCount,
    };
    exportPcmContractReady = buildExportPcmContractCheck(bootstrap.pcm);
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : 'Connectable plugin export bootstrap discovery failed.';
    exportProviderReady = {
      status: 'fail',
      detail,
    };
    exportPcmContractReady = {
      status: 'fail',
      detail: 'Export PCM contract check was skipped because the export provider bootstrap is unavailable.',
    };
  }

  const ffmpegProbe = await discoverFfmpegImpl(config);
  const ffmpegDiscoverable = {
    status: ffmpegProbe.status,
    detail: ffmpegProbe.detail,
    executablePath: ffmpegProbe.executablePath,
    source: ffmpegProbe.source,
    attempts: ffmpegProbe.attempts,
  } as const;

  let ffmpegEncodeReady: DoctorReport['checks']['ffmpegEncodeReady'];
  if (ffmpegProbe.status === 'fail') {
    ffmpegEncodeReady = {
      status: 'fail',
      detail: 'FFmpeg encode smoke test was skipped because ffmpeg is unavailable.',
    };
  } else if (exportPcmContractReady.status !== 'pass') {
    ffmpegEncodeReady = {
      status: 'fail',
      detail: 'FFmpeg encode smoke test was skipped because the export PCM contract is incomplete.',
    };
  } else {
    const relayPcm = toRelayPcm(exportPcmContractReady);
    if (relayPcm === undefined) {
      throw new Error('Doctor PCM contract narrowing failed unexpectedly.');
    }

    ffmpegEncodeReady = await probeFfmpegPcmEncodeReadinessImpl(
      config,
      ffmpegProbe.executablePath,
      relayPcm,
    );
  }

  const report: DoctorReport = {
    platform,
    checks: {
      pearHostExact,
      pearAuthReachable,
      pearWebSocketReachable,
      windowsRequirementSatisfied,
      exportProviderReady,
      exportPcmContractReady,
      ffmpegDiscoverable,
      ffmpegEncodeReady,
    },
    fullPass:
      pearHostExact.status === 'pass' &&
      pearAuthReachable.status === 'pass' &&
      pearWebSocketReachable.status === 'pass' &&
      windowsRequirementSatisfied.status === 'pass' &&
      exportProviderReady.status === 'pass' &&
      exportPcmContractReady.status === 'pass' &&
      ffmpegDiscoverable.status === 'pass' &&
      ffmpegEncodeReady.status === 'pass',
  };

  return report;
}

export async function assertRuntimePreflight(
  config: DoctorConfig,
  dependencies: DoctorDependencies = {},
): Promise<DoctorReport> {
  const report = await runDoctor(config, dependencies);
  if (!report.fullPass) {
    throw new Error(`Runtime preflight failed: ${firstProblemDetail(report)}`);
  }

  return report;
}
