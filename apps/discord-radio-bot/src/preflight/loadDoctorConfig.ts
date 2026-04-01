import type { ConfigEnv } from '../config/index.js';
import type { DoctorConfig } from './types.js';

function readTrimmed(env: ConfigEnv, key: string): string | undefined {
  const value = env[key];
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function readRequired(env: ConfigEnv, key: string): string {
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
  const rawPort = readTrimmed(env, 'PEAR_PORT');
  if (rawPort === undefined) {
    return 26538;
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('PEAR_PORT must be a valid TCP port');
  }

  return port;
}

export function loadDoctorConfig(
  env: ConfigEnv,
): DoctorConfig {
  return {
    pearHost: readTrimmed(env, 'PEAR_HOST') ?? '127.0.0.1',
    pearPort: readPort(env),
    pearClientId: readRequired(env, 'PEAR_CLIENT_ID'),
    ffmpegPath: readOptional(env, 'FFMPEG_PATH'),
  };
}
