import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRadioInteractionRouter,
} from '../../src/discord/router.js';
import {
  encodeAddSelectionValue,
} from '../../src/discord/select-value.js';
import type {
  PearControlAction,
  QueuePlacement,
} from '../../src/pear/index.js';

type TestResponse = {
  readonly content: string;
  readonly ephemeral: boolean;
  readonly components?: readonly unknown[] | undefined;
};

type TestVoiceState = {
  readonly channel:
    | {
      readonly id: string;
      readonly name: string;
      readonly kind: 'voice' | 'stage';
    }
    | null;
};

type TestOverrides = {
  readonly controllerVoiceState?: {
    getState(): Promise<TestVoiceState> | TestVoiceState;
  };
  readonly pear?: {
    search(query: string): Promise<unknown> | unknown;
    addToQueue(request: {
      readonly videoId: string;
      readonly placement?: QueuePlacement | undefined;
    }): Promise<void> | void;
    control(action: PearControlAction): Promise<void> | void;
  };
  readonly voice?: {
    join(channel: {
      readonly id: string;
      readonly name: string;
    }): Promise<string> | string;
    leave(): Promise<string> | string;
  };
  readonly nowPlaying?: {
    getState(): {
      readonly status: 'offline' | 'connecting' | 'ready' | 'degraded';
      readonly staleReason?: string | undefined;
      readonly song?: {
        readonly videoId: string;
        readonly title: string;
        readonly subtitle?: string | undefined;
      } | undefined;
    };
  };
};

interface RouterHarness {
  readonly calls: {
    readonly join: Array<{
      id: string;
      name: string;
    }>;
    readonly leave: number;
    readonly search: string[];
    readonly addToQueue: Array<{
      videoId: string;
      placement: QueuePlacement;
    }>;
    readonly control: PearControlAction[];
  };
  readonly responses: TestResponse[];
  readonly router: ReturnType<typeof createRadioInteractionRouter>;
}

function createHarness(overrides: TestOverrides = {}): RouterHarness {
  const calls = {
    join: [] as Array<{
      id: string;
      name: string;
    }>,
    leave: 0,
    search: [] as string[],
    addToQueue: [] as Array<{
      videoId: string;
      placement: QueuePlacement;
    }>,
    control: [] as PearControlAction[],
  };
  const responses: TestResponse[] = [];

  const controllerVoiceState = overrides.controllerVoiceState ?? {
    async getState() {
      return {
        channel: {
          id: 'voice-1',
          name: 'Desk Radio',
          kind: 'voice',
        },
      };
    },
  };

  const pear = overrides.pear ?? {
    async search(query: string) {
      calls.search.push(query);
      return {
        sections: [
          {
            contents: [
              {
                videoId: 'video-1',
                isPlayable: true,
                title: 'Angel',
                artists: [{ text: 'Massive Attack' }],
              },
              {
                videoId: 'video-2',
                isPlayable: true,
                title: 'Teardrop',
                artists: [{ text: 'Massive Attack' }],
              },
            ],
          },
        ],
      };
    },
    async addToQueue(request: {
      readonly videoId: string;
      readonly placement?: QueuePlacement | undefined;
    }) {
      calls.addToQueue.push({
        videoId: request.videoId,
        placement: request.placement ?? 'queue',
      });
    },
    async control(action: PearControlAction) {
      calls.control.push(action);
    },
  };

  const nowPlaying = overrides.nowPlaying ?? {
    getState() {
      return {
        status: 'ready',
        song: {
          videoId: 'video-1',
          title: 'Angel',
          subtitle: 'Massive Attack',
        },
      };
    },
  };

  const voice = overrides.voice ?? {
    async join(channel: {
      readonly id: string;
      readonly name: string;
    }) {
      calls.join.push(channel);
      return `Joined ${channel.name}.`;
    },
    async leave() {
      calls.leave += 1;
      return 'Already idle.';
    },
  };

  const router = createRadioInteractionRouter({
    guildId: 'guild-1',
    controllerUserId: 'user-1',
    responder: {
      async send(response: TestResponse) {
        responses.push(response);
      },
    },
    controllerVoiceState,
    voice,
    pear,
    nowPlaying,
  });

  return {
    calls,
    responses,
    router,
  };
}

