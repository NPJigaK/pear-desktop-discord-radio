import type {
  RadioControllerVoiceResolution,
  RadioControllerVoiceState,
} from './types.js';

export function resolveControllerVoiceChannel(
  state: RadioControllerVoiceState,
): RadioControllerVoiceResolution {
  if (state.channel === null) {
    return {
      ok: false,
      code: 'not-in-voice',
      message: 'The configured controller user is not in a voice channel.',
    };
  }

  if (state.channel.kind === 'stage') {
    return {
      ok: false,
      code: 'stage-channel',
      message: 'Stage channels are not supported. Join a standard voice channel first.',
    };
  }

  if (state.channel.kind !== 'voice') {
    return {
      ok: false,
      code: 'unsupported-channel',
      message: 'Only standard guild voice channels are supported.',
    };
  }

  return {
    ok: true,
    channel: {
      id: state.channel.id,
      name: state.channel.name,
    },
  };
}
