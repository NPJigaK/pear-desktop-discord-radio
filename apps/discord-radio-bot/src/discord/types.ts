import type {
  PearControlAction,
  PearSong,
  QueuePlacement,
} from '../pear/index.js';

export type Awaitable<T> = Promise<T> | T;

export interface RadioAuthorizationConfig {
  readonly guildId: string;
  readonly controllerUserId: string;
}

export interface RadioAccessContext {
  readonly guildId?: string | undefined;
  readonly userId: string;
}

export type RadioAuthorizationResult =
  | {
    readonly ok: true;
  }
  | {
    readonly ok: false;
    readonly code: 'wrong-guild' | 'wrong-user';
    readonly message: string;
  };

export interface RadioVoiceChannelState {
  readonly id: string;
  readonly name: string;
  readonly kind: 'voice' | 'stage' | 'unknown';
}

export interface RadioControllerVoiceState {
  readonly channel: RadioVoiceChannelState | null;
}

export interface RadioResolvedVoiceChannel {
  readonly id: string;
  readonly name: string;
}

export type RadioControllerVoiceResolution =
  | {
    readonly ok: true;
    readonly channel: RadioResolvedVoiceChannel;
  }
  | {
    readonly ok: false;
    readonly code: 'not-in-voice' | 'stage-channel' | 'unsupported-channel';
    readonly message: string;
  };

export interface RadioSelectOption {
  readonly label: string;
  readonly value: string;
  readonly description?: string | undefined;
}

export interface RadioStringSelectComponent {
  readonly type: 'string-select';
  readonly customId: 'radio:add-select';
  readonly placeholder: string;
  readonly options: readonly RadioSelectOption[];
}

export interface RadioResponse {
  readonly content: string;
  readonly ephemeral: true;
  readonly components?: readonly RadioStringSelectComponent[] | undefined;
}

export interface RadioInteractionResponder {
  send(response: RadioResponse): Awaitable<void>;
}

export interface RadioControllerVoiceStateProvider {
  getState(input: RadioAuthorizationConfig): Awaitable<RadioControllerVoiceState>;
}

export interface RadioVoiceActions {
  join(channel: RadioResolvedVoiceChannel): Awaitable<string>;
  leave(): Awaitable<string>;
}

export interface RadioPearActions {
  search(query: string): Awaitable<unknown>;
  addToQueue(request: {
    readonly videoId: string;
    readonly placement?: QueuePlacement | undefined;
  }): Awaitable<void>;
  control(action: PearControlAction): Awaitable<void>;
}

export interface RadioNowPlayingState {
  readonly status: 'offline' | 'connecting' | 'ready' | 'degraded';
  readonly staleReason?: string | undefined;
  readonly song?: PearSong | undefined;
}

export interface RadioNowPlayingProvider {
  getState(): Awaitable<RadioNowPlayingState>;
}

export type RadioControlCommandAction =
  | 'play'
  | 'pause'
  | 'toggle'
  | 'next'
  | 'previous';

export type RadioInteraction =
  | {
    readonly kind: 'command';
    readonly guildId?: string | undefined;
    readonly userId: string;
    readonly subcommand: 'join';
  }
  | {
    readonly kind: 'command';
    readonly guildId?: string | undefined;
    readonly userId: string;
    readonly subcommand: 'leave';
  }
  | {
    readonly kind: 'command';
    readonly guildId?: string | undefined;
    readonly userId: string;
    readonly subcommand: 'add';
    readonly query: string;
    readonly placement?: QueuePlacement | undefined;
  }
  | {
    readonly kind: 'command';
    readonly guildId?: string | undefined;
    readonly userId: string;
    readonly subcommand: 'now';
  }
  | {
    readonly kind: 'command';
    readonly guildId?: string | undefined;
    readonly userId: string;
    readonly subcommand: 'control';
    readonly action: RadioControlCommandAction;
  }
  | {
    readonly kind: 'select';
    readonly guildId?: string | undefined;
    readonly userId: string;
    readonly customId: 'radio:add-select';
    readonly values: readonly string[];
  };

export interface RadioInteractionRouterDependencies
  extends RadioAuthorizationConfig {
  readonly responder: RadioInteractionResponder;
  readonly controllerVoiceState: RadioControllerVoiceStateProvider;
  readonly voice: RadioVoiceActions;
  readonly pear: RadioPearActions;
  readonly nowPlaying: RadioNowPlayingProvider;
}
