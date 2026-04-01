import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authorizeRadioAccess,
} from '../../src/discord/guards.js';
import {
  decodeAddSelectionValue,
  encodeAddSelectionValue,
} from '../../src/discord/select-value.js';
import {
  clampDiscordComponentText,
} from '../../src/discord/text.js';
import {
  resolveControllerVoiceChannel,
} from '../../src/discord/voice-channel.js';

test('authorizeRadioAccess accepts the configured guild and controller user', () => {
  assert.deepStrictEqual(
    authorizeRadioAccess(
      {
        guildId: 'guild-1',
        controllerUserId: 'user-1',
      },
      {
        guildId: 'guild-1',
        userId: 'user-1',
      },
    ),
    { ok: true },
  );
});

test('authorizeRadioAccess rejects requests from the wrong guild', () => {
  assert.deepStrictEqual(
    authorizeRadioAccess(
      {
        guildId: 'guild-1',
        controllerUserId: 'user-1',
      },
      {
        guildId: 'guild-2',
        userId: 'user-1',
      },
    ),
    {
      ok: false,
      code: 'wrong-guild',
      message: 'This radio only accepts commands in the configured guild.',
    },
  );
});

test('authorizeRadioAccess rejects requests from the wrong user', () => {
  assert.deepStrictEqual(
    authorizeRadioAccess(
      {
        guildId: 'guild-1',
        controllerUserId: 'user-1',
      },
      {
        guildId: 'guild-1',
        userId: 'user-2',
      },
    ),
    {
      ok: false,
      code: 'wrong-user',
      message: 'Only the configured controller user can use this radio.',
    },
  );
});

test('resolveControllerVoiceChannel returns the standard voice channel', () => {
  assert.deepStrictEqual(
    resolveControllerVoiceChannel({
      channel: {
        id: 'voice-1',
        name: 'Desk Radio',
        kind: 'voice',
      },
    }),
    {
      ok: true,
      channel: {
        id: 'voice-1',
        name: 'Desk Radio',
      },
    },
  );
});

test('resolveControllerVoiceChannel rejects missing voice state', () => {
  assert.deepStrictEqual(
    resolveControllerVoiceChannel({
      channel: null,
    }),
    {
      ok: false,
      code: 'not-in-voice',
      message: 'The configured controller user is not in a voice channel.',
    },
  );
});

test('resolveControllerVoiceChannel rejects stage channels', () => {
  assert.deepStrictEqual(
    resolveControllerVoiceChannel({
      channel: {
        id: 'stage-1',
        name: 'Town Hall',
        kind: 'stage',
      },
    }),
    {
      ok: false,
      code: 'stage-channel',
      message: 'Stage channels are not supported. Join a standard voice channel first.',
    },
  );
});

test('encodeAddSelectionValue and decodeAddSelectionValue round-trip a valid choice', () => {
  const value = encodeAddSelectionValue('next', 'video-123');

  assert.equal(value, 'next|video-123');
  assert.deepStrictEqual(decodeAddSelectionValue(value), {
    ok: true,
    placement: 'next',
    videoId: 'video-123',
  });
});

test('decodeAddSelectionValue rejects malformed values', () => {
  assert.deepStrictEqual(decodeAddSelectionValue('bad-value'), {
    ok: false,
  });
  assert.deepStrictEqual(decodeAddSelectionValue('queue|'), {
    ok: false,
  });
  assert.deepStrictEqual(decodeAddSelectionValue('later|video-123'), {
    ok: false,
  });
});

test('clampDiscordComponentText keeps values at or under the limit unchanged', () => {
  assert.equal(clampDiscordComponentText('short text', 100), 'short text');
  assert.equal(clampDiscordComponentText('x'.repeat(100), 100), 'x'.repeat(100));
});

test('clampDiscordComponentText truncates over-limit values with an ellipsis', () => {
  const value = `${'l'.repeat(99)}tail`;

  assert.equal(clampDiscordComponentText(value, 100), `${'l'.repeat(99)}…`);
});
