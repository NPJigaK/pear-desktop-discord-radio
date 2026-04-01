import { transitionState } from './fsm.js';

export type RelayState = 'stopped' | 'starting' | 'running' | 'restarting' | 'failed';

const RELAY_TRANSITIONS = {
  stopped: ['starting'],
  starting: ['running', 'failed', 'stopped'],
  running: ['restarting', 'stopped'],
  restarting: ['running', 'failed', 'stopped'],
  failed: ['starting', 'stopped'],
} as const satisfies Readonly<Record<RelayState, readonly RelayState[]>>;

export function transitionRelayState(current: RelayState, next: RelayState): RelayState {
  return transitionState('relay', current, next, RELAY_TRANSITIONS);
}