test('router rejects a command from the wrong guild', async () => {
  const harness = createHarness();

  await harness.router.handle({
    kind: 'command',
    guildId: 'guild-2',
    userId: 'user-1',
    subcommand: 'join',
  });

  assert.deepStrictEqual(harness.responses, [
    {
      content: 'This radio only accepts commands in the configured guild.',
      ephemeral: true,
    },
  ]);
});

test('router rejects a command from the wrong user', async () => {
  const harness = createHarness();

  await harness.router.handle({
    kind: 'command',
    guildId: 'guild-1',
    userId: 'user-2',
    subcommand: 'join',
  });

  assert.deepStrictEqual(harness.responses, [
    {
      content: 'Only the configured controller user can use this radio.',
      ephemeral: true,
    },
  ]);
});

test('router resolves the controller standard voice channel and delegates join', async () => {
  const harness = createHarness();

  await harness.router.handle({
    kind: 'command',
    guildId: 'guild-1',
    userId: 'user-1',
    subcommand: 'join',
  });

  assert.deepStrictEqual(harness.calls.join, [
    {
      id: 'voice-1',
      name: 'Desk Radio',
    },
  ]);
  assert.deepStrictEqual(harness.responses, [
    {
      content: 'Joined Desk Radio.',
      ephemeral: true,
    },
  ]);
});

test('router returns the voice layer move message when already connected elsewhere', async () => {
  const movedJoinCalls: Array<{
    id: string;
    name: string;
  }> = [];
  const harness = createHarness({
    controllerVoiceState: {
      async getState() {
        return {
          channel: {
            id: 'voice-2',
            name: 'Studio',
            kind: 'voice',
          },
        };
      },
    },
    voice: {
      async join(channel: {
        readonly id: string;
        readonly name: string;
      }) {
        movedJoinCalls.push(channel);
        return `Moved to ${channel.name} and kept the relay running.`;
      },
      async leave() {
        return 'Already idle.';
      },
    },
  });

  await harness.router.handle({
    kind: 'command',
    guildId: 'guild-1',
    userId: 'user-1',
    subcommand: 'join',
  });

  assert.deepStrictEqual(movedJoinCalls, [
    {
      id: 'voice-2',
      name: 'Studio',
    },
  ]);
  assert.deepStrictEqual(harness.responses, [
    {
      content: 'Moved to Studio and kept the relay running.',
      ephemeral: true,
    },
  ]);
});

test('router rejects join when the controller is not in voice', async () => {
  const harness = createHarness({
    controllerVoiceState: {
      async getState() {
        return {
          channel: null,
        };
      },
    },
  });

  await harness.router.handle({
    kind: 'command',
    guildId: 'guild-1',
    userId: 'user-1',
    subcommand: 'join',
  });

  assert.deepStrictEqual(harness.responses, [
    {
      content: 'The configured controller user is not in a voice channel.',
      ephemeral: true,
    },
  ]);
});

test('router rejects join when the controller is in a stage channel', async () => {
  const harness = createHarness({
    controllerVoiceState: {
      async getState() {
        return {
          channel: {
            id: 'stage-1',
            name: 'Town Hall',
            kind: 'stage',
          },
        };
      },
    },
  });

  await harness.router.handle({
    kind: 'command',
    guildId: 'guild-1',
    userId: 'user-1',
    subcommand: 'join',
  });

  assert.deepStrictEqual(harness.responses, [
    {
      content: 'Stage channels are not supported. Join a standard voice channel first.',
      ephemeral: true,
    },
  ]);
});

test('router converts controller voice-state lookup failures into an ephemeral join error', async () => {
  const harness = createHarness({
    controllerVoiceState: {
      async getState() {
        throw new Error('voice state unavailable');
      },
    },
  });

  await harness.router.handle({
    kind: 'command',
    guildId: 'guild-1',
    userId: 'user-1',
    subcommand: 'join',
  });

  assert.deepStrictEqual(harness.responses, [
    {
      content: 'Could not resolve the controller voice channel: voice state unavailable',
      ephemeral: true,
    },
  ]);
});

test('router converts voice join failures into an ephemeral error response', async () => {
  const harness = createHarness({
    voice: {
      async join() {
        throw new Error('join failed');
      },
      async leave() {
        return 'Already idle.';
      },
    },
  });

  await harness.router.handle({
    kind: 'command',
    guildId: 'guild-1',
    userId: 'user-1',
    subcommand: 'join',
  });

  assert.deepStrictEqual(harness.responses, [
    {
      content: 'Could not join the controller voice channel: join failed',
      ephemeral: true,
    },
  ]);
});

