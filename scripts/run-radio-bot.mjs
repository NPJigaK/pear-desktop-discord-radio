import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT_ENV_FALLBACK_PATH_ENV = 'RADIO_BOT_ROOT_ENV_FALLBACK';

function resolveRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function resolveRootEnvFallbackPath(repoRoot) {
  const envPath = path.join(repoRoot, '.env');
  if (!existsSync(envPath)) {
    return undefined;
  }

  return envPath;
}

function resolveExecutableOnPath(executableName, searchPath = process.env.PATH ?? '') {
  for (const directory of searchPath.split(path.delimiter)) {
    if (directory.trim() === '') {
      continue;
    }

    const candidate = path.join(directory, executableName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function resolvePnpmCommand(env = process.env) {
  const npmExecPath = env.npm_execpath?.trim();
  if (npmExecPath !== undefined && npmExecPath !== '' && existsSync(npmExecPath)) {
    const extension = path.extname(npmExecPath).toLowerCase();
    if (extension === '.js' || extension === '.cjs' || extension === '.mjs') {
      return {
        command: process.execPath,
        prefixArgs: [npmExecPath],
      };
    }

    return {
      command: npmExecPath,
      prefixArgs: [],
    };
  }

  if (process.platform === 'win32') {
    const pnpmExecutable = resolveExecutableOnPath('pnpm.exe', env.PATH);
    if (pnpmExecutable !== undefined) {
      return {
        command: pnpmExecutable,
        prefixArgs: [],
      };
    }
  }

  return {
    command: 'pnpm',
    prefixArgs: [],
  };
}

function spawnChild(command, args, options) {
  return spawn(command, args, {
    ...options,
    windowsHide: process.platform === 'win32',
  });
}

async function waitForChild(child) {
  const code = await new Promise((resolve, reject) => {
    child.on('close', resolve);
    child.on('error', reject);
  });

  return code ?? 1;
}

async function main() {
  const scriptName = process.argv[2];
  if (scriptName === undefined || scriptName.trim() === '') {
    throw new Error('Missing radio bot script name.');
  }

  const repoRoot = resolveRepoRoot();
  const botDir = path.join(repoRoot, 'apps', 'discord-radio-bot');
  const rawForwardedArgs = process.argv.slice(3);
  const forwardedArgs =
    rawForwardedArgs[0] === '--'
      ? rawForwardedArgs.slice(1)
      : rawForwardedArgs;
  const childEnv = {
    ...process.env,
  };
  const rootEnvFallbackPath = resolveRootEnvFallbackPath(repoRoot);
  if (
    rootEnvFallbackPath !== undefined &&
    childEnv[ROOT_ENV_FALLBACK_PATH_ENV] === undefined
  ) {
    childEnv[ROOT_ENV_FALLBACK_PATH_ENV] = rootEnvFallbackPath;
  }
  const pnpmCommand = resolvePnpmCommand(childEnv);

  if (scriptName === 'test') {
    const pretestCode = await waitForChild(
      spawnChild(
        pnpmCommand.command,
        [
          ...pnpmCommand.prefixArgs,
          'run',
          'pretest',
        ],
        {
          stdio: 'inherit',
          cwd: botDir,
          env: childEnv,
        },
      ),
    );
    if (pretestCode !== 0) {
      process.exitCode = pretestCode;
      return;
    }

    const testCode = await waitForChild(
      spawnChild(
        process.execPath,
        [
          '--test',
          ...forwardedArgs,
          'dist/tests/**/*.test.js',
        ],
        {
          stdio: 'inherit',
          cwd: botDir,
          env: childEnv,
        },
      ),
    );
    process.exitCode = testCode;
    return;
  }

  const child = spawnChild(
    pnpmCommand.command,
    [
      ...pnpmCommand.prefixArgs,
      'run',
      scriptName,
      ...forwardedArgs,
    ],
    {
      stdio: 'inherit',
      cwd: botDir,
      env: childEnv,
    },
  );

  process.exitCode = await waitForChild(child);
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`radio bot wrapper failed: ${detail}`);
  process.exitCode = 1;
});
