import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createPluginExportProvider,
  loadPluginExportBootstrapCandidate,
  type FindConnectablePluginExportBootstrapInput,
  findConnectablePluginExportBootstrap,
  loadPluginExportBootstrap,
  parsePluginExportHandshake,
} from '../../src/audio/plugin-export.js';

function createValidHandshake() {
  return {
    version: 1,
    kind: 'plugin',
    transport: 'named-pipe',
    sessionId: 'plugin-session-123',
    bootstrapPath: 'C:\\temp\\pear-direct-audio-export\\plugin-session-123.json',
    bootstrapWrittenAt: '2026-03-31T00:00:00.000Z',
    pipePath: '\\\\.\\pipe\\pear-direct-audio',
    streamState: 'waiting-for-client',
    droppedFrameCount: 0,
    pcm: {
      sampleRate: 48_000,
      channels: 2,
      bitsPerSample: 16,
    },
  };
}

test('parsePluginExportHandshake preserves the live transport details needed by the bot', () => {
  const result = parsePluginExportHandshake(
    JSON.stringify(createValidHandshake()),
  );

  assert.deepStrictEqual(result, {
    version: 1,
    kind: 'plugin',
    transport: 'named-pipe',
    sessionId: 'plugin-session-123',
    bootstrapPath: 'C:\\temp\\pear-direct-audio-export\\plugin-session-123.json',
    bootstrapWrittenAt: '2026-03-31T00:00:00.000Z',
    pipePath: '\\\\.\\pipe\\pear-direct-audio',
    streamState: 'waiting-for-client',
    droppedFrameCount: 0,
    pcm: {
      sampleRate: 48_000,
      channels: 2,
      bitsPerSample: 16,
    },
  });
});

test('parsePluginExportHandshake rejects a handshake with the wrong kind', () => {
  assert.throws(
    () =>
      parsePluginExportHandshake(
        JSON.stringify({
          ...createValidHandshake(),
          kind: 'private-patch',
        }),
      ),
    /Invalid plugin export handshake: expected kind "plugin"\./u,
  );
});

test('parsePluginExportHandshake rejects malformed JSON', () => {
  assert.throws(
    () => parsePluginExportHandshake('{'),
    /Invalid plugin export handshake: expected valid JSON\./u,
  );
});

test('parsePluginExportHandshake rejects a handshake with an unsupported transport', () => {
  assert.throws(
    () =>
      parsePluginExportHandshake(
        JSON.stringify({
          ...createValidHandshake(),
          transport: 'ipc',
        }),
      ),
    /Invalid plugin export handshake: expected transport "named-pipe"\./u,
  );
});

test('parsePluginExportHandshake rejects a handshake without a pcm object', () => {
  assert.throws(
    () =>
      parsePluginExportHandshake(
        JSON.stringify({
          ...createValidHandshake(),
          pcm: undefined,
        }),
      ),
    /Invalid plugin export handshake: expected pcm object\./u,
  );
});

test('parsePluginExportHandshake rejects a handshake without a bootstrap version', () => {
  assert.throws(
    () =>
      parsePluginExportHandshake(
        JSON.stringify({
          ...createValidHandshake(),
          version: undefined,
        }),
      ),
    /Invalid plugin export handshake: expected version 1\./u,
  );
});

test('parsePluginExportHandshake rejects a handshake without a session id', () => {
  assert.throws(
    () =>
      parsePluginExportHandshake(
        JSON.stringify({
          ...createValidHandshake(),
          sessionId: '',
        }),
      ),
    /Invalid plugin export handshake: expected non-empty sessionId\./u,
  );
});

test('parsePluginExportHandshake rejects a handshake without a named pipe path', () => {
  assert.throws(
    () =>
      parsePluginExportHandshake(
        JSON.stringify({
          ...createValidHandshake(),
          pipePath: '',
        }),
      ),
    /Invalid plugin export handshake: expected non-empty pipePath\./u,
  );
});

test('parsePluginExportHandshake rejects a handshake without a bootstrap path', () => {
  assert.throws(
    () =>
      parsePluginExportHandshake(
        JSON.stringify({
          ...createValidHandshake(),
          bootstrapPath: '',
        }),
      ),
    /Invalid plugin export handshake: expected non-empty bootstrapPath\./u,
  );
});

