# pear-desktop-discord-radio

Windows-only local Discord radio bot that uses Pear Desktop as the playback, search, and queue authority.

Japanese README: [README.ja.md](./README.ja.md)

> The supported v2 path is a single-repo layout: the patched Pear fork lives at the repo root, and the Node bot/runtime package lives under `apps/discord-radio-bot`.

## Topology

- Repo root: patched Pear Desktop fork, including the `direct-audio-export` plugin and Pear build/start scripts.
- `apps/discord-radio-bot`: Discord runtime, `doctor`, launcher, FFmpeg bootstrap, slash-command sync, and tests.
- Root wrapper entry points:
  - `pnpm start:radio-stack`
  - `pnpm doctor:radio-bot`
  - `pnpm test:radio-bot`
- No external sibling Pear repository is part of the supported topology.

## Product Boundaries

- One guild, one controller user, one active voice session.
- One root slash command: `/radio`.
- Guild-scoped command sync only.
- Pear remains the only source of truth for playback state, search results, and queue state.
- No cloud hosting, no public interactions endpoint, and no database.

## Requirements

- Native Windows 11 for runtime use.
- Node.js 24 or newer.
- Discord application and bot token for the target guild.
- The patched Pear fork already present at this repo root.

`FFMPEG_DSHOW_AUDIO_DEVICE` is not part of the supported v2 setup path.

## Quick Start

Use this if you just want the shortest working path.

1. Create `E:\github\pear-desktop-discord-radio\.env` from [apps/discord-radio-bot/.env.example](./apps/discord-radio-bot/.env.example).
2. Copy the same file to `E:\github\pear-desktop-discord-radio\apps\discord-radio-bot\.env`.
3. From the repo root, run:

```powershell
pnpm install
pnpm build
pnpm --dir apps/discord-radio-bot run bootstrap:ffmpeg
```

4. Start Pear from the repo root:

```powershell
pnpm start:direct-audio-export
```

5. In Pear, enable:
   - API Server
   - `127.0.0.1`
   - `AUTH_AT_FIRST`
   - `Direct Audio Export (Spike)`
6. Back in the repo root, run:

```powershell
pnpm doctor:radio-bot
pnpm --dir apps/discord-radio-bot run sync-commands
```

7. Start the bot:

- If Pear is still open from step 4, run:

```powershell
pnpm --dir apps/discord-radio-bot run runtime
```

- If Pear is not running, run the integrated launcher:

```powershell
pnpm start:radio-stack
```

8. In Discord, join a normal voice channel and run `/radio join`.

If `pnpm doctor:radio-bot` prints `full-pass: YES`, the stack is ready.

## Pear Setup

In the Pear app built from this repo root:

1. Enable the API Server.
2. Bind it to `127.0.0.1`.
3. Keep auth mode on `AUTH_AT_FIRST`.
4. Enable the `Direct Audio Export (Spike)` plugin used by the v2 runtime path.

Supported audio path:

`Pear direct audio export -> FFmpeg encode -> Ogg/Opus -> Discord voice`

## Environment

Use [apps/discord-radio-bot/.env.example](./apps/discord-radio-bot/.env.example) as the variable reference.

Env loading depends on how you start the bot package:

- Root wrapper commands such as `pnpm start:radio-stack`, `pnpm doctor:radio-bot`, and `pnpm test:radio-bot` use the repo-root `.env` as a fallback source for the bot package.
- Direct bot-package commands such as `pnpm --dir apps/discord-radio-bot run sync-commands` and `pnpm --dir apps/discord-radio-bot run runtime` do not get that root-wrapper fallback automatically. For those commands, either export the variables in the current shell first or place a matching `.env` in `apps/discord-radio-bot/`.

Required:

- `DISCORD_TOKEN`
- `DISCORD_APPLICATION_ID`
- `DISCORD_GUILD_ID`
- `DISCORD_CONTROLLER_USER_ID`
- `PEAR_CLIENT_ID`

Optional:

- `PEAR_HOST` default: `127.0.0.1`
- `PEAR_PORT` default: `26538`
- `PEAR_DESKTOP_DIR` override only; defaults to this repo root
- `FFMPEG_PATH` fallback only
- `LOG_LEVEL`

`PEAR_HOST` is locked to `127.0.0.1`. Startup fails if it is anything else.

## Install

Install the integrated workspace from the repo root:

```powershell
pnpm install
pnpm build
pnpm --dir apps/discord-radio-bot run bootstrap:ffmpeg
```

- `pnpm install` installs both the Pear root and the bot workspace package.
- `pnpm build` builds the Pear app at the root.
- `pnpm --dir apps/discord-radio-bot run bootstrap:ffmpeg` downloads the pinned BtbN `win64-lgpl-shared-8.0` build, verifies its checksum, and extracts it into `apps/discord-radio-bot/.cache/ffmpeg/`.

FFmpeg provenance and attribution are documented in [docs/ffmpeg-notice.md](./docs/ffmpeg-notice.md).

If runtime or `doctor` reports that no usable ffmpeg executable was found, run the bot-package bootstrap command first. Fallback to `FFMPEG_PATH` and `PATH` still remains available.

FFmpeg resolution order:

1. app-managed bot-package cache
2. `FFMPEG_PATH`
3. `PATH`

## Command Sync

