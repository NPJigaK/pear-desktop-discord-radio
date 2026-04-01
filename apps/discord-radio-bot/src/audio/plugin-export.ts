import { createConnection, type Socket } from 'node:net';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAudioExportProviderDescriptor } from './export-provider.js';
import type { AudioExportProviderReadyResult } from './export-provider.js';
import type {
  AudioExportEndedEvent,
  AudioExportProvider,
  RunningAudioExport,
} from './export-session.js';

export const PLUGIN_EXPORT_BOOTSTRAP_VERSION = 1 as const;
export const PLUGIN_EXPORT_BOOTSTRAP_DIRECTORY_NAME =
  'pear-direct-audio-export' as const;
export const DEFAULT_PLUGIN_EXPORT_MAX_BOOTSTRAP_AGE_MS = 30_000 as const;

export type PluginExportStreamState =
  | 'waiting-for-client'
  | 'connected'
  | 'dropping'
  | 'stopped'
  | 'error';

export interface PluginExportReadyResult extends AudioExportProviderReadyResult {
  readonly version: typeof PLUGIN_EXPORT_BOOTSTRAP_VERSION;
  readonly transport: 'named-pipe';
  readonly sessionId: string;
  readonly bootstrapPath: string;
  readonly bootstrapWrittenAt: string;
  readonly pipePath: string;
  readonly streamState: PluginExportStreamState;
  readonly droppedFrameCount: number;
}

export interface PluginExportBootstrapCandidate {
  readonly version: typeof PLUGIN_EXPORT_BOOTSTRAP_VERSION;
  readonly kind: 'plugin';
  readonly transport: 'named-pipe';
  readonly sessionId: string;
  readonly bootstrapPath: string;
  readonly bootstrapWrittenAt: string;
  readonly pipePath: string;
  readonly streamState: PluginExportStreamState;
  readonly droppedFrameCount: number;
  readonly pcm: {
    readonly sampleRate?: number | undefined;
    readonly channels?: number | undefined;
    readonly bitsPerSample?: number | undefined;
  };
}

interface CreatePluginExportProviderDependencies {
  readonly connectNamedPipe?: ((pipePath: string) => Socket) | undefined;
}

interface LoadPluginExportBootstrapInput {
  readonly bootstrapPath: string;
  readonly expectedSessionId?: string | undefined;
  readonly maxBootstrapAgeMs?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly readBootstrapFile?:
    | ((bootstrapPath: string) => Promise<string>)
    | undefined;
}

export interface FindConnectablePluginExportBootstrapInput {
  readonly bootstrapDirectoryPath?: string | undefined;
  readonly maxBootstrapAgeMs?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly listBootstrapPaths?:
    | ((bootstrapDirectoryPath: string) => Promise<readonly string[]>)
    | undefined;
  readonly loadBootstrap?:
    | ((
      input: LoadPluginExportBootstrapInput,
    ) => Promise<PluginExportReadyResult>)
    | undefined;
}

interface FindConnectablePluginExportBootstrapCandidateInput {
  readonly bootstrapDirectoryPath?: string | undefined;
  readonly maxBootstrapAgeMs?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly listBootstrapPaths?:
    | ((bootstrapDirectoryPath: string) => Promise<readonly string[]>)
    | undefined;
  readonly loadBootstrap?:
    | ((input: LoadPluginExportBootstrapInput) => Promise<PluginExportBootstrapCandidate>)
    | undefined;
}

