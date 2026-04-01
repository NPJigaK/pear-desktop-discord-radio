import { transitionState } from './fsm.js';

export type PearState = 'offline' | 'connecting' | 'ready' | 'degraded';

const PEAR_TRANSITIONS = {
  offline: ['connecting'],
  connecting: ['ready', 'degraded', 'offline'],
  ready: ['degraded', 'offline'],
  degraded: ['connecting', 'offline'],
} as const satisfies Readonly<Record<PearState, readonly PearState[]>>;

export function transitionPearState(current: PearState, next: PearState): PearState {
  return transitionState('pear', current, next, PEAR_TRANSITIONS);
}
