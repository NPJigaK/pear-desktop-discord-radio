import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '../../src/config/index.js';

const baseEnv = {
  DISCORD_TOKEN: 'discord-token',
  DISCORD_APPLICATION_ID: 'application-id',
  DISCORD_GUILD_ID: 'guild-id',
  DISCORD_CONTROLLER_USER_ID: 'controller-user-id',
  PEAR_CLIENT_ID: 'pear-client-id',
};

test('loadConfig no longer requires FFMPEG_DSHOW_AUDIO_DEVICE', () => {
  const config = loadConfig(baseEnv);

  assert.deepStrictEqual(config, {
    discordToken: 'discord-token',
    discordApplicationId: 'application-id',
    discordGuildId: 'guild-id',
    discordControllerUserId: 'controller-user-id',
    pearClientId: 'pear-client-id',
    pearHost: '127.0.0.1',
    pearPort: 26538,
    ffmpegPath: undefined,
    logLevel: undefined,
  });
});

test('loadConfig trims whitespace from accepted values', () => {
  const config = loadConfig({
    DISCORD_TOKEN: '  discord-token  ',
    DISCORD_APPLICATION_ID: '\tapplication-id\n',
    DISCORD_GUILD_ID: ' guild-id ',
    DISCORD_CONTROLLER_USER_ID: ' controller-user-id ',
    PEAR_CLIENT_ID: ' pear-client-id ',
    PEAR_HOST: ' 127.0.0.1 ',
    PEAR_PORT: ' 26539 ',
    FFMPEG_PATH: '  C:\\ffmpeg\\bin\\ffmpeg.exe  ',
    LOG_LEVEL: ' debug ',
  });

  assert.deepStrictEqual(config, {
    discordToken: 'discord-token',
    discordApplicationId: 'application-id',
    discordGuildId: 'guild-id',
    discordControllerUserId: 'controller-user-id',
    pearClientId: 'pear-client-id',
    pearHost: '127.0.0.1',
    pearPort: 26539,
    ffmpegPath: 'C:\\ffmpeg\\bin\\ffmpeg.exe',
    logLevel: 'debug',
  });
});

test('loadConfig rejects a non-127.0.0.1 PEAR_HOST', () => {
  assert.throws(() => {
    loadConfig({
      ...baseEnv,
      PEAR_HOST: 'localhost',
    });
  }, /PEAR_HOST must be exactly 127\.0\.0\.1/);
});

test('loadConfig rejects missing required environment variables', () => {
  assert.throws(() => {
    loadConfig({
      ...baseEnv,
      DISCORD_TOKEN: undefined,
    });
  }, /Missing required environment variable: DISCORD_TOKEN/);
});

test('loadConfig rejects invalid PEAR_PORT values', () => {
  for (const pearPort of ['abc', '0', '70000']) {
    assert.throws(() => {
      loadConfig({
        ...baseEnv,
        PEAR_PORT: pearPort,
      });
    }, /PEAR_PORT must be a valid TCP port/);
  }
});