test('parsePluginExportHandshake rejects a handshake without a bootstrap timestamp', () => {
  assert.throws(
    () =>
      parsePluginExportHandshake(
        JSON.stringify({
          ...createValidHandshake(),
          bootstrapWrittenAt: '',
        }),
      ),
    /Invalid plugin export handshake: expected valid bootstrapWrittenAt timestamp\./u,
  );
});

test('parsePluginExportHandshake rejects a handshake without an explicit stream state', () => {
  assert.throws(
    () =>
      parsePluginExportHandshake(
        JSON.stringify({
          ...createValidHandshake(),
          streamState: 'ready',
        }),
      ),
    /Invalid plugin export handshake: expected streamState to be "waiting-for-client", "connected", "dropping", "stopped", or "error"\./u,
  );
});

test('parsePluginExportHandshake rejects a handshake with an invalid sample rate', () => {
  assert.throws(
    () =>
      parsePluginExportHandshake(
        JSON.stringify({
          ...createValidHandshake(),
          pcm: {
            ...createValidHandshake().pcm,
            sampleRate: 0,
          },
        }),
      ),
    /Invalid plugin export handshake: expected positive integer pcm\.sampleRate\./u,
  );
});

test('parsePluginExportHandshake rejects a handshake with the wrong channel count', () => {
  assert.throws(
    () =>
      parsePluginExportHandshake(
        JSON.stringify({
          ...createValidHandshake(),
          pcm: {
            ...createValidHandshake().pcm,
            channels: 1,
          },
        }),
      ),
    /Invalid plugin export handshake: expected pcm\.channels 2\./u,
  );
});

test('parsePluginExportHandshake rejects a handshake with the wrong bit depth', () => {
  assert.throws(
    () =>
      parsePluginExportHandshake(
        JSON.stringify({
          ...createValidHandshake(),
          pcm: {
            ...createValidHandshake().pcm,
            bitsPerSample: 24,
          },
        }),
      ),
    /Invalid plugin export handshake: expected pcm\.bitsPerSample 16\./u,
  );
});

test('loadPluginExportBootstrap rejects a bootstrap whose embedded path does not match the file path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'plugin-export-bootstrap-'));
  const bootstrapPath = join(directory, 'session.json');
  await writeFile(
    bootstrapPath,
    JSON.stringify({
      ...createValidHandshake(),
      bootstrapPath: join(directory, 'different-session.json'),
    }),
    'utf8',
  );

  await assert.rejects(
    () =>
      loadPluginExportBootstrap({
        bootstrapPath,
      }),
    /Invalid plugin export handshake: expected bootstrapPath to match the loaded bootstrap file path\./u,
  );
});

test('loadPluginExportBootstrap rejects a stale bootstrap when max age is enforced', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'plugin-export-bootstrap-'));
  const bootstrapPath = join(directory, 'session.json');
  await writeFile(
    bootstrapPath,
    JSON.stringify({
      ...createValidHandshake(),
      bootstrapPath,
      bootstrapWrittenAt: '2026-03-31T00:00:00.000Z',
    }),
    'utf8',
  );

  await assert.rejects(
    () =>
      loadPluginExportBootstrap({
        bootstrapPath,
        maxBootstrapAgeMs: 1_000,
        now: () => Date.parse('2026-03-31T00:00:02.000Z'),
      }),
    /Invalid plugin export handshake: bootstrap is stale\./u,
  );
});

test('loadPluginExportBootstrapCandidate preserves provider bootstrap readiness when the PCM contract is not runtime-safe', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'plugin-export-bootstrap-'));
  const bootstrapPath = join(directory, 'session.json');
  await writeFile(
    bootstrapPath,
    JSON.stringify({
      ...createValidHandshake(),
      bootstrapPath,
      pcm: {
        sampleRate: 44_100,
        channels: 2,
        bitsPerSample: 24,
      },
    }),
    'utf8',
  );

  const result = await loadPluginExportBootstrapCandidate({
    bootstrapPath,
  });

  assert.equal(result.bootstrapPath, bootstrapPath);
  assert.equal(result.pipePath, '\\\\.\\pipe\\pear-direct-audio');
  assert.deepStrictEqual(result.pcm, {
    sampleRate: 44_100,
    channels: 2,
    bitsPerSample: 24,
  });

  await assert.rejects(
    () =>
      loadPluginExportBootstrap({
        bootstrapPath,
      }),
    /Invalid plugin export handshake: expected pcm\.bitsPerSample 16\./u,
  );
});

