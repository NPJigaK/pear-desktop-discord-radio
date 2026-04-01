import path from 'node:path';
import { fileURLToPath } from 'node:url';

function buildTemporaryArchiveName(assetName) {
  const parsed = path.parse(assetName);
  const extension = parsed.ext || '.zip';
  const baseName = parsed.ext === '' ? assetName : parsed.name;

  return `${baseName}.download${extension}`;
}

export function getBootstrapPaths(projectRoot, manifest) {
  const cacheRoot = path.join(projectRoot, '.cache', 'ffmpeg');
  const relativeSegments = manifest.relativeExecutablePath.split(/[\\/]/u);

  return {
    cacheRoot,
    installRoot: path.join(cacheRoot, relativeSegments[0]),
    executablePath: path.join(cacheRoot, ...relativeSegments),
    downloadPath: path.join(cacheRoot, buildTemporaryArchiveName(manifest.assetName)),
  };
}

export function getProjectRootFromScript(scriptUrl) {
  const scriptDirectory = path.dirname(fileURLToPath(scriptUrl));
  return path.resolve(scriptDirectory, '..');
}
