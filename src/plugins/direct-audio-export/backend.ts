import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname, join } from 'node:path';

import { app, ipcMain, type IpcMainEvent } from 'electron';

import { createBackend } from '@/utils';
import type { BackendContext } from '@/types/contexts';

import {
  createDirectAudioExportBootstrap,
  DIRECT_AUDIO_EXPORT_CLIENT_STATE_CHANNEL,
  DIRECT_AUDIO_EXPORT_CLIENT_STATE_QUERY_CHANNEL,
  DIRECT_AUDIO_EXPORT_BOOTSTRAP_CHANNEL,
  DIRECT_AUDIO_EXPORT_BOOTSTRAP_DIRECTORY_NAME,
  DIRECT_AUDIO_EXPORT_FRAME_CHANNEL,
  type DirectAudioExportBootstrap,
  type DirectAudioExportPcmContract,
  type DirectAudioExportStreamState,
} from './shared';
import { createBootstrapHeartbeat } from './bootstrap-heartbeat.js';

import type { DirectAudioExportPluginConfig } from './index';

const LOGGER_PREFIX = '[DirectAudioExport]';

function normalizeFrameChunk(
  value: ArrayBuffer | Uint8Array,
): Buffer {
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }

  return Buffer.from(value);
}

export const backend = createBackend<
  {
    sessionId?: string;
    pipePath?: string;
    bootstrapPath?: string;
    server?: Server;
    client?: Socket;
    context?: BackendContext<DirectAudioExportPluginConfig>;
    clientAttached: boolean;
    acceptsFrames: boolean;
    bootstrapPcm?: DirectAudioExportPcmContract;
    streamState: DirectAudioExportStreamState;
    droppedFrameCount: number;
    bootstrapUpdates: Promise<void>;
    bootstrapHeartbeat?: ReturnType<typeof createBootstrapHeartbeat>;
    bootstrapListener?: (
      _event: IpcMainEvent,
      pcm: DirectAudioExportPcmContract,
    ) => Promise<void>;
    clientStateQueryHandler?: () => boolean;
    frameListener?: (
      _event: IpcMainEvent,
      chunk: ArrayBuffer | Uint8Array,
    ) => void;
    attachClient: (socket: Socket) => void;
    logBootstrapUpdateFailure: (
      label: string,
      error: unknown,
    ) => void;
    persistBootstrap: (label: string) => Promise<void>;
    scheduleBootstrapPersist: (label: string) => void;
    updateStreamState: (
      streamState: DirectAudioExportStreamState,
      label: string,
    ) => void;
    setClientAttached: (clientAttached: boolean, label: string) => void;
    recordDroppedFrame: (
      streamState: DirectAudioExportStreamState,
      label: string,
    ) => void;
  },
  DirectAudioExportPluginConfig
