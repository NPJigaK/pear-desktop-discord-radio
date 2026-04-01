import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  getBootstrapPaths,
  getProjectRootFromScript,
} from './bootstrap-ffmpeg-paths.mjs';

function toErrorMessage(error) {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  return 'Unknown error';
}

async function readManifest(projectRoot) {
  const manifestPath = path.join(projectRoot, 'config', 'ffmpeg-managed.json');
  const raw = await readFile(manifestPath, 'utf8');
  return JSON.parse(raw);
}

async function calculateSha256(filePath) {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest('hex');
}

async function downloadArchive(url, destination) {
  const response = await fetch(url);
  if (!response.ok || response.body === null) {
    throw new Error(`Download failed with status ${response.status}.`);
  }

  const output = createWriteStream(destination);
  await pipeline(Readable.fromWeb(response.body), output);
}

async function expandArchive(archivePath, destinationPath) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${archivePath.replace(/'/gu, "''")}' -DestinationPath '${destinationPath.replace(/'/gu, "''")}' -Force`,
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }

      reject(new Error(stderr.trim() || `Expand-Archive exited with code ${String(code)}`));
    });
  });
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('FFmpeg bootstrap is only supported on Windows source installs.');
  }

  const force = process.argv.includes('--force');
  const projectRoot = getProjectRootFromScript(import.meta.url);
  const manifest = await readManifest(projectRoot);
  const paths = getBootstrapPaths(projectRoot, manifest);

  if (!force && existsSync(paths.executablePath)) {
    await stat(paths.executablePath);
    console.log(`FFmpeg already bootstrapped at ${paths.executablePath}`);
    return;
  }

  await mkdir(paths.cacheRoot, { recursive: true });
  await rm(paths.installRoot, { recursive: true, force: true });
  await rm(paths.downloadPath, { force: true });

  console.log(`Downloading ${manifest.assetName} from ${manifest.provider}...`);
  await downloadArchive(manifest.assetUrl, paths.downloadPath);

  const sha256 = await calculateSha256(paths.downloadPath);
  if (sha256 !== manifest.sha256) {
    await rm(paths.downloadPath, { force: true });
    throw new Error(
      `Checksum mismatch for ${manifest.assetName}. Expected ${manifest.sha256}, got ${sha256}.`,
    );
  }

  await expandArchive(paths.downloadPath, paths.cacheRoot);

  if (!existsSync(paths.executablePath)) {
    throw new Error(`Bootstrap completed, but ffmpeg.exe was not found at ${paths.executablePath}.`);
  }

  await rm(paths.downloadPath, { force: true });
  console.log(`FFmpeg bootstrapped at ${paths.executablePath}`);
}

main().catch((error) => {
  console.error(`FFmpeg bootstrap failed: ${toErrorMessage(error)}`);
  process.exitCode = 1;
});
