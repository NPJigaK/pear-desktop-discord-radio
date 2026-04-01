import { loadConfig, type AppConfig, type ConfigEnv } from '../config/index.js';
import { createDiscordRuntime } from '../discord/runtime.js';
import { createLogger, type RuntimeLogger } from '../logging/index.js';
import { createPearRuntimeStateCoordinator } from '../pear/runtime-state.js';
import { assertRuntimePreflight, type DoctorReport } from '../preflight/index.js';
import type { RadioNowPlayingProvider } from '../discord/types.js';
import { PearClient, PearWebSocketClient } from '../pear/index.js';
import { createLiveVoiceSession, createVoiceActionsFactory } from '../voice/index.js';

export interface RuntimePearState extends RadioNowPlayingProvider {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface RuntimeDiscordService {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface RuntimeSignalSource {
  on(event: 'SIGINT' | 'SIGTERM', handler: () => void): unknown;
  off(event: 'SIGINT' | 'SIGTERM', handler: () => void): unknown;
}

export interface StartRuntimeDependencies {
  readonly env?: ConfigEnv | undefined;
  readonly signalSource?: RuntimeSignalSource | undefined;
  readonly loadConfig?:
    | ((env: ConfigEnv) => AppConfig)
    | undefined;
  readonly createLogger?:
    | ((level?: string | undefined) => RuntimeLogger)
    | undefined;
  readonly assertRuntimePreflight?:
    | ((config: AppConfig) => Promise<DoctorReport | void>)
    | undefined;
  readonly createLiveVoiceSession?:
    | ((input: {
      readonly ffmpegPath?: string | undefined;
      readonly ffmpegSource?: 'app-managed' | 'env' | 'path' | undefined;
      readonly logger: RuntimeLogger;
    }) => ReturnType<typeof createLiveVoiceSession>)
    | undefined;
  readonly createPearRuntimeState?:
    | ((input: {
      readonly config: AppConfig;
      readonly logger: RuntimeLogger;
    }) => Promise<RuntimePearState> | RuntimePearState)
    | undefined;
  readonly createDiscordRuntime?:
    | ((input: {
      readonly config: AppConfig;
      readonly logger: RuntimeLogger;
      readonly pearRuntimeState: RuntimePearState;
    }) => Promise<RuntimeDiscordService> | RuntimeDiscordService)
    | undefined;
  readonly syncCommands?: (() => Promise<void> | void) | undefined;
}

export interface StartedRuntime {
  stop(): Promise<void>;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  return 'Unknown error';
}

export async function startRuntime(
  dependencies: StartRuntimeDependencies = {},
): Promise<StartedRuntime> {
  const env = dependencies.env ?? process.env;
  const readConfig = dependencies.loadConfig ?? loadConfig;
  const loggerFactory = dependencies.createLogger ?? createLogger;
  const preflight = dependencies.assertRuntimePreflight ?? assertRuntimePreflight;
  const config = readConfig(env);
  const logger = loggerFactory(config.logLevel).child({
    service: 'runtime',
  });
  const createLiveVoiceSessionImpl =
    dependencies.createLiveVoiceSession ?? createLiveVoiceSession;
  const pearClient = new PearClient({
    host: config.pearHost,
    port: config.pearPort,
    clientId: config.pearClientId,
  });
  const pearLogger = logger.child({ component: 'pear' });
  const discordLogger = logger.child({ component: 'discord' });
  const voiceLogger = logger.child({ component: 'voice' });

  const preflightReport = await preflight(config);
  const ffmpegExecutablePath =
    preflightReport?.checks.ffmpegDiscoverable.executablePath ??
    config.ffmpegPath;
  const ffmpegSource = preflightReport?.checks.ffmpegDiscoverable.source;

  logger.info('Audio export provider selected for runtime.', {
    kind: 'plugin',
    transport: 'named-pipe',
  });

  if (ffmpegSource !== undefined && ffmpegExecutablePath !== undefined) {
    logger.info('FFmpeg selected for runtime.', {
      source: ffmpegSource,
      executablePath: ffmpegExecutablePath,
    });

    if (ffmpegSource !== 'app-managed') {
      logger.warn('Runtime is using a fallback FFmpeg source.', {
        source: ffmpegSource,
        executablePath: ffmpegExecutablePath,
      });
    }
  }

  const pearRuntimeState =
    (await dependencies.createPearRuntimeState?.({
      config,
      logger: pearLogger,
    })) ??
    createPearRuntimeStateCoordinator({
      pearClient,
      pearWebSocketClient: new PearWebSocketClient({
        host: config.pearHost,
        port: config.pearPort,
        getAccessToken: async () => pearClient.authenticate(),
      }),
      logger: pearLogger,
    });
  await pearRuntimeState.start();

  let discordRuntime: RuntimeDiscordService | undefined;
  try {
    const voiceSession = createLiveVoiceSessionImpl({
      ffmpegPath: ffmpegExecutablePath,
      ffmpegSource,
      logger: voiceLogger,
    });
    const createVoiceActions = createVoiceActionsFactory({
      session: voiceSession,
    });

    discordRuntime =
      (await dependencies.createDiscordRuntime?.({
        config,
        logger: discordLogger,
        pearRuntimeState,
      })) ??
      createDiscordRuntime({
        token: config.discordToken,
        guildId: config.discordGuildId,
        controllerUserId: config.discordControllerUserId,
        pear: pearClient,
        nowPlaying: pearRuntimeState,
        createVoiceActions(input) {
          return createVoiceActions({
            guildId: input.guildId,
            voiceAdapterCreator: input.voiceAdapterCreator,
          });
        },
        logger: discordLogger,
      });
    await discordRuntime.start();
  } catch (error) {
    try {
      await pearRuntimeState.stop();
    } catch (cleanupError) {
      logger.error('Pear runtime cleanup failed during startup rollback.', {
        error: toErrorMessage(cleanupError),
        cause: toErrorMessage(error),
      });
    }
    throw error;
  }

  logger.info('Runtime started.');

  const signalSource = dependencies.signalSource ?? process;
  let stoppingPromise: Promise<void> | undefined;

  const stop = async (): Promise<void> => {
    if (stoppingPromise !== undefined) {
      return stoppingPromise;
    }

    stoppingPromise = (async () => {
      signalSource.off('SIGINT', handleSignal);
      signalSource.off('SIGTERM', handleSignal);
      try {
        await discordRuntime?.stop();
      } catch (error) {
        logger.error('Discord runtime stop failed.', {
          error: toErrorMessage(error),
        });
      }
      try {
        await pearRuntimeState.stop();
      } catch (error) {
        logger.error('Pear runtime stop failed.', {
          error: toErrorMessage(error),
        });
      }
      logger.info('Runtime stopped.');
    })();

    return stoppingPromise;
  };

  const handleSignal = () => {
    logger.info('Runtime shutdown requested.');
    void stop();
  };

  signalSource.on('SIGINT', handleSignal);
  signalSource.on('SIGTERM', handleSignal);

  return {
    stop,
  };
}
