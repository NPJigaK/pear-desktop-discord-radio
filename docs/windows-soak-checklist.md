# Windows Soak Checklist

Use this checklist for a real native Windows 11 soak pass of the approved v2 runtime. It assumes the current single-guild, single-controller-user, single-session scope and uses the supported single-repo topology.

## Source Archive Expectations

Use a clean source archive or clone. Do not share or depend on:

- `node_modules/`
- `dist/`
- `.codex/`
- `.git/` metadata

The soak host should start from source plus the normal install/bootstrap flow.

## Exact Setup Order

1. Prepare a native Windows 11 host.
2. Install Node.js 24 or newer.
3. Place this repository on the soak host as a clean source archive or git clone.
4. Prepare environment variables using [../apps/discord-radio-bot/.env.example](../apps/discord-radio-bot/.env.example) as the variable reference.
5. If you will use root wrapper commands only, put the working `.env` at the repo root.
6. If you will run direct bot-package commands such as `pnpm --dir apps/discord-radio-bot run sync-commands`, either export the same variables in the current shell or place a matching `.env` in `apps/discord-radio-bot/`.
7. Run `pnpm install` at the repo root.
8. Run `pnpm build` at the repo root.
9. Configure Pear exactly as described below.
10. Enable the `Direct Audio Export (Spike)` plugin in the root Pear app.
11. Run `pnpm --dir apps/discord-radio-bot run bootstrap:ffmpeg`.
12. Run `pnpm doctor:radio-bot` and require `full-pass: YES`.
13. Run `pnpm --dir apps/discord-radio-bot run sync-commands`.
14. Run `pnpm start:radio-stack`.
15. Execute the command-by-command verification steps in Discord as the configured controller user.

## Required Environment Variables

Use [../apps/discord-radio-bot/.env.example](../apps/discord-radio-bot/.env.example) as the source of truth.

Required:

- `DISCORD_TOKEN`
- `DISCORD_APPLICATION_ID`
- `DISCORD_GUILD_ID`
- `DISCORD_CONTROLLER_USER_ID`
- `PEAR_CLIENT_ID`

Optional:

- `PEAR_HOST=127.0.0.1`
- `PEAR_PORT=26538`
- `PEAR_DESKTOP_DIR`
- `FFMPEG_PATH`
- `LOG_LEVEL`

Notes:

- `PEAR_HOST` must stay exactly `127.0.0.1`.
- `PEAR_DESKTOP_DIR` is optional; the supported default is this repo root.
- `FFMPEG_PATH` is a fallback only. The default path is the app-managed bot-package binary.
- `LOG_LEVEL=debug` is useful during the soak pass.
- Repo-root `.env` is used automatically only by the root wrapper commands.
- Direct bot-package commands require shell-exported variables or `apps/discord-radio-bot/.env`.

## Pear Setup Steps

In the Pear app built from this repo root:

1. Enable the API Server.
2. Bind it to `127.0.0.1`.
3. Keep auth mode on `AUTH_AT_FIRST`.
4. Enable the `Direct Audio Export (Spike)` plugin.

Expected audio path:

`Pear direct audio export -> FFmpeg encode -> Ogg/Opus -> Discord voice`

## Export Expectations

- The direct-audio-export transport must be enabled in the root Pear app.
- The export readiness probe must succeed before runtime is expected to be healthy.
- The readiness probe should pass when Pear is running and reachable even if Pear is idle or paused at startup.
- If Pear cannot attach the export client, `doctor` or runtime startup will fail even if FFmpeg itself is present.

## FFmpeg Bootstrap Expectations

Default FFmpeg resolution order:

1. app-managed binary in `apps/discord-radio-bot/.cache/ffmpeg/`
2. `FFMPEG_PATH`
3. `PATH`

Run:

```powershell
pnpm --dir apps/discord-radio-bot run bootstrap:ffmpeg
```

Expected outcomes:

- Normal Windows source installs should work without a manual FFmpeg installation.
- If app-managed FFmpeg is missing but `FFMPEG_PATH` or `PATH` works, `doctor` still passes and reports the fallback source.
- If no source works, the error should point the tester to the bot-package bootstrap command.

## Doctor Verification

Run:

```powershell
pnpm doctor:radio-bot
```

Require all of the following on native Windows 11:

- `pear-host-exact: PASS`
- `pear-auth-reachable: PASS`
- `pear-websocket-reachable: PASS`
- `windows-requirement-satisfied: PASS`
- `export-provider-ready: PASS`
- `export-pcm-contract-ready: PASS`
- `ffmpeg-discoverable: PASS`
- `ffmpeg-encode-ready: PASS`
- `full-pass: YES`

