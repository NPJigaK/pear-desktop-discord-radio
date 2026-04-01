import type { QueuePlacement } from '../pear/index.js';

const ADD_SELECTION_SEPARATOR = '|';

function isQueuePlacement(value: string): value is QueuePlacement {
  return value === 'queue' || value === 'next';
}

function isValidVideoId(value: string): boolean {
  return value.trim() !== '' && !value.includes(ADD_SELECTION_SEPARATOR);
}

export function encodeAddSelectionValue(
  placement: QueuePlacement,
  videoId: string,
): string {
  if (!isValidVideoId(videoId)) {
    throw new Error('Add select values require a non-empty video id without separators');
  }

  return `${placement}${ADD_SELECTION_SEPARATOR}${videoId}`;
}

export function decodeAddSelectionValue(value: string):
  | {
    readonly ok: true;
    readonly placement: QueuePlacement;
    readonly videoId: string;
  }
  | {
    readonly ok: false;
  } {
  const parts = value.split(ADD_SELECTION_SEPARATOR);
  if (parts.length !== 2) {
    return { ok: false };
  }

  const [placement, videoId] = parts;
  if (
    placement === undefined ||
    videoId === undefined ||
    !isQueuePlacement(placement) ||
    !isValidVideoId(videoId)
  ) {
    return { ok: false };
  }

  return {
    ok: true,
    placement,
    videoId,
  };
}
