export interface AppConfig {
  readonly discordToken: string;
  readonly discordApplicationId: string;
  readonly discordGuildId: string;
  readonly discordControllerUserId: string;
  readonly pearClientId: string;
  readonly pearHost: '127.0.0.1';
  readonly pearPort: number;
  readonly ffmpegPath?: string | undefined;
  readonly logLevel?: string | undefined;
}

export type ConfigEnv = Readonly<Record<string, string | undefined>>;
