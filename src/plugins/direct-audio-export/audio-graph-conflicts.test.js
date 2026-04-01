import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getUnsupportedDirectAudioExportConflictIds,
  isUnsupportedDirectAudioExportConflictPlugin,
} from './audio-graph-conflicts.js';

test('identifies conflicting plugin ids', () => {
  assert.equal(
    isUnsupportedDirectAudioExportConflictPlugin('audio-compressor'),
    true,
  );
  assert.equal(isUnsupportedDirectAudioExportConflictPlugin('equalizer'), true);
  assert.equal(isUnsupportedDirectAudioExportConflictPlugin('skip-silences'), false);
});

test('detects conflicting graph-mutating plugins', () => {
  assert.deepEqual(
    getUnsupportedDirectAudioExportConflictIds({
      'audio-compressor': { enabled: true },
      equalizer: { enabled: true },
    }),
    ['audio-compressor', 'equalizer'],
  );
});

test('ignores unrelated plugins', () => {
  assert.deepEqual(
    getUnsupportedDirectAudioExportConflictIds({
      'audio-compressor': { enabled: false },
      equalizer: { enabled: false },
      'skip-silences': { enabled: true },
    }),
    [],
  );
});
