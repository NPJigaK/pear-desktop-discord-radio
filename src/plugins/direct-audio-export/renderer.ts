import { createRenderer } from '@/utils';

import {
  createDirectAudioExportPcmContract,
  DIRECT_AUDIO_EXPORT_CLIENT_STATE_CHANNEL,
  DIRECT_AUDIO_EXPORT_CLIENT_STATE_QUERY_CHANNEL,
  DIRECT_AUDIO_EXPORT_BOOTSTRAP_CHANNEL,
  DIRECT_AUDIO_EXPORT_FRAME_CHANNEL,
  type DirectAudioExportClientState,
} from './shared';
import {
  attachExportCapture,
  detachExportCapture,
  setMonitorSuppressed,
} from './audio-graph.js';
import {
  getUnsupportedDirectAudioExportConflictIds,
  isUnsupportedDirectAudioExportConflictPlugin,
} from './audio-graph-conflicts.js';

import type { RendererContext } from '@/types/contexts';
import type { DirectAudioExportPluginConfig } from './index';

const LOGGER_PREFIX = '[DirectAudioExport]';
const PLUGIN_ENABLE_CHANNEL = 'plugin:enable';
const PLUGIN_UNLOAD_CHANNEL = 'plugin:unload';

interface AudioCanPlayDetail {
  readonly audioContext: AudioContext;
  readonly audioSource: MediaElementAudioSourceNode;
}

interface CaptureState {
  readonly source: MediaElementAudioSourceNode;
  readonly destination: AudioDestinationNode;
  readonly monitorGain: GainNode;
  readonly processor: ScriptProcessorNode;
  readonly silentGain: GainNode;
}

function safeDisconnect(fn: () => void) {
  try {
    fn();
  } catch {}
}

function floatToInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

function encodePcm16le(input: AudioBuffer): Uint8Array {
  const frames = input.length;
  const left = input.getChannelData(0);
  const right = input.numberOfChannels > 1 ? input.getChannelData(1) : left;
  const output = new Int16Array(frames * 2);

  for (let index = 0; index < frames; index += 1) {
    const outputIndex = index * 2;
    output[outputIndex] = floatToInt16(left[index] ?? 0);
    output[outputIndex + 1] = floatToInt16(right[index] ?? 0);
  }

  return new Uint8Array(output.buffer);
}

export const renderer = createRenderer<
  {
    context?: RendererContext<DirectAudioExportPluginConfig>;
    capture?: CaptureState;
    monitorSuppressed: boolean;
    hasReceivedClientStateUpdate: boolean;
    conflictingPluginIds: Set<string>;
    unsupportedConflictKey?: string;
    audioCanPlayHandler: (event: CustomEvent<AudioCanPlayDetail>) => void;
    clientStateHandler: (clientAttached: DirectAudioExportClientState) => void;
    pluginEnableHandler: (pluginId: string) => void;
    pluginUnloadHandler: (pluginId: string) => void;
    clientStateIpcListener?: (
      _event: unknown,
      clientAttached: DirectAudioExportClientState,
    ) => void;
    pluginEnableIpcListener?: (_event: unknown, pluginId: string) => void;
    pluginUnloadIpcListener?: (_event: unknown, pluginId: string) => void;
    resetCapture: () => void;
    logUnsupportedConflicts: (conflictIds: string[]) => void;
    syncConflictState: () => void;
    setConflictPluginState: (pluginId: string, enabled: boolean) => void;
  },
  DirectAudioExportPluginConfig
