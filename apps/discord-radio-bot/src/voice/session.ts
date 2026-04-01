import type { Readable } from 'node:stream';

import type {
  AudioExportProviderReadyResult,
  AudioPcmFormat,
  AudioExportEndedEvent,
  FfmpegSource,
  RunningAudioExport,
} from '../audio/index.js';
import { transitionRelayState, transitionVoiceState, type RelayState, type VoiceState } from '../state/index.js';
import type { RadioResolvedVoiceChannel } from '../discord/types.js';
import type { RuntimeLogger } from '../logging/index.js';

interface VoiceConnectionLike {
  on(event: 'disconnect', listener: () => void): this;
  off(event: 'disconnect', listener: () => void): this;
  subscribe(player: AudioPlayerLike): boolean;
  destroy(): void;
}

interface AudioPlayerLike {
  play(resource: unknown): void;
  stop(): void;
}

interface RelayExitEvent {
  readonly process: 'helper' | 'ffmpeg';
  readonly exitCode: number | null;
}

interface RelayErrorEvent {
  readonly process: 'helper' | 'ffmpeg';
  readonly error: Error;
}

export interface StartedAudioExport {
  readonly ready: AudioExportProviderReadyResult;
  readonly running: RunningAudioExport;
  readonly diagnostics?: Readonly<Record<string, unknown>> | undefined;
}

interface RelayProcessLike {
  readonly stdout: Readable;
  readonly stderr: Readable;
  on(event: 'exit', listener: (event: RelayExitEvent) => void): this;
  on(event: 'error', listener: (event: RelayErrorEvent) => void): this;
  off(event: 'exit', listener: (event: RelayExitEvent) => void): this;
  off(event: 'error', listener: (event: RelayErrorEvent) => void): this;
  kill(): boolean;
}

interface RecoveryTaskHandle {
  cancel(): void;
}

type RecoveryScheduler = (
  task: () => void | Promise<void>,
  delayMs?: number,
) => RecoveryTaskHandle;

export interface JoinVoiceSessionRequest {
  readonly guildId: string;
  readonly voiceAdapterCreator: unknown;
  readonly channel: RadioResolvedVoiceChannel;
}

export interface VoiceSessionStateSnapshot {
  readonly voice: VoiceState;
  readonly relay: RelayState;
}

export interface CreateVoiceSessionOptions {
  readonly ffmpegPath?: string | undefined;
  readonly ffmpegSource?: FfmpegSource | undefined;
  readonly startAudioExport?: (() => Promise<StartedAudioExport>) | undefined;
  readonly joinVoiceChannel: (input: {
    readonly channelId: string;
    readonly guildId: string;
    readonly adapterCreator: unknown;
    readonly selfDeaf: boolean;
  }) => VoiceConnectionLike;
  readonly waitForVoiceReady: (
    connection: VoiceConnectionLike,
  ) => Promise<void>;
  readonly createAudioPlayer: () => AudioPlayerLike;
  readonly createAudioResource: (
    stream: Readable,
    options: {
      readonly inputType: 'ogg/opus';
    },
  ) => unknown;
  readonly spawnRelay: (input: {
    readonly exportStream?: Readable | undefined;
    readonly pcm?: AudioPcmFormat | undefined;
    readonly ffmpegPath?: string | undefined;
  }) => RelayProcessLike;
  readonly scheduleRecovery?: RecoveryScheduler | undefined;
  readonly logger: RuntimeLogger;
}

