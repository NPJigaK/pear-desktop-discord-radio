import { REST, Routes } from 'discord.js';

import { buildRadioCommandData } from './commands.js';

export interface DiscordSyncConfig {
  readonly token: string;
  readonly applicationId: string;
  readonly guildId: string;
}

export interface DiscordSyncEnv {
  readonly DISCORD_TOKEN?: string | undefined;
  readonly DISCORD_APPLICATION_ID?: string | undefined;
  readonly DISCORD_GUILD_ID?: string | undefined;
}

interface RestLike {
  put(route: string, options: {
    readonly body: unknown;
  }): Promise<unknown>;
}

interface SyncDependencies {
  createRest(token: string): RestLike;
  applicationGuildCommands(applicationId: string, guildId: string): string;
}

function readRequired(
  env: DiscordSyncEnv,
  key: keyof DiscordSyncEnv,
): string {
  const value = env[key];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value.trim();
}

function createRest(token: string): RestLike {
  const rest = new REST({ version: '10' }).setToken(token);

  return {
    put(route, options) {
      return rest.put(route as `/${string}`, {
        body: options.body as never,
      });
    },
  };
}

export function loadDiscordSyncConfig(env: DiscordSyncEnv): DiscordSyncConfig {
  return {
    token: readRequired(env, 'DISCORD_TOKEN'),
    applicationId: readRequired(env, 'DISCORD_APPLICATION_ID'),
    guildId: readRequired(env, 'DISCORD_GUILD_ID'),
  };
}

export async function syncGuildCommands(
  config: DiscordSyncConfig,
  dependencies: SyncDependencies = {
    createRest,
    applicationGuildCommands: Routes.applicationGuildCommands,
  },
): Promise<void> {
  const rest = dependencies.createRest(config.token);
  const body = [buildRadioCommandData()];
  const route = dependencies.applicationGuildCommands(
    config.applicationId,
    config.guildId,
  );

  await rest.put(route, { body });
}