test('router truncates add select option labels and descriptions to Discord limits', async () => {
  const harness = createHarness({
    pear: {
      async search(query: string) {
        harness.calls.search.push(query);
        return {
          sections: [
            {
              contents: [
                {
                  videoId: 'video-1',
                  isPlayable: true,
                  title: 'L'.repeat(120),
                  artists: [{ text: 'D'.repeat(120) }],
                },
              ],
            },
          ],
        };
      },
      async addToQueue(request: {
        readonly videoId: string;
        readonly placement?: QueuePlacement | undefined;
      }) {
        harness.calls.addToQueue.push({
          videoId: request.videoId,
          placement: request.placement ?? 'queue',
        });
      },
      async control(action: PearControlAction) {
        harness.calls.control.push(action);
      },
    },
  });

  await harness.router.handle({
    kind: 'command',
    guildId: 'guild-1',
    userId: 'user-1',
    subcommand: 'add',
    query: 'long song',
  });

  assert.deepStrictEqual(harness.responses, [
    {
      content: 'Choose a track to add to the queue.',
      ephemeral: true,
      components: [
        {
          type: 'string-select',
          customId: 'radio:add-select',
          placeholder: 'Select a track',
          options: [
            {
              label: `${'L'.repeat(99)}…`,
              description: `${'D'.repeat(99)}…`,
              value: 'queue|video-1',
            },
          ],
        },
      ],
    },
  ]);
});

test('router searches Pear and returns an ephemeral select menu for add', async () => {
  const harness = createHarness();

  await harness.router.handle({
    kind: 'command',
    guildId: 'guild-1',
    userId: 'user-1',
    subcommand: 'add',
    query: 'massive attack',
  });

  assert.deepStrictEqual(harness.calls.search, ['massive attack']);
  assert.deepStrictEqual(harness.responses, [
    {
      content: 'Choose a track to add to the queue.',
      ephemeral: true,
      components: [
        {
          type: 'string-select',
          customId: 'radio:add-select',
          placeholder: 'Select a track',
          options: [
            {
              label: 'Angel',
              description: 'Massive Attack',
              value: 'queue|video-1',
            },
            {
              label: 'Teardrop',
              description: 'Massive Attack',
              value: 'queue|video-2',
            },
          ],
        },
      ],
    },
  ]);
});

test('router returns a clear reply when add finds no results', async () => {
  const searchCalls: string[] = [];
  const harness = createHarness({
    pear: {
      async search(query: string) {
        searchCalls.push(query);
        return {
          sections: [],
        };
      },
      async addToQueue(request: {
        readonly videoId: string;
        readonly placement?: QueuePlacement | undefined;
      }) {
        void request;
      },
      async control(action: PearControlAction) {
        void action;
      },
    },
  });

  await harness.router.handle({
    kind: 'command',
    guildId: 'guild-1',
    userId: 'user-1',
    subcommand: 'add',
    query: 'no matches',
  });

  assert.deepStrictEqual(searchCalls, ['no matches']);
  assert.deepStrictEqual(harness.responses, [
    {
      content: 'No playable tracks were found for "no matches".',
      ephemeral: true,
    },
  ]);
});

test('router rejects an invalid add select value', async () => {
  const harness = createHarness();

  await harness.router.handle({
    kind: 'select',
    guildId: 'guild-1',
    userId: 'user-1',
    customId: 'radio:add-select',
    values: ['bad-value'],
  });

  assert.deepStrictEqual(harness.calls.addToQueue, []);
  assert.deepStrictEqual(harness.responses, [
    {
      content: 'That selection is invalid. Run /radio add again.',
      ephemeral: true,
    },
  ]);
});

test('router enqueues the selected track directly after a valid add select submit', async () => {
  const harness = createHarness();

  await harness.router.handle({
    kind: 'select',
    guildId: 'guild-1',
    userId: 'user-1',
    customId: 'radio:add-select',
    values: [encodeAddSelectionValue('next', 'video-2')],
  });

  assert.deepStrictEqual(harness.calls.addToQueue, [
    {
      videoId: 'video-2',
      placement: 'next',
    },
  ]);
  assert.deepStrictEqual(harness.responses, [
    {
      content: 'Added the selected track next in queue.',
      ephemeral: true,
    },
  ]);
});

