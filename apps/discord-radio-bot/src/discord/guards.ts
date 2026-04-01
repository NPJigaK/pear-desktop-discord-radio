import type {
  RadioAccessContext,
  RadioAuthorizationConfig,
  RadioAuthorizationResult,
} from './types.js';

export function authorizeRadioAccess(
  config: RadioAuthorizationConfig,
  context: RadioAccessContext,
): RadioAuthorizationResult {
  if (context.guildId !== config.guildId) {
    return {
      ok: false,
      code: 'wrong-guild',
      message: 'This radio only accepts commands in the configured guild.',
    };
  }

  if (context.userId !== config.controllerUserId) {
    return {
      ok: false,
      code: 'wrong-user',
      message: 'Only the configured controller user can use this radio.',
    };
  }

  return { ok: true };
}
