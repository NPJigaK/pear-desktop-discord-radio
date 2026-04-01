export const DIRECT_AUDIO_EXPORT_BOOTSTRAP_CHANNEL =
  'pear-direct-audio-export:bootstrap';
export const DIRECT_AUDIO_EXPORT_FRAME_CHANNEL =
  'pear-direct-audio-export:frame';
export const DIRECT_AUDIO_EXPORT_CLIENT_STATE_CHANNEL =
  'pear-direct-audio-export:client-state';
export const DIRECT_AUDIO_EXPORT_CLIENT_STATE_QUERY_CHANNEL =
  'pear-direct-audio-export:client-state:query';
export const DIRECT_AUDIO_EXPORT_BOOTSTRAP_VERSION = 1 as const;
export const DIRECT_AUDIO_EXPORT_BOOTSTRAP_DIRECTORY_NAME =
  'pear-direct-audio-export';

export type DirectAudioExportClientState = boolean;

export type DirectAudioExportStreamState =
  | 'waiting-for-client'
  | 'connected'
  | 'dropping'
  | 'stopped'
  | 'error';

export interface DirectAudioExportPcmContract {
  readonly sampleRate: number;
  readonly channels: 2;
  readonly bitsPerSample: 16;
}

export interface DirectAudioExportBootstrap {
  readonly version: typeof DIRECT_AUDIO_EXPORT_BOOTSTRAP_VERSION;
  readonly kind: 'plugin';
  readonly transport: 'named-pipe';
  readonly sessionId: string;
  readonly bootstrapPath: string;
  readonly bootstrapWrittenAt: string;
  readonly pipePath: string;
  readonly streamState: DirectAudioExportStreamState;
  readonly droppedFrameCount: number;
  readonly pcm: DirectAudioExportPcmContract;
}

export function createDirectAudioExportPcmContract(
  sampleRate: number,
): DirectAudioExportPcmContract {
  return {
    sampleRate,
    channels: 2,
    bitsPerSample: 16,
  };
}

export function createDirectAudioExportBootstrap(input: {
  readonly sessionId: string;
  readonly bootstrapPath: string;
  readonly pipePath: string;
  readonly streamState: DirectAudioExportStreamState;
  readonly droppedFrameCount: number;
  readonly pcm: DirectAudioExportPcmContract;
}): DirectAudioExportBootstrap {
  return {
    version: DIRECT_AUDIO_EXPORT_BOOTSTRAP_VERSION,
    kind: 'plugin',
    transport: 'named-pipe',
    sessionId: input.sessionId,
    bootstrapPath: input.bootstrapPath,
    bootstrapWrittenAt: new Date().toISOString(),
    pipePath: input.pipePath,
    streamState: input.streamState,
    droppedFrameCount: input.droppedFrameCount,
    pcm: input.pcm,
  };
}
