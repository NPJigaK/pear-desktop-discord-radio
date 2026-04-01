import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';

import {
  loadLocalEnvIfPresent,
  ROOT_ENV_FALLBACK_PATH_ENV,
  resolveBotPackageRoot,
  resolveBotPackageRootFromModuleUrl,
  resolveFallbackEnvPath,
  resolveLocalEnvPath,
} from '../../src/cli/env.js';

test('resolveBotPackageRoot points at the bot package directory in built output', () => {
  const packageRoot = path.resolve(process.cwd());
  const distModuleUrl = pathToFileURL(
    path.join(packageRoot, 'dist', 'src', 'cli', 'env.js'),
  ).href;

  assert.equal(
    resolveBotPackageRootFromModuleUrl(distModuleUrl),
    packageRoot,
  );

  assert.equal(
    resolveBotPackageRoot(),
    packageRoot,
  );
});

test('resolveBotPackageRoot points at the bot package directory in source output', () => {
  const packageRoot = resolveBotPackageRoot();
  const sourceModuleUrl = pathToFileURL(
    path.join(packageRoot, 'src', 'cli', 'env.ts'),
  ).href;

  assert.equal(
    resolveBotPackageRootFromModuleUrl(sourceModuleUrl),
    packageRoot,
  );
});

test('resolveLocalEnvPath defaults to the bot package root instead of process.cwd()', () => {
  const packageRoot = resolveBotPackageRoot();

  assert.equal(resolveLocalEnvPath(), path.join(packageRoot, '.env'));
});

test('resolveLocalEnvPath points at .env within the provided working directory', () => {
  const packageRoot = resolveBotPackageRoot();

  assert.equal(
    resolveLocalEnvPath(packageRoot),
    path.join(packageRoot, '.env'),
  );
});

test('loadLocalEnvIfPresent skips loading when .env is absent', () => {
  let loadCalls = 0;
  const packageRoot = resolveBotPackageRoot();

  const result = loadLocalEnvIfPresent({
    cwd: packageRoot,
    fileExists: () => false,
    loadEnvFile() {
      loadCalls += 1;
    },
  });

  assert.deepStrictEqual(result, {
    loaded: false,
    envPath: path.join(packageRoot, '.env'),
  });
  assert.equal(loadCalls, 0);
});

test('loadLocalEnvIfPresent loads .env through the Node built-in loader when present', () => {
  const calls: string[] = [];
  const packageRoot = resolveBotPackageRoot();

  const result = loadLocalEnvIfPresent({
    cwd: packageRoot,
    fileExists: () => true,
    loadEnvFile(envPath) {
      calls.push(envPath);
    },
  });

  assert.deepStrictEqual(result, {
    loaded: true,
    envPath: path.join(packageRoot, '.env'),
  });
  assert.deepStrictEqual(calls, [
    path.join(packageRoot, '.env'),
  ]);
});

test('resolveFallbackEnvPath returns the trimmed root fallback path when configured', () => {
  assert.equal(
    resolveFallbackEnvPath({
      [ROOT_ENV_FALLBACK_PATH_ENV]: '  C:\\radio\\.env  ',
    }),
    'C:\\radio\\.env',
  );
  assert.equal(
    resolveFallbackEnvPath({
      [ROOT_ENV_FALLBACK_PATH_ENV]: '   ',
    }),
    undefined,
  );
});

test('loadLocalEnvIfPresent applies the root fallback only for keys still missing after bot-local loading', () => {
  const packageRoot = resolveBotPackageRoot();
  const botEnvPath = path.join(packageRoot, '.env');
  const rootEnvPath = path.join(path.dirname(packageRoot), '.env');
  const env: NodeJS.ProcessEnv = {
    PEAR_PORT: 'shell-port',
    [ROOT_ENV_FALLBACK_PATH_ENV]: rootEnvPath,
  };
  const loadCalls: string[] = [];

  const result = loadLocalEnvIfPresent({
    cwd: packageRoot,
    env,
    fileExists(filePath) {
      return filePath === botEnvPath || filePath === rootEnvPath;
    },
    loadEnvFile(filePath) {
      loadCalls.push(filePath);
      env.DISCORD_TOKEN = 'bot-token';
      env.DISCORD_GUILD_ID = 'bot-guild';
    },
    readFile(filePath) {
      assert.equal(filePath, rootEnvPath);
      return [
        'DISCORD_TOKEN=root-token',
        'DISCORD_APPLICATION_ID=root-app',
        'PEAR_CLIENT_ID=root-client',
        'PEAR_PORT=root-port',
      ].join('\n');
    },
    parseEnvFile: parseEnv,
  });

  assert.deepStrictEqual(result, {
    loaded: true,
    envPath: botEnvPath,
  });
  assert.deepStrictEqual(loadCalls, [botEnvPath]);
  assert.equal(env.PEAR_PORT, 'shell-port');
  assert.equal(env.DISCORD_TOKEN, 'bot-token');
  assert.equal(env.DISCORD_GUILD_ID, 'bot-guild');
  assert.equal(env.DISCORD_APPLICATION_ID, 'root-app');
  assert.equal(env.PEAR_CLIENT_ID, 'root-client');
});

test('loadLocalEnvIfPresent can use the root fallback when the bot-local .env is absent', () => {
  const packageRoot = resolveBotPackageRoot();
  const botEnvPath = path.join(packageRoot, '.env');
  const rootEnvPath = path.join(path.dirname(packageRoot), '.env');
  const env: NodeJS.ProcessEnv = {};
  let loadCalls = 0;

  const result = loadLocalEnvIfPresent({
    cwd: packageRoot,
    env,
    fileExists(filePath) {
      return filePath === rootEnvPath;
    },
    loadEnvFile() {
      loadCalls += 1;
    },
    fallbackEnvPath: rootEnvPath,
    readFile(filePath) {
      assert.equal(filePath, rootEnvPath);
      return [
        'PEAR_CLIENT_ID=root-client',
        'DISCORD_APPLICATION_ID=root-app',
      ].join('\n');
    },
    parseEnvFile: parseEnv,
  });

  assert.deepStrictEqual(result, {
    loaded: false,
    envPath: botEnvPath,
  });
  assert.equal(loadCalls, 0);
  assert.equal(env.PEAR_CLIENT_ID, 'root-client');
  assert.equal(env.DISCORD_APPLICATION_ID, 'root-app');
});
