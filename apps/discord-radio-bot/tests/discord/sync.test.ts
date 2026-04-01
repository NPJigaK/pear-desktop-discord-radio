import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRadioCommandData } from '../../src/discord/commands.js';
import {
  loadDiscordSyncConfig,
  syncGuildCommands,
} from '../../src/discord/sync.js';

test('loadDiscordSyncConfig only requires the Discord command sync environment variables', () => {
  assert.deepStrictEqual(
    loadDiscordSyncConfig({
      DISCORD_TOKEN: ' discord-token ',
      DISCORD_APPLICATION_ID: ' application-id ',
      DISCORD_GUILD_ID: ' guild-id ',
    }),
    {
      token: 'discord-token',
      applicationId: 'application-id',
      guildId: 'guild-id',
    },
  );
});

test('syncGuildCommands uses the guild command route and exactly one radio command body', async () => {
  const calls: Array<{
    route: string;
    body: unknown;
  }> = [];
  let capturedToken = '';

  await syncGuildCommands(
    {
      token: 'discord-token',
      applicationId: 'application-id',
      guildId: 'guild-id',
    },
    {
      createRest(token: string) {
        capturedToken = token;
        return {
          async put(route: string, options: {
            readonly body: unknown;
          }) {
            calls.push({
              route,
              body: options.body,
            });
          },
        };
      },
      applicationGuildCommands(applicationId: string, guildId: string) {
        return `/applications/${applicationId}/guilds/${guildId}/commands`;
      },
    },
  );

  assert.equal(capturedToken, 'discord-token');
  assert.deepStrictEqual(calls, [
    {
      route: '/applications/application-id/guilds/guild-id/commands',
      body: [buildRadioCommandData()],
    },
  ]);
});
