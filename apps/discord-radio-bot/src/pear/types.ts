export interface PearConnectionConfig {
  readonly host: '127.0.0.1';
  readonly port: number;
  readonly clientId: string;
}

export interface PearSong {
  readonly videoId: string;
  readonly title: string;
  readonly subtitle?: string | undefined;
}

export interface PearSearchResult extends PearSong {
  readonly label: string;
}

export type PearRepeatMode = 'NONE' | 'ONE' | 'ALL';

export type QueuePlacement = 'queue' | 'next';

export type PearInsertPosition =
  | 'INSERT_AT_END'
  | 'INSERT_AFTER_CURRENT_VIDEO';

export type PearControlAction =
  | 'play'
  | 'pause'
  | 'toggle-play'
  | 'next'
  | 'previous';
