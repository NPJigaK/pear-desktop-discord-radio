import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import type { AudioExportEndedEvent } from '../../src/audio/export-session.js';
import { createAudioExportSession } from '../../src/audio/export-session.js';

test('createAudioExportSession surfaces a PCM stream and propagates provider failure', async () => {
  const stream = new PassThrough();
  const failureEvents: Error[] = [];
  const endEvents: string[] = [];
  const fatalError = new Error('provider failed');
  let fatalListener: ((error: Error) => void) | undefined;
  let endedListener: ((event: AudioExportEndedEvent) => void) | undefined;

  const session = createAudioExportSession({
    provider: {
      async start() {
        return {
          stream,
          stop: async () => undefined,
          onFatalError(listener: (error: Error) => void) {
            fatalListener = listener;
          },
          onEnded(listener: (event: AudioExportEndedEvent) => void) {
            endedListener = listener;
          },
        };
      },
    },
  });

  const running = await session.start();
  running.onFatalError((error: Error) => {
    failureEvents.push(error);
  });
  running.onEnded((event: AudioExportEndedEvent) => {
    endEvents.push(event.reason);
  });

  assert.ok(fatalListener);
  assert.ok(endedListener);
  fatalListener(fatalError);
  endedListener({ reason: 'producer-ended' });

  assert.equal(running.stream, stream);
  assert.equal(failureEvents.length, 1);
  assert.equal(failureEvents[0], fatalError);
  assert.deepStrictEqual(endEvents, ['producer-ended']);
});
