#!/usr/bin/env node

import { loadLocalEnvIfPresent } from './env.js';
import { startRuntime } from '../runtime/bootstrap.js';

async function main(): Promise<void> {
  loadLocalEnvIfPresent();
  await startRuntime();
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error && error.message.trim() !== ''
      ? error.message
      : 'Unknown error';
  console.error(`Failed to start runtime: ${message}`);
  process.exitCode = 1;
});
