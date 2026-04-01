# ADR 0001: v1 Architecture for Pear Desktop Discord Radio

**Status:** Accepted

**Date:** 2026-03-29

## Context

This repository is a personal Windows-only local Discord radio bot. Pear Desktop must remain the playback, search, and queue engine. The bot must not create a second queue, a second playback timeline, or a bot-side media resolution path.

The v1 service also needs to stay local-only, single-package, single-guild, single-controller-user, and single-session. That rules out cloud hosting, public HTTP interactions, databases, and Pear fork/plugin code in v1.

Earlier v1 docs treated system `ffmpeg.exe` as a normal Windows prerequisite. That requirement is now superseded by [docs/ffmpeg-management.md](../ffmpeg-management.md).

Earlier v1 docs also treated VB-CABLE and DirectShow capture as the default relay path. That audio guidance is superseded by the Windows 11 loopback-helper docs and no longer represents the supported v1.1 setup path.

## Decision

Use stock Pear Desktop as the playback/search/queue engine, with an external local Node 24 companion service written in TypeScript and ESM as the Discord integration layer.

Approve **bootstrap-managed FFmpeg** as the default v1 Windows strategy. The project ships a pinned FFmpeg manifest and a bootstrap script that downloads, checksum-verifies, and extracts a BtbN `win64-lgpl-shared-8.0` build into a local app-managed cache. Runtime and `doctor` resolve FFmpeg in this order:

1. app-managed cached binary
2. `FFMPEG_PATH`
3. `PATH`

If the app-managed binary is unavailable but `FFMPEG_PATH` or `PATH` works, the service may continue and must surface that fallback clearly in logs and diagnostics.

## Approved v1 Architecture

- Runtime: Node 24 Active LTS
- Language: TypeScript + ESM
- Discord libraries: `discord.js` and `@discordjs/voice`
- Logging: `pino`
- Network primitives: built-in `fetch` and `WebSocket`
- Pear integration: manual Pear prerequisite, Pear API Server REST plus `/api/v1/ws`
- Audio path: Pear process loopback helper -> PCM 48kHz stereo -> FFmpeg encode -> Ogg/Opus -> Discord voice
- FFmpeg: app-managed by default via bootstrap-managed pinned binary, with `FFMPEG_PATH` and `PATH` as fallback only
- Bot scope: guild-scoped slash commands only
- Commands: `/radio join`, `/radio leave`, `/radio add`, `/radio now`, `/radio control`
- `/radio control`: only `play`, `pause`, `toggle`, `next`, and `previous`
- `/radio add`: Pear-search-backed ephemeral select-menu flow first, not autocomplete
- Command sync: separate from normal runtime startup
- Doctor: standalone diagnostic command
- Security guard: refuse Pear hosts other than `127.0.0.1`
- Auth behavior: retain `AUTH_AT_FIRST`
- Session model: single configured user, single guild, single active session
- Voice-channel policy: reject stage channels in v1

## Consequences

This architecture keeps the risky playback and queue state inside Pear and keeps the Discord bot a thin local adapter. That improves debuggability and preserves the approved product boundaries.

Moving FFmpeg to an app-managed default improves normal Windows setup: users no longer need to install system FFmpeg for the common case. The tradeoff is a one-time bootstrap/download step for source installs and a small amount of local cache management inside the repo workspace.

`doctor` and runtime now carry more FFmpeg responsibility. They must identify which FFmpeg source was selected, validate helper readiness, and validate a short relay-path encode smoke test before claiming a Windows full pass.

## Rejected Alternatives

- Pear fork or plugin-based implementation: rejected because it increases maintenance burden and couples v1 to Pear internals.
- Bot-owned playback queue or timeline: rejected because it violates Pear’s authority.
- Bot-side search or media resolution: rejected because Pear must remain the search engine and queue authority.
- Cloud-hosted or public HTTP service: rejected because v1 is local-only and Windows-only.
- Database-backed persistence: rejected because v1 does not need cross-session state outside Pear.
- `ffmpeg-static`: rejected because it hides binary acquisition behind package-manager install behavior, uses its own packaging/update model, and gives less explicit provenance/debugging control for this personal Windows-only tool.
- Repository-vendored FFmpeg binaries: rejected because they bloat git history and complicate update/redistribution handling.
- Non-local Pear host or relaxed host guard: rejected because the bot must only talk to `127.0.0.1` in v1.

## Notes on Security and Windows Assumptions

The bot must treat Pear as local-only and refuse any configuration that targets a host other than `127.0.0.1`. `AUTH_AT_FIRST` stays enabled because the local-only manual Pear setup still depends on Pear-controlled auth prompts.

The Windows audio path now assumes the native loopback helper is built and runnable on Windows 11. FFmpeg is app-managed by default, but the runtime must still be explicit and inspectable about the binary source, executable path, helper readiness, and relay failure details.
