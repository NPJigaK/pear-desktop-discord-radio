import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { SpawnOptions } from 'node:child_process';
import test from 'node:test';

import {
  createLauncher,
  type LauncherChildProcess,
  type LauncherRuntimeHandle,
} from '../../src/launcher/launch-runtime.js';
import type { PearDesktopLaunchPlan } from '../../src/launcher/resolve-pear-desktop.js';

function createPearLaunchPlan(): PearDesktopLaunchPlan {
  return {
    repoDir: 'E:\\github\\pear-desktop-discord-radio',
    command: ['pnpm', 'start:direct-audio-export'],
  };
}

class ControlledPearChild extends EventEmitter implements LauncherChildProcess {
  constructor(private readonly calls: string[]) {
    super();
  }

  kill(signal?: NodeJS.Signals | number) {
    this.calls.push(`kill:${signal ?? 'default'}`);
    return true;
  }
}

function createPearChild(calls: string[]): ControlledPearChild {
  return new ControlledPearChild(calls);
}

test('createLauncher starts Pear, waits for readiness, then starts runtime in-process', async () => {
  const calls: string[] = [];
  let runtimeStopped = false;

  const launcher = createLauncher({
    pearLaunchPlan: createPearLaunchPlan(),
    spawn(
      command: string,
      args: readonly string[],
      options: SpawnOptions,
    ) {
      calls.push(`spawn:${command} ${args.join(' ')}`);
      assert.equal(options.cwd, 'E:\\github\\pear-desktop-discord-radio');
      assert.equal(options.stdio, 'inherit');
      assert.equal(Object.hasOwn(options, 'shell'), false);
      return createPearChild(calls);
    },
    async waitForPearReady() {
      calls.push('wait-for-ready');
    },
    async startRuntime() {
      calls.push('start-runtime');
      return {
        async stop() {
          runtimeStopped = true;
          calls.push('stop-runtime');
        },
      } satisfies LauncherRuntimeHandle;
    },
  });

  const handle = await launcher.start();
  await handle.stop();
  await handle.completion;

  assert.equal(runtimeStopped, true);
  assert.deepStrictEqual(calls, [
    'spawn:pnpm start:direct-audio-export',
    'wait-for-ready',
    'start-runtime',
    'stop-runtime',
    'kill:SIGTERM',
  ]);
});

test('createLauncher ignores clean Pear exit after full startup completes', async () => {
  const calls: string[] = [];
  const child = createPearChild(calls);
  let runtimeStopped = false;

  const launcher = createLauncher({
    pearLaunchPlan: createPearLaunchPlan(),
    spawn(command: string, args: readonly string[]) {
      calls.push(`spawn:${command} ${args.join(' ')}`);
      return child;
    },
    async waitForPearReady() {
      calls.push('wait-for-ready');
    },
    async startRuntime() {
      calls.push('start-runtime');
      return {
        async stop() {
          runtimeStopped = true;
          calls.push('stop-runtime');
        },
      } satisfies LauncherRuntimeHandle;
    },
  });

  const handle = await launcher.start();
  child.emit('exit', 0, null);
  const completionState = await Promise.race([
    handle.completion.then(
      () => 'resolved' as const,
      (error) => `rejected:${error instanceof Error ? error.message : String(error)}` as const,
    ),
    new Promise<'pending'>((resolve) => {
      setTimeout(() => resolve('pending'), 20);
    }),
  ]);

  assert.equal(completionState, 'pending');
  await handle.stop();
  await handle.completion;

  assert.equal(runtimeStopped, true);
  assert.deepStrictEqual(calls, [
    'spawn:pnpm start:direct-audio-export',
    'wait-for-ready',
    'start-runtime',
    'stop-runtime',
    'kill:SIGTERM',
  ]);
});

test('createLauncher rejects clean Pear exit in the gap before runtime startup completes', async () => {
  const calls: string[] = [];
  const child = createPearChild(calls);
  let runtimeStopped = false;
  let resolveRuntimeStart: (() => void) | undefined;
  let resolveRuntimeStartEntered: (() => void) | undefined;
  const runtimeStartStarted = new Promise<void>((resolve) => {
    resolveRuntimeStartEntered = resolve;
  });
  const runtimeStartGate = new Promise<void>((resolve) => {
    resolveRuntimeStart = resolve;
  });

  const launcher = createLauncher({
    pearLaunchPlan: createPearLaunchPlan(),
    spawn(command: string, args: readonly string[]) {
      calls.push(`spawn:${command} ${args.join(' ')}`);
      return child;
    },
    async waitForPearReady() {
      calls.push('wait-for-ready');
    },
    async startRuntime() {
      calls.push('start-runtime');
      resolveRuntimeStartEntered?.();
      await runtimeStartGate;
      return {
        async stop() {
          runtimeStopped = true;
          calls.push('stop-runtime');
        },
      } satisfies LauncherRuntimeHandle;
    },
  });

  const startPromise = launcher.start();
  await runtimeStartStarted;
  child.emit('exit', 0, null);
  resolveRuntimeStart?.();

  await assert.rejects(
    startPromise,
    /Pear launcher exited before runtime startup completed \(code 0\)\./,
  );

  assert.equal(runtimeStopped, true);
  assert.deepStrictEqual(calls, [
    'spawn:pnpm start:direct-audio-export',
    'wait-for-ready',
    'start-runtime',
    'stop-runtime',
    'kill:SIGTERM',
  ]);
});

