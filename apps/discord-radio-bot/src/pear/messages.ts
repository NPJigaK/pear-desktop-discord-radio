import { normalizePearSong } from './search.js';
import type { PearRepeatMode, PearSong } from './types.js';

type UnknownRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readRepeatMode(value: unknown): PearRepeatMode | null {
  return value === 'NONE' || value === 'ONE' || value === 'ALL' ? value : null;
}

function parseMessageData(data: unknown): unknown {
  if (typeof data === 'string') {
    return JSON.parse(data) as unknown;
  }

  if (data instanceof ArrayBuffer) {
    return JSON.parse(new TextDecoder().decode(new Uint8Array(data))) as unknown;
  }

  if (ArrayBuffer.isView(data)) {
    return JSON.parse(
      new TextDecoder().decode(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      ),
    ) as unknown;
  }

  return data;
}

export interface PearPlayerSnapshot {
  readonly song?: PearSong | undefined;
  readonly isPlaying: boolean;
  readonly muted: boolean;
  readonly position: number;
  readonly volume: number;
  readonly repeat: PearRepeatMode;
  readonly shuffle: boolean;
}

export interface PearPlayerInfoMessage extends PearPlayerSnapshot {
  readonly type: 'PLAYER_INFO';
}

export interface PearVideoChangedMessage {
  readonly type: 'VIDEO_CHANGED';
  readonly song: PearSong;
  readonly position: number;
}

export interface PearPlayerStateChangedMessage {
  readonly type: 'PLAYER_STATE_CHANGED';
  readonly isPlaying: boolean;
  readonly position: number;
}

export interface PearPositionChangedMessage {
  readonly type: 'POSITION_CHANGED';
  readonly position: number;
}

export interface PearVolumeChangedMessage {
  readonly type: 'VOLUME_CHANGED';
  readonly volume: number;
  readonly muted: boolean;
}

export interface PearRepeatChangedMessage {
  readonly type: 'REPEAT_CHANGED';
  readonly repeat: PearRepeatMode;
}

export interface PearShuffleChangedMessage {
  readonly type: 'SHUFFLE_CHANGED';
  readonly shuffle: boolean;
}

export type PearWebSocketMessage =
  | PearPlayerInfoMessage
  | PearVideoChangedMessage
  | PearPlayerStateChangedMessage
  | PearPositionChangedMessage
  | PearVolumeChangedMessage
  | PearRepeatChangedMessage
  | PearShuffleChangedMessage;

function parsePlayerInfo(payload: UnknownRecord): PearPlayerInfoMessage | null {
  const isPlaying = readBoolean(payload.isPlaying);
  const muted = readBoolean(payload.muted);
  const position = readNumber(payload.position);
  const volume = readNumber(payload.volume);
  const repeat = readRepeatMode(payload.repeat);
  const shuffle = readBoolean(payload.shuffle);

  if (
    isPlaying === null ||
    muted === null ||
    position === null ||
    volume === null ||
    repeat === null ||
    shuffle === null
  ) {
    return null;
  }

  if (payload.song === undefined) {
    return {
      type: 'PLAYER_INFO',
      isPlaying,
      muted,
      position,
      volume,
      repeat,
      shuffle,
    };
  }

  const song = normalizePearSong(payload.song);
  if (song === null) {
    return null;
  }

  return {
    type: 'PLAYER_INFO',
    song,
    isPlaying,
    muted,
    position,
    volume,
    repeat,
    shuffle,
  };
}

export function parsePearWebSocketMessage(
  data: unknown,
): PearWebSocketMessage | null {
  let parsed: unknown;
  try {
    parsed = parseMessageData(data);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    return null;
  }

  switch (parsed.type) {
    case 'PLAYER_INFO':
      return parsePlayerInfo(parsed);
    case 'VIDEO_CHANGED': {
      const song = normalizePearSong(parsed.song);
      const position = readNumber(parsed.position);
      if (song === null || position === null) {
        return null;
      }
      return { type: 'VIDEO_CHANGED', song, position };
    }
    case 'PLAYER_STATE_CHANGED': {
      const isPlaying = readBoolean(parsed.isPlaying);
      const position = readNumber(parsed.position);
      if (isPlaying === null || position === null) {
        return null;
      }
      return { type: 'PLAYER_STATE_CHANGED', isPlaying, position };
    }
    case 'POSITION_CHANGED': {
      const position = readNumber(parsed.position);
      return position === null ? null : { type: 'POSITION_CHANGED', position };
    }
    case 'VOLUME_CHANGED': {
      const volume = readNumber(parsed.volume);
      const muted = readBoolean(parsed.muted);
      if (volume === null || muted === null) {
        return null;
      }
      return { type: 'VOLUME_CHANGED', volume, muted };
    }
    case 'REPEAT_CHANGED': {
      const repeat = readRepeatMode(parsed.repeat);
      return repeat === null ? null : { type: 'REPEAT_CHANGED', repeat };
    }
    case 'SHUFFLE_CHANGED': {
      const shuffle = readBoolean(parsed.shuffle);
      return shuffle === null ? null : { type: 'SHUFFLE_CHANGED', shuffle };
    }
    default:
      return null;
  }
}
