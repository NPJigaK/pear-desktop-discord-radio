import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { resolvePearDesktopLaunchPlan } from '../../src/launcher/resolve-pear-desktop.js';

test('resolvePearDesktopLaunchPlan uses the repository root by default', () => {
  const projectRoot = path.resolve(process.cwd());
  const result = resolvePearDesktopLaunchPlan(
    {},
    projectRoot,
  );

  assert.equal(
    result.repoDir,
    path.resolve(projectRoot, '..', '..'),
  );
  assert.deepStrictEqual(result.command, ['pnpm', 'start:direct-audio-export']);
});

test('resolvePearDesktopLaunchPlan respects PEAR_DESKTOP_DIR', () => {
  const result = resolvePearDesktopLaunchPlan(
    {
      PEAR_DESKTOP_DIR: 'D:\\tools\\pear-desktop-direct-audio-export',
    },
    path.resolve(process.cwd()),
  );

  assert.equal(result.repoDir, 'D:\\tools\\pear-desktop-direct-audio-export');
});

test('resolvePearDesktopLaunchPlan trims whitespace-padded PEAR_DESKTOP_DIR', () => {
  const result = resolvePearDesktopLaunchPlan(
    {
      PEAR_DESKTOP_DIR: '  D:\\tools\\pear-desktop-direct-audio-export  ',
    },
    path.resolve(process.cwd()),
  );

  assert.equal(result.repoDir, 'D:\\tools\\pear-desktop-direct-audio-export');
});
