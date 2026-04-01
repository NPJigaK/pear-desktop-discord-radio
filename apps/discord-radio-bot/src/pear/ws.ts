import { parsePearWebSocketMessage } from './messages.js';

export type PearWebSocketFactory = (
  url: string | URL,
  protocols?: string | string[],
  init?: WebSocketInit,
) => WebSocket;

export interface PearWebSocketClientOptions {
  readonly host: '127.0.0.1';
  readonly port: number;
  readonly getAccessToken: () => Promise<string>;
  readonly webSocketFactory?: PearWebSocketFactory | undefined;
}

type PearWebSocketListener = (message: ReturnType<typeof parsePearWebSocketMessage>) => void;

export class PearWebSocketClient {
  private readonly url: string;

  private readonly getAccessToken: () => Promise<string>;

  private readonly webSocketFactory: PearWebSocketFactory;

  private readonly listeners = new Set<PearWebSocketListener>();

  private socket: WebSocket | undefined;

  private connectPromise: Promise<WebSocket> | undefined;

  private connectionSequence = 0;

  public constructor(options: PearWebSocketClientOptions) {
    this.url = `ws://${options.host}:${options.port}/api/v1/ws`;
    this.getAccessToken = options.getAccessToken;
    this.webSocketFactory =
      options.webSocketFactory ??
      ((url, protocols, init) => {
        if (protocols !== undefined) {
          return new WebSocket(url, protocols);
        }

        return new WebSocket(url, init);
      });
  }

  public connect(): Promise<WebSocket> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.socket);
    }

    if (this.connectPromise !== undefined) {
      return this.connectPromise;
    }

    const connectionSequence = ++this.connectionSequence;
    this.connectPromise = this.openSocket(connectionSequence);
    return this.connectPromise;
  }

  public subscribe(listener: PearWebSocketListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public close(code?: number, reason?: string): void {
    this.connectionSequence += 1;
    this.connectPromise = undefined;
    this.socket?.close(code, reason);
    this.socket = undefined;
  }

  private async openSocket(connectionSequence: number): Promise<WebSocket> {
    try {
      const accessToken = await this.getAccessToken();
      if (connectionSequence !== this.connectionSequence) {
        throw new Error('Pear websocket connection was canceled');
      }

      const socket = this.webSocketFactory(this.url, undefined, {
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      this.socket = socket;
      socket.addEventListener('message', (event) => {
        const message = parsePearWebSocketMessage(event.data);
        if (message === null) {
          return;
        }

        for (const listener of this.listeners) {
          listener(message);
        }
      });

      return await new Promise<WebSocket>((resolve, reject) => {
        const handleOpen = () => {
          cleanup();
          this.connectPromise = undefined;
          resolve(socket);
        };
        const handleError = () => {
          cleanup();
          this.connectPromise = undefined;
          if (this.socket === socket) {
            this.socket = undefined;
          }
          reject(new Error('Pear websocket connection failed'));
        };
        const handleClose = () => {
          cleanup();
          this.connectPromise = undefined;
          if (this.socket === socket) {
            this.socket = undefined;
          }
          reject(new Error('Pear websocket connection closed before opening'));
        };
        const cleanup = () => {
          socket.removeEventListener('open', handleOpen);
          socket.removeEventListener('error', handleError);
          socket.removeEventListener('close', handleClose);
        };

        socket.addEventListener('open', handleOpen, { once: true });
        socket.addEventListener('error', handleError, { once: true });
        socket.addEventListener('close', handleClose, { once: true });
      });
    } catch (error) {
      if (connectionSequence === this.connectionSequence) {
        this.connectPromise = undefined;
      }
      throw error;
    }
  }
}
