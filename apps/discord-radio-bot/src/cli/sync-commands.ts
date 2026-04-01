#!/usr/bin/env node

import { loadLocalEnvIfPresent } from './env.js';
import {
  loadDiscordSyncConfig,
  syncGuildCommands,
} from '../discord/sync.js';

async function main(): Promise<void> {
  loadLocalEnvIfPresent();
  const config = loadDiscordSyncConfig(process.env);
  await syncGuildCommands(config);
  console.log('Discord guild commands synced.');
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error && error.message.trim() !== ''
      ? error.message
      : 'Unknown error';
  console.error(`Failed to sync Discord guild commands: ${message}`);
  process.exitCode = 1;
});