>({
  streamState: 'waiting-for-client',
  clientAttached: false,
  acceptsFrames: true,
  droppedFrameCount: 0,
  bootstrapUpdates: Promise.resolve(),

  logBootstrapUpdateFailure(label, error) {
    console.error(LOGGER_PREFIX, `Bootstrap update failed during ${label}.`, error);
  },

  async persistBootstrap(label) {
    if (
      !(
        this.bootstrapPath &&
        this.sessionId &&
        this.pipePath &&
        this.bootstrapPcm
      )
    ) {
      return;
    }

    const bootstrap: DirectAudioExportBootstrap =
      createDirectAudioExportBootstrap({
        sessionId: this.sessionId,
        bootstrapPath: this.bootstrapPath,
        pipePath: this.pipePath,
        streamState: this.streamState,
        droppedFrameCount: this.droppedFrameCount,
        pcm: this.bootstrapPcm,
      });

    await writeFile(
      this.bootstrapPath,
      JSON.stringify(bootstrap, null, 2),
      'utf8',
    );
    if (label !== 'heartbeat') {
      console.log(LOGGER_PREFIX, 'Bootstrap contract updated.', {
        label,
        bootstrapPath: this.bootstrapPath,
        streamState: this.streamState,
        droppedFrameCount: this.droppedFrameCount,
      });
    }
  },

  scheduleBootstrapPersist(label) {
    this.bootstrapUpdates = this.bootstrapUpdates
      .then(() => this.persistBootstrap(label))
      .catch((error: unknown) => {
        this.logBootstrapUpdateFailure(label, error);
        this.streamState = 'error';
      });
  },

  updateStreamState(streamState, label) {
    if (this.streamState === streamState) {
      return;
    }

    this.streamState = streamState;
    this.scheduleBootstrapPersist(label);
  },

  setClientAttached(clientAttached, label) {
    if (this.clientAttached === clientAttached) {
      return;
    }

    this.clientAttached = clientAttached;
    this.context?.ipc.send(
      DIRECT_AUDIO_EXPORT_CLIENT_STATE_CHANNEL,
      clientAttached,
    );
    console.log(LOGGER_PREFIX, 'Export client attachment changed.', {
      label,
      clientAttached,
    });
  },

  recordDroppedFrame(streamState, label) {
    this.droppedFrameCount += 1;
    if (this.streamState !== streamState || this.droppedFrameCount % 100 === 0) {
      this.streamState = streamState;
      this.scheduleBootstrapPersist(label);
    }
  },

  attachClient(socket) {
    this.client?.destroy();
    this.client = socket;
    this.acceptsFrames = true;
    this.setClientAttached(true, 'client-attached');
    this.updateStreamState('connected', 'client-attached');

    socket.on('drain', () => {
      if (this.client === socket) {
        this.acceptsFrames = true;
        this.updateStreamState('connected', 'client-drain');
      }
    });

    socket.on('close', () => {
      if (this.client === socket) {
        this.client = undefined;
        this.acceptsFrames = true;
        this.setClientAttached(false, 'client-close');
        this.updateStreamState('waiting-for-client', 'client-close');
      }
    });

    socket.on('error', (error) => {
      console.error(LOGGER_PREFIX, 'Named pipe client failed.', error);
      if (this.client === socket) {
        this.client = undefined;
        this.acceptsFrames = false;
        this.setClientAttached(false, 'client-error');
      }
      this.updateStreamState('error', 'client-error');
    });
  },

  async start(context: BackendContext<DirectAudioExportPluginConfig>) {
    this.context = context;
    this.sessionId = randomUUID();
    this.pipePath = `\\\\.\\pipe\\pear-direct-audio-${this.sessionId}`;
    this.bootstrapPath = join(
      app.getPath('temp'),
      DIRECT_AUDIO_EXPORT_BOOTSTRAP_DIRECTORY_NAME,
      `${this.sessionId}.json`,
    );
    this.streamState = 'waiting-for-client';
    this.clientAttached = false;
    this.acceptsFrames = true;
    this.droppedFrameCount = 0;
    this.bootstrapPcm = undefined;
    this.bootstrapUpdates = Promise.resolve();
    this.bootstrapHeartbeat = undefined;

    await mkdir(dirname(this.bootstrapPath), {
      recursive: true,
    });

    this.server = createServer((socket) => {
      this.attachClient(socket);
    });
    this.server.on('error', (error) => {
      console.error(LOGGER_PREFIX, 'Named pipe server failed.', error);
      this.setClientAttached(false, 'server-error');
      this.updateStreamState('error', 'server-error');
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.pipePath!, () => resolve());
    });

    this.bootstrapListener = async (_event, pcm) => {
      this.bootstrapPcm = pcm;
      this.streamState = this.client ? 'connected' : 'waiting-for-client';
      this.bootstrapHeartbeat?.start();

      try {
        await this.persistBootstrap('audio-bootstrap');
      } catch (error) {
        this.streamState = 'error';
        this.logBootstrapUpdateFailure('audio-bootstrap', error);
      }
    };

    this.clientStateQueryHandler = () => this.clientAttached;
    this.context.ipc.handle(
      DIRECT_AUDIO_EXPORT_CLIENT_STATE_QUERY_CHANNEL,
      this.clientStateQueryHandler,
    );

    this.frameListener = (_event, chunk) => {
      if (!this.bootstrapPcm) {
        this.recordDroppedFrame('dropping', 'frame-before-bootstrap');
        return;
      }

      if (!this.client) {
        this.recordDroppedFrame('waiting-for-client', 'frame-without-client');
        return;
      }

      if (!this.acceptsFrames || this.client.writableNeedDrain) {
        this.acceptsFrames = false;
        this.recordDroppedFrame('dropping', 'frame-dropped-during-backpressure');
        return;
      }

      if (!this.client.write(normalizeFrameChunk(chunk))) {
        this.acceptsFrames = false;
        console.warn(
          LOGGER_PREFIX,
          'Named pipe backpressure detected; dropping frames until drain.',
        );
        this.recordDroppedFrame('dropping', 'frame-backpressure');
      }
    };

    ipcMain.on(DIRECT_AUDIO_EXPORT_BOOTSTRAP_CHANNEL, this.bootstrapListener);
    ipcMain.on(DIRECT_AUDIO_EXPORT_FRAME_CHANNEL, this.frameListener);
    this.bootstrapHeartbeat = createBootstrapHeartbeat({
      onTick: () => {
        if (
          !this.bootstrapPcm ||
          this.streamState === 'stopped' ||
          this.streamState === 'error'
        ) {
          return;
        }

        this.scheduleBootstrapPersist('heartbeat');
      },
    });

    console.log(LOGGER_PREFIX, 'Named pipe producer started.', {
      pipePath: this.pipePath,
      bootstrapPath: this.bootstrapPath,
      sessionId: this.sessionId,
    });
  },

  async stop() {
    this.bootstrapHeartbeat?.stop();
    this.bootstrapHeartbeat = undefined;

    if (this.bootstrapListener) {
      ipcMain.off(
        DIRECT_AUDIO_EXPORT_BOOTSTRAP_CHANNEL,
        this.bootstrapListener,
      );
      this.bootstrapListener = undefined;
    }

    if (this.clientStateQueryHandler) {
      this.context?.ipc.removeHandler(
        DIRECT_AUDIO_EXPORT_CLIENT_STATE_QUERY_CHANNEL,
      );
      this.clientStateQueryHandler = undefined;
    }

    if (this.frameListener) {
      ipcMain.off(DIRECT_AUDIO_EXPORT_FRAME_CHANNEL, this.frameListener);
      this.frameListener = undefined;
    }

    this.streamState = 'stopped';
    this.setClientAttached(false, 'stop');
    this.scheduleBootstrapPersist('stop');
    await this.bootstrapUpdates;

    const client = this.client;
    this.client = undefined;
    client?.destroy();
    this.acceptsFrames = true;
    this.clientAttached = false;

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = undefined;
    }

    this.bootstrapPcm = undefined;
    this.bootstrapPath = undefined;
    this.pipePath = undefined;
    this.sessionId = undefined;
    this.bootstrapUpdates = Promise.resolve();
    this.context = undefined;
  },
});