function failPluginExportHandshake(reason: string): never {
  throw new Error(`Invalid plugin export handshake: ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function toOptionalInteger(value: unknown): number | undefined {
  return Number.isInteger(value) ? (value as number) : undefined;
}

function isPluginExportStreamState(
  value: unknown,
): value is PluginExportStreamState {
  return (
    value === 'waiting-for-client' ||
    value === 'connected' ||
    value === 'dropping' ||
    value === 'stopped' ||
    value === 'error'
  );
}

function validateBootstrapTimestamp(raw: unknown): string {
  if (!isNonEmptyString(raw) || Number.isNaN(Date.parse(raw))) {
    failPluginExportHandshake('expected valid bootstrapWrittenAt timestamp.');
  }

  return raw;
}

function validateStreamState(raw: unknown): PluginExportStreamState {
  if (!isPluginExportStreamState(raw)) {
    failPluginExportHandshake(
      'expected streamState to be "waiting-for-client", "connected", "dropping", "stopped", or "error".',
    );
  }

  return raw;
}

function validateLoadedBootstrap<TBootstrap extends {
  readonly bootstrapPath: string;
  readonly sessionId: string;
  readonly bootstrapWrittenAt: string;
  readonly streamState: PluginExportStreamState;
}>(
  handshake: TBootstrap,
  input: LoadPluginExportBootstrapInput,
): TBootstrap {
  if (
    normalizeBootstrapPathForComparison(handshake.bootstrapPath) !==
    normalizeBootstrapPathForComparison(input.bootstrapPath)
  ) {
    failPluginExportHandshake(
      'expected bootstrapPath to match the loaded bootstrap file path.',
    );
  }

  if (
    input.expectedSessionId !== undefined &&
    handshake.sessionId !== input.expectedSessionId
  ) {
    failPluginExportHandshake('expected bootstrap sessionId to match.');
  }

  if (input.maxBootstrapAgeMs !== undefined) {
    const now = input.now ?? Date.now;
    const writtenAt = Date.parse(handshake.bootstrapWrittenAt);
    if (now() - writtenAt > input.maxBootstrapAgeMs) {
      failPluginExportHandshake('bootstrap is stale.');
    }
  }

  if (handshake.streamState === 'stopped' || handshake.streamState === 'error') {
    failPluginExportHandshake(
      'expected bootstrap streamState to be connectable.',
    );
  }

  return handshake;
}

function normalizeBootstrapPathForComparison(bootstrapPath: string): string {
  const normalized = bootstrapPath.replaceAll('/', '\\');
  if (process.platform === 'win32') {
    return normalized.toLowerCase();
  }

  return normalized;
}

async function listPluginExportBootstrapPaths(
  bootstrapDirectoryPath: string,
): Promise<readonly string[]> {
  const entries = await readdir(bootstrapDirectoryPath, {
    withFileTypes: true,
  });

  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => join(bootstrapDirectoryPath, entry.name));
}

export function getPluginExportBootstrapDirectoryPath(
  tempDirectoryPath = tmpdir(),
): string {
  return join(tempDirectoryPath, PLUGIN_EXPORT_BOOTSTRAP_DIRECTORY_NAME);
}

async function stopNamedPipeConnection(socket: Socket): Promise<void> {
  if (socket.destroyed) {
    return;
  }

  await new Promise<void>((resolve) => {
    socket.once('close', () => resolve());
    socket.destroy();
  });
}

function createRunningNamedPipeExport(input: {
  readonly socket: Socket;
  readonly sessionId: string;
}): RunningAudioExport {
  const fatalListeners = new Set<(error: Error) => void>();
  const endedListeners = new Set<(event: AudioExportEndedEvent) => void>();
  let ended = false;
  let stopping = false;
  let sawRemoteEnd = false;

  const emitEnded = (event: AudioExportEndedEvent) => {
    if (ended) {
      return;
    }

    ended = true;
    for (const listener of endedListeners) {
      listener(event);
    }
  };

  input.socket.on('error', (error) => {
    for (const listener of fatalListeners) {
      listener(error);
    }
  });
  input.socket.on('end', () => {
    sawRemoteEnd = true;
    emitEnded({
      reason: 'producer-ended',
    });
  });
  input.socket.on('close', () => {
    if (stopping || ended) {
      return;
    }

    emitEnded({
      reason: sawRemoteEnd ? 'producer-ended' : 'pipe-closed',
    });
  });

  return {
    stream: input.socket,
    async stop() {
      stopping = true;
      emitEnded({
        reason: 'stopped',
      });
      await stopNamedPipeConnection(input.socket);
    },
    onFatalError(listener) {
      fatalListeners.add(listener);
    },
    onEnded(listener) {
      endedListeners.add(listener);
    },
  };
}

async function connectPluginNamedPipe(
  pipePath: string,
  sessionId: string,
  connectNamedPipe: (pipePath: string) => Socket,
): Promise<RunningAudioExport> {
  return await new Promise<RunningAudioExport>((resolve, reject) => {
    const socket = connectNamedPipe(pipePath);

    const handleConnect = () => {
      socket.off('error', handleInitialError);
      resolve(
        createRunningNamedPipeExport({
          socket,
          sessionId,
        }),
      );
    };

    const handleInitialError = (error: Error) => {
      socket.off('connect', handleConnect);
      reject(error);
    };

    socket.once('connect', handleConnect);
    socket.once('error', handleInitialError);
  });
}

export function parsePluginExportBootstrapCandidate(
  raw: string,
): PluginExportBootstrapCandidate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    failPluginExportHandshake('expected valid JSON.');
  }

  if (!isRecord(parsed)) {
    failPluginExportHandshake('expected object.');
  }

  if (parsed.version !== PLUGIN_EXPORT_BOOTSTRAP_VERSION) {
    failPluginExportHandshake(`expected version ${PLUGIN_EXPORT_BOOTSTRAP_VERSION}.`);
  }

  if (parsed.kind !== 'plugin') {
    failPluginExportHandshake('expected kind "plugin".');
  }

  if (parsed.transport !== 'named-pipe') {
    failPluginExportHandshake('expected transport "named-pipe".');
  }

  if (!isNonEmptyString(parsed.sessionId)) {
    failPluginExportHandshake('expected non-empty sessionId.');
  }

  if (!isNonEmptyString(parsed.bootstrapPath)) {
    failPluginExportHandshake('expected non-empty bootstrapPath.');
  }

  const bootstrapWrittenAt = validateBootstrapTimestamp(parsed.bootstrapWrittenAt);

  if (!isNonEmptyString(parsed.pipePath)) {
    failPluginExportHandshake('expected non-empty pipePath.');
  }

  const streamState = validateStreamState(parsed.streamState);

  if (!isNonNegativeInteger(parsed.droppedFrameCount)) {
    failPluginExportHandshake('expected non-negative integer droppedFrameCount.');
  }

  return {
    version: parsed.version,
    kind: 'plugin',
    transport: 'named-pipe',
    sessionId: parsed.sessionId,
    bootstrapPath: parsed.bootstrapPath,
    bootstrapWrittenAt,
    pipePath: parsed.pipePath,
    streamState,
    droppedFrameCount: parsed.droppedFrameCount,
    pcm: {
      sampleRate: isRecord(parsed.pcm) ? toOptionalInteger(parsed.pcm.sampleRate) : undefined,
      channels: isRecord(parsed.pcm) ? toOptionalInteger(parsed.pcm.channels) : undefined,
      bitsPerSample:
        isRecord(parsed.pcm) ? toOptionalInteger(parsed.pcm.bitsPerSample) : undefined,
    },
  };
}

export function parsePluginExportHandshake(
  raw: string,
): PluginExportReadyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    failPluginExportHandshake('expected valid JSON.');
  }

  if (!isRecord(parsed)) {
    failPluginExportHandshake('expected object.');
  }

  if (!isRecord(parsed.pcm)) {
    failPluginExportHandshake('expected pcm object.');
  }

  const candidate = parsePluginExportBootstrapCandidate(raw);

  if (!isPositiveInteger(candidate.pcm.sampleRate)) {
    failPluginExportHandshake('expected positive integer pcm.sampleRate.');
  }

  if (candidate.pcm.channels !== 2) {
    failPluginExportHandshake('expected pcm.channels 2.');
  }

  if (candidate.pcm.bitsPerSample !== 16) {
    failPluginExportHandshake('expected pcm.bitsPerSample 16.');
  }

  const descriptor = createAudioExportProviderDescriptor({
    kind: candidate.kind,
    transport: candidate.transport,
    sampleRate: candidate.pcm.sampleRate,
    channels: candidate.pcm.channels,
    bitsPerSample: candidate.pcm.bitsPerSample,
  });

  return {
    ...descriptor,
    transport: 'named-pipe',
    version: candidate.version,
    sessionId: candidate.sessionId,
    bootstrapPath: candidate.bootstrapPath,
    bootstrapWrittenAt: candidate.bootstrapWrittenAt,
    pipePath: candidate.pipePath,
    streamState: candidate.streamState,
    droppedFrameCount: candidate.droppedFrameCount,
  };
}

export async function loadPluginExportBootstrap(
  input: LoadPluginExportBootstrapInput,
): Promise<PluginExportReadyResult> {
  const readBootstrapFile = input.readBootstrapFile ?? readFile;
  const raw = await readBootstrapFile(input.bootstrapPath);
  return validateLoadedBootstrap(
    parsePluginExportHandshake(raw.toString()),
    input,
  );
}

export async function loadPluginExportBootstrapCandidate(
  input: LoadPluginExportBootstrapInput,
): Promise<PluginExportBootstrapCandidate> {
  const readBootstrapFile = input.readBootstrapFile ?? readFile;
  const raw = await readBootstrapFile(input.bootstrapPath);
  return validateLoadedBootstrap(
    parsePluginExportBootstrapCandidate(raw.toString()),
    input,
  );
}

interface FindConnectablePluginExportBootstrapInternalInput<TBootstrap extends {
  readonly bootstrapPath: string;
  readonly bootstrapWrittenAt: string;
  readonly streamState: PluginExportStreamState;
}> {
  readonly bootstrapDirectoryPath?: string | undefined;
  readonly maxBootstrapAgeMs?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly listBootstrapPaths?:
    | ((bootstrapDirectoryPath: string) => Promise<readonly string[]>)
    | undefined;
  readonly loadBootstrap?:
    | ((input: LoadPluginExportBootstrapInput) => Promise<TBootstrap>)
    | undefined;
}

async function findConnectablePluginExportBootstrapInternal<TBootstrap extends {
  readonly bootstrapPath: string;
  readonly bootstrapWrittenAt: string;
  readonly streamState: PluginExportStreamState;
}>(
  input: FindConnectablePluginExportBootstrapInternalInput<TBootstrap>,
  defaults: {
    readonly loadBootstrap: (input: LoadPluginExportBootstrapInput) => Promise<TBootstrap>;
  },
): Promise<TBootstrap> {
  const bootstrapDirectoryPath =
    input.bootstrapDirectoryPath ?? getPluginExportBootstrapDirectoryPath();
  const listBootstrapPaths =
    input.listBootstrapPaths ?? listPluginExportBootstrapPaths;
  const loadBootstrap = input.loadBootstrap ?? defaults.loadBootstrap;
  let bootstrapPaths: readonly string[];

  try {
    bootstrapPaths = await listBootstrapPaths(bootstrapDirectoryPath);
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      throw new Error('No connectable plugin export bootstrap found.', {
        cause: error,
      });
    }

    throw error;
  }

  const validBootstraps: TBootstrap[] = [];

  for (const bootstrapPath of bootstrapPaths) {
    try {
      const bootstrap = await loadBootstrap({
        bootstrapPath,
        maxBootstrapAgeMs:
          input.maxBootstrapAgeMs ??
          DEFAULT_PLUGIN_EXPORT_MAX_BOOTSTRAP_AGE_MS,
        now: input.now,
      });

      if (bootstrap.streamState !== 'waiting-for-client') {
        continue;
      }

      validBootstraps.push(bootstrap);
    } catch {
      continue;
    }
  }

  if (validBootstraps.length === 0) {
    throw new Error('No connectable plugin export bootstrap found.');
  }

  validBootstraps.sort((left, right) => {
    const timestampDelta =
      Date.parse(right.bootstrapWrittenAt) - Date.parse(left.bootstrapWrittenAt);
    if (timestampDelta !== 0) {
      return timestampDelta;
    }

    return right.bootstrapPath.localeCompare(left.bootstrapPath);
  });

  const freshestBootstrap = validBootstraps[0];
  if (freshestBootstrap === undefined) {
    throw new Error('No connectable plugin export bootstrap found.');
  }

  return freshestBootstrap;
}

export async function findConnectablePluginExportBootstrap(
  input: FindConnectablePluginExportBootstrapInput = {},
): Promise<PluginExportReadyResult> {
  return findConnectablePluginExportBootstrapInternal(input, {
    loadBootstrap: loadPluginExportBootstrap,
  });
}

export async function findConnectablePluginExportBootstrapCandidate(
  input: FindConnectablePluginExportBootstrapCandidateInput = {},
): Promise<PluginExportBootstrapCandidate> {
  return findConnectablePluginExportBootstrapInternal(input, {
    loadBootstrap: loadPluginExportBootstrapCandidate,
  });
}

export function createPluginExportProvider(
  handshake: PluginExportReadyResult,
  dependencies: CreatePluginExportProviderDependencies = {},
): AudioExportProvider {
  const connectNamedPipe = dependencies.connectNamedPipe ?? createConnection;

  return {
    async start() {
      return await connectPluginNamedPipe(
        handshake.pipePath,
        handshake.sessionId,
        connectNamedPipe,
      );
    },
  };
}

export function createPluginExportProviderFromHandshake(
  raw: string,
  dependencies: CreatePluginExportProviderDependencies = {},
): AudioExportProvider {
  return createPluginExportProvider(
    parsePluginExportHandshake(raw),
    dependencies,
  );
}
