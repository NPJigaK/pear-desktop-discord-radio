import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDiscordControllerVoiceStateProvider,
  createDiscordClient,
  createDiscordInteractionHandler,
  createDiscordInteractionResponder,
} from '../../src/discord/runtime.js';
import type {
  RadioInteraction,
  RadioResponse,
} from '../../src/discord/types.js';

type FakeReplyPayload = {
  readonly content?: string | undefined;
  readonly flags?: number | undefined;
  readonly components?: readonly unknown[] | undefined;
};

type FakeDeferredReplyPayload = {
  readonly flags?: number | undefined;
};

type ClientFactoryOptions = {
  readonly intents: readonly number[];
};

type FakeVoiceActionsFactoryInput = {
  readonly guildId: string;
  readonly channelId?: string | undefined;
};

function createBasePearActions() {
  return {
    async search() {
      throw new Error('unused');
    },
    async addToQueue() {
      throw new Error('unused');
    },
    async control() {
      throw new Error('unused');
    },
  };
}

function createBaseNowPlayingProvider() {
  return {
    getState() {
      return {
        status: 'ready',
      } as const;
    },
  };
}

function createLoggerRecorder() {
  const entries: Array<{
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    payload?: Readonly<Record<string, unknown>> | undefined;
  }> = [];

  return {
    logger: {
      child() {
        return this;
      },
      info(message: string, payload?: Readonly<Record<string, unknown>>) {
        entries.push({
          level: 'info',
          message,
          payload,
        });
      },
      warn(message: string, payload?: Readonly<Record<string, unknown>>) {
        entries.push({
          level: 'warn',
          message,
          payload,
        });
      },
      error(message: string, payload?: Readonly<Record<string, unknown>>) {
        entries.push({
          level: 'error',
          message,
          payload,
        });
      },
      debug(message: string, payload?: Readonly<Record<string, unknown>>) {
        entries.push({
          level: 'debug',
          message,
          payload,
        });
      },
    },
    entries,
  };
}

test('createDiscordClient uses only Guilds and GuildVoiceStates intents', () => {
  let capturedOptions: { readonly intents: readonly number[] } | undefined;

  createDiscordClient({
    createClient(options: ClientFactoryOptions) {
      capturedOptions = options;
      return {
        on() {
          return this;
        },
        once() {
          return this;
        },
        async login() {
          return undefined;
        },
        destroy() {
          return undefined;
        },
      };
    },
  });

  assert.deepStrictEqual(capturedOptions, {
    intents: [1, 1 << 7],
  });
});

test('createDiscordInteractionHandler defers /radio join before routing and edits the deferred reply', async () => {
  const routedInteractions: RadioInteraction[] = [];
  const calls: Array<{
    method: 'deferReply' | 'reply' | 'editReply';
    payload?: FakeDeferredReplyPayload | FakeReplyPayload | undefined;
  }> = [];
  const voiceCalls: Array<{ guildId: string; channelId?: string | undefined }> = [];

  const interaction = {
    type: 'chat-input',
    commandName: 'radio',
    guildId: 'guild-1',
    user: {
      id: 'user-1',
    },
    guild: {
      id: 'guild-1',
      voiceAdapterCreator: {
        kind: 'adapter',
      },
      voiceStates: {
        cache: new Map([
          ['user-1', { channelId: 'voice-1' }],
        ]),
      },
      channels: {
        cache: new Map([
          ['voice-1', { id: 'voice-1', name: 'Desk Radio', type: 2 }],
        ]),
      },
    },
    replied: false,
    deferred: false,
    isChatInputCommand() {
      return true;
    },
    isStringSelectMenu() {
      return false;
    },
    options: {
      getSubcommand() {
        return 'join';
      },
      getString() {
        return null;
      },
    },
    async deferReply(payload: FakeDeferredReplyPayload) {
      calls.push({
        method: 'deferReply',
        payload,
      });
      this.deferred = true;
    },
    async reply(payload: FakeReplyPayload) {
      calls.push({
        method: 'reply',
        payload,
      });
    },
    async editReply(payload: FakeReplyPayload) {
      calls.push({
        method: 'editReply',
        payload,
      });
    },
  };

  const handler = createDiscordInteractionHandler({
    guildId: 'guild-1',
    controllerUserId: 'user-1',
    pear: createBasePearActions(),
    nowPlaying: createBaseNowPlayingProvider(),
    createVoiceActions({ guildId, channelId }: FakeVoiceActionsFactoryInput) {
      voiceCalls.push({ guildId, channelId });
      return {
        async join(channel: {
          readonly id: string;
          readonly name: string;
        }) {
          return `Joined ${channel.name}.`;
        },
        async leave() {
          return 'Already idle.';
        },
      };
    },
    createRouter(dependencies: {
      readonly responder: {
        send(response: RadioResponse): Promise<void> | void;
      };
    }) {
      return {
        async handle(radioInteraction: RadioInteraction) {
          routedInteractions.push(radioInteraction);
          await dependencies.responder.send({
            content: 'Joined Desk Radio.',
            ephemeral: true,
          });
        },
      };
    },
  });

  await handler(interaction);

  assert.deepStrictEqual(routedInteractions, [
    {
      kind: 'command',
      guildId: 'guild-1',
      userId: 'user-1',
      subcommand: 'join',
    },
  ]);
  assert.deepStrictEqual(voiceCalls, [
    {
      guildId: 'guild-1',
      channelId: 'voice-1',
    },
  ]);
  assert.deepStrictEqual(calls, [
    {
      method: 'deferReply',
      payload: {
        flags: 1 << 6,
      },
    },
    {
      method: 'editReply',
      payload: {
        content: 'Joined Desk Radio.',
        components: [],
      },
    },
  ]);
});

