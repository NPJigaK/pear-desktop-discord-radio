import {
  ChannelType,
  Client,
  ComponentType,
  GatewayIntentBits,
  MessageFlags,
} from 'discord.js';

import { createRadioInteractionRouter } from './router.js';
import type {
  RadioControllerVoiceStateProvider,
  RadioInteraction,
  RadioInteractionResponder,
  RadioInteractionRouterDependencies,
  RadioNowPlayingProvider,
  RadioPearActions,
  RadioResponse,
  RadioVoiceActions,
} from './types.js';
import type { RuntimeLogger } from '../logging/index.js';
import type { QueuePlacement } from '../pear/index.js';

interface DiscordCacheLike<Value> {
  get(key: string): Value | undefined;
}

interface DiscordChannelLike {
  readonly id: string;
  readonly name?: string | undefined;
  readonly type?: number | undefined;
}

interface DiscordGuildLike {
  readonly id: string;
  readonly voiceAdapterCreator?: unknown;
  readonly voiceStates: {
    readonly cache: DiscordCacheLike<{
      readonly channelId?: string | null | undefined;
    }>;
  };
  readonly channels: {
    readonly cache: DiscordCacheLike<DiscordChannelLike>;
  };
}

interface DiscordUserLike {
  readonly id: string;
}

interface DiscordOptionsLike {
  getSubcommand(): string;
  getString(
    name: string,
    required?: boolean,
  ): string | null;
}

interface DiscordReplyPayload {
  readonly content: string;
  readonly flags?: number | undefined;
  readonly components?: readonly unknown[] | undefined;
}

interface DiscordDeferredReplyPayload {
  readonly flags?: number | undefined;
}

interface DiscordReplyableInteractionLike {
  readonly replied: boolean;
  readonly deferred: boolean;
  reply(payload: DiscordReplyPayload): Promise<unknown>;
  editReply(payload: Omit<DiscordReplyPayload, 'flags'>): Promise<unknown>;
}

interface DiscordChatInputInteractionLike
  extends DiscordReplyableInteractionLike {
  readonly commandName: string;
  readonly guildId?: string | undefined;
  readonly user: DiscordUserLike;
  readonly guild?: DiscordGuildLike | null | undefined;
  readonly options: DiscordOptionsLike;
  deferReply(payload: DiscordDeferredReplyPayload): Promise<unknown>;
  isChatInputCommand(): boolean;
  isStringSelectMenu(): boolean;
}

interface DiscordStringSelectInteractionLike
  extends DiscordReplyableInteractionLike {
  readonly customId: string;
  readonly guildId?: string | undefined;
  readonly user: DiscordUserLike;
  readonly guild?: DiscordGuildLike | null | undefined;
  readonly values: readonly string[];
  deferUpdate(): Promise<unknown>;
  isChatInputCommand(): boolean;
  isStringSelectMenu(): boolean;
}

type DiscordInteractionLike =
  | DiscordChatInputInteractionLike
  | DiscordStringSelectInteractionLike;

interface DiscordClientLike {
  on(event: 'interactionCreate', listener: (interaction: unknown) => void): unknown;
  once(event: 'ready', listener: () => void): unknown;
  login(token: string): Promise<unknown>;
  destroy(): void;
}

interface DiscordClientFactoryOptions {
  readonly intents: readonly number[];
}

export interface CreateDiscordClientDependencies {
  readonly createClient?:
    | ((options: DiscordClientFactoryOptions) => DiscordClientLike)
    | undefined;
}

export interface CreateDiscordVoiceActionsInput {
  readonly guildId: string;
  readonly channelId?: string | undefined;
  readonly guild?: DiscordGuildLike | null | undefined;
  readonly voiceAdapterCreator?: unknown;
}

