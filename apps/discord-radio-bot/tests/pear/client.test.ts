import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PearClient,
  type PearControlAction,
  mapQueuePlacement,
  normalizePearSearchResults,
} from '../../src/pear/index.js';

type FetchCall = {
  readonly url: string;
  readonly init: RequestInit | undefined;
};

function createJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

test('PearClient authenticates once and reuses the bearer token for REST calls', async () => {
  const calls: FetchCall[] = [];

  const fetchMock: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.endsWith('/auth/client-123')) {
      return createJsonResponse(200, { accessToken: 'token-1' });
    }

    if (url.endsWith('/api/v1/song')) {
      return createJsonResponse(200, {
        videoId: 'song-1',
        title: 'Now Playing',
      });
    }

    if (url.endsWith('/api/v1/search')) {
      return createJsonResponse(200, { continuation: 'next-page' });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  const client = new PearClient({
    host: '127.0.0.1',
    port: 26538,
    clientId: 'client-123',
    fetch: fetchMock,
  });

  const song = await client.getCurrentSong();
  const search = await client.search('massive attack');

  assert.deepStrictEqual(song, {
    videoId: 'song-1',
    title: 'Now Playing',
  });
  assert.deepStrictEqual(search, { continuation: 'next-page' });
  assert.equal(calls.length, 3);
  assert.equal(calls[0]?.url, 'http://127.0.0.1:26538/auth/client-123');
  assert.equal(calls[0]?.init?.method, 'POST');
  assert.equal(
    new Headers(calls[1]?.init?.headers).get('authorization'),
    'Bearer token-1',
  );
  assert.equal(
    new Headers(calls[2]?.init?.headers).get('authorization'),
    'Bearer token-1',
  );
});

test('PearClient re-authenticates once after a 401 and retries the request with the new token', async () => {
  const calls: FetchCall[] = [];
  let authCount = 0;

  const fetchMock: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.endsWith('/auth/client-401')) {
      authCount += 1;
      return createJsonResponse(200, { accessToken: `token-${authCount}` });
    }

    if (url.endsWith('/api/v1/song')) {
      const authorization = new Headers(init?.headers).get('authorization');

      if (authorization === 'Bearer token-1') {
        return new Response(null, { status: 401 });
      }

      if (authorization === 'Bearer token-2') {
        return createJsonResponse(200, {
          videoId: 'song-2',
          title: 'Recovered',
        });
      }
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  const client = new PearClient({
    host: '127.0.0.1',
    port: 26538,
    clientId: 'client-401',
    fetch: fetchMock,
  });

  const song = await client.getCurrentSong();

  assert.deepStrictEqual(song, {
    videoId: 'song-2',
    title: 'Recovered',
  });
  assert.equal(
    calls.filter((call) => call.url.endsWith('/auth/client-401')).length,
    2,
  );
  assert.equal(
    new Headers(calls.at(-1)?.init?.headers).get('authorization'),
    'Bearer token-2',
  );
});