test('createDiscordInteractionHandler sends a terminal failure reply after a deferred command throws', async () => {
  const calls: Array<{
    method: 'deferReply' | 'reply' | 'editReply';
    payload?: FakeDeferredReplyPayload | FakeReplyPayload | undefined;
  }> = [];
  const { logger, entries } = createLoggerRecorder();

  const interaction = {
    type: 'chat-input',
    commandName: 'radio',
    guildId: 'guild-1',
    user: {
      id: 'user-1',
    },
    guild: {
      id: 'guild-1',
      voiceAdapterCreator: {
        kind: 'adapter',
      },
      voiceStates: {
        cache: new Map(),
      },
      channels: {
        cache: new Map(),
      },
    },
    replied: false,
    deferred: false,
    isChatInputCommand() {
      return true;
    },
    isStringSelectMenu() {
      return false;
    },
    options: {
      getSubcommand() {
        return 'join';
      },
      getString() {
        return null;
      },
    },
    async deferReply(payload: FakeDeferredReplyPayload) {
      calls.push({
        method: 'deferReply',
        payload,
      });
      this.deferred = true;
    },
    async reply(payload: FakeReplyPayload) {
      calls.push({
        method: 'reply',
        payload,
      });
    },
    async editReply(payload: FakeReplyPayload) {
      calls.push({
        method: 'editReply',
        payload,
      });
    },
  };

  const handler = createDiscordInteractionHandler({
    guildId: 'guild-1',
    controllerUserId: 'user-1',
    pear: createBasePearActions(),
    nowPlaying: createBaseNowPlayingProvider(),
    createVoiceActions() {
      return {
        async join() {
          return 'unused';
        },
        async leave() {
          return 'unused';
        },
      };
    },
    createRouter() {
      return {
        async handle() {
          throw new Error('voice exploded');
        },
      };
    },
    logger,
  });

  await handler(interaction);

  assert.deepStrictEqual(calls, [
    {
      method: 'deferReply',
      payload: {
        flags: 1 << 6,
      },
    },
    {
      method: 'editReply',
      payload: {
        content: 'The radio command failed. Check logs and try again.',
        components: [],
      },
    },
  ]);
  assert.deepStrictEqual(entries, [
    {
      level: 'error',
      message: 'Discord interaction handler failed.',
      payload: {
        error: 'voice exploded',
      },
    },
  ]);
});

test('createDiscordInteractionHandler defers /radio add before routing and edits the deferred reply', async () => {
  const routedInteractions: RadioInteraction[] = [];
  const calls: Array<{
    method: 'deferReply' | 'reply' | 'editReply';
    payload?: FakeDeferredReplyPayload | FakeReplyPayload | undefined;
  }> = [];

  const interaction = {
    type: 'chat-input',
    commandName: 'radio',
    guildId: 'guild-1',
    user: {
      id: 'user-1',
    },
    guild: {
      id: 'guild-1',
      voiceAdapterCreator: {
        kind: 'adapter',
      },
      voiceStates: {
        cache: new Map(),
      },
      channels: {
        cache: new Map(),
      },
    },
    replied: false,
    deferred: false,
    isChatInputCommand() {
      return true;
    },
    isStringSelectMenu() {
      return false;
    },
    options: {
      getSubcommand() {
        return 'add';
      },
      getString(name: string) {
        if (name === 'query') {
          return 'massive attack';
        }

        return null;
      },
    },
    async deferReply(payload: FakeDeferredReplyPayload) {
      calls.push({
        method: 'deferReply',
        payload,
      });
      this.deferred = true;
    },
    async reply(payload: FakeReplyPayload) {
      calls.push({
        method: 'reply',
        payload,
      });
    },
    async editReply(payload: FakeReplyPayload) {
      calls.push({
        method: 'editReply',
        payload,
      });
    },
  };

  const handler = createDiscordInteractionHandler({
    guildId: 'guild-1',
    controllerUserId: 'user-1',
    pear: createBasePearActions(),
    nowPlaying: createBaseNowPlayingProvider(),
    createVoiceActions() {
      return {
        async join() {
          return 'unused';
        },
        async leave() {
          return 'unused';
        },
      };
    },
    createRouter(dependencies: {
      readonly responder: {
        send(response: RadioResponse): Promise<void> | void;
      };
    }) {
      return {
        async handle(radioInteraction: RadioInteraction) {
          routedInteractions.push(radioInteraction);
          await dependencies.responder.send({
            content: 'Choose a track to add to the queue.',
            ephemeral: true,
          });
        },
      };
    },
  });

  await handler(interaction);

  assert.deepStrictEqual(routedInteractions, [
    {
      kind: 'command',
      guildId: 'guild-1',
      userId: 'user-1',
      subcommand: 'add',
      query: 'massive attack',
      placement: undefined,
    },
  ]);
  assert.deepStrictEqual(calls, [
    {
      method: 'deferReply',
      payload: {
        flags: 1 << 6,
      },
    },
    {
      method: 'editReply',
      payload: {
        content: 'Choose a track to add to the queue.',
        components: [],
      },
    },
  ]);
});

