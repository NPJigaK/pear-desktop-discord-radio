import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const bootstrapPathsModuleUrl = pathToFileURL(
  path.join(process.cwd(), 'scripts', 'bootstrap-ffmpeg-paths.mjs'),
).href;

test('getBootstrapPaths preserves the zip extension for the temporary archive path', async () => {
  const { getBootstrapPaths } = await import(bootstrapPathsModuleUrl);
  const projectRoot = path.resolve(process.cwd());

  const paths = getBootstrapPaths(projectRoot, {
    assetName: 'ffmpeg-n8.0.1-win64-lgpl-shared.zip',
    relativeExecutablePath: 'ffmpeg-n8.0.1-win64-lgpl-shared\\bin\\ffmpeg.exe',
  });

  assert.equal(
    paths.downloadPath,
    path.join(
      projectRoot,
      '.cache',
      'ffmpeg',
      'ffmpeg-n8.0.1-win64-lgpl-shared.download.zip',
    ),
  );
});

test('getProjectRootFromScript resolves the bot package root from the script location', async () => {
  const { getProjectRootFromScript } = await import(bootstrapPathsModuleUrl);

  assert.equal(
    getProjectRootFromScript(
      'file:///E:/github/pear-desktop-discord-radio/apps/discord-radio-bot/scripts/bootstrap-ffmpeg.mjs',
    ),
    path.resolve(process.cwd()),
  );
});
