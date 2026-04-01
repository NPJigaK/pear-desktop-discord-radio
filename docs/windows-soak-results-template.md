# Windows Soak Results Template

Fill this in during or immediately after a native Windows 11 soak pass.

## Run Summary

- Date:
- Tester:
- Repository revision:
- Source archive type: git clone / zip / other
- Archive was clean source only: yes / no
- Windows version:
- Node.js version:
- Pear version from repo root:
- Discord desktop version:

## Environment Configuration

- Repo-root `.env` present: yes / no
- `DISCORD_TOKEN` set: yes / no
- `DISCORD_APPLICATION_ID` set: yes / no
- `DISCORD_GUILD_ID` set: yes / no
- `DISCORD_CONTROLLER_USER_ID` set: yes / no
- `PEAR_CLIENT_ID` set: yes / no
- `PEAR_HOST` value:
- `PEAR_PORT` value:
- `PEAR_DESKTOP_DIR` value:
- `FFMPEG_PATH` value:
- `LOG_LEVEL` value:

## Pear Setup

- Root `pnpm install` completed: yes / no
- Root `pnpm build` completed: yes / no
- API Server enabled: yes / no
- Pear bind host:
- Auth mode:
- `Direct Audio Export (Spike)` plugin enabled: yes / no

## Bot Package Setup

- `pnpm --dir apps/discord-radio-bot run bootstrap:ffmpeg` completed: yes / no
- App-managed FFmpeg present in `apps/discord-radio-bot/.cache/ffmpeg/`: yes / no
- `pnpm --dir apps/discord-radio-bot run sync-commands` completed: yes / no

## Doctor Results

- `pnpm doctor:radio-bot` completed: yes / no
- `pear-host-exact`:
- `pear-auth-reachable`:
- `pear-websocket-reachable`:
- `windows-requirement-satisfied`:
- `export-provider-ready`:
- `export-pcm-contract-ready`:
- `ffmpeg-discoverable`:
- `ffmpeg-encode-ready`:
- `full-pass`:

## Runtime Startup

- `pnpm start:radio-stack` started: yes / no
- `Audio export provider selected for runtime.` observed: yes / no
- `FFmpeg selected for runtime.` observed: yes / no
- `Audio relay started.` observed: yes / no
- `Runtime is using a fallback FFmpeg source.` observed: yes / no

## Command Verification

| Step | Result | Notes |
| --- | --- | --- |
| `/radio join` from controller user's standard voice channel | pass / fail / not run | |
| `/radio join` move case to a second standard voice channel | pass / fail / not run | |
| `/radio add query:<string> placement:queue` | pass / fail / not run | |
| `/radio add query:<string> placement:next` | pass / fail / not run | |
| `/radio now` | pass / fail / not run | |
| `/radio control action:play` | pass / fail / not run | |
| `/radio control action:pause` | pass / fail / not run | |
| `/radio control action:toggle` | pass / fail / not run | |
| `/radio control action:next` | pass / fail / not run | |
| `/radio control action:previous` | pass / fail / not run | |
| `/radio leave` | pass / fail / not run | |

## Audio Verification

- Pear audio reached the direct-export path: yes / no
- FFmpeg encoded the direct-export stream: yes / no
- Discord voice received audible audio: yes / no
- Same-machine local monitor suppression behaved as expected: yes / no
- Audio quality acceptable for soak: yes / no

## Failure And Recovery Checks

- App-managed FFmpeg missing scenario tested: yes / no
- `FFMPEG_PATH` fallback tested: yes / no
- `PATH` fallback tested: yes / no
- Export restart or respawn behavior tested: yes / no
- Reconnect behavior observed: yes / no

## Log Excerpts

- doctor output excerpt:
- runtime output excerpt:

## Final Outcome

- Overall result: pass / partial / fail
- Blocking issues:
- Non-blocking issues:
- Recommended next action:
