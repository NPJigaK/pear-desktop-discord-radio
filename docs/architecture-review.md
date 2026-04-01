# pear-desktop-discord-radio v2 Architecture Review

> This review reflects the current v2 runtime path. The repo root is the patched Pear fork, and the Node Discord runtime lives under `apps/discord-radio-bot`.

## Decision

Use Pear Desktop at the repo root as the playback, search, queue, and direct-audio-export authority, with a local Node 24 companion package under `apps/discord-radio-bot` as the Discord integration layer.

Pear remains the only source of truth for playback state, search results, and queue state. The bot does not own a second queue, a second playback timeline, or a separate media resolution path. Command sync remains separate from normal runtime startup, `doctor` remains a standalone diagnostic command, Pear host access remains locked to `127.0.0.1`, and the runtime still rejects stage channels.

## Approved v2 Stack

- Pear root: patched Pear Desktop fork in this repo root
- Bot/runtime: `apps/discord-radio-bot`
- Runtime: Node 24 Active LTS
- Language: TypeScript with ESM
- Discord libraries: `discord.js`, `@discordjs/voice`
- Logging: `pino`
- Network APIs: built-in `fetch` and `WebSocket`
- No `axios`, no `dotenv`, no extra database/runtime stack
- Pear integration: Pear API Server REST plus `/api/v1/ws` and the root `direct-audio-export` plugin
- Audio path: Pear direct audio export -> FFmpeg encode -> Ogg/Opus -> Discord voice
- FFmpeg strategy: bot-package bootstrap-managed pinned BtbN `win64-lgpl-shared-8.0` binary by default, with `FFMPEG_PATH` and `PATH` fallback only
- Bot scope: guild-scoped slash commands only
- Commands: `/radio join`, `/radio leave`, `/radio add`, `/radio now`, `/radio control`
- Session model: single configured controller user, single guild, single active session
- Runtime OS: native Windows 11 only

## Repository Topology Review

The current single-repo layout is deliberate:

- Repo root is the upstream-tracking Pear fork and remains the Pear-side build/start surface.
- `apps/discord-radio-bot` contains the product-specific Discord runtime, launcher, doctor, and FFmpeg bootstrap code.
- Root wrapper commands are the preferred user entry points where they exist:
  - `pnpm start:radio-stack`
  - `pnpm doctor:radio-bot`
  - `pnpm test:radio-bot`
- Bot-only commands that do not have a root wrapper stay explicit as `pnpm --dir apps/discord-radio-bot run ...`.
- The repo-root `.env` fallback only applies when those root wrappers dispatch into the bot package. Direct bot-package commands instead rely on shell-exported variables or `apps/discord-radio-bot/.env`.

This layout keeps upstream Pear tracking natural while still making the integrated product understandable to other contributors.

## FFmpeg Strategy Review

| Option | Decision | Windows x64 practicality | Repo simplicity | User experience | Debugging / observability | Licensing / update fit |
|---|---|---|---|---|---|---|
| `ffmpeg-static` | Reject | Practical enough, but npm-managed packaging is not aligned with this local Windows setup | Adds an npm-driven binary packaging layer the repo does not otherwise need | Easier than manual install, but less explicit than a repo-owned bootstrap flow | Harder to reason about exactly which upstream build was materialized and when | Package-level GPL licensing and non-semver FFmpeg compatibility make it a weaker fit here |
| Root-vendored binary layout | Reject | Works, but bloats the repo with large Windows binaries | Worse than the current sub-package cache approach | Good for offline installs, but heavy to distribute and update | Explicit once committed, but every update becomes a repo artifact problem | Higher redistribution and notice burden, plus noisy git history |
| Bot-package bootstrap/download script with pinned version + checksum + local cache | Choose | Strong fit for a personal Windows x64 local tool | Keeps the repo lean while staying explicit | Self-contained after bootstrap, no normal manual FFmpeg install | Best option for surfacing exact source, version, executable path, and fallback behavior | Pinning plus checksum is clear, and notices/provenance can point to the exact upstream asset |

