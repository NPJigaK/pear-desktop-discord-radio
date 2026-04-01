import { PassThrough, type Readable } from 'node:stream';

import {
  type AudioPlayer,
  createAudioPlayer,
  createAudioResource,
  type DiscordGatewayAdapterCreator,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  type VoiceConnection,
  VoiceConnectionStatus,
} from '@discordjs/voice';

import {
  createAudioExportSession,
  createPluginExportProvider,
  findConnectablePluginExportBootstrap,
  type FfmpegSource,
  spawnFfmpegRelay,
} from '../audio/index.js';
import type { RadioVoiceActions } from '../discord/types.js';
import type { RuntimeLogger } from '../logging/index.js';
import { createVoiceSession } from './session.js';

export interface CreateLiveVoiceSessionOptions {
  readonly ffmpegPath?: string | undefined;
  readonly ffmpegSource?: FfmpegSource | undefined;
  readonly logger: RuntimeLogger;
}

function spawnAudioRelay(options: {
  readonly inputStream: Readable;
  readonly pcm: {
    readonly sampleRate: number;
    readonly channels: number;
    readonly bitsPerSample: number;
  };
  readonly ffmpegPath?: string | undefined;
}) {
  const ffmpeg = spawnFfmpegRelay({
    ffmpegPath: options.ffmpegPath,
    pcm: options.pcm,
  });
  const stderr = new PassThrough();
  const exitListeners = new Set<
    (event: {
      process: 'ffmpeg';
      exitCode: number | null;
    }) => void
  >();
  const errorListeners = new Set<
    (event: {
      process: 'ffmpeg';
      error: Error;
    }) => void
  >();
  let settled = false;

  options.inputStream.pipe(ffmpeg.stdin);
  ffmpeg.stdin.on('error', () => {
    return undefined;
  });
  ffmpeg.stderr.pipe(stderr);

  const emitExit = (
    process: 'ffmpeg',
    exitCode: number | null,
  ) => {
    if (settled) {
      return;
    }

    settled = true;
    for (const listener of exitListeners) {
      listener({
        process,
        exitCode,
      });
    }
  };

  const emitError = (
    process: 'ffmpeg',
    error: Error,
  ) => {
    if (settled) {
      return;
    }

    settled = true;
    for (const listener of errorListeners) {
      listener({
        process,
        error,
      });
    }
  };

  ffmpeg.on('exit', (code) => {
    emitExit('ffmpeg', code);
  });
  ffmpeg.on('error', (error) => {
    emitError('ffmpeg', error);
  });

  return {
    stdout: ffmpeg.stdout,
    stderr,
    on(
      event: 'exit' | 'error',
      listener:
        | ((event: {
          process: 'ffmpeg';
          exitCode: number | null;
        }) => void)
        | ((event: {
          process: 'ffmpeg';
          error: Error;
        }) => void),
    ) {
      if (event === 'exit') {
        exitListeners.add(listener as (event: {
          process: 'ffmpeg';
          exitCode: number | null;
        }) => void);
      } else {
        errorListeners.add(listener as (event: {
          process: 'ffmpeg';
          error: Error;
        }) => void);
      }

      return this;
    },
    off(
      event: 'exit' | 'error',
      listener:
        | ((event: {
          process: 'ffmpeg';
          exitCode: number | null;
        }) => void)
        | ((event: {
          process: 'ffmpeg';
          error: Error;
        }) => void),
    ) {
      if (event === 'exit') {
        exitListeners.delete(listener as (event: {
          process: 'ffmpeg';
          exitCode: number | null;
        }) => void);
      } else {
        errorListeners.delete(listener as (event: {
          process: 'ffmpeg';
          error: Error;
        }) => void);
      }

      return this;
    },
    kill() {
      options.inputStream.unpipe(ffmpeg.stdin);
      ffmpeg.stdin.destroy();
      const ffmpegKilled = ffmpeg.kill();
      return ffmpegKilled;
    },
  };
}

