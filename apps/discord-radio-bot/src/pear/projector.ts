import type {
  PearPlayerSnapshot,
  PearWebSocketMessage,
} from './messages.js';

function createSnapshot(
  fields: Omit<PearPlayerSnapshot, 'song'>,
  song: PearPlayerSnapshot['song'],
): PearPlayerSnapshot {
  if (song === undefined) {
    return fields;
  }

  return {
    ...fields,
    song,
  };
}

export interface PearPlayerStateProjector {
  apply(message: PearWebSocketMessage): PearPlayerSnapshot;
  getSnapshot(): PearPlayerSnapshot;
}

export function createPearPlayerStateProjector(): PearPlayerStateProjector {
  let snapshot = createSnapshot(
    {
      isPlaying: false,
      muted: false,
      position: 0,
      volume: 100,
      repeat: 'NONE',
      shuffle: false,
    },
    undefined,
  );

  return {
    apply(message) {
      switch (message.type) {
        case 'PLAYER_INFO':
          snapshot = createSnapshot(
            {
              isPlaying: message.isPlaying,
              muted: message.muted,
              position: message.position,
              volume: message.volume,
              repeat: message.repeat,
              shuffle: message.shuffle,
            },
            message.song,
          );
          break;
        case 'VIDEO_CHANGED':
          snapshot = createSnapshot(
            {
              isPlaying: snapshot.isPlaying,
              muted: snapshot.muted,
              position: message.position,
              volume: snapshot.volume,
              repeat: snapshot.repeat,
              shuffle: snapshot.shuffle,
            },
            message.song,
          );
          break;
        case 'PLAYER_STATE_CHANGED':
          snapshot = createSnapshot(
            {
              isPlaying: message.isPlaying,
              muted: snapshot.muted,
              position: message.position,
              volume: snapshot.volume,
              repeat: snapshot.repeat,
              shuffle: snapshot.shuffle,
            },
            snapshot.song,
          );
          break;
        case 'POSITION_CHANGED':
          snapshot = createSnapshot(
            {
              isPlaying: snapshot.isPlaying,
              muted: snapshot.muted,
              position: message.position,
              volume: snapshot.volume,
              repeat: snapshot.repeat,
              shuffle: snapshot.shuffle,
            },
            snapshot.song,
          );
          break;
        case 'VOLUME_CHANGED':
          snapshot = createSnapshot(
            {
              isPlaying: snapshot.isPlaying,
              muted: message.muted,
              position: snapshot.position,
              volume: message.volume,
              repeat: snapshot.repeat,
              shuffle: snapshot.shuffle,
            },
            snapshot.song,
          );
          break;
        case 'REPEAT_CHANGED':
          snapshot = createSnapshot(
            {
              isPlaying: snapshot.isPlaying,
              muted: snapshot.muted,
              position: snapshot.position,
              volume: snapshot.volume,
              repeat: message.repeat,
              shuffle: snapshot.shuffle,
            },
            snapshot.song,
          );
          break;
        case 'SHUFFLE_CHANGED':
          snapshot = createSnapshot(
            {
              isPlaying: snapshot.isPlaying,
              muted: snapshot.muted,
              position: snapshot.position,
              volume: snapshot.volume,
              repeat: snapshot.repeat,
              shuffle: message.shuffle,
            },
            snapshot.song,
          );
          break;
      }

      return snapshot;
    },
    getSnapshot() {
      return snapshot;
    },
  };
}
