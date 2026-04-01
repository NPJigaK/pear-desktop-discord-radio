import assert from 'node:assert/strict';
import test from 'node:test';

import {
  transitionPearState,
  transitionRelayState,
  transitionVoiceState,
} from '../../src/state/index.js';

test('pear state transitions through the allowed graph', () => {
  const allowedTransitions: Array<readonly ['offline' | 'connecting' | 'ready' | 'degraded', 'offline' | 'connecting' | 'ready' | 'degraded']> = [
    ['offline', 'connecting'],
    ['connecting', 'ready'],
    ['connecting', 'degraded'],
    ['ready', 'degraded'],
    ['ready', 'offline'],
    ['degraded', 'connecting'],
    ['degraded', 'offline'],
    ['connecting', 'offline'],
  ];

  for (const [from, to] of allowedTransitions) {
    assert.equal(transitionPearState(from, to), to);
  }
});

test('pear state rejects invalid transitions', () => {
  assert.throws(() => {
    transitionPearState('offline', 'ready');
  }, /Invalid pear transition from offline to ready/);
});

test('pear state rejects unknown runtime states with a domain error', () => {
  assert.throws(() => {
    transitionPearState('unknown' as never, 'offline');
  }, /Unknown pear state: unknown/);
});

test('voice state transitions through the allowed graph', () => {
  const allowedTransitions: Array<readonly ['idle' | 'joining' | 'connected' | 'reconnecting', 'idle' | 'joining' | 'connected' | 'reconnecting']> = [
    ['idle', 'joining'],
    ['joining', 'connected'],
    ['joining', 'idle'],
    ['connected', 'reconnecting'],
    ['connected', 'idle'],
    ['reconnecting', 'joining'],
    ['reconnecting', 'connected'],
    ['reconnecting', 'idle'],
  ];

  for (const [from, to] of allowedTransitions) {
    assert.equal(transitionVoiceState(from, to), to);
  }
});

test('voice state rejects invalid transitions', () => {
  assert.throws(() => {
    transitionVoiceState('idle', 'connected');
  }, /Invalid voice transition from idle to connected/);
});

test('voice state rejects unknown runtime states with a domain error', () => {
  assert.throws(() => {
    transitionVoiceState('unknown' as never, 'idle');
  }, /Unknown voice state: unknown/);
});

test('relay state transitions through the allowed graph', () => {
  const allowedTransitions: Array<readonly ['stopped' | 'starting' | 'running' | 'restarting' | 'failed', 'stopped' | 'starting' | 'running' | 'restarting' | 'failed']> = [
    ['stopped', 'starting'],
    ['starting', 'running'],
    ['starting', 'failed'],
    ['starting', 'stopped'],
    ['running', 'restarting'],
    ['running', 'stopped'],
    ['restarting', 'running'],
    ['restarting', 'failed'],
    ['restarting', 'stopped'],
    ['failed', 'starting'],
    ['failed', 'stopped'],
  ];

  for (const [from, to] of allowedTransitions) {
    assert.equal(transitionRelayState(from, to), to);
  }
});

test('relay state rejects invalid transitions', () => {
  assert.throws(() => {
    transitionRelayState('running', 'starting');
  }, /Invalid relay transition from running to starting/);
});

test('relay state rejects unknown runtime states with a domain error', () => {
  assert.throws(() => {
    transitionRelayState('unknown' as never, 'stopped');
  }, /Unknown relay state: unknown/);
});
