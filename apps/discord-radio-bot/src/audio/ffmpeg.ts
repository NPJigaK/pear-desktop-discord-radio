import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildFfmpegRelaySmokeTestArguments } from './relay.js';
import type { AudioPcmFormat } from './export-provider.js';

export type DiagnosticStatus = 'pass' | 'fail' | 'unsupported';

export type FfmpegSource = 'app-managed' | 'env' | 'path';

export interface CommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error | undefined;
}

export type RunCommand = (
  command: string,
  args: readonly string[],
  stdin?: string | Uint8Array | undefined,
) => Promise<CommandResult>;

export interface AppManagedFfmpegManifest {
  readonly provider: string;
  readonly version: string;
  readonly releaseTag: string;
  readonly variant: string;
  readonly assetName: string;
  readonly assetUrl: string;
  readonly checksumUrl: string;
  readonly sha256: string;
  readonly relativeExecutablePath: string;
  readonly license: string;
}

export interface DiscoverFfmpegOptions {
  readonly ffmpegPath?: string | undefined;
  readonly appManagedExecutablePath?: string | undefined;
  readonly fileExists?: ((executablePath: string) => boolean) | undefined;
  readonly runCommand?: RunCommand | undefined;
}

export interface FfmpegDiscoveryAttempt {
  readonly source: FfmpegSource;
  readonly executablePath: string;
  readonly status: 'pass' | 'fail';
  readonly detail: string;
}

export interface FfmpegDiscoveryResult {
  readonly status: 'pass' | 'fail';
  readonly detail: string;
  readonly executablePath: string;
  readonly source: FfmpegSource;
  readonly attempts: readonly FfmpegDiscoveryAttempt[];
}

export interface ProbeFfmpegPcmEncodeReadinessOptions {
  readonly executablePath: string;
  readonly pcm: AudioPcmFormat;
  readonly runCommand?: RunCommand | undefined;
}

export interface FfmpegPcmEncodeReadiness {
  readonly status: DiagnosticStatus;
  readonly detail: string;
}

export function createRunCommand(
  spawnImpl: typeof spawn = spawn,
): RunCommand {
  return (command, args, stdin) =>
    new Promise((resolve) => {
      const child = spawnImpl(command, [...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      let error: Error | undefined;

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdout += String(chunk);
      });

      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += String(chunk);
      });

      child.on('error', (spawnError) => {
        error = spawnError;
      });

      child.stdin.on('error', (stdinError: NodeJS.ErrnoException) => {
        if (stdinError.code !== 'EPIPE' && error === undefined) {
          error = stdinError;
        }
      });

      child.stdin.end(stdin);

      child.on('close', (exitCode) => {
        resolve({
          exitCode,
          stdout,
          stderr,
          error,
        });
      });
    });
}

export const runCommand = createRunCommand();

function readVersionLine(output: string): string | undefined {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line !== '');
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  return 'Unknown error';
}

function readLastNonEmptyLine(output: string): string | undefined {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return lines.at(-1);
}

function describeProbeFailure(probe: CommandResult): string {
  return (
    probe.error?.message ??
    readLastNonEmptyLine(`${probe.stderr}\n${probe.stdout}`) ??
    `ffmpeg exited with code ${String(probe.exitCode)}`
  );
}

function buildSilentPcmSample(
  pcm: AudioPcmFormat,
  durationSeconds: number,
): Buffer {
  return Buffer.alloc(
    pcm.sampleRate * pcm.channels * (pcm.bitsPerSample / 8) * durationSeconds,
  );
}

function readAppManagedManifest(projectRoot: string): AppManagedFfmpegManifest {
  const manifestPath = path.join(projectRoot, 'config', 'ffmpeg-managed.json');
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as AppManagedFfmpegManifest;
}

function findProjectRoot(startDirectory: string): string {
  let currentDirectory = path.resolve(startDirectory);

  while (true) {
    if (existsSync(path.join(currentDirectory, 'package.json'))) {
      return currentDirectory;
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      throw new Error('Could not locate the project root for app-managed FFmpeg discovery.');
    }

    currentDirectory = parentDirectory;
  }
}

export function getProjectRoot(): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  return findProjectRoot(moduleDirectory);
}

export function loadAppManagedFfmpegManifest(
  projectRoot = getProjectRoot(),
): AppManagedFfmpegManifest {
  return readAppManagedManifest(projectRoot);
}

export function getAppManagedFfmpegExecutablePath(
  projectRoot = getProjectRoot(),
): string {
  const manifest = loadAppManagedFfmpegManifest(projectRoot);
  return path.join(
    projectRoot,
    '.cache',
    'ffmpeg',
    ...manifest.relativeExecutablePath.split(/[\\/]/u),
  );
}

