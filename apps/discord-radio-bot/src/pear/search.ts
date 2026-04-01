import type { PearSearchResult, PearSong } from './types.js';

type UnknownRecord = Readonly<Record<string, unknown>>;

export interface NormalizePearSearchOptions {
  readonly limit?: number | undefined;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function readText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return readNonEmptyString(value);
  }

  if (Array.isArray(value)) {
    const parts = value.flatMap((entry) => {
      const text = readText(entry);
      return text === undefined ? [] : [text];
    });

    if (parts.length === 0) {
      return undefined;
    }

    return parts.join(' ').trim();
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const directText = readNonEmptyString(value.text);
  if (directText !== undefined) {
    return directText;
  }

  if (Array.isArray(value.runs)) {
    return readText(value.runs);
  }

  return undefined;
}

function readSubtitle(candidate: UnknownRecord): string | undefined {
  return (
    readText(candidate.artists) ??
    readText(candidate.artist) ??
    readText(candidate.byline) ??
    readText(candidate.subtitle)
  );
}

function hasWatchLikeEndpoint(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (isRecord(value.watchEndpoint) || isRecord(value.watchPlaylistEndpoint)) {
    return true;
  }

  return false;
}

function hasPositivePlayabilitySignal(candidate: UnknownRecord): boolean {
  if (candidate.isPlayable === true || candidate.playable === true) {
    return true;
  }

  return (
    hasWatchLikeEndpoint(candidate.navigationEndpoint) ||
    hasWatchLikeEndpoint(candidate.playNavigationEndpoint)
  );
}

function readSongCandidate(value: unknown): PearSong | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.isPlayable === false || value.playable === false) {
    return null;
  }

  const videoId = readNonEmptyString(value.videoId);
  const title =
    readText(value.title) ??
    readText(value.name) ??
    readText(value.label) ??
    readText(value.text);

  if (videoId === undefined || title === undefined) {
    return null;
  }

  const subtitle = readSubtitle(value);
  if (subtitle === undefined) {
    return { videoId, title };
  }

  return { videoId, title, subtitle };
}

function readSearchSongCandidate(value: unknown): PearSong | null {
  if (!isRecord(value)) {
    return null;
  }

  if (!hasPositivePlayabilitySignal(value)) {
    return null;
  }

  return readSongCandidate(value);
}

function visitSearchTree(
  value: unknown,
  visit: (candidate: UnknownRecord) => boolean,
): boolean {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (visitSearchTree(entry, visit)) {
        return true;
      }
    }

    return false;
  }

  if (!isRecord(value)) {
    return false;
  }

  if (visit(value)) {
    return true;
  }

  for (const nestedValue of Object.values(value)) {
    if (visitSearchTree(nestedValue, visit)) {
      return true;
    }
  }

  return false;
}

export function normalizePearSong(value: unknown): PearSong | null {
  return readSongCandidate(value);
}

export function normalizePearSearchResults(
  value: unknown,
  options: NormalizePearSearchOptions = {},
): PearSearchResult[] {
  const limit = options.limit ?? 25;
  const results: PearSearchResult[] = [];

  visitSearchTree(value, (candidate) => {
    if (results.length >= limit) {
      return true;
    }

    if (!Object.hasOwn(candidate, 'videoId')) {
      return false;
    }

    const song = readSearchSongCandidate(candidate);
    if (song === null) {
      return false;
    }

    results.push({
      label: song.title,
      subtitle: song.subtitle,
      title: song.title,
      videoId: song.videoId,
    });

    return results.length >= limit;
  });

  return results;
}
