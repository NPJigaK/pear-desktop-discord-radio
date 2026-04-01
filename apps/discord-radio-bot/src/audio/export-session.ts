import type { Readable } from 'node:stream';

export type AudioExportEndedReason =
  | 'stopped'
  | 'producer-ended'
  | 'pipe-closed';

export interface AudioExportEndedEvent {
  readonly reason: AudioExportEndedReason;
}

export interface RunningAudioExport {
  readonly stream: Readable;
  readonly stop: () => Promise<void>;
  readonly onFatalError: (listener: (error: Error) => void) => void;
  readonly onEnded: (
    listener: (event: AudioExportEndedEvent) => void,
  ) => void;
}

export interface AudioExportProvider {
  start(): Promise<RunningAudioExport>;
}

export interface AudioExportSession {
  start(): Promise<RunningAudioExport>;
}

export function createAudioExportSession(input: {
  readonly provider: AudioExportProvider;
}): AudioExportSession {
  return {
    start(): Promise<RunningAudioExport> {
      return input.provider.start();
    },
  };
}
