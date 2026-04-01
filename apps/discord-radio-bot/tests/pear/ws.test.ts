import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PearWebSocketClient,
  createPearPlayerStateProjector,
  parsePearWebSocketMessage,
} from '../../src/pear/index.js';

class FakeWebSocket extends EventTarget {
  public readonly sent: string[] = [];

  public closeCalls = 0;

  public readyState = WebSocket.CONNECTING;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close'));
  }

  emitOpen(): void {
    this.readyState = WebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  emitMessage(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }

  emitError(): void {
    this.dispatchEvent(new Event('error'));
  }
}

test('PearWebSocketClient opens /api/v1/ws with the bearer token in headers', async () => {
  const socket = new FakeWebSocket();
  let capturedUrl = '';
  let capturedAuthorization = '';

  const client = new PearWebSocketClient({
    host: '127.0.0.1',
    port: 26538,
    getAccessToken: async () => 'ws-token',
    webSocketFactory: (url, protocols, init) => {
      capturedUrl = String(url);
      capturedAuthorization = new Headers(init?.headers).get('authorization') ?? '';
      assert.equal(protocols, undefined);
      queueMicrotask(() => {
        socket.emitOpen();
      });
      return socket as unknown as WebSocket;
    },
  });

  await client.connect();

  assert.equal(capturedUrl, 'ws://127.0.0.1:26538/api/v1/ws');
  assert.equal(capturedAuthorization, 'Bearer ws-token');
});

test('PearWebSocketClient shares one in-flight connect promise and waits for open', async () => {
  const socket = new FakeWebSocket();
  let factoryCalls = 0;

  const client = new PearWebSocketClient({
    host: '127.0.0.1',
    port: 26538,
    getAccessToken: async () => 'ws-token',
    webSocketFactory: () => {
      factoryCalls += 1;
      return socket as unknown as WebSocket;
    },
  });

  const firstConnect = client.connect();
  const secondConnect = client.connect();

  assert.strictEqual(firstConnect, secondConnect);

  let resolvedSocket: WebSocket | undefined;
  void secondConnect.then((value) => {
    resolvedSocket = value;
  });

  await Promise.resolve();
  assert.equal(factoryCalls, 1);
  assert.equal(resolvedSocket, undefined);

  socket.emitOpen();

  const openSocket = await firstConnect;
  assert.strictEqual(openSocket, socket as unknown as WebSocket);
  assert.strictEqual(resolvedSocket, socket as unknown as WebSocket);
});

test('parsePearWebSocketMessage validates events and projector applies incremental updates', () => {
  const projector = createPearPlayerStateProjector();

  const infoEvent = parsePearWebSocketMessage(
    JSON.stringify({
      type: 'PLAYER_INFO',
      song: {
        videoId: 'video-1',
        title: 'First Song',
      },
      isPlaying: true,
      muted: false,
      position: 12,
      volume: 30,
      repeat: 'ALL',
      shuffle: true,
    }),
  );

  assert.ok(infoEvent);
  assert.deepStrictEqual(projector.apply(infoEvent), {
    song: {
      videoId: 'video-1',
      title: 'First Song',
    },
    isPlaying: true,
    muted: false,
    position: 12,
    volume: 30,
    repeat: 'ALL',
    shuffle: true,
  });

  const repeatEvent = parsePearWebSocketMessage(
    JSON.stringify({
      type: 'REPEAT_CHANGED',
      repeat: 'ONE',
    }),
  );

  assert.ok(repeatEvent);
  assert.deepStrictEqual(projector.apply(repeatEvent), {
    song: {
      videoId: 'video-1',
      title: 'First Song',
    },
    isPlaying: true,
    muted: false,
    position: 12,
    volume: 30,
    repeat: 'ONE',
    shuffle: true,
  });

  const volumeEvent = parsePearWebSocketMessage(
    JSON.stringify({
      type: 'VOLUME_CHANGED',
      volume: 45,
      muted: true,
    }),
  );

  assert.ok(volumeEvent);
  assert.deepStrictEqual(projector.apply(volumeEvent), {
    song: {
      videoId: 'video-1',
      title: 'First Song',
    },
    isPlaying: true,
    muted: true,
    position: 12,
    volume: 45,
    repeat: 'ONE',
    shuffle: true,
  });

  assert.equal(
    parsePearWebSocketMessage(
      JSON.stringify({
        type: 'PLAYER_STATE_CHANGED',
        isPlaying: true,
        position: 'bad',
      }),
    ),
    null,
  );
});