export function createLiveVoiceSession(
  options: CreateLiveVoiceSessionOptions,
) {
  const wrapVoiceConnection = (connection: VoiceConnection) => {
    const disconnectListeners = new Map<
      () => void,
      (
        oldState: VoiceConnection['state'],
        newState: VoiceConnection['state'],
      ) => void
    >();

    return {
      rawConnection: connection,
      on(event: 'disconnect', listener: () => void) {
        if (event !== 'disconnect') {
          return this;
        }

        const wrappedListener = (
          _oldState: VoiceConnection['state'],
          newState: VoiceConnection['state'],
        ) => {
          if (newState.status === VoiceConnectionStatus.Disconnected) {
            listener();
          }
        };

        disconnectListeners.set(listener, wrappedListener);
        connection.on('stateChange', wrappedListener);
        return this;
      },
      off(event: 'disconnect', listener: () => void) {
        if (event !== 'disconnect') {
          return this;
        }

        const wrappedListener = disconnectListeners.get(listener);
        if (wrappedListener !== undefined) {
          connection.off('stateChange', wrappedListener);
          disconnectListeners.delete(listener);
        }

        return this;
      },
      subscribe(player: unknown) {
        return connection.subscribe(player as AudioPlayer) !== undefined;
      },
      destroy() {
        connection.destroy();
      },
    };
  };

  return createVoiceSession({
    ffmpegPath: options.ffmpegPath,
    ffmpegSource: options.ffmpegSource,
    async startAudioExport() {
      const bootstrap = await findConnectablePluginExportBootstrap();
      const session = createAudioExportSession({
        provider: createPluginExportProvider(bootstrap),
      });
      const running = await session.start();

      return {
        ready: bootstrap,
        running,
        diagnostics: {
          audioExportBootstrapPath: bootstrap.bootstrapPath,
          audioExportSessionId: bootstrap.sessionId,
          audioExportPipePath: bootstrap.pipePath,
          audioExportStreamState: bootstrap.streamState,
          audioExportDroppedFrameCount: bootstrap.droppedFrameCount,
        },
      };
    },
    joinVoiceChannel(input) {
      return wrapVoiceConnection(joinVoiceChannel({
        channelId: input.channelId,
        guildId: input.guildId,
        adapterCreator:
          input.adapterCreator as DiscordGatewayAdapterCreator,
        selfDeaf: input.selfDeaf,
      }));
    },
    async waitForVoiceReady(connection) {
      await entersState(
        (connection as ReturnType<typeof wrapVoiceConnection>).rawConnection,
        VoiceConnectionStatus.Ready,
        20_000,
      );
    },
    createAudioPlayer() {
      return createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Play,
        },
      });
    },
    createAudioResource(stream, createOptions) {
      return createAudioResource(stream, {
        inputType:
          createOptions.inputType === 'ogg/opus'
            ? StreamType.OggOpus
            : StreamType.Arbitrary,
      });
    },
    spawnRelay({ exportStream, pcm, ffmpegPath }) {
      if (exportStream === undefined || pcm === undefined) {
        throw new Error('Audio export stream is required before starting FFmpeg.');
      }

      return spawnAudioRelay({
        inputStream: exportStream,
        pcm,
        ffmpegPath,
      });
    },
    logger: options.logger,
  });
}

export function createVoiceActionsFactory(input: {
  readonly session: ReturnType<typeof createLiveVoiceSession>;
}): (context: {
  readonly guildId: string;
  readonly voiceAdapterCreator?: unknown;
}) => RadioVoiceActions {
  return (context) => ({
    async join(channel) {
      if (context.voiceAdapterCreator === undefined) {
        throw new Error('Discord voice adapter is unavailable for this guild.');
      }

      return input.session.join({
        guildId: context.guildId,
        voiceAdapterCreator: context.voiceAdapterCreator,
        channel,
      });
    },
    async leave() {
      return input.session.leave();
    },
  });
}
