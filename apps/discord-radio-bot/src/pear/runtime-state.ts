import { transitionPearState, type PearState } from '../state/index.js';
import type { RadioNowPlayingProvider, RadioNowPlayingState } from '../discord/types.js';
import type { RuntimeLogger } from '../logging/index.js';
import {
  createPearPlayerStateProjector,
  PearClient,
  PearWebSocketClient,
  type PearSong,
  type PearWebSocketMessage,
} from './index.js';

type WebSocketLike = EventTarget;

interface SchedulableTaskHandle {
  cancel(): void;
}

type ReconnectScheduler = (
  task: () => void | Promise<void>,
  delayMs: number,
) => SchedulableTaskHandle;

type PearClientLike = Pick<PearClient, 'getCurrentSong'>;
type PearWebSocketClientLike = Pick<
  PearWebSocketClient,
  'connect' | 'subscribe' | 'close'
>;

export interface PearRuntimeStateSnapshot {
  readonly status: PearState;
  readonly staleReason?: string | undefined;
  readonly song?: PearSong | undefined;
}

export interface PearRuntimeStateCoordinator extends RadioNowPlayingProvider {
  start(): Promise<void>;
  stop(): Promise<void>;
  getRuntimeState(): PearRuntimeStateSnapshot;
}

export interface CreatePearRuntimeStateCoordinatorOptions {
  readonly pearClient: PearClientLike;
  readonly pearWebSocketClient: PearWebSocketClientLike;
  readonly logger: RuntimeLogger;
  readonly reconnectDelayMs?: number | undefined;
  readonly scheduleReconnect?: ReconnectScheduler | undefined;
}

function defaultScheduleReconnect(
  task: () => void | Promise<void>,
  delayMs: number,
): SchedulableTaskHandle {
  const timeoutId = setTimeout(() => {
    void task();
  }, delayMs);

  return {
    cancel() {
      clearTimeout(timeoutId);
    },
  };
}

function toReconnectReason(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  return 'unknown reconnect error';
}

export function createPearRuntimeStateCoordinator(
  options: CreatePearRuntimeStateCoordinatorOptions,
): PearRuntimeStateCoordinator {
  const projector = createPearPlayerStateProjector();
  const logger = options.logger.child({
    component: 'pear-runtime-state',
  });
  const reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
  const scheduleReconnect = options.scheduleReconnect ?? defaultScheduleReconnect;

  let status: PearState = 'offline';
  let staleReason: string | undefined;
  let song: PearSong | undefined;
  let connectedSocket: WebSocketLike | undefined;
  let removeSocketListeners: (() => void) | undefined;
  let unsubscribeMessages: (() => void) | undefined;
  let reconnectTask: SchedulableTaskHandle | undefined;
  let started = false;

  const updateSongFromProjector = (message: PearWebSocketMessage | null) => {
    if (message === null) {
      return;
    }

    const snapshot = projector.apply(message);
    song = snapshot.song;
  };

  const detachSocket = () => {
    removeSocketListeners?.();
    removeSocketListeners = undefined;
    connectedSocket = undefined;
  };

  const transitionTo = (next: PearState) => {
    status = transitionPearState(status, next);
  };

  const transitionToOffline = () => {
    if (status !== 'offline') {
      transitionTo('offline');
    }

    staleReason = undefined;
    song = undefined;
  };

  const markDegraded = (reason: string) => {
    staleReason = reason;
    if (status === 'ready') {
      transitionTo('degraded');
      return;
    }

    if (status === 'connecting') {
      transitionTo('degraded');
    }
  };

  const attachSocket = (socket: WebSocketLike) => {
    connectedSocket = socket;

    const handleDisconnect = () => {
      if (!started || connectedSocket !== socket || status === 'offline') {
        return;
      }

      detachSocket();
      markDegraded('Pear websocket disconnected.');
      reconnectTask?.cancel();
      reconnectTask = scheduleReconnect(async () => {
        if (!started || status !== 'degraded') {
          return;
        }

        reconnectTask = undefined;
        transitionTo('connecting');

        try {
          const nextSocket = await options.pearWebSocketClient.connect();
          attachSocket(nextSocket as WebSocketLike);
          staleReason = undefined;
          transitionTo('ready');
          logger.info('Pear websocket reconnect succeeded.');
        } catch (error) {
          markDegraded(
            `Pear websocket reconnect failed: ${toReconnectReason(error)}`,
          );
          logger.warn('Pear websocket reconnect failed.', {
            error: toReconnectReason(error),
          });
        }
      }, reconnectDelayMs);
    };

    socket.addEventListener('close', handleDisconnect);
    socket.addEventListener('error', handleDisconnect);

    removeSocketListeners = () => {
      socket.removeEventListener('close', handleDisconnect);
      socket.removeEventListener('error', handleDisconnect);
    };
  };

  return {
    async start() {
      if (started) {
        return;
      }

      started = true;
      transitionTo('connecting');
      try {
        song = (await options.pearClient.getCurrentSong()) ?? undefined;
      } catch (error) {
        started = false;
        unsubscribeMessages?.();
        unsubscribeMessages = undefined;
        reconnectTask?.cancel();
        reconnectTask = undefined;
        detachSocket();
        transitionToOffline();
        throw error;
      }

      unsubscribeMessages = options.pearWebSocketClient.subscribe(
        updateSongFromProjector,
      );

      try {
        const socket = await options.pearWebSocketClient.connect();
        attachSocket(socket as WebSocketLike);
      } catch (error) {
        started = false;
        unsubscribeMessages?.();
        unsubscribeMessages = undefined;
        detachSocket();
        transitionToOffline();
        throw error;
      }

      staleReason = undefined;
      transitionTo('ready');
      logger.info('Pear runtime state coordinator started.');
    },
    async stop() {
      if (!started && status === 'offline') {
        return;
      }

      reconnectTask?.cancel();
      reconnectTask = undefined;
      unsubscribeMessages?.();
      unsubscribeMessages = undefined;
      detachSocket();
      options.pearWebSocketClient.close();
      started = false;

      transitionToOffline();
      logger.info('Pear runtime state coordinator stopped.');
    },
    getRuntimeState() {
      if (staleReason === undefined) {
        if (song === undefined) {
          return {
            status,
          };
        }

        return {
          status,
          song,
        };
      }

      if (song === undefined) {
        return {
          status,
          staleReason,
        };
      }

      return {
        status,
        staleReason,
        song,
      };
    },
    getState(): RadioNowPlayingState {
      if (status === 'ready') {
        return song === undefined
          ? {
            status,
          }
          : {
            status,
            song,
          };
      }

      if (status === 'degraded') {
        return song === undefined
          ? {
            status,
            staleReason: staleReason ?? 'Pear websocket projection is stale.',
          }
          : {
            status,
            staleReason: staleReason ?? 'Pear websocket projection is stale.',
            song,
          };
      }

      return {
        status,
      };
    },
  };
}
