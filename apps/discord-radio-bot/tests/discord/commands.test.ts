import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRadioCommandData } from '../../src/discord/commands.js';

type MutableRadioCommandData = {
  options: Array<{
    options?: Array<{
      choices?: Array<{
        name: string;
      }>;
    }>;
  }>;
};

test('buildRadioCommandData returns the expected radio command schema', () => {
  assert.deepStrictEqual(buildRadioCommandData(), {
    name: 'radio',
    description: 'Control the radio',
    type: 1,
    options: [
      {
        type: 1,
        name: 'join',
        description: 'Join the radio voice channel',
      },
      {
        type: 1,
        name: 'leave',
        description: 'Leave the radio voice channel',
      },
      {
        type: 1,
        name: 'add',
        description: 'Add a track to the queue',
        options: [
          {
            type: 3,
            name: 'query',
            description: 'Search query',
            required: true,
          },
          {
            type: 3,
            name: 'placement',
            description: 'Where to place the track',
            choices: [
              {
                name: 'queue',
                value: 'queue',
              },
              {
                name: 'next',
                value: 'next',
              },
            ],
          },
        ],
      },
      {
        type: 1,
        name: 'now',
        description: 'Show the current track',
      },
      {
        type: 1,
        name: 'control',
        description: 'Control playback',
        options: [
          {
            type: 3,
            name: 'action',
            description: 'Playback action',
            required: true,
            choices: [
              {
                name: 'play',
                value: 'play',
              },
              {
                name: 'pause',
                value: 'pause',
              },
              {
                name: 'toggle',
                value: 'toggle',
              },
              {
                name: 'next',
                value: 'next',
              },
              {
                name: 'previous',
                value: 'previous',
              },
            ],
          },
        ],
      },
    ],
  });
});

test('buildRadioCommandData returns a fresh copy on each call', () => {
  const first = buildRadioCommandData() as unknown as MutableRadioCommandData;
  first.options[2]!.options![1]!.choices![0]!.name = 'mutated';

  const second = buildRadioCommandData() as unknown as MutableRadioCommandData;
  assert.equal(second.options[2]!.options![1]!.choices![0]!.name, 'queue');
});