export interface DiscordInteractionHandlerOptions {
  readonly guildId: string;
  readonly controllerUserId: string;
  readonly pear: RadioPearActions;
  readonly nowPlaying: RadioNowPlayingProvider;
  readonly createVoiceActions: (
    input: CreateDiscordVoiceActionsInput,
  ) => RadioVoiceActions;
  readonly createRouter?:
    | ((dependencies: RadioInteractionRouterDependencies) => {
      handle(interaction: RadioInteraction): Promise<void>;
    })
    | undefined;
  readonly logger?: RuntimeLogger | undefined;
}

export interface DiscordRuntimeOptions extends DiscordInteractionHandlerOptions {
  readonly token: string;
  readonly client?: DiscordClientLike | undefined;
}

function buildDiscordResponseComponents(
  response: RadioResponse,
): readonly unknown[] {
  if (response.components === undefined) {
    return [];
  }

  return response.components.map((component) => ({
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.StringSelect,
        custom_id: component.customId,
        placeholder: component.placeholder,
        options: component.options.map((option) => ({
          label: option.label,
          value: option.value,
          description: option.description,
        })),
      },
    ],
  }));
}

function mapGuildChannelKind(channel: DiscordChannelLike | undefined): 'voice' | 'stage' | 'unknown' {
  if (channel?.type === ChannelType.GuildVoice) {
    return 'voice';
  }

  if (channel?.type === ChannelType.GuildStageVoice) {
    return 'stage';
  }

  return 'unknown';
}

function readControllerChannelId(
  guild: DiscordGuildLike | null | undefined,
  controllerUserId: string,
): string | undefined {
  return guild?.voiceStates.cache.get(controllerUserId)?.channelId ?? undefined;
}

function readRequiredOptionString(
  options: DiscordOptionsLike,
  name: string,
): string {
  const value = options.getString(name, true);
  if (value === null) {
    throw new Error(`Missing required Discord option: ${name}`);
  }

  return value;
}

function isChatInputInteraction(
  interaction: DiscordInteractionLike,
): interaction is DiscordChatInputInteractionLike {
  return interaction.isChatInputCommand();
}

function isStringSelectInteraction(
  interaction: DiscordInteractionLike,
): interaction is DiscordStringSelectInteractionLike {
  return interaction.isStringSelectMenu();
}

function toRadioInteraction(
  interaction: DiscordInteractionLike,
): RadioInteraction | null {
  if (isChatInputInteraction(interaction)) {
    if (interaction.commandName !== 'radio') {
      return null;
    }

    const subcommand = interaction.options.getSubcommand();
    switch (subcommand) {
      case 'join':
      case 'leave':
      case 'now':
        return {
          kind: 'command',
          guildId: interaction.guildId,
          userId: interaction.user.id,
          subcommand,
        };
      case 'add': {
        const query = readRequiredOptionString(interaction.options, 'query');
        const placement =
          interaction.options.getString('placement') as QueuePlacement | null;

        return {
          kind: 'command',
          guildId: interaction.guildId,
          userId: interaction.user.id,
          subcommand,
          query,
          placement: placement ?? undefined,
        };
      }
      case 'control':
        return {
          kind: 'command',
          guildId: interaction.guildId,
          userId: interaction.user.id,
          subcommand,
          action: readRequiredOptionString(interaction.options, 'action') as
            | 'play'
            | 'pause'
            | 'toggle'
            | 'next'
            | 'previous',
        };
      default:
        return null;
    }
  }

  if (!isStringSelectInteraction(interaction)) {
    return null;
  }

  if (interaction.customId !== 'radio:add-select') {
    return null;
  }

  return {
    kind: 'select',
    guildId: interaction.guildId,
    userId: interaction.user.id,
    customId: 'radio:add-select',
    values: [...interaction.values],
  };
}

