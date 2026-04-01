import { spawn as spawnChildProcess, type SpawnOptions } from 'node:child_process';
import process from 'node:process';

import { loadConfig, type ConfigEnv } from '../config/index.js';
import { assertRuntimePreflight } from '../preflight/index.js';
import {
  startRuntime as startRuntimeBootstrap,
  type RuntimeSignalSource,
} from '../runtime/bootstrap.js';
import type { PearDesktopLaunchPlan } from './resolve-pear-desktop.js';

export interface LauncherRuntimeHandle {
  stop(): Promise<void>;
}

export interface LauncherChildProcess {
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: 'error', listener: (error: Error) => void): this;
  once(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  off(event: 'error', listener: (error: Error) => void): this;
  off(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
}

export interface WaitForPearReadyOptions {
  readonly env: ConfigEnv;
  readonly timeoutMs?: number | undefined;
  readonly retryDelayMs?: number | undefined;
  readonly loadConfig?: ((env: ConfigEnv) => ReturnType<typeof loadConfig>) | undefined;
  readonly assertRuntimePreflight?:
    | ((config: ReturnType<typeof loadConfig>) => Promise<unknown>)
    | undefined;
  readonly sleep?: ((delayMs: number) => Promise<void>) | undefined;
}

export interface CreateLauncherDependencies {
  readonly env?: ConfigEnv | undefined;
  readonly pearLaunchPlan: PearDesktopLaunchPlan;
  readonly spawn?:
    | ((
      command: string,
      args: readonly string[],
      options: SpawnOptions,
    ) => LauncherChildProcess)
    | undefined;
  readonly waitForPearReady?:
    | ((options: WaitForPearReadyOptions) => Promise<void>)
    | undefined;
  readonly startRuntime?:
    | ((input: {
      readonly env: ConfigEnv;
      readonly signalSource: RuntimeSignalSource;
    }) => Promise<LauncherRuntimeHandle>)
    | undefined;
  readonly signalSource?: RuntimeSignalSource | undefined;
}

export interface StartedLauncher {
  stop(): Promise<void>;
  readonly completion: Promise<void>;
}

export interface Launcher {
  start(): Promise<StartedLauncher>;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  return 'Unknown error';
}

function createSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export async function waitForPearReady(
  options: WaitForPearReadyOptions,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retryDelayMs = options.retryDelayMs ?? 1_000;
  const readConfig = options.loadConfig ?? loadConfig;
  const runPreflight = options.assertRuntimePreflight ?? assertRuntimePreflight;
  const sleep = options.sleep ?? createSleep;
  const startTime = Date.now();
  let lastError: unknown;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const config = readConfig(options.env);
      await runPreflight(config);
      return;
    } catch (error) {
      lastError = error;
    }

    await sleep(retryDelayMs);
  }

  const suffix =
    lastError === undefined ? '' : ` Last error: ${toErrorMessage(lastError)}`;
  throw new Error(
    `Timed out waiting for Pear readiness after ${timeoutMs}ms.${suffix}`,
  );
}

function createLauncherRuntimeSignalSource(): RuntimeSignalSource {
  const listeners = new Map<'SIGINT' | 'SIGTERM', Set<() => void>>();

  return {
    on(event, handler) {
      const handlers = listeners.get(event) ?? new Set();
      handlers.add(handler);
      listeners.set(event, handlers);
      return this;
    },
    off(event, handler) {
      listeners.get(event)?.delete(handler);
      return this;
    },
  };
}

function watchPearStartup(
  child: LauncherChildProcess,
  onUnexpectedTermination?: ((error: Error) => void) | undefined,
) {
  let startupSettled = false;
  let startupReady = false;
  let startupComplete = false;
  let pendingStartupError: Error | undefined;
  let resolveReady: (() => void) | undefined;
  let rejectReady: ((error: Error) => void) | undefined;

  const promise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const handleError = (error: Error) => {
    if (!startupReady) {
      if (startupSettled) {
        return;
      }

      startupSettled = true;
      rejectReady?.(
        new Error(`Pear launcher failed to spawn: ${toErrorMessage(error)}`),
      );
      return;
    }

    onUnexpectedTermination?.(
      new Error(`Managed Pear process failed after startup: ${toErrorMessage(error)}`),
    );
  };

  const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
    const detail =
      signal !== null
        ? `signal ${signal}`
        : `code ${code === null ? 'unknown' : String(code)}`;

    if (!startupReady) {
      if (startupSettled) {
        return;
      }

      startupSettled = true;
      rejectReady?.(
        new Error(`Pear launcher exited before runtime startup completed (${detail}).`),
      );
      return;
    }

    if (code === 0 && signal === null) {
      if (!startupComplete) {
        pendingStartupError = new Error(
          `Pear launcher exited before runtime startup completed (${detail}).`,
        );
      }
      return;
    }

    onUnexpectedTermination?.(
      new Error(`Managed Pear process exited unexpectedly after startup (${detail}).`),
    );
  };

  child.once('error', handleError);
  child.once('exit', handleExit);

  return {
    promise,
    markStartupComplete() {
      if (startupSettled) {
        return false;
      }

      startupComplete = true;
      return true;
    },
    markReady() {
      if (startupSettled) {
        return false;
      }

      startupReady = true;
      startupSettled = true;
      resolveReady?.();
      return true;
    },
    takePendingStartupError() {
      const error = pendingStartupError;
      pendingStartupError = undefined;
      return error;
    },
    dispose() {
      child.off('error', handleError);
      child.off('exit', handleExit);
    },
  };
}