>({
  monitorSuppressed: false,
  hasReceivedClientStateUpdate: false,
  conflictingPluginIds: new Set(),

  resetCapture() {
    if (!this.capture) {
      return;
    }

    const capture = this.capture;
    capture.processor.onaudioprocess = null;
    safeDisconnect(() => detachExportCapture(capture));
    this.capture = undefined;
  },

  clientStateHandler(clientAttached) {
    this.hasReceivedClientStateUpdate = true;
    this.monitorSuppressed = clientAttached;

    if (this.capture) {
      setMonitorSuppressed(this.capture, this.monitorSuppressed);
    }
  },

  pluginEnableHandler(pluginId) {
    this.setConflictPluginState(pluginId, true);
  },

  pluginUnloadHandler(pluginId) {
    this.setConflictPluginState(pluginId, false);
  },

  logUnsupportedConflicts(conflictIds) {
    const conflictKey = conflictIds.join(',');
    if (this.unsupportedConflictKey === conflictKey) {
      return;
    }

    this.unsupportedConflictKey = conflictKey;
    console.error(
      LOGGER_PREFIX,
      'Direct Audio Export is unsupported while these graph-mutating plugins are enabled:',
      conflictIds.join(', '),
    );
  },

  setConflictPluginState(pluginId, enabled) {
    if (!isUnsupportedDirectAudioExportConflictPlugin(pluginId)) {
      return;
    }

    if (enabled) {
      this.conflictingPluginIds.add(pluginId);
    } else {
      this.conflictingPluginIds.delete(pluginId);
    }

    this.syncConflictState();
  },

  syncConflictState() {
    const conflictIds = [...this.conflictingPluginIds].sort();

    if (conflictIds.length) {
      this.resetCapture();
      this.logUnsupportedConflicts(conflictIds);
      return;
    }

    if (this.unsupportedConflictKey) {
      this.unsupportedConflictKey = undefined;
      console.error(
        LOGGER_PREFIX,
        'Direct Audio Export conflict cleared; export will resume on the next audio-can-play.',
      );
    }
  },

  audioCanPlayHandler({ detail: { audioContext, audioSource } }) {
    if (!this.context) {
      return;
    }

    if (this.conflictingPluginIds.size) {
      const conflictIds = [...this.conflictingPluginIds].sort();
      this.resetCapture();
      this.logUnsupportedConflicts(conflictIds);
      return;
    }

    this.unsupportedConflictKey = undefined;
    this.resetCapture();

    const processor = audioContext.createScriptProcessor(4096, 2, 2);
    const monitorGain = audioContext.createGain();
    const silentGain = audioContext.createGain();
    monitorGain.gain.value = 1;
    silentGain.gain.value = 0;

    processor.onaudioprocess = (event) => {
      this.context?.ipc.send(
        DIRECT_AUDIO_EXPORT_FRAME_CHANNEL,
        encodePcm16le(event.inputBuffer),
      );
    };

    this.capture = {
      source: audioSource,
      destination: audioContext.destination,
      monitorGain,
      processor,
      silentGain,
    };

    attachExportCapture(this.capture);
    setMonitorSuppressed(this.capture, this.monitorSuppressed);

    this.context.ipc.send(
      DIRECT_AUDIO_EXPORT_BOOTSTRAP_CHANNEL,
      createDirectAudioExportPcmContract(audioContext.sampleRate),
    );
  },

  async start(context) {
    this.context = context;
    this.hasReceivedClientStateUpdate = false;
    this.clientStateIpcListener = (_event, clientAttached) => {
      this.clientStateHandler(clientAttached);
    };
    this.pluginEnableIpcListener = (_event, pluginId) => {
      this.pluginEnableHandler(pluginId);
    };
    this.pluginUnloadIpcListener = (_event, pluginId) => {
      this.pluginUnloadHandler(pluginId);
    };

    window.ipcRenderer.on(
      DIRECT_AUDIO_EXPORT_CLIENT_STATE_CHANNEL,
      this.clientStateIpcListener,
    );
    window.ipcRenderer.on(PLUGIN_ENABLE_CHANNEL, this.pluginEnableIpcListener);
    window.ipcRenderer.on(PLUGIN_UNLOAD_CHANNEL, this.pluginUnloadIpcListener);
    this.conflictingPluginIds = new Set(
      getUnsupportedDirectAudioExportConflictIds(
        window.mainConfig.plugins.getPlugins(),
      ),
    );
    this.syncConflictState();
    try {
      const clientAttached = Boolean(
        await this.context.ipc.invoke(
          DIRECT_AUDIO_EXPORT_CLIENT_STATE_QUERY_CHANNEL,
        ),
      );

      if (!this.hasReceivedClientStateUpdate) {
        this.clientStateHandler(clientAttached);
      }
    } catch {
      if (!this.hasReceivedClientStateUpdate) {
        this.clientStateHandler(false);
      }
    }
    document.addEventListener('peard:audio-can-play', this.audioCanPlayHandler, {
      passive: true,
    });
  },

  stop() {
    document.removeEventListener('peard:audio-can-play', this.audioCanPlayHandler);
    if (this.clientStateIpcListener) {
      window.ipcRenderer.removeListener(
        DIRECT_AUDIO_EXPORT_CLIENT_STATE_CHANNEL,
        this.clientStateIpcListener,
      );
      this.clientStateIpcListener = undefined;
    }
    if (this.pluginEnableIpcListener) {
      window.ipcRenderer.removeListener(
        PLUGIN_ENABLE_CHANNEL,
        this.pluginEnableIpcListener,
      );
      this.pluginEnableIpcListener = undefined;
    }
    if (this.pluginUnloadIpcListener) {
      window.ipcRenderer.removeListener(
        PLUGIN_UNLOAD_CHANNEL,
        this.pluginUnloadIpcListener,
      );
      this.pluginUnloadIpcListener = undefined;
    }
    this.resetCapture();
    this.monitorSuppressed = false;
    this.hasReceivedClientStateUpdate = false;
    this.conflictingPluginIds = new Set();
    this.unsupportedConflictKey = undefined;
    this.context = undefined;
  },
});
