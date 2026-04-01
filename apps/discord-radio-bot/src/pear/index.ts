export type {
  PearConnectionConfig,
  PearControlAction,
  PearInsertPosition,
  PearRepeatMode,
  PearSearchResult,
  PearSong,
  QueuePlacement,
} from './types.js';
export type {
  NormalizePearSearchOptions,
} from './search.js';
export type {
  AddToQueueRequest,
  PearClientOptions,
  PearSearchRequest,
} from './client.js';
export type {
  PearPlayerInfoMessage,
  PearPlayerSnapshot,
  PearPlayerStateChangedMessage,
  PearPositionChangedMessage,
  PearRepeatChangedMessage,
  PearShuffleChangedMessage,
  PearVideoChangedMessage,
  PearVolumeChangedMessage,
  PearWebSocketMessage,
} from './messages.js';
export type {
  PearPlayerStateProjector,
} from './projector.js';
export type {
  PearWebSocketClientOptions,
  PearWebSocketFactory,
} from './ws.js';

export { PearClient, mapQueuePlacement } from './client.js';
export { mapControlActionPath } from './client.js';
export {
  normalizePearSearchResults,
  normalizePearSong,
} from './search.js';
export { parsePearWebSocketMessage } from './messages.js';
export { createPearPlayerStateProjector } from './projector.js';
export { PearWebSocketClient } from './ws.js';
