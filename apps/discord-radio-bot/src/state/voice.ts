import { transitionState } from './fsm.js';

export type VoiceState = 'idle' | 'joining' | 'connected' | 'reconnecting';

const VOICE_TRANSITIONS = {
  idle: ['joining'],
  joining: ['connected', 'idle'],
  connected: ['reconnecting', 'idle'],
  reconnecting: ['joining', 'connected', 'idle'],
} as const satisfies Readonly<Record<VoiceState, readonly VoiceState[]>>;

export function transitionVoiceState(current: VoiceState, next: VoiceState): VoiceState {
  return transitionState('voice', current, next, VOICE_TRANSITIONS);
}