test('router converts voice leave failures into an ephemeral error response', async () => {
  const harness = createHarness({
    voice: {
      async join(channel: {
        readonly id: string;
        readonly name: string;
      }) {
        return `Joined ${channel.name}.`;
      },
      async leave() {
        throw new Error('leave failed');
      },
    },
  });

  await harness.router.handle({
    kind: 'command',
    guildId: 'guild-1',
    userId: 'user-1',
    subcommand: 'leave',
  });

  assert.deepStrictEqual(harness.responses, [
    {
      content: 'Could not leave the voice channel: leave failed',
      ephemeral: true,
    },
  ]);
});

test('router renders the ready now-playing state with the current song', async () => {
  const harness = createHarness();

  await harness.router.handle({
    kind: 'command',
    guildId: 'guild-1',
    userId: 'user-1',
    subcommand: 'now',
  });

  assert.deepStrictEqual(harness.responses, [
    {
      content: 'Now playing: Angel - Massive Attack',
      ephemeral: true,
    },
  ]);
});

test('router renders the degraded now-playing state with a stale note', async () => {
  const harness = createHarness({
    nowPlaying: {
      getState() {
        return {
          status: 'degraded',
          staleReason: 'last update was 90 seconds ago',
          song: {
            videoId: 'video-1',
            title: 'Angel',
            subtitle: 'Massive Attack',
          },
        };
      },
    },
  });

  await harness.router.handle({
    kind: 'command',
    guildId: 'guild-1',
    userId: 'user-1',
    subcommand: 'now',
  });

  assert.deepStrictEqual(harness.responses, [
    {
      content: 'Pear state is degraded: last update was 90 seconds ago. Last known track: Angel - Massive Attack',
      ephemeral: true,
    },
  ]);
});

test('router renders the offline now-playing state with a clear reply', async () => {
  const harness = createHarness({
    nowPlaying: {
      getState() {
        return {
          status: 'offline',
        };
      },
    },
  });

  await harness.router.handle({
    kind: 'command',
    guildId: 'guild-1',
    userId: 'user-1',
    subcommand: 'now',
  });

  assert.deepStrictEqual(harness.responses, [
    {
      content: 'Pear is offline. No now-playing state is available.',
      ephemeral: true,
    },
  ]);
});

test('router renders the connecting now-playing state with a clear reply', async () => {
  const harness = createHarness({
    nowPlaying: {
      getState() {
        return {
          status: 'connecting',
        };
      },
    },
  });

  await harness.router.handle({
    kind: 'command',
    guildId: 'guild-1',
    userId: 'user-1',
    subcommand: 'now',
  });

  assert.deepStrictEqual(harness.responses, [
    {
      content: 'Pear is connecting. Now-playing state is not ready yet.',
      ephemeral: true,
    },
  ]);
});

test('router renders a clear reply when no song is available', async () => {
  const harness = createHarness({
    nowPlaying: {
      getState() {
        return {
          status: 'ready',
        };
      },
    },
  });

  await harness.router.handle({
    kind: 'command',
    guildId: 'guild-1',
    userId: 'user-1',
    subcommand: 'now',
  });

  assert.deepStrictEqual(harness.responses, [
    {
      content: 'No song is currently available from Pear.',
      ephemeral: true,
    },
  ]);
});

test('router converts now-playing provider failures into an ephemeral error response', async () => {
  const harness = createHarness({
    nowPlaying: {
      getState() {
        throw new Error('player state unavailable');
      },
    },
  });

  await harness.router.handle({
    kind: 'command',
    guildId: 'guild-1',
    userId: 'user-1',
    subcommand: 'now',
  });

  assert.deepStrictEqual(harness.responses, [
    {
      content: 'Could not read Pear now playing state: player state unavailable',
      ephemeral: true,
    },
  ]);
});

test('router dispatches control actions to the Pear control dependency', async () => {
  const harness = createHarness();

  const cases = [
    ['play', 'play'],
    ['pause', 'pause'],
    ['toggle', 'toggle-play'],
    ['next', 'next'],
    ['previous', 'previous'],
  ] as const;

  for (const [action] of cases) {
    await harness.router.handle({
      kind: 'command',
      guildId: 'guild-1',
      userId: 'user-1',
      subcommand: 'control',
      action,
    });
  }

  assert.deepStrictEqual(harness.calls.control, cases.map(([, mapped]) => mapped));
});