test('createDiscordInteractionHandler defers string-select interactions with deferUpdate and edits the reply', async () => {
  const routedInteractions: RadioInteraction[] = [];
  const calls: Array<{
    method: 'deferUpdate' | 'reply' | 'editReply';
    payload?: FakeReplyPayload | undefined;
  }> = [];

  const interaction = {
    type: 'string-select',
    customId: 'radio:add-select',
    values: ['queue|video-123'],
    guildId: 'guild-1',
    user: {
      id: 'user-1',
    },
    guild: {
      id: 'guild-1',
      voiceAdapterCreator: {
        kind: 'adapter',
      },
      voiceStates: {
        cache: new Map(),
      },
      channels: {
        cache: new Map(),
      },
    },
    replied: false,
    deferred: false,
    isChatInputCommand() {
      return false;
    },
    isStringSelectMenu() {
      return true;
    },
    async deferUpdate() {
      calls.push({
        method: 'deferUpdate',
      });
      this.deferred = true;
    },
    async reply(payload: FakeReplyPayload) {
      calls.push({
        method: 'reply',
        payload,
      });
    },
    async editReply(payload: FakeReplyPayload) {
      calls.push({
        method: 'editReply',
        payload,
      });
    },
  };

  const handler = createDiscordInteractionHandler({
    guildId: 'guild-1',
    controllerUserId: 'user-1',
    pear: createBasePearActions(),
    nowPlaying: createBaseNowPlayingProvider(),
    createVoiceActions() {
      return {
        async join() {
          return 'unused';
        },
        async leave() {
          return 'unused';
        },
      };
    },
    createRouter() {
      return {
        async handle(radioInteraction: RadioInteraction) {
          routedInteractions.push(radioInteraction);
          await createDiscordInteractionResponder(interaction).send({
            content: 'Added the selected track to the queue.',
            ephemeral: true,
          });
        },
      };
    },
  });

  await handler(interaction);

  assert.deepStrictEqual(routedInteractions, [
    {
      kind: 'select',
      guildId: 'guild-1',
      userId: 'user-1',
      customId: 'radio:add-select',
      values: ['queue|video-123'],
    },
  ]);
  assert.deepStrictEqual(calls, [
    {
      method: 'deferUpdate',
    },
    {
      method: 'editReply',
      payload: {
        content: 'Added the selected track to the queue.',
        components: [],
      },
    },
  ]);
});

test('createDiscordInteractionHandler sends a terminal failure reply after a deferred select throws', async () => {
  const calls: Array<{
    method: 'deferUpdate' | 'reply' | 'editReply';
    payload?: FakeReplyPayload | undefined;
  }> = [];
  const { logger, entries } = createLoggerRecorder();

  const interaction = {
    type: 'string-select',
    customId: 'radio:add-select',
    values: ['queue|video-123'],
    guildId: 'guild-1',
    user: {
      id: 'user-1',
    },
    guild: {
      id: 'guild-1',
      voiceAdapterCreator: {
        kind: 'adapter',
      },
      voiceStates: {
        cache: new Map(),
      },
      channels: {
        cache: new Map(),
      },
    },
    replied: false,
    deferred: false,
    isChatInputCommand() {
      return false;
    },
    isStringSelectMenu() {
      return true;
    },
    async deferUpdate() {
      calls.push({
        method: 'deferUpdate',
      });
      this.deferred = true;
    },
    async reply(payload: FakeReplyPayload) {
      calls.push({
        method: 'reply',
        payload,
      });
    },
    async editReply(payload: FakeReplyPayload) {
      calls.push({
        method: 'editReply',
        payload,
      });
    },
  };

  const handler = createDiscordInteractionHandler({
    guildId: 'guild-1',
    controllerUserId: 'user-1',
    pear: createBasePearActions(),
    nowPlaying: createBaseNowPlayingProvider(),
    createVoiceActions() {
      return {
        async join() {
          return 'unused';
        },
        async leave() {
          return 'unused';
        },
      };
    },
    createRouter() {
      return {
        async handle() {
          throw new Error('queue write failed');
        },
      };
    },
    logger,
  });

  await handler(interaction);

  assert.deepStrictEqual(calls, [
    {
      method: 'deferUpdate',
    },
    {
      method: 'editReply',
      payload: {
        content: 'The radio command failed. Check logs and try again.',
        components: [],
      },
    },
  ]);
  assert.deepStrictEqual(entries, [
    {
      level: 'error',
      message: 'Discord interaction handler failed.',
      payload: {
        error: 'queue write failed',
      },
    },
  ]);
});