test('findConnectablePluginExportBootstrap selects the freshest waiting-for-client bootstrap', async () => {
  const bootstrapDirectoryPath = 'C:\\temp\\pear-direct-audio-export';
  const candidates = [
    `${bootstrapDirectoryPath}\\stale-connectable.json`,
    `${bootstrapDirectoryPath}\\fresh-connectable.json`,
    `${bootstrapDirectoryPath}\\already-connected.json`,
  ];
  const loadCalls: string[] = [];

  const result = await findConnectablePluginExportBootstrap({
    bootstrapDirectoryPath,
    maxBootstrapAgeMs: 5_000,
    now: () => Date.parse('2026-03-31T00:00:06.000Z'),
    listBootstrapPaths: async () => candidates,
    loadBootstrap: async (input: {
      bootstrapPath: string;
      maxBootstrapAgeMs?: FindConnectablePluginExportBootstrapInput['maxBootstrapAgeMs'];
      now?: FindConnectablePluginExportBootstrapInput['now'];
    }) => {
      loadCalls.push(input.bootstrapPath);

      if (input.bootstrapPath.endsWith('already-connected.json')) {
        return loadPluginExportBootstrap({
          ...input,
          readBootstrapFile: async () =>
            JSON.stringify({
              ...createValidHandshake(),
              sessionId: 'already-connected',
              bootstrapPath: input.bootstrapPath,
              bootstrapWrittenAt: '2026-03-31T00:00:05.000Z',
              streamState: 'connected',
            }),
        });
      }

      if (input.bootstrapPath.endsWith('fresh-connectable.json')) {
        return loadPluginExportBootstrap({
          ...input,
          readBootstrapFile: async () =>
            JSON.stringify({
              ...createValidHandshake(),
              sessionId: 'fresh-connectable',
              bootstrapPath: input.bootstrapPath,
              bootstrapWrittenAt: '2026-03-31T00:00:04.000Z',
              streamState: 'waiting-for-client',
              pcm: {
                sampleRate: 44_100,
                channels: 2,
                bitsPerSample: 16,
              },
            }),
        });
      }

      return loadPluginExportBootstrap({
        ...input,
        readBootstrapFile: async () =>
          JSON.stringify({
            ...createValidHandshake(),
            sessionId: 'stale-connectable',
            bootstrapPath: input.bootstrapPath,
            bootstrapWrittenAt: '2026-03-31T00:00:00.000Z',
            streamState: 'waiting-for-client',
          }),
      });
    },
  });

  assert.equal(result.sessionId, 'fresh-connectable');
  assert.equal(result.streamState, 'waiting-for-client');
  assert.equal(result.pcm.sampleRate, 44_100);
  assert.deepStrictEqual(loadCalls, candidates);
});

test('findConnectablePluginExportBootstrap ignores connected bootstraps even when they are newer', async () => {
  const bootstrapDirectoryPath = 'C:\\temp\\pear-direct-audio-export';

  const result = await findConnectablePluginExportBootstrap({
    bootstrapDirectoryPath,
    maxBootstrapAgeMs: 5_000,
    now: () => Date.parse('2026-03-31T00:00:06.000Z'),
    listBootstrapPaths: async () => [
      `${bootstrapDirectoryPath}\\older.json`,
      `${bootstrapDirectoryPath}\\newest.json`,
    ],
    loadBootstrap: async (input: {
      bootstrapPath: string;
      maxBootstrapAgeMs?: FindConnectablePluginExportBootstrapInput['maxBootstrapAgeMs'];
      now?: FindConnectablePluginExportBootstrapInput['now'];
    }) =>
      loadPluginExportBootstrap({
        ...input,
        readBootstrapFile: async () =>
          JSON.stringify({
            ...createValidHandshake(),
            sessionId: input.bootstrapPath.endsWith('newest.json')
              ? 'newest'
              : 'older',
            bootstrapPath: input.bootstrapPath,
            bootstrapWrittenAt: input.bootstrapPath.endsWith('newest.json')
              ? '2026-03-31T00:00:05.000Z'
              : '2026-03-31T00:00:04.000Z',
            streamState: input.bootstrapPath.endsWith('newest.json')
              ? 'connected'
              : 'waiting-for-client',
          }),
      }),
  });

  assert.equal(result.sessionId, 'older');
});

