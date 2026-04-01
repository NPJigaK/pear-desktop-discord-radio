import { spawn } from 'node:child_process';

import type { AudioPcmFormat } from './export-provider.js';

export interface SpawnFfmpegRelayOptions {
  readonly ffmpegPath?: string | undefined;
  readonly pcm?: AudioPcmFormat | undefined;
}

interface BuildFfmpegRelayArgumentOptions {
  readonly logLevel: 'warning' | 'error';
  readonly outputTarget: string;
  readonly durationSeconds?: number | undefined;
  readonly pcm: AudioPcmFormat;
}

function getPcmInputFormat(bitsPerSample: number): string {
  if (bitsPerSample === 16) {
    return 's16le';
  }

  throw new Error(`Unsupported PCM bit depth for FFmpeg relay: ${bitsPerSample}`);
}

function buildRelayArgumentList(
  options: BuildFfmpegRelayArgumentOptions,
): string[] {
  const argumentsList = [
    '-hide_banner',
    '-loglevel',
    options.logLevel,
    '-nostdin',
    '-f',
    getPcmInputFormat(options.pcm.bitsPerSample),
    '-ar',
    String(options.pcm.sampleRate),
    '-ac',
    String(options.pcm.channels),
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
  ];

  if (options.durationSeconds !== undefined) {
    argumentsList.push('-t', String(options.durationSeconds));
  }

  argumentsList.push('-f', 'ogg', options.outputTarget);
  return argumentsList;
}

export function buildFfmpegRelayArguments(): string[] {
  return buildRelayArgumentList({
    logLevel: 'warning',
    outputTarget: 'pipe:1',
    pcm: {
      sampleRate: 48_000,
      channels: 2,
      bitsPerSample: 16,
    },
  });
}

export function buildFfmpegRelaySmokeTestArguments(
  pcm: AudioPcmFormat,
): string[] {
  return buildRelayArgumentList({
    logLevel: 'error',
    durationSeconds: 1,
    outputTarget: 'pipe:1',
    pcm,
  });
}

export function spawnFfmpegRelay(
  options: SpawnFfmpegRelayOptions,
) {
  return spawn(
    options.ffmpegPath ?? 'ffmpeg',
    buildRelayArgumentList({
      logLevel: 'warning',
      outputTarget: 'pipe:1',
      pcm: options.pcm ?? {
        sampleRate: 48_000,
        channels: 2,
        bitsPerSample: 16,
      },
    }),
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
}
