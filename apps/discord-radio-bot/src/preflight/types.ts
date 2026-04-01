import type {
  FfmpegDiscoveryAttempt,
  FfmpegDiscoveryResult,
  FfmpegPcmEncodeReadiness,
  PluginExportBootstrapCandidate,
  PluginExportReadyResult,
} from '../audio/index.js';

export type DoctorStatus = 'pass' | 'fail' | 'unsupported';

export interface DoctorConfig {
  readonly pearHost: string;
  readonly pearPort: number;
  readonly pearClientId: string;
  readonly ffmpegPath?: string | undefined;
}

export interface DoctorCheck {
  readonly status: DoctorStatus;
  readonly detail: string;
}

export interface DoctorReport {
  readonly platform: NodeJS.Platform;
  readonly checks: {
    readonly pearHostExact: DoctorCheck;
    readonly pearAuthReachable: DoctorCheck;
    readonly pearWebSocketReachable: DoctorCheck;
    readonly windowsRequirementSatisfied?: DoctorCheck | undefined;
    readonly exportProviderReady?: (DoctorCheck & {
      readonly sessionId?: string | undefined;
      readonly bootstrapPath?: string | undefined;
      readonly pipePath?: string | undefined;
      readonly streamState?: PluginExportReadyResult['streamState'] | undefined;
      readonly droppedFrameCount?: number | undefined;
    }) | undefined;
    readonly exportPcmContractReady?: (DoctorCheck & {
      readonly pcm?: PluginExportBootstrapCandidate['pcm'] | undefined;
    }) | undefined;
    readonly ffmpegDiscoverable: DoctorCheck & {
      readonly executablePath?: string | undefined;
      readonly source?: FfmpegDiscoveryResult['source'] | undefined;
      readonly attempts?: readonly FfmpegDiscoveryAttempt[] | undefined;
    };
    readonly ffmpegEncodeReady?: DoctorCheck | undefined;
  };
  readonly fullPass: boolean;
}

export interface DoctorDependencies {
  readonly platform?: NodeJS.Platform | undefined;
  readonly osRelease?: string | undefined;
  readonly probePearAuth?: ((config: DoctorConfig) => Promise<void>) | undefined;
  readonly probePearWebSocket?: ((config: DoctorConfig) => Promise<void>) | undefined;
  readonly findConnectablePluginExportBootstrapCandidate?:
    | (() => Promise<PluginExportBootstrapCandidate>)
    | undefined;
  readonly discoverFfmpeg?:
    | ((config: DoctorConfig) => Promise<FfmpegDiscoveryResult>)
    | undefined;
  readonly probeFfmpegPcmEncodeReadiness?:
    | ((
      config: DoctorConfig,
      executablePath: string,
      pcm: PluginExportReadyResult['pcm'],
    ) => Promise<FfmpegPcmEncodeReadiness>)
    | undefined;
}