test('findConnectablePluginExportBootstrap rejects when no fresh waiting-for-client bootstrap exists', async () => {
  await assert.rejects(
    () =>
      findConnectablePluginExportBootstrap({
        bootstrapDirectoryPath: 'C:\\temp\\pear-direct-audio-export',
        maxBootstrapAgeMs: 5_000,
        now: () => Date.parse('2026-03-31T00:00:06.000Z'),
        listBootstrapPaths: async () => [
          'C:\\temp\\pear-direct-audio-export\\connected.json',
          'C:\\temp\\pear-direct-audio-export\\stopped.json',
        ],
        loadBootstrap: async (input: {
          bootstrapPath: string;
          maxBootstrapAgeMs?: FindConnectablePluginExportBootstrapInput['maxBootstrapAgeMs'];
          now?: FindConnectablePluginExportBootstrapInput['now'];
        }) =>
          loadPluginExportBootstrap({
            ...input,
            readBootstrapFile: async () =>
              JSON.stringify({
                ...createValidHandshake(),
                sessionId: input.bootstrapPath.endsWith('connected.json')
                  ? 'connected'
                  : 'stopped',
                bootstrapPath: input.bootstrapPath,
                bootstrapWrittenAt: '2026-03-31T00:00:05.000Z',
                streamState: input.bootstrapPath.endsWith('connected.json')
                  ? 'connected'
                  : 'stopped',
              }),
          }),
      }),
    /No connectable plugin export bootstrap found\./u,
  );
});

test(
  'createPluginExportProvider connects to the named pipe declared by the bootstrap contract',
  { skip: process.platform !== 'win32' },
  async () => {
    const pipePath = `\\\\.\\pipe\\pear-direct-audio-test-${process.pid}-${Date.now()}`;
    const server = createServer();

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipePath, () => resolve());
    });

    const provider = createPluginExportProvider(
      parsePluginExportHandshake(
        JSON.stringify({
          ...createValidHandshake(),
          pipePath,
        }),
      ),
    );

    try {
      const serverConnectionPromise = once(server, 'connection');
      const running = await provider.start();
      const [serverSocket] = await serverConnectionPromise;
      const endEvents: string[] = [];

      running.onEnded((event) => {
        endEvents.push(event.reason);
      });

      const chunkPromise = once(running.stream, 'data');
      serverSocket.write(Buffer.from([1, 2, 3, 4]));
      const [chunk] = await chunkPromise;

      assert.deepStrictEqual(
        Buffer.from(chunk as Uint8Array),
        Buffer.from([1, 2, 3, 4]),
      );

      await running.stop();
      assert.deepStrictEqual(endEvents, ['stopped']);
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  },
);

test(
  'createPluginExportProvider emits an explicit end event when the producer closes the pipe',
  { skip: process.platform !== 'win32' },
  async () => {
    const pipePath = `\\\\.\\pipe\\pear-direct-audio-test-${process.pid}-${Date.now()}-ended`;
    const server = createServer();

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipePath, () => resolve());
    });

    const provider = createPluginExportProvider(
      parsePluginExportHandshake(
        JSON.stringify({
          ...createValidHandshake(),
          pipePath,
        }),
      ),
    );

    try {
      const serverConnectionPromise = once(server, 'connection');
      const running = await provider.start();
      const [serverSocket] = await serverConnectionPromise;
      const endPromise = new Promise<string>((resolve) => {
        running.onEnded((event) => resolve(event.reason));
      });

      serverSocket.end();

      assert.equal(await endPromise, 'producer-ended');
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  },
);
