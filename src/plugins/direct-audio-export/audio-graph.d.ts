export interface DirectAudioExportGraph {
  source: MediaElementAudioSourceNode;
  destination: AudioNode;
  monitorGain: GainNode;
  processor: ScriptProcessorNode;
  silentGain: GainNode;
}

export function attachExportCapture(
  graph: DirectAudioExportGraph,
): void;

export function setMonitorSuppressed(
  graph: DirectAudioExportGraph,
  suppressed: boolean,
): void;

export function detachExportCapture(
  graph: DirectAudioExportGraph,
): void;
