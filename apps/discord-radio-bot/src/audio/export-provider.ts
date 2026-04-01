export type AudioExportProviderKind = 'plugin' | 'private-patch';

export type AudioExportTransport = 'named-pipe' | 'ipc';

export interface AudioPcmFormat {
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitsPerSample: number;
}

export interface AudioExportProviderReadyResult {
  readonly kind: AudioExportProviderKind;
  readonly transport: AudioExportTransport;
  readonly pcm: AudioPcmFormat;
}

export interface CreateAudioExportProviderDescriptorInput
  extends AudioPcmFormat {
  readonly kind: AudioExportProviderKind;
  readonly transport: AudioExportTransport;
}

export function createAudioExportProviderDescriptor(
  input: CreateAudioExportProviderDescriptorInput,
): AudioExportProviderReadyResult {
  return {
    kind: input.kind,
    transport: input.transport,
    pcm: {
      sampleRate: input.sampleRate,
      channels: input.channels,
      bitsPerSample: input.bitsPerSample,
    },
  };
}
