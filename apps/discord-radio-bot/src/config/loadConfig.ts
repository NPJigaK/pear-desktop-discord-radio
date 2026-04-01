import type { AppConfig, ConfigEnv } from './types.js';

type RequiredKey =
  | 'DISCORD_TOKEN'
  | 'DISCORD_APPLICATION_ID'
  | 'DISCORD_GUILD_ID'
  | 'DISCORD_CONTROLLER_USER_ID'
  | 'PEAR_CLIENT_ID';

function readTrimmed(env: ConfigEnv, key: string): string | undefined {
  const value = env[key];
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function readRequired(env: ConfigEnv, key: RequiredKey): string {
  const value = readTrimmed(env, key);
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function readOptional(env: ConfigEnv, key: string): string | undefined {
  return readTrimmed(env, key);
}

function readPort(env: ConfigEnv): number {
  const rawPort = readOptional(env, 'PEAR_PORT');
  if (rawPort === undefined) {
    return 26538;
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('PEAR_PORT must be a valid TCP port');
  }

  return port;
}

export function loadConfig(env: ConfigEnv): AppConfig {
  const pearHost = readOptional(env, 'PEAR_HOST') ?? '127.0.0.1';
  if (pearHost !== '127.0.0.1') {
    throw new Error('PEAR_HOST must be exactly 127.0.0.1');
  }

  return {
    discordToken: readRequired(env, 'DISCORD_TOKEN'),
    discordApplicationId: readRequired(env, 'DISCORD_APPLICATION_ID'),
    discordGuildId: readRequired(env, 'DISCORD_GUILD_ID'),
    discordControllerUserId: readRequired(env, 'DISCORD_CONTROLLER_USER_ID'),
    pearClientId: readRequired(env, 'PEAR_CLIENT_ID'),
    pearHost: '127.0.0.1',
    pearPort: readPort(env),
    ffmpegPath: readOptional(env, 'FFMPEG_PATH'),
    logLevel: readOptional(env, 'LOG_LEVEL'),
  };
}
