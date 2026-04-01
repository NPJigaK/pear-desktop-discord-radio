import assert from 'node:assert/strict';
import test from 'node:test';

import * as audio from '../../src/audio/index.js';

type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;

type AudioSurface = typeof import('../../src/audio/index.js');

const loopbackHelperCommandResultRemoved: HasKey<
  AudioSurface,
  'LoopbackHelperCommandResult'
> = false;
const loopbackHelperDiscoveryResultRemoved: HasKey<
  AudioSurface,
  'LoopbackHelperDiscoveryResult'
> = false;
const loopbackHelperProbeResultRemoved: HasKey<
  AudioSurface,
  'LoopbackHelperProbeResult'
> = false;
const probeLoopbackHelperOptionsRemoved: HasKey<
  AudioSurface,
  'ProbeLoopbackHelperOptions'
> = false;
const runLoopbackHelperCommandRemoved: HasKey<
  AudioSurface,
  'RunLoopbackHelperCommand'
> = false;

void loopbackHelperCommandResultRemoved;
void loopbackHelperDiscoveryResultRemoved;
void loopbackHelperProbeResultRemoved;
void probeLoopbackHelperOptionsRemoved;
void runLoopbackHelperCommandRemoved;

test('audio index no longer exposes loopback-helper symbols', () => {
  assert.equal('discoverLoopbackHelper' in audio, false);
  assert.equal('probeLoopbackHelper' in audio, false);
  assert.equal('runLoopbackHelperCommand' in audio, false);
  assert.equal('getLoopbackHelperExecutablePath' in audio, false);
});
