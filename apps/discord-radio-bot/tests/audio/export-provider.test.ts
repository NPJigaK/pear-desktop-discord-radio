import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type AudioExportProviderKind,
  type AudioExportProviderReadyResult,
  type AudioExportTransport,
  type CreateAudioExportProviderDescriptorInput,
  createAudioExportProviderDescriptor,
} from '../../src/audio/index.js';

type IsExact<TActual, TExpected> = (
  <T>() => T extends TActual ? 1 : 2
) extends (
  <T>() => T extends TExpected ? 1 : 2
)
  ? (
      <T>() => T extends TExpected ? 1 : 2
    ) extends (
      <T>() => T extends TActual ? 1 : 2
    )
    ? true
    : false
  : false;

type AssertExact<TActual, TExpected> = IsExact<TActual, TExpected> extends true
  ? true
  : never;

type ExpectedAudioExportProviderKind = 'plugin' | 'private-patch';
type ExpectedAudioExportTransport = 'named-pipe' | 'ipc';
type ExpectedCreateAudioExportProviderDescriptorInput = {
  readonly kind: ExpectedAudioExportProviderKind;
  readonly transport: ExpectedAudioExportTransport;
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitsPerSample: number;
};
type ExpectedCreateAudioExportProviderDescriptor = (
  input: ExpectedCreateAudioExportProviderDescriptorInput,
) => AudioExportProviderReadyResult;

const typeChecks: [
  AssertExact<AudioExportProviderKind, ExpectedAudioExportProviderKind>,
  AssertExact<AudioExportTransport, ExpectedAudioExportTransport>,
  AssertExact<
    CreateAudioExportProviderDescriptorInput,
    ExpectedCreateAudioExportProviderDescriptorInput
  >,
  AssertExact<
    typeof createAudioExportProviderDescriptor,
    ExpectedCreateAudioExportProviderDescriptor
  >,
] = [true, true, true, true];

const createAudioExportProviderDescriptorInputCheck: CreateAudioExportProviderDescriptorInput =
  {
    kind: 'plugin',
    transport: 'named-pipe',
    sampleRate: 48_000,
    channels: 2,
    bitsPerSample: 16,
  };

test('createAudioExportProviderDescriptor preserves the provider identity and PCM contract', () => {
  const descriptor = createAudioExportProviderDescriptor(
    createAudioExportProviderDescriptorInputCheck,
  );

  const providerKind: AudioExportProviderReadyResult['kind'] = descriptor.kind;
  const providerTransport: AudioExportProviderReadyResult['transport'] = descriptor.transport;
  const providerPcm: AudioExportProviderReadyResult['pcm'] = descriptor.pcm;

  assert.deepStrictEqual(descriptor, {
    kind: 'plugin',
    transport: 'named-pipe',
    pcm: {
      sampleRate: 48_000,
      channels: 2,
      bitsPerSample: 16,
    },
  } satisfies AudioExportProviderReadyResult);

  assert.equal(providerKind, 'plugin');
  assert.equal(providerTransport, 'named-pipe');
  assert.deepStrictEqual(providerPcm, {
    sampleRate: 48_000,
    channels: 2,
    bitsPerSample: 16,
  });

  assert.deepStrictEqual(typeChecks, [true, true, true, true]);
});