test('createDiscordInteractionHandler leaves fast replies undeferred', async () => {
  const calls: Array<{
    method: 'deferReply' | 'reply' | 'editReply';
    payload?: FakeDeferredReplyPayload | FakeReplyPayload | undefined;
  }> = [];

  const interaction = {
    type: 'chat-input',
    commandName: 'radio',
    guildId: 'guild-1',
    user: {
      id: 'user-1',
    },
    guild: {
      id: 'guild-1',
      voiceAdapterCreator: {
        kind: 'adapter',
      },
      voiceStates: {
        cache: new Map(),
      },
      channels: {
        cache: new Map(),
      },
    },
    replied: false,
    deferred: false,
    isChatInputCommand() {
      return true;
    },
    isStringSelectMenu() {
      return false;
    },
    options: {
      getSubcommand() {
        return 'now';
      },
      getString() {
        return null;
      },
    },
    async deferReply(payload: FakeDeferredReplyPayload) {
      calls.push({
        method: 'deferReply',
        payload,
      });
      this.deferred = true;
    },
    async reply(payload: FakeReplyPayload) {
      calls.push({
        method: 'reply',
        payload,
      });
    },
    async editReply(payload: FakeReplyPayload) {
      calls.push({
        method: 'editReply',
        payload,
      });
    },
  };

  const handler = createDiscordInteractionHandler({
    guildId: 'guild-1',
    controllerUserId: 'user-1',
    pear: createBasePearActions(),
    nowPlaying: createBaseNowPlayingProvider(),
    createVoiceActions() {
      return {
        async join() {
          return 'unused';
        },
        async leave() {
          return 'unused';
        },
      };
    },
    createRouter(dependencies: {
      readonly responder: {
        send(response: RadioResponse): Promise<void> | void;
      };
    }) {
      return {
        async handle() {
          await dependencies.responder.send({
            content: 'Now playing: Angel.',
            ephemeral: true,
          });
        },
      };
    },
  });

  await handler(interaction);

  assert.deepStrictEqual(calls, [
    {
      method: 'reply',
      payload: {
        content: 'Now playing: Angel.',
        flags: 1 << 6,
        components: [],
      },
    },
  ]);
});

test('createDiscordInteractionResponder edits an existing reply on subsequent sends', async () => {
  const calls: Array<{
    method: 'reply' | 'editReply';
    payload: FakeReplyPayload;
  }> = [];

  const responder = createDiscordInteractionResponder({
    replied: true,
    deferred: false,
    async reply(payload: FakeReplyPayload) {
      calls.push({
        method: 'reply',
        payload,
      });
    },
    async editReply(payload: FakeReplyPayload) {
      calls.push({
        method: 'editReply',
        payload,
      });
    },
  });

  await responder.send({
    content: 'Updated response',
    ephemeral: true,
  } satisfies RadioResponse);

  assert.deepStrictEqual(calls, [
    {
      method: 'editReply',
      payload: {
        content: 'Updated response',
        components: [],
      },
    },
  ]);
});

test('buildDiscordControllerVoiceStateProvider resolves the controller voice channel from guild caches', async () => {
  const provider = buildDiscordControllerVoiceStateProvider({
    id: 'guild-1',
    voiceStates: {
      cache: new Map([
        ['user-1', { channelId: 'voice-1' }],
      ]),
    },
    channels: {
      cache: new Map([
        ['voice-1', { id: 'voice-1', name: 'Desk Radio', type: 2 }],
      ]),
    },
  });

  const state = await provider.getState({
    guildId: 'guild-1',
    controllerUserId: 'user-1',
  });

  assert.deepStrictEqual(state, {
    channel: {
      id: 'voice-1',
      name: 'Desk Radio',
      kind: 'voice',
    },
  });
});