test('PearClient.getCurrentSong throws when Pear returns an invalid 200 song payload', async () => {
  const fetchMock: typeof fetch = async (input) => {
    const url = String(input);

    if (url.endsWith('/auth/client-invalid-song')) {
      return createJsonResponse(200, { accessToken: 'token-invalid-song' });
    }

    if (url.endsWith('/api/v1/song')) {
      return createJsonResponse(200, {
        title: 'Missing video id',
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  const client = new PearClient({
    host: '127.0.0.1',
    port: 26538,
    clientId: 'client-invalid-song',
    fetch: fetchMock,
  });

  await assert.rejects(
    async () => client.getCurrentSong(),
    /Pear song response did not include a valid song payload/,
  );
});

test('PearClient adds a song to the queue with Pear insert position mapping', async () => {
  const calls: FetchCall[] = [];

  const fetchMock: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.endsWith('/auth/client-queue')) {
      return createJsonResponse(200, { accessToken: 'token-queue' });
    }

    if (url.endsWith('/api/v1/queue')) {
      return new Response(null, { status: 204 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  const client = new PearClient({
    host: '127.0.0.1',
    port: 26538,
    clientId: 'client-queue',
    fetch: fetchMock,
  });

  await client.addToQueue({
    videoId: 'video-123',
    placement: 'next',
  });

  assert.equal(mapQueuePlacement('queue'), 'INSERT_AT_END');
  assert.equal(mapQueuePlacement('next'), 'INSERT_AFTER_CURRENT_VIDEO');
  assert.deepStrictEqual(JSON.parse(String(calls[1]?.init?.body)), {
    videoId: 'video-123',
    insertPosition: 'INSERT_AFTER_CURRENT_VIDEO',
  });
});

test('PearClient maps playback control actions to explicit control endpoints', async () => {
  const calls: FetchCall[] = [];

  const fetchMock: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.endsWith('/auth/client-control')) {
      return createJsonResponse(200, { accessToken: 'token-control' });
    }

    if (
      url.endsWith('/api/v1/play') ||
      url.endsWith('/api/v1/pause') ||
      url.endsWith('/api/v1/toggle-play') ||
      url.endsWith('/api/v1/next') ||
      url.endsWith('/api/v1/previous')
    ) {
      return new Response(null, { status: 204 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  const client = new PearClient({
    host: '127.0.0.1',
    port: 26538,
    clientId: 'client-control',
    fetch: fetchMock,
  });

  const actions: readonly PearControlAction[] = [
    'play',
    'pause',
    'toggle-play',
    'next',
    'previous',
  ];

  for (const action of actions) {
    await client.control(action);
  }

  assert.deepStrictEqual(
    calls
      .filter((call) => call.url.includes('/api/v1/'))
      .map((call) => ({
        url: call.url,
        method: call.init?.method,
        authorization: new Headers(call.init?.headers).get('authorization'),
      })),
    [
      {
        url: 'http://127.0.0.1:26538/api/v1/play',
        method: 'POST',
        authorization: 'Bearer token-control',
      },
      {
        url: 'http://127.0.0.1:26538/api/v1/pause',
        method: 'POST',
        authorization: 'Bearer token-control',
      },
      {
        url: 'http://127.0.0.1:26538/api/v1/toggle-play',
        method: 'POST',
        authorization: 'Bearer token-control',
      },
      {
        url: 'http://127.0.0.1:26538/api/v1/next',
        method: 'POST',
        authorization: 'Bearer token-control',
      },
      {
        url: 'http://127.0.0.1:26538/api/v1/previous',
        method: 'POST',
        authorization: 'Bearer token-control',
      },
    ],
  );
});

test('normalizePearSearchResults keeps playable labeled tracks in order and applies the caller limit', () => {
  const normalized = normalizePearSearchResults(
    {
      sections: [
        {
          contents: [
            {
              videoId: 'video-1',
              isPlayable: true,
              title: {
                text: 'First Song',
              },
              artists: [{ text: 'Artist One' }],
            },
            {
              videoId: '',
              title: 'Missing id',
            },
            {
              videoId: 'video-2',
              isPlayable: false,
              title: 'Blocked Song',
            },
            {
              playlistId: 'playlist-1',
              title: 'Playlist',
            },
            {
              videoId: 'video-3',
              title: {
                runs: [{ text: 'Second Song' }],
              },
              navigationEndpoint: {
                watchEndpoint: {
                  videoId: 'video-3',
                },
              },
            },
            {
              videoId: 'video-4',
              title: '   ',
            },
          ],
        },
      ],
    },
    { limit: 2 },
  );

  assert.deepStrictEqual(normalized, [
    {
      videoId: 'video-1',
      title: 'First Song',
      label: 'First Song',
      subtitle: 'Artist One',
    },
    {
      videoId: 'video-3',
      title: 'Second Song',
      label: 'Second Song',
      subtitle: undefined,
    },
  ]);
});

test('normalizePearSearchResults requires a positive playability signal for command picker results', () => {
  const normalized = normalizePearSearchResults({
    sections: [
      {
        contents: [
          {
            videoId: 'video-keep',
            title: 'Playable via navigation',
            navigationEndpoint: {
              watchEndpoint: {
                videoId: 'video-keep',
              },
            },
          },
          {
            videoId: 'video-drop',
            title: 'No playability signal',
          },
          {
            videoId: 'video-blocked',
            isPlayable: false,
            title: 'Explicitly blocked',
            navigationEndpoint: {
              watchEndpoint: {
                videoId: 'video-blocked',
              },
            },
          },
        ],
      },
    ],
  });

  assert.deepStrictEqual(normalized, [
    {
      videoId: 'video-keep',
      title: 'Playable via navigation',
      label: 'Playable via navigation',
      subtitle: undefined,
    },
  ]);
});

test('normalizePearSearchResults returns no results when the caller limit is zero', () => {
  const normalized = normalizePearSearchResults(
    {
      sections: [
        {
          contents: [
            {
              videoId: 'video-1',
              title: 'First Song',
            },
          ],
        },
      ],
    },
    { limit: 0 },
  );

  assert.deepStrictEqual(normalized, []);
});