test('createLauncher rejects non-zero Pear exit after full startup completes', async () => {
  const calls: string[] = [];
  const child = createPearChild(calls);
  let runtimeStopped = false;

  const launcher = createLauncher({
    pearLaunchPlan: createPearLaunchPlan(),
    spawn(command: string, args: readonly string[]) {
      calls.push(`spawn:${command} ${args.join(' ')}`);
      return child;
    },
    async waitForPearReady() {
      calls.push('wait-for-ready');
    },
    async startRuntime() {
      calls.push('start-runtime');
      return {
        async stop() {
          runtimeStopped = true;
          calls.push('stop-runtime');
        },
      } satisfies LauncherRuntimeHandle;
    },
  });

  const handle = await launcher.start();
  child.emit('exit', 1, null);

  await assert.rejects(
    handle.completion,
    /Managed Pear process exited unexpectedly after startup \(code 1\)\./,
  );

  assert.equal(runtimeStopped, true);
  assert.deepStrictEqual(calls, [
    'spawn:pnpm start:direct-audio-export',
    'wait-for-ready',
    'start-runtime',
    'stop-runtime',
    'kill:SIGTERM',
  ]);
});

test('createLauncher rejects Pear signal exit after full startup completes', async () => {
  const calls: string[] = [];
  const child = createPearChild(calls);
  let runtimeStopped = false;

  const launcher = createLauncher({
    pearLaunchPlan: createPearLaunchPlan(),
    spawn(command: string, args: readonly string[]) {
      calls.push(`spawn:${command} ${args.join(' ')}`);
      return child;
    },
    async waitForPearReady() {
      calls.push('wait-for-ready');
    },
    async startRuntime() {
      calls.push('start-runtime');
      return {
        async stop() {
          runtimeStopped = true;
          calls.push('stop-runtime');
        },
      } satisfies LauncherRuntimeHandle;
    },
  });

  const handle = await launcher.start();
  child.emit('exit', null, 'SIGTERM');

  await assert.rejects(
    handle.completion,
    /Managed Pear process exited unexpectedly after startup \(signal SIGTERM\)\./,
  );

  assert.equal(runtimeStopped, true);
  assert.deepStrictEqual(calls, [
    'spawn:pnpm start:direct-audio-export',
    'wait-for-ready',
    'start-runtime',
    'stop-runtime',
    'kill:SIGTERM',
  ]);
});

test('createLauncher stops runtime when Pear emits an error after full startup completes', async () => {
  const calls: string[] = [];
  const child = createPearChild(calls);
  let runtimeStopped = false;

  const launcher = createLauncher({
    pearLaunchPlan: createPearLaunchPlan(),
    spawn(command: string, args: readonly string[]) {
      calls.push(`spawn:${command} ${args.join(' ')}`);
      return child;
    },
    async waitForPearReady() {
      calls.push('wait-for-ready');
    },
    async startRuntime() {
      calls.push('start-runtime');
      return {
        async stop() {
          runtimeStopped = true;
          calls.push('stop-runtime');
        },
      } satisfies LauncherRuntimeHandle;
    },
  });

  const handle = await launcher.start();
  child.emit('error', new Error('pear crashed'));
  await assert.rejects(
    handle.completion,
    /Managed Pear process failed after startup: pear crashed/,
  );

  assert.equal(runtimeStopped, true);
  assert.deepStrictEqual(calls, [
    'spawn:pnpm start:direct-audio-export',
    'wait-for-ready',
    'start-runtime',
    'stop-runtime',
    'kill:SIGTERM',
  ]);
});

test('createLauncher kills Pear when readiness fails before runtime start', async () => {
  const calls: string[] = [];

  const launcher = createLauncher({
    pearLaunchPlan: createPearLaunchPlan(),
    spawn(command: string, args: readonly string[]) {
      calls.push(`spawn:${command} ${args.join(' ')}`);
      return createPearChild(calls);
    },
    async waitForPearReady() {
      calls.push('wait-for-ready');
      throw new Error('Timed out waiting for Pear readiness');
    },
    async startRuntime() {
      calls.push('start-runtime');
      throw new Error('runtime should not start');
    },
  });

  await assert.rejects(launcher.start(), /Timed out waiting for Pear readiness/);
  assert.deepStrictEqual(calls, [
    'spawn:pnpm start:direct-audio-export',
    'wait-for-ready',
    'kill:SIGTERM',
  ]);
});