Normal runtime startup never registers commands. Sync them explicitly from the bot package:

```powershell
pnpm --dir apps/discord-radio-bot run sync-commands
```

Before running that direct bot-package command, make sure the environment is available either through shell-exported variables or `apps/discord-radio-bot/.env`.

This registers one guild-scoped `/radio` command tree for the configured guild.

## Diagnostics

Run the standalone doctor through the root wrapper:

```powershell
pnpm doctor:radio-bot
```

Doctor checks:

- Pear host is exactly `127.0.0.1`
- Pear auth endpoint is reachable
- Pear websocket endpoint is reachable
- The plugin export transport is discoverable
- The export PCM contract is ready for runtime
- FFmpeg is discoverable with explicit source/path reporting
- FFmpeg can satisfy the export -> Ogg/Opus encode smoke test used by runtime

Each check reports `PASS`, `FAIL`, or `UNSUPPORTED`. `full-pass: YES` only appears on native Windows 11 with every required check passing.

## Run

Pear dev/build commands stay at the repo root:

```powershell
pnpm dev
pnpm start
pnpm start:direct-audio-export
```

Integrated radio-stack launch goes through the root wrapper:

```powershell
pnpm start:radio-stack
```

`pnpm start:radio-stack` starts the bot package launcher, which resolves the Pear root directory, waits for Pear readiness, and then starts the Discord runtime.

If Pear is already running and you want the bot runtime only, run the app-package command directly:

```powershell
pnpm --dir apps/discord-radio-bot run runtime
```

## Slash Commands

`/radio join`

- Joins only the configured controller user's current standard guild voice channel.
- If the bot is already connected elsewhere, it moves the existing voice session to the controller user's current standard voice channel and keeps the relay running.
- Rejects stage channels.
- Fails clearly if the controller user is not in voice.

`/radio leave`

- Stops the relay and leaves the current voice connection.

`/radio add query:<text> placement:<queue|next>`

- Searches Pear directly.
- Drops non-playable results and entries without a usable `videoId` or label.
- Returns an ephemeral select menu.
- Enqueues directly in Pear with no bot-side queue or search cache.

`/radio now`

- Reports the current Pear-backed track projection.
- Distinguishes `offline`, `connecting`, `ready`, and `degraded`.

`/radio control action:<play|pause|toggle|next|previous>`

- Sends the selected control action straight to Pear.

## Command Surface

Root entry points:

```text
pnpm start:radio-stack
pnpm doctor:radio-bot
pnpm test:radio-bot
pnpm install
pnpm build
pnpm dev
pnpm start
pnpm start:direct-audio-export
```

Bot-package-only commands:

```text
pnpm --dir apps/discord-radio-bot run bootstrap:ffmpeg
pnpm --dir apps/discord-radio-bot run sync-commands
pnpm --dir apps/discord-radio-bot run runtime
pnpm --dir apps/discord-radio-bot run lint
pnpm --dir apps/discord-radio-bot run typecheck
pnpm --dir apps/discord-radio-bot run test
```

## Implementation Notes

- Runtime uses only `Guilds` and `GuildVoiceStates` gateway intents.
- Runtime command handling is gateway-only; there is no public HTTP interactions endpoint.
- Audio relay uses Pear direct audio export plus FFmpeg `libopus` / `ogg` encoding for `@discordjs/voice`.
- The supported Pear patch lives in this repo root; see [docs/private-pear-fork.md](./docs/private-pear-fork.md).
- The bot/runtime package lives under [apps/discord-radio-bot](./apps/discord-radio-bot).
- Runtime and `doctor` resolve FFmpeg as app-managed -> `FFMPEG_PATH` -> `PATH`.
- The pinned FFmpeg manifest and attribution note stay in sync with [docs/ffmpeg-management.md](./docs/ffmpeg-management.md) and [docs/ffmpeg-notice.md](./docs/ffmpeg-notice.md).

Windows soak execution docs:

- [docs/windows-soak-checklist.md](./docs/windows-soak-checklist.md)
- [docs/windows-soak-results-template.md](./docs/windows-soak-results-template.md)

## Manual Windows Verification

1. Run `pnpm install` and `pnpm build` at the repo root.
2. Run `pnpm --dir apps/discord-radio-bot run bootstrap:ffmpeg`.
3. Start Pear from this repo root and confirm the API server is reachable on `127.0.0.1`.
4. Enable the `Direct Audio Export (Spike)` plugin in the Pear app.
5. Run `pnpm doctor:radio-bot` and require `full-pass: YES`.
6. For direct bot-package commands, either export the bot env in the current shell or place a matching `.env` in `apps/discord-radio-bot/`.
7. Run `pnpm --dir apps/discord-radio-bot run sync-commands`.
8. Run `pnpm start:radio-stack`.
9. As the configured controller user, verify `/radio join`, `/radio add`, `/radio now`, `/radio control`, and `/radio leave`.

## Known Limits

- Runtime is intended for native Windows 11 use only.
- Only one configured guild and one configured controller user are accepted.
- Only standard guild voice channels are supported.
- `pnpm start:radio-stack` is the supported integrated startup path.
- Slash commands are not auto-synced at runtime.
- Source installs need one-time internet access for the default FFmpeg bootstrap path unless `FFMPEG_PATH` or `PATH` already provides a working binary.
