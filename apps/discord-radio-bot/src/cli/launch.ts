#!/usr/bin/env node

import process from 'node:process';

import { loadLocalEnvIfPresent, resolveBotPackageRoot } from './env.js';
import { createLauncher } from '../launcher/launch-runtime.js';
import { resolvePearDesktopLaunchPlan } from '../launcher/resolve-pear-desktop.js';

async function main(): Promise<void> {
  loadLocalEnvIfPresent();
  const botPackageRoot = resolveBotPackageRoot();

  const launcher = createLauncher({
    env: process.env,
    pearLaunchPlan: resolvePearDesktopLaunchPlan(process.env, botPackageRoot),
  });

  const started = await launcher.start();
  await started.completion;
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error && error.message.trim() !== ''
      ? error.message
      : 'Unknown error';
  console.error(`Failed to launch Pear runtime: ${message}`);
  process.exitCode = 1;
});