export function createLauncher(
  dependencies: CreateLauncherDependencies,
): Launcher {
  return {
    async start(): Promise<StartedLauncher> {
      const env = dependencies.env ?? process.env;
      const spawn =
        dependencies.spawn ??
        ((command: string, args: readonly string[], options: SpawnOptions) =>
          spawnChildProcess(command, [...args], options));
      const waitForPearReadyImpl =
        dependencies.waitForPearReady ?? waitForPearReady;
      const startRuntimeImpl =
        dependencies.startRuntime ??
        (async (input: {
          readonly env: ConfigEnv;
          readonly signalSource: RuntimeSignalSource;
        }) => startRuntimeBootstrap(input));
      const signalSource = dependencies.signalSource ?? process;
      const [command, ...args] = dependencies.pearLaunchPlan.command;

      const pearChild = spawn(command, args, {
        cwd: dependencies.pearLaunchPlan.repoDir,
        env,
        stdio: 'inherit',
      });
      const runtimeSignalSource = createLauncherRuntimeSignalSource();
      let runtime: LauncherRuntimeHandle | undefined;
      let stoppingPromise: Promise<void> | undefined;
      let runtimeStopRequested = false;
      let runtimeStopInvoked = false;
      let completionSettled = false;
      let startupWatch: ReturnType<typeof watchPearStartup>;
      let completeLaunch:
        | ((result?: void | PromiseLike<void>) => void)
        | undefined;
      let failLaunch: ((reason?: unknown) => void) | undefined;
      const completion = new Promise<void>((resolve, reject) => {
        completeLaunch = resolve;
        failLaunch = reject;
      });

      const resolveCompletion = () => {
        if (completionSettled) {
          return;
        }

        completionSettled = true;
        completeLaunch?.();
      };

      const rejectCompletion = (error: unknown) => {
        if (completionSettled) {
          return;
        }

        completionSettled = true;
        failLaunch?.(error);
      };

      const killPear = () => {
        pearChild.kill('SIGTERM');
      };

      const stopRuntime = async (): Promise<void> => {
        runtimeStopRequested = true;
        if (runtime === undefined || runtimeStopInvoked) {
          return;
        }

        runtimeStopInvoked = true;
        await runtime.stop();
      };

      const requestUnexpectedShutdown = (error: Error) => {
        if (stoppingPromise !== undefined) {
          return;
        }

        void stop(error).catch(() => {});
      };

      async function stop(completionError?: unknown): Promise<void> {
        if (stoppingPromise !== undefined) {
          return stoppingPromise;
        }

        stoppingPromise = (async () => {
          let stopFailure = completionError;
          signalSource.off('SIGINT', handleSignal);
          signalSource.off('SIGTERM', handleSignal);
          startupWatch.dispose();
          try {
            await stopRuntime();
          } catch (error) {
            stopFailure ??= error;
            throw error;
          } finally {
            killPear();
            if (stopFailure === undefined) {
              resolveCompletion();
            } else {
              rejectCompletion(stopFailure);
            }
          }
        })();

        return stoppingPromise;
      }

      startupWatch = watchPearStartup(pearChild, requestUnexpectedShutdown);

      const handleSignal = () => {
        void stop().catch(() => {});
      };

      signalSource.on('SIGINT', handleSignal);
      signalSource.on('SIGTERM', handleSignal);

      try {
        await Promise.race([
          waitForPearReadyImpl({ env }),
          startupWatch.promise,
        ]);
        if (!startupWatch.markReady()) {
          throw new Error('Pear launcher exited before runtime startup completed.');
        }
        runtime = await startRuntimeImpl({
          env,
          signalSource: runtimeSignalSource,
        });
        startupWatch.markStartupComplete();
        const startupError = startupWatch.takePendingStartupError();
        if (startupError !== undefined) {
          await runtime.stop();
          throw startupError;
        }
        if (runtimeStopRequested && !runtimeStopInvoked) {
          runtimeStopInvoked = true;
          await runtime.stop();
          throw new Error('Pear launcher stopped before runtime startup completed.');
        }
      } catch (error) {
        startupWatch.dispose();
        signalSource.off('SIGINT', handleSignal);
        signalSource.off('SIGTERM', handleSignal);
        killPear();
        throw error;
      }

      return {
        stop,
        completion,
      };
    },
  };
}