## Runtime Startup Verification

Run:

```powershell
pnpm start:radio-stack
```

Watch the terminal running the launcher/runtime. Expected log signals include:

- `Audio export provider selected for runtime.`
- `FFmpeg selected for runtime.`
- `Runtime is using a fallback FFmpeg source.` only if app-managed FFmpeg was not used
- `Voice session joined.`
- `Audio relay started.`
- `Voice session moved.` when rejoining from another standard voice channel
- `Voice session left.`

## Command-By-Command Verification

Run these as the configured controller user in the configured guild.

### `/radio join`

Steps:

1. Join a standard guild voice channel as the controller user.
2. Run `/radio join`.

Expect:

- The bot joins that channel.
- The runtime logs `Voice session joined.` and `Audio relay started.`
- Audio starts flowing when Pear is already playing.

### `/radio join` move case

Steps:

1. While the bot is already connected, move the controller user to a different standard voice channel.
2. Run `/radio join` again.

Expect:

- The existing voice session moves.
- The relay stays running.
- The runtime logs `Voice session moved.`

### `/radio add query:<string> placement:queue`

Steps:

1. Run `/radio add` with a query that should return playable Pear results.
2. Select a result from the menu.

Expect:

- The command defers cleanly instead of timing out.
- The result is added to Pear's queue.
- No bot-owned queue is created.

### `/radio add query:<string> placement:next`

Repeat the previous test with `placement:next`.

Expect:

- The item is inserted in Pear using the approved `next` semantics.
- The interaction still defers cleanly and finishes without timeout.

### `/radio now`

Expect:

- The response reflects Pear-backed state only.
- It distinguishes `offline`, `connecting`, `ready`, and `degraded` when applicable.

### `/radio control action:<play|pause|toggle|next|previous>`

Verify each action.

Expect:

- The command reaches Pear.
- Pear changes state accordingly.

### `/radio leave`

Expect:

- The bot leaves voice.
- The relay stops.
- The runtime logs `Voice session left.`

## Failure Symptoms And Where To Look

### `doctor` fails

Look at the terminal output from `pnpm doctor:radio-bot`.

Common signals:

- `ffmpeg-discoverable: FAIL`
  - No usable FFmpeg source worked.
  - First action: run `pnpm --dir apps/discord-radio-bot run bootstrap:ffmpeg`.
- `export-provider-ready: FAIL`
  - The export transport was not found or the root Pear app is not running with the plugin enabled.
- `export-pcm-contract-ready: FAIL`
  - Pear could not attach the export client or confirm the runtime audio stream on the host.
- `ffmpeg-encode-ready: FAIL`
  - FFmpeg could not satisfy the actual export -> Ogg/Opus relay path used by runtime.

### Runtime relay fails

Look at the same terminal that is running `pnpm start:radio-stack`.

Relevant log messages:

- `Audio export provider selected for runtime.`
- `FFmpeg selected for runtime.`
- `Runtime is using a fallback FFmpeg source.`
- `Audio relay started.`
- `Audio relay exited.`
- `Audio relay emitted an error.`
- `Attempting audio relay restart.`
- `Relay restart succeeded.`
- `Relay restart failed.`
- `Voice session join failed.`
- `Voice session move failed.`

### Discord command fails

Check:

- wrong guild
- wrong controller user
- controller user not in a standard voice channel
- stage channel attempt
- Pear unavailable or degraded

## Optional Fallback Verification

If you want to prove the fallback order:

1. Remove or rename `apps/discord-radio-bot/.cache/ffmpeg/`.
2. Set `FFMPEG_PATH` to a known-good FFmpeg binary and rerun `pnpm doctor:radio-bot`.
3. Remove `FFMPEG_PATH`, place FFmpeg on `PATH`, and rerun `pnpm doctor:radio-bot`.

Expect:

- The first working source is selected in this order: app-managed, then `FFMPEG_PATH`, then `PATH`.
- Runtime and `doctor` should continue to work with a warning when a fallback source is used.

## Completion Criteria

The repository is ready for a real soak pass when:

- install/build succeeds from the repo root
- bot-package FFmpeg bootstrap succeeds
- `pnpm doctor:radio-bot` returns `full-pass: YES`
- command sync succeeds
- runtime starts cleanly through `pnpm start:radio-stack`
- every `/radio` command behaves as documented
- Pear audio is audible in Discord through the approved local direct-export/FFmpeg path
