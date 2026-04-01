import type {
  PearControlAction,
  PearSong,
  QueuePlacement,
} from '../pear/index.js';
import { normalizePearSearchResults } from '../pear/index.js';
import { authorizeRadioAccess } from './guards.js';
import {
  decodeAddSelectionValue,
  encodeAddSelectionValue,
} from './select-value.js';
import type {
  RadioInteraction,
  RadioControlCommandAction,
  RadioInteractionRouterDependencies,
  RadioResponse,
  RadioSelectOption,
  RadioStringSelectComponent,
} from './types.js';
import { clampDiscordComponentText } from './text.js';
import { resolveControllerVoiceChannel } from './voice-channel.js';

const ADD_SELECT_CUSTOM_ID = 'radio:add-select';

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  return 'Unknown error';
}

function buildResponse(
  content: string,
  components?: readonly RadioStringSelectComponent[],
): RadioResponse {
  if (components === undefined) {
    return {
      content,
      ephemeral: true,
    };
  }

  return {
    content,
    ephemeral: true,
    components,
  };
}

function buildTrackLabel(song: PearSong): string {
  if (song.subtitle === undefined) {
    return song.title;
  }

  return `${song.title} - ${song.subtitle}`;
}

function buildAddSelectOptions(
  placement: QueuePlacement,
  results: ReturnType<typeof normalizePearSearchResults>,
): readonly RadioSelectOption[] {
  return results.map((result) => {
    if (result.subtitle === undefined) {
      return {
        label: clampDiscordComponentText(result.title, 100),
        value: encodeAddSelectionValue(placement, result.videoId),
      };
    }

    return {
      label: clampDiscordComponentText(result.title, 100),
      description: clampDiscordComponentText(result.subtitle, 100),
      value: encodeAddSelectionValue(placement, result.videoId),
    };
  });
}

function mapControlAction(action: RadioControlCommandAction): PearControlAction {
  switch (action) {
    case 'play':
      return 'play';
    case 'pause':
      return 'pause';
    case 'toggle':
      return 'toggle-play';
    case 'next':
      return 'next';
    case 'previous':
      return 'previous';
  }
}

export function createRadioInteractionRouter(
  dependencies: RadioInteractionRouterDependencies,
): {
  handle(interaction: RadioInteraction): Promise<void>;
} {
  async function send(content: string, components?: readonly RadioStringSelectComponent[]): Promise<void> {
    await dependencies.responder.send(buildResponse(content, components));
  }

  async function handleJoin(): Promise<void> {
    let voiceState;
    try {
      voiceState = await dependencies.controllerVoiceState.getState({
        guildId: dependencies.guildId,
        controllerUserId: dependencies.controllerUserId,
      });
    } catch (error) {
      await send(`Could not resolve the controller voice channel: ${toErrorMessage(error)}`);
      return;
    }

    const resolution = resolveControllerVoiceChannel(voiceState);

    if (!resolution.ok) {
      await send(resolution.message);
      return;
    }

    let message: string;
    try {
      message = await dependencies.voice.join(resolution.channel);
    } catch (error) {
      await send(`Could not join the controller voice channel: ${toErrorMessage(error)}`);
      return;
    }

    await send(message);
  }

  async function handleLeave(): Promise<void> {
    let message: string;
    try {
      message = await dependencies.voice.leave();
    } catch (error) {
      await send(`Could not leave the voice channel: ${toErrorMessage(error)}`);
      return;
    }

    await send(message);
  }

  async function handleAdd(
    interaction: Extract<RadioInteraction, {
      readonly kind: 'command';
      readonly subcommand: 'add';
    }>,
  ): Promise<void> {
    try {
      const placement = interaction.placement ?? 'queue';
      const results = normalizePearSearchResults(
        await dependencies.pear.search(interaction.query),
        { limit: 25 },
      );

      if (results.length === 0) {
        await send(`No playable tracks were found for "${interaction.query}".`);
        return;
      }

      const component: RadioStringSelectComponent = {
        type: 'string-select',
        customId: ADD_SELECT_CUSTOM_ID,
        placeholder: 'Select a track',
        options: buildAddSelectOptions(placement, results),
      };

      await send('Choose a track to add to the queue.', [component]);
    } catch (error) {
      await send(`Pear search failed: ${toErrorMessage(error)}`);
    }
  }

  async function handleAddSelection(
    interaction: Extract<RadioInteraction, { readonly kind: 'select' }>,
  ): Promise<void> {
    if (interaction.customId !== ADD_SELECT_CUSTOM_ID) {
      await send('That selection is invalid. Run /radio add again.');
      return;
    }

    const [value] = interaction.values;
    if (value === undefined) {
      await send('That selection is invalid. Run /radio add again.');
      return;
    }

    const decoded = decodeAddSelectionValue(value);
    if (!decoded.ok) {
      await send('That selection is invalid. Run /radio add again.');
      return;
    }

    try {
      await dependencies.pear.addToQueue({
        videoId: decoded.videoId,
        placement: decoded.placement,
      });
    } catch (error) {
      await send(`Pear queue add failed: ${toErrorMessage(error)}`);
      return;
    }

    if (decoded.placement === 'next') {
      await send('Added the selected track next in queue.');
      return;
    }

    await send('Added the selected track to the queue.');
  }

  async function handleNow(): Promise<void> {
    let state;
    try {
      state = await dependencies.nowPlaying.getState();
    } catch (error) {
      await send(`Could not read Pear now playing state: ${toErrorMessage(error)}`);
      return;
    }

    switch (state.status) {
      case 'offline':
        await send('Pear is offline. No now-playing state is available.');
        return;
      case 'connecting':
        await send('Pear is connecting. Now-playing state is not ready yet.');
        return;
      case 'degraded': {
        const reason = state.staleReason ?? 'Pear websocket projection is stale.';
        if (state.song === undefined) {
          await send(`Pear state is degraded: ${reason}. No song is currently available from the stale projection.`);
          return;
        }

        await send(`Pear state is degraded: ${reason}. Last known track: ${buildTrackLabel(state.song)}`);
        return;
      }
      case 'ready':
        if (state.song === undefined) {
          await send('No song is currently available from Pear.');
          return;
        }

        await send(`Now playing: ${buildTrackLabel(state.song)}`);
        return;
    }
  }

  async function handleControl(
    interaction: Extract<RadioInteraction, {
      readonly kind: 'command';
      readonly subcommand: 'control';
    }>,
  ): Promise<void> {
    try {
      await dependencies.pear.control(mapControlAction(interaction.action));
      await send(`Sent ${interaction.action} to Pear.`);
    } catch (error) {
      await send(`Pear control failed: ${toErrorMessage(error)}`);
    }
  }

  return {
    async handle(interaction) {
      const authorization = authorizeRadioAccess(dependencies, interaction);
      if (!authorization.ok) {
        await send(authorization.message);
        return;
      }

      if (interaction.kind === 'select') {
        await handleAddSelection(interaction);
        return;
      }

      switch (interaction.subcommand) {
        case 'join':
          await handleJoin();
          return;
        case 'leave':
          await handleLeave();
          return;
        case 'add':
          await handleAdd(interaction);
          return;
        case 'now':
          await handleNow();
          return;
        case 'control':
          await handleControl(interaction);
          return;
      }
    },
  };
}
