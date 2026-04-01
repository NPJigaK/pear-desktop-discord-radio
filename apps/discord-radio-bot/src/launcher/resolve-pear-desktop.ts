import path from 'node:path';

export interface PearDesktopLaunchPlan {
  readonly repoDir: string;
  readonly command: readonly [string, ...string[]];
}

export function resolvePearDesktopLaunchPlan(
  env: NodeJS.ProcessEnv,
  projectRoot: string,
): PearDesktopLaunchPlan {
  const pearDesktopDir = env.PEAR_DESKTOP_DIR;
  const repoDir =
    pearDesktopDir !== undefined && pearDesktopDir.trim() !== ''
      ? pearDesktopDir.trim()
      : path.resolve(projectRoot, '..', '..');

  return {
    repoDir,
    command: ['pnpm', 'start:direct-audio-export'],
  };
}