function buildFfmpegCandidates(
  options: DiscoverFfmpegOptions,
  attempts: FfmpegDiscoveryAttempt[],
): Array<{
  source: FfmpegSource;
  executablePath: string;
}> {
  const candidates: Array<{
    source: FfmpegSource;
    executablePath: string;
  }> = [];

  if (options.appManagedExecutablePath !== undefined) {
    candidates.push({
      source: 'app-managed',
      executablePath: options.appManagedExecutablePath,
    });
  } else {
    try {
      candidates.push({
        source: 'app-managed',
        executablePath: getAppManagedFfmpegExecutablePath(),
      });
    } catch (error) {
      attempts.push({
        source: 'app-managed',
        executablePath: '<app-managed>',
        status: 'fail',
        detail: `App-managed ffmpeg metadata could not be loaded: ${toErrorMessage(error)}`,
      });
    }
  }

  if (options.ffmpegPath !== undefined) {
    candidates.push({
      source: 'env',
      executablePath: options.ffmpegPath,
    });
  }

  candidates.push({
    source: 'path',
    executablePath: 'ffmpeg',
  });

  const seenPaths = new Set<string>();
  return candidates.filter((candidate) => {
    if (seenPaths.has(candidate.executablePath)) {
      return false;
    }

    seenPaths.add(candidate.executablePath);
    return true;
  });
}

function missingBinaryDetail(source: FfmpegSource): string {
  switch (source) {
    case 'app-managed':
      return 'App-managed ffmpeg binary was not found. Run `pnpm bootstrap:ffmpeg` to install it.';
    case 'env':
      return 'Configured FFMPEG_PATH binary was not found.';
    case 'path':
      return 'ffmpeg was not found on PATH.';
  }
}

function buildNoUsableFfmpegDetail(
  attempts: readonly FfmpegDiscoveryAttempt[],
): string {
  const lastAttemptDetail = attempts.at(-1)?.detail;
  return [
    'No usable ffmpeg executable was discovered.',
    'Run `pnpm bootstrap:ffmpeg` to install the app-managed binary, or configure FFMPEG_PATH / PATH with a working ffmpeg.',
    lastAttemptDetail === undefined ? undefined : `Last probe detail: ${lastAttemptDetail}`,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' ');
}

export async function discoverFfmpeg(
  options: DiscoverFfmpegOptions = {},
): Promise<FfmpegDiscoveryResult> {
  const commandRunner = options.runCommand ?? runCommand;
  const fileExists = options.fileExists ?? existsSync;
  const attempts: FfmpegDiscoveryAttempt[] = [];
  const candidates = buildFfmpegCandidates(options, attempts);

  for (const candidate of candidates) {
    if (candidate.source !== 'path' && !fileExists(candidate.executablePath)) {
      attempts.push({
        source: candidate.source,
        executablePath: candidate.executablePath,
        status: 'fail',
        detail: missingBinaryDetail(candidate.source),
      });
      continue;
    }

    const probe = await commandRunner(candidate.executablePath, ['-version']);
    const output = `${probe.stdout}\n${probe.stderr}`;
    const versionLine = readVersionLine(output);

    if (probe.error !== undefined || probe.exitCode !== 0) {
      attempts.push({
        source: candidate.source,
        executablePath: candidate.executablePath,
        status: 'fail',
        detail: `ffmpeg probe failed: ${describeProbeFailure(probe)}`,
      });
      continue;
    }

    const detail = versionLine ?? 'ffmpeg responded to -version.';
    attempts.push({
      source: candidate.source,
      executablePath: candidate.executablePath,
      status: 'pass',
      detail,
    });
    return {
      status: 'pass',
      detail,
      executablePath: candidate.executablePath,
      source: candidate.source,
      attempts,
    };
  }

  const finalAttempt = attempts.at(-1);
  return {
    status: 'fail',
    detail: buildNoUsableFfmpegDetail(attempts),
    executablePath: finalAttempt?.executablePath ?? 'ffmpeg',
    source: finalAttempt?.source ?? 'path',
    attempts,
  };
}

export async function probeFfmpegPcmEncodeReadiness(
  options: ProbeFfmpegPcmEncodeReadinessOptions,
): Promise<FfmpegPcmEncodeReadiness> {
  const commandRunner = options.runCommand ?? runCommand;
  const probe = await commandRunner(
    options.executablePath,
    buildFfmpegRelaySmokeTestArguments(options.pcm),
    buildSilentPcmSample(options.pcm, 1),
  );

  if (probe.error !== undefined || probe.exitCode !== 0) {
    return {
      status: 'fail',
      detail: `PCM Ogg/Opus encode smoke test failed: ${describeProbeFailure(probe)}`,
    };
  }

  return {
    status: 'pass',
    detail: 'PCM Ogg/Opus encode smoke test succeeded.',
  };
}