async function acknowledgeSlowPathInteraction(
  interaction: DiscordInteractionLike,
  radioInteraction: RadioInteraction,
): Promise<void> {
  if (interaction.replied || interaction.deferred) {
    return;
  }

  if (radioInteraction.kind === 'select' && isStringSelectInteraction(interaction)) {
    await interaction.deferUpdate();
    return;
  }

  if (
    radioInteraction.kind === 'command' &&
    (radioInteraction.subcommand === 'join' || radioInteraction.subcommand === 'add') &&
    isChatInputInteraction(interaction)
  ) {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });
  }
}

export function createDiscordClient(
  dependencies: CreateDiscordClientDependencies = {},
): DiscordClientLike {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ] as const;

  if (dependencies.createClient !== undefined) {
    return dependencies.createClient({ intents });
  }

  return new Client({ intents });
}

export function createDiscordInteractionResponder(
  interaction: DiscordReplyableInteractionLike,
): RadioInteractionResponder {
  return {
    async send(response) {
      const payload = {
        content: response.content,
        components: buildDiscordResponseComponents(response),
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply(payload);
        return;
      }

      await interaction.reply({
        ...payload,
        flags: MessageFlags.Ephemeral,
      });
    },
  };
}

export function buildDiscordControllerVoiceStateProvider(
  guild: DiscordGuildLike | null | undefined,
): RadioControllerVoiceStateProvider {
  return {
    async getState(input) {
      const channelId = readControllerChannelId(guild, input.controllerUserId);
      if (channelId === undefined) {
        return {
          channel: null,
        };
      }

      const channel = guild?.channels.cache.get(channelId);
      return {
        channel: {
          id: channelId,
          name: channel?.name ?? channelId,
          kind: mapGuildChannelKind(channel),
        },
      };
    },
  };
}

export function createDiscordInteractionHandler(
  options: DiscordInteractionHandlerOptions,
): (interaction: DiscordInteractionLike) => Promise<void> {
  return async (interaction) => {
    const radioInteraction = toRadioInteraction(interaction);
    if (radioInteraction === null) {
      return;
    }

    await acknowledgeSlowPathInteraction(interaction, radioInteraction);

    let responseSent = false;
    const responder: RadioInteractionResponder = {
      async send(response) {
        await createDiscordInteractionResponder(interaction).send(response);
        responseSent = true;
      },
    };

    const guild = interaction.guild ?? undefined;
    const routerDependencies: RadioInteractionRouterDependencies = {
      guildId: options.guildId,
      controllerUserId: options.controllerUserId,
      responder,
      controllerVoiceState: buildDiscordControllerVoiceStateProvider(guild),
      voice: options.createVoiceActions({
        guildId: guild?.id ?? options.guildId,
        channelId: readControllerChannelId(guild, options.controllerUserId),
        guild,
        voiceAdapterCreator: guild?.voiceAdapterCreator,
      }),
      pear: options.pear,
      nowPlaying: options.nowPlaying,
    };
    const router =
      options.createRouter?.(routerDependencies) ??
      createRadioInteractionRouter(routerDependencies);

    try {
      await router.handle(radioInteraction);
    } catch (error) {
      options.logger?.error('Discord interaction handler failed.', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      if (!responseSent) {
        try {
          await responder.send({
            content: 'The radio command failed. Check logs and try again.',
            ephemeral: true,
          });
        } catch (replyError) {
          options.logger?.error('Discord interaction failure response could not be sent.', {
            error: replyError instanceof Error ? replyError.message : 'Unknown error',
          });
        }
      }
    }
  };
}

export function createDiscordRuntime(options: DiscordRuntimeOptions): {
  start(): Promise<void>;
  stop(): Promise<void>;
} {
  const client = options.client ?? createDiscordClient();
  const handler = createDiscordInteractionHandler(options);

  return {
    async start() {
      client.on('interactionCreate', (interaction) => {
        void handler(interaction as DiscordInteractionLike).catch((error) => {
          options.logger?.error('Discord interaction handling failed.', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        });
      });
      client.once('ready', () => {
        options.logger?.info('Discord client ready.');
      });
      await client.login(options.token);
    },
    async stop() {
      client.destroy();
    },
  };
}