function defaultScheduleRecovery(
  task: () => void | Promise<void>,
  delayMs = 0,
): RecoveryTaskHandle {
  const timeoutId = setTimeout(() => {
    void task();
  }, delayMs);

  return {
    cancel() {
      clearTimeout(timeoutId);
    },
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  return 'Unknown error';
}

function createRelayStderrTracker(stream: Readable): {
  getTail(): string | undefined;
  dispose(): void;
} {
  const lines: string[] = [];
  const handleData = (chunk: Buffer | string) => {
    for (const line of String(chunk).split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (trimmed === '') {
        continue;
      }

      lines.push(trimmed);
      if (lines.length > 12) {
        lines.shift();
      }
    }
  };

  stream.on('data', handleData);

  return {
    getTail() {
      if (lines.length === 0) {
        return undefined;
      }

      return lines.join('\n');
    },
    dispose() {
      stream.off('data', handleData);
    },
  };
}

function createStartupAudioPipelineError(input: {
  readonly kind: 'fatal' | 'ended';
  readonly detail: string;
}): Error {
  if (input.kind === 'fatal') {
    return new Error(
      `Audio export provider emitted a fatal error during startup: ${input.detail}`,
    );
  }

  return new Error(
    `Audio export provider ended during startup: ${input.detail}`,
  );
}

function isAudioPipelineStarting(relayState: RelayState): boolean {
  return relayState === 'starting' || relayState === 'restarting';
}

export function createVoiceSession(options: CreateVoiceSessionOptions): {
  join(request: JoinVoiceSessionRequest): Promise<string>;
  leave(): Promise<string>;
  getState(): VoiceSessionStateSnapshot;
} {
  const logger = options.logger.child({
    component: 'voice-session',
  });
  const player = options.createAudioPlayer();
  const scheduleRecovery = options.scheduleRecovery ?? defaultScheduleRecovery;

  let voiceState: VoiceState = 'idle';
  let relayState: RelayState = 'stopped';
  let currentConnection: VoiceConnectionLike | undefined;
  let currentRelay: RelayProcessLike | undefined;
  let currentAudioExport: RunningAudioExport | undefined;
  let currentAudioExportReady: AudioExportProviderReadyResult | undefined;
  let currentAudioExportDiagnostics:
    | Readonly<Record<string, unknown>>
    | undefined;
  let currentRequest: JoinVoiceSessionRequest | undefined;
  let removeDisconnectListener: (() => void) | undefined;
  let removeRelayExitListener: (() => void) | undefined;
  let removeRelayErrorListener: (() => void) | undefined;
  let removeAudioExportFatalListener: (() => void) | undefined;
  let removeAudioExportEndedListener: (() => void) | undefined;
  let disposeRelayStderrTracker: (() => void) | undefined;
  let readRelayStderrTail: (() => string | undefined) | undefined;
  let voiceRecoveryTask: RecoveryTaskHandle | undefined;
  let relayRecoveryTask: RecoveryTaskHandle | undefined;

  const buildRelayLogPayload = (
    extra: Readonly<Record<string, unknown>> = {},
  ): Readonly<Record<string, unknown>> => {
    const stderrTail = readRelayStderrTail?.();
    const payload: Record<string, unknown> = {
      ffmpegSource: options.ffmpegSource ?? 'path',
      ffmpegExecutablePath: options.ffmpegPath ?? 'ffmpeg',
      ...extra,
    };
    if (currentAudioExportReady !== undefined) {
      payload.audioExportKind = currentAudioExportReady.kind;
      payload.audioExportTransport = currentAudioExportReady.transport;
      payload.audioExportSampleRate = currentAudioExportReady.pcm.sampleRate;
    }
    if (currentAudioExportDiagnostics !== undefined) {
      Object.assign(payload, currentAudioExportDiagnostics);
    }
    if (stderrTail !== undefined) {
      payload.stderrTail = stderrTail;
    }
    return payload;
  };

  const connectVoiceChannel = async (request: JoinVoiceSessionRequest) => {
    const connection = options.joinVoiceChannel({
      channelId: request.channel.id,
      guildId: request.guildId,
      adapterCreator: request.voiceAdapterCreator,
      selfDeaf: false,
    });
    currentConnection = connection;
    attachDisconnectHandler(connection);
    connection.subscribe(player);
    await options.waitForVoiceReady(connection);
    return connection;
  };

  const setVoiceState = (next: VoiceState) => {
    voiceState = transitionVoiceState(voiceState, next);
  };

  const setRelayState = (next: RelayState) => {
    relayState = transitionRelayState(relayState, next);
  };

  const detachConnection = () => {
    removeDisconnectListener?.();
    removeDisconnectListener = undefined;
    currentConnection = undefined;
  };

  const detachRelay = () => {
    removeRelayExitListener?.();
    removeRelayExitListener = undefined;
    removeRelayErrorListener?.();
    removeRelayErrorListener = undefined;
    disposeRelayStderrTracker?.();
    disposeRelayStderrTracker = undefined;
    readRelayStderrTail = undefined;
    currentRelay = undefined;
  };

  const detachAudioExport = () => {
    removeAudioExportFatalListener?.();
    removeAudioExportFatalListener = undefined;
    removeAudioExportEndedListener?.();
    removeAudioExportEndedListener = undefined;
    currentAudioExport = undefined;
    currentAudioExportReady = undefined;
    currentAudioExportDiagnostics = undefined;
  };

  const stopAudioPipeline = async (input: {
    readonly relay?: RelayProcessLike | undefined;
    readonly audioExport?: RunningAudioExport | undefined;
  }) => {
    input.relay?.kill();
    try {
      await input.audioExport?.stop();
    } catch (error) {
      logger.warn('Audio export shutdown failed.', {
        ...buildRelayLogPayload(),
        error: toErrorMessage(error),
      });
    }
  };

  const attachDisconnectHandler = (connection: VoiceConnectionLike) => {
    const handleDisconnect = () => {
      if (connection !== currentConnection || voiceState !== 'connected') {
        return;
      }

      setVoiceState('reconnecting');
      voiceRecoveryTask?.cancel();
      voiceRecoveryTask = scheduleRecovery(async () => {
        if (voiceState !== 'reconnecting' || currentRequest === undefined) {
          return;
        }

        voiceRecoveryTask = undefined;
        const previousConnection = currentConnection;
        detachConnection();
        previousConnection?.destroy();

        try {
          const nextConnection = options.joinVoiceChannel({
            channelId: currentRequest.channel.id,
            guildId: currentRequest.guildId,
            adapterCreator: currentRequest.voiceAdapterCreator,
            selfDeaf: false,
          });
          currentConnection = nextConnection;
          attachDisconnectHandler(nextConnection);
          nextConnection.subscribe(player);
          await options.waitForVoiceReady(nextConnection);
          if (voiceState !== 'reconnecting' || currentConnection !== nextConnection) {
            return;
          }
          setVoiceState('connected');
          logger.info('Voice reconnect succeeded.');
        } catch (error) {
          logger.error('Voice reconnect failed.', {
            error: toErrorMessage(error),
          });
          await teardown({
            finalRelayState: relayState === 'failed' ? 'failed' : 'stopped',
          });
        }
      });
    };

    connection.on('disconnect', handleDisconnect);
    removeDisconnectListener = () => {
      connection.off('disconnect', handleDisconnect);
    };
  };

  const handleAudioPipelineFailure = (input: {
    readonly relay?: RelayProcessLike | undefined;
    readonly audioExport?: RunningAudioExport | undefined;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly message: string;
  }) => {
    if (
      (input.relay !== undefined && input.relay !== currentRelay) ||
      (input.audioExport !== undefined && input.audioExport !== currentAudioExport) ||
      relayState !== 'running'
    ) {
      return;
    }

    logger.error(input.message, buildRelayLogPayload({
      ...input.payload,
      ...(voiceState === 'reconnecting'
        ? { reason: 'relay-failed-during-voice-reconnect' }
        : {}),
    }));

    if (voiceState === 'reconnecting') {
      setVoiceState('idle');
      relayState = 'failed';
      void teardown({
        finalRelayState: 'failed',
      });
      return;
    }

    if (voiceState !== 'connected') {
      return;
    }

    const relayToRestart = currentRelay;
    const audioExportToRestart = currentAudioExport;
    const restartLogPayload = buildRelayLogPayload();
    detachRelay();
    detachAudioExport();
    setRelayState('restarting');
    logger.warn('Attempting audio relay restart.', restartLogPayload);
    relayRecoveryTask?.cancel();
    relayRecoveryTask = scheduleRecovery(async () => {
      if (relayState !== 'restarting') {
        return;
      }

      relayRecoveryTask = undefined;
      await stopAudioPipeline({
        relay: relayToRestart,
        audioExport: audioExportToRestart,
      });

      try {
        await startRelay('restarting');
        logger.info('Relay restart succeeded.', buildRelayLogPayload());
      } catch (error) {
        logger.error('Relay restart failed.', {
          ...buildRelayLogPayload(),
          error: toErrorMessage(error),
          reason: 'relay-restart-failed',
        });
        setRelayState('failed');
        await teardown({
          finalRelayState: 'failed',
        });
      }
    });
  };

  const attachAudioExportHandlers = (
    audioExport: StartedAudioExport,
    startupFailure: { error?: Error },
  ) => {
    const handleFatalError = (error: Error) => {
      if (
        isAudioPipelineStarting(relayState) &&
        startupFailure.error === undefined
      ) {
        startupFailure.error = createStartupAudioPipelineError({
          kind: 'fatal',
          detail: toErrorMessage(error),
        });
        return;
      }

      handleAudioPipelineFailure({
        audioExport: audioExport.running,
        payload: {
          audioExportError: toErrorMessage(error),
        },
        message: 'Audio export provider emitted a fatal error.',
      });
    };
    const handleEnded = (event: AudioExportEndedEvent) => {
      if (event.reason === 'stopped') {
        return;
      }

      if (
        isAudioPipelineStarting(relayState) &&
        startupFailure.error === undefined
      ) {
        startupFailure.error = createStartupAudioPipelineError({
          kind: 'ended',
          detail: event.reason,
        });
        return;
      }

      handleAudioPipelineFailure({
        audioExport: audioExport.running,
        payload: {
          audioExportEndedReason: event.reason,
        },
        message: 'Audio export provider ended.',
      });
    };

    audioExport.running.onFatalError(handleFatalError);
    audioExport.running.onEnded(handleEnded);
    removeAudioExportFatalListener = () => undefined;
    removeAudioExportEndedListener = () => undefined;
  };

  const attachRelayExitHandler = (relay: RelayProcessLike) => {
    const stderrTracker = createRelayStderrTracker(relay.stderr);
    disposeRelayStderrTracker = () => {
      stderrTracker.dispose();
    };
    readRelayStderrTail = () => stderrTracker.getTail();

    const handleExit = (event: RelayExitEvent) => {
      handleAudioPipelineFailure({
        relay,
        payload: {
          relayProcess: event.process,
          exitCode: event.exitCode,
        },
        message: 'Audio relay exited.',
      });
    };
    const handleError = (event: RelayErrorEvent) => {
      handleAudioPipelineFailure({
        relay,
        payload: {
          relayProcess: event.process,
          error: toErrorMessage(event.error),
        },
        message: 'Audio relay emitted an error.',
      });
    };

    relay.on('exit', handleExit);
    relay.on('error', handleError);
    removeRelayExitListener = () => {
      relay.off('exit', handleExit);
    };
    removeRelayErrorListener = () => {
      relay.off('error', handleError);
    };
  };

  const startRelay = async (mode: 'starting' | 'restarting') => {
    if (mode === 'starting') {
      setRelayState('starting');
    }

    let startedAudioExport: StartedAudioExport | undefined;
    const startupFailure: { error?: Error } = {};

    try {
      startedAudioExport = await options.startAudioExport?.();
      if (startedAudioExport !== undefined) {
        currentAudioExport = startedAudioExport.running;
        currentAudioExportReady = startedAudioExport.ready;
        currentAudioExportDiagnostics = startedAudioExport.diagnostics;
        attachAudioExportHandlers(startedAudioExport, startupFailure);
      }

      const relay = options.spawnRelay({
        exportStream: startedAudioExport?.running.stream,
        pcm: startedAudioExport?.ready.pcm,
        ffmpegPath: options.ffmpegPath,
      });
      currentRelay = relay;
      attachRelayExitHandler(relay);
      const resource = options.createAudioResource(relay.stdout, {
        inputType: 'ogg/opus',
      });
      player.play(resource);
      if (startupFailure.error !== undefined) {
        throw startupFailure.error;
      }
    } catch (error) {
      const relayToKill = currentRelay;
      const audioExportToStop = currentAudioExport ?? startedAudioExport?.running;
      detachRelay();
      detachAudioExport();
      await stopAudioPipeline({
        relay: relayToKill,
        audioExport: audioExportToStop,
      });
      throw error;
    }

    if (mode === 'starting') {
      setRelayState('running');
      logger.info('Audio relay started.', buildRelayLogPayload());
      return;
    }

    setRelayState('running');
    logger.info('Audio relay restarted.', buildRelayLogPayload());
  };

  const teardown = async (optionsForTeardown: {
    readonly finalRelayState: 'stopped' | 'failed';
  }) => {
    voiceRecoveryTask?.cancel();
    voiceRecoveryTask = undefined;
    relayRecoveryTask?.cancel();
    relayRecoveryTask = undefined;

    const relayToKill = currentRelay;
    const audioExportToStop = currentAudioExport;
    detachRelay();
    detachAudioExport();
    await stopAudioPipeline({
      relay: relayToKill,
      audioExport: audioExportToStop,
    });

    player.stop();

    if (currentConnection !== undefined) {
      const connectionToDestroy = currentConnection;
      detachConnection();
      connectionToDestroy.destroy();
    }

    currentRequest = undefined;

    if (voiceState !== 'idle') {
      setVoiceState('idle');
    }

    if (optionsForTeardown.finalRelayState === 'stopped') {
      if (relayState !== 'stopped') {
        setRelayState('stopped');
      }
      return;
    }

    relayState = 'failed';
  };

  return {
    async join(request) {
      if (voiceState === 'joining') {
        return `Already joining ${currentRequest?.channel.name ?? request.channel.name}.`;
      }

      if (voiceState !== 'idle' && currentRequest?.channel.id === request.channel.id) {
        return `Already connected to ${currentRequest.channel.name}.`;
      }

      const isMove = voiceState !== 'idle';
      if (isMove) {
        voiceRecoveryTask?.cancel();
        voiceRecoveryTask = undefined;

        const previousConnection = currentConnection;
        detachConnection();

        if (voiceState !== 'reconnecting') {
          setVoiceState('reconnecting');
        }

        previousConnection?.destroy();
        currentRequest = request;

        try {
          const nextConnection = await connectVoiceChannel(request);
          if (voiceState !== 'reconnecting' || currentConnection !== nextConnection) {
            throw new Error('Voice move was interrupted before the replacement connection became ready.');
          }
          setVoiceState('connected');
          logger.info('Voice session moved.', {
            channelId: request.channel.id,
          });
        } catch (error) {
          logger.error('Voice session move failed.', {
            ...buildRelayLogPayload(),
            error: toErrorMessage(error),
          });
          await teardown({
            finalRelayState: relayState === 'failed' ? 'failed' : 'stopped',
          });
          throw error;
        }

        return `Moved to ${request.channel.name} and kept the relay running.`;
      }

      currentRequest = request;
      setVoiceState('joining');

      try {
        await connectVoiceChannel(request);
        setVoiceState('connected');
        await startRelay('starting');
        logger.info('Voice session joined.', {
          channelId: request.channel.id,
        });
      } catch (error) {
        logger.error('Voice session join failed.', {
          ...buildRelayLogPayload(),
          error: toErrorMessage(error),
        });
        await teardown({
          finalRelayState: 'stopped',
        });
        throw error;
      }

      return `Joined ${request.channel.name} and started the relay.`;
    },
    async leave() {
      if (voiceState === 'idle' && relayState === 'stopped') {
        return 'Already idle.';
      }

      await teardown({
        finalRelayState: 'stopped',
      });
      logger.info('Voice session left.');
      return 'Left the voice channel and stopped the relay.';
    },
    getState() {
      return {
        voice: voiceState,
        relay: relayState,
      };
    },
  };
}
