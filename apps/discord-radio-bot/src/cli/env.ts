import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const BOT_PACKAGE_NAME = 'pear-desktop-discord-radio';
export const ROOT_ENV_FALLBACK_PATH_ENV = 'RADIO_BOT_ROOT_ENV_FALLBACK';

export interface LoadLocalEnvOptions {
  readonly cwd?: string | undefined;
  readonly fileExists?: ((filePath: string) => boolean) | undefined;
  readonly loadEnvFile?: ((filePath: string) => void) | undefined;
  readonly fallbackEnvPath?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly readFile?: ((filePath: string) => string) | undefined;
  readonly parseEnvFile?: ((source: string) => Record<string, string | undefined>) | undefined;
}

export interface LoadLocalEnvResult {
  readonly loaded: boolean;
  readonly envPath: string;
}

interface PackageJsonLike {
  readonly name?: string | undefined;
}

export function resolveBotPackageRootFromModuleUrl(moduleUrl = import.meta.url): string {
  let currentDirectory = path.dirname(fileURLToPath(moduleUrl));

  while (true) {
    const packageJsonPath = path.join(currentDirectory, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJsonLike;
        if (packageJson.name === BOT_PACKAGE_NAME) {
          return currentDirectory;
        }
      } catch {
        // Continue walking upward if the file is not a usable package manifest.
      }
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      throw new Error(
        'Could not locate the bot package root from the current module URL.',
      );
    }

    currentDirectory = parentDirectory;
  }
}

export function resolveBotPackageRoot(): string {
  return resolveBotPackageRootFromModuleUrl();
}

export function resolveLocalEnvPath(cwd = resolveBotPackageRoot()): string {
  return path.join(cwd, '.env');
}

export function resolveFallbackEnvPath(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fallbackPath = env[ROOT_ENV_FALLBACK_PATH_ENV];
  if (typeof fallbackPath !== 'string') {
    return undefined;
  }

  const trimmedPath = fallbackPath.trim();
  return trimmedPath === '' ? undefined : trimmedPath;
}

export function loadLocalEnvIfPresent(
  options: LoadLocalEnvOptions = {},
): LoadLocalEnvResult {
  const envPath = resolveLocalEnvPath(options.cwd);
  const fileExists = options.fileExists ?? existsSync;
  const targetEnv = options.env ?? process.env;
  const fallbackEnvPath = options.fallbackEnvPath ?? resolveFallbackEnvPath(targetEnv);
  const loadEnvFile = options.loadEnvFile ?? process.loadEnvFile;
  const readFile = options.readFile ?? ((filePath: string) => readFileSync(filePath, 'utf8'));
  const parseEnvFile = options.parseEnvFile ?? parseEnv;

  let loaded = false;

  if (fileExists(envPath)) {
    loadEnvFile(envPath);
    loaded = true;
  }

  if (
    fallbackEnvPath !== undefined &&
    fallbackEnvPath !== envPath &&
    fileExists(fallbackEnvPath)
  ) {
    const fallbackValues = parseEnvFile(readFile(fallbackEnvPath));
    for (const [key, value] of Object.entries(fallbackValues)) {
      if (value !== undefined && targetEnv[key] === undefined) {
        targetEnv[key] = value;
      }
    }
  }

  return {
    loaded,
    envPath,
  };
}
