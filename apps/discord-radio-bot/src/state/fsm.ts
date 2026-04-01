export type TransitionMap<State extends string> = Readonly<Record<State, readonly State[]>>;

export function canTransitionState<State extends string>(
  machineName: string,
  current: State,
  next: State,
  transitions: TransitionMap<State>,
): boolean {
  const allowedTransitions = transitions[current];
  if (allowedTransitions === undefined) {
    throw new Error(`Unknown ${machineName} state: ${current}`);
  }

  return allowedTransitions.includes(next);
}

export function transitionState<State extends string>(
  machineName: string,
  current: State,
  next: State,
  transitions: TransitionMap<State>,
): State {
  if (!canTransitionState(machineName, current, next, transitions)) {
    throw new Error(`Invalid ${machineName} transition from ${current} to ${next}`);
  }

  return next;
}