Approved provider and variant:

- Provider: BtbN FFmpeg builds
- Variant: `win64-lgpl-shared-8.0`
- Install location: `apps/discord-radio-bot/.cache/ffmpeg/`
- Attribution/provenance note: [ffmpeg-notice.md](./ffmpeg-notice.md)

## Resolution Order

Runtime and `doctor` resolve FFmpeg in this exact order:

1. app-managed bot-package cache
2. `FFMPEG_PATH`
3. `PATH`

If the app-managed binary is missing or fails probing, fallback continues. If `FFMPEG_PATH` or `PATH` succeeds, `doctor` still reports `PASS`, and runtime logs that a fallback source is in use.

## Why This Architecture

The product is fundamentally an adapter between Discord and Pear. Pear already owns playback, search, and queue semantics, so the safest implementation is to keep Pear authoritative and keep the Node service thin.

The direct-audio-export transport improves the same-machine Windows setup without violating that boundary. The Node service still does not resolve media itself; it only accepts Pear export audio, encodes it through FFmpeg, and forwards the result to Discord.

## Major Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Pear and the bot disagree about state | Users see stale or wrong playback status | Keep Pear authoritative and derive only read-only projected state in the bot |
| Direct export transport is missing or the root Pear app is not running | Relay cannot start with the default path | `doctor` and runtime probe export readiness first |
| App-managed FFmpeg is missing or bootstrap never ran | Relay cannot encode the default path | `doctor` and runtime probe app-managed first, then continue to `FFMPEG_PATH` and `PATH` |
| Runtime fallback hides which binary is active | Troubleshooting becomes ambiguous | Log selected source/path/version and emit a warning when runtime is not using app-managed FFmpeg |
| Bootstrap requires internet access | Offline source installs may not get the default binary | Keep `FFMPEG_PATH` and `PATH` fallback, and document bootstrap as a one-time prerequisite for the default path |

## Test Strategy

Test at three layers:

1. Root Pear tests/build for the patched Pear fork.
2. Bot-package unit and integration tests under `apps/discord-radio-bot`.
3. Manual Windows 11 verification against the integrated root+subdir topology.

Specific v2 coverage should include:

- Pear host guard rejects anything except `127.0.0.1`
- `AUTH_AT_FIRST` remains the auth path
- Slash command registration is guild-scoped only
- `/radio add` stays Pear-backed and select-menu-based
- `/radio join` rejects stage channels and preserves the single-session model
- Export readiness is checked before FFmpeg encode readiness
- FFmpeg resolution is app-managed first, then `FFMPEG_PATH`, then `PATH`
- `doctor` reports selected FFmpeg source/path, export readiness, and relay capture readiness
- Runtime logs identify selected FFmpeg source/path and relay failure details

## Rollout and Verification on Windows

Recommended local setup order:

1. Prepare variables using [../apps/discord-radio-bot/.env.example](../apps/discord-radio-bot/.env.example) as the reference.
2. If you will use the root wrapper commands, place the working `.env` at the repo root.
3. If you will run direct bot-package commands, export the same variables in the shell or place a matching `.env` in `apps/discord-radio-bot/`.
4. Run `pnpm install` at the repo root.
5. Run `pnpm build` at the repo root.
6. Run `pnpm --dir apps/discord-radio-bot run bootstrap:ffmpeg`.
7. Start the Pear app from the repo root and enable the `Direct Audio Export (Spike)` plugin.
8. Run `pnpm doctor:radio-bot` and require `full-pass: YES`.
9. Run `pnpm --dir apps/discord-radio-bot run sync-commands`.
10. Run `pnpm start:radio-stack`.
11. Exercise `/radio join`, `/radio add`, `/radio now`, `/radio control`, and `/radio leave`.

## Conclusion

The correct v2 architecture is a single repository where the patched Pear fork remains at the root and the Discord runtime remains a separate Node package under `apps/discord-radio-bot`. The audio path is Pear direct audio export into FFmpeg and then Discord voice, while Pear remains the only playback/search/queue authority.
