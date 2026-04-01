# FFmpeg Management for v2

> This note supersedes the older VB-CABLE / DirectShow relay guidance and stays aligned with the v2 direct-audio-export path.
> If this note conflicts with older FFmpeg guidance, this note wins.

## Approved Strategy

v2 approves **bootstrap-managed FFmpeg** as the default Windows strategy for source installs.

- Provider: BtbN FFmpeg Builds
- Variant: `win64-lgpl-shared-8.0`
- Pinning mechanism: repo manifest plus SHA-256
- Manifest: [config/ffmpeg-managed.json](../config/ffmpeg-managed.json)
- Bootstrap script: [scripts/bootstrap-ffmpeg.mjs](../scripts/bootstrap-ffmpeg.mjs)
- Local cache: `.cache/ffmpeg/`
- Attribution / notice: [docs/ffmpeg-notice.md](ffmpeg-notice.md)

The user should not need to manually install FFmpeg for normal Windows use.

## Why This Strategy Won

### `ffmpeg-static`

Rejected for this repo because:

- it hides binary acquisition behind npm package behavior
- it is less explicit about the exact Windows binary lifecycle for this repo
- its compatibility/update story is tied to the npm package rather than a repo-owned manifest
- it is a weaker fit for a personal Windows-only local tool where explicit provenance and troubleshooting matter more than npm convenience

### Repository-vendored binary layout

Rejected for this repo because:

- it bloats git history and repo size
- every FFmpeg update becomes a large committed artifact change
- redistribution/notice handling becomes heavier than needed

### Bootstrap/download script with pinned version + checksum + local cache

Approved for this repo because:

- it works well for Windows x64 source installs
- it keeps the repo single-package and lean
- it provides a self-contained user experience after bootstrap
- it keeps provenance explicit through a pinned manifest and checksum
- it lets runtime and `doctor` report the exact binary source and executable path

## Resolution Order

Runtime and `doctor` must resolve FFmpeg in this exact order:

1. app-managed cached/bundled binary
2. `FFMPEG_PATH`
3. `PATH`

Behavior rules:

- app-managed is always tried first
- `FFMPEG_PATH` is a repair/fallback path, not the normal default
- `PATH` remains the last fallback
- fallback continues on missing file or failed `-version` probe

If app-managed FFmpeg is unavailable but `FFMPEG_PATH` or `PATH` works:

- `doctor` still reports `PASS`
- `doctor` surfaces the selected fallback source/path
- runtime continues
- runtime logs a warning that fallback FFmpeg is in use

## What the Windows User Must Still Install Manually

These remain manual v2 prerequisites:

- Node.js
- Pear Desktop
- Discord bot credentials/setup
- Rust toolchain only if the supported Pear fork's build flow requires it

System FFmpeg is no longer a normal prerequisite.

## Bootstrap Flow

Recommended source-install flow:

1. `pnpm install`
2. Enable the direct-audio-export plugin in the supported Pear fork.
3. `pnpm bootstrap:ffmpeg`
4. `pnpm run doctor`
5. `pnpm sync-commands`
6. `pnpm runtime`

Bootstrap behavior:

- downloads the pinned BtbN ZIP from the manifest
- verifies the SHA-256 from the manifest
- extracts the archive into `.cache/ffmpeg/`
- expects `ffmpeg.exe` at the manifest’s relative executable path
- exits early when the executable already exists unless `--force` is passed

## Doctor Requirements

`doctor` validates the real relay path up to local export readiness:

- selected FFmpeg source
- selected executable path
- FFmpeg version line from `-version`
- direct-audio-export discoverability
- direct-audio-export readiness: Pear resolution, successful export-client attachment, and confirmation of the direct audio stream used by runtime
- one-second direct export -> Ogg/Opus encode smoke test using the same FFmpeg output shape as runtime

`doctor` does not involve Discord voice directly. It proves the local relay prerequisites are ready.
Active Pear playback is not required for export readiness to pass; idle or paused Pear is acceptable if Pear can attach the export client successfully and FFmpeg can satisfy the runtime encode path.

## Runtime Logging Requirements

When the relay path is active or fails, runtime logs must surface:

- selected FFmpeg source
- selected executable path
- fallback warning when source is not app-managed
- relay exit or error
- stderr tail when available
- restart attempt and restart outcome
- final failure reason when teardown follows relay failure

Export readiness is reported by `doctor`, not runtime.

## Licensing / Attribution Expectations

This is engineering guidance, not legal advice.

v2 documentation must keep the following explicit:

- which upstream FFmpeg build is pinned
- where it came from
- which checksum is expected
- that the project uses FFmpeg under the upstream licensing terms
- where maintainers should look when updating attribution/provenance text
- the attribution record for the current pinned build lives in [docs/ffmpeg-notice.md](ffmpeg-notice.md)

The current choice deliberately favors a pinned upstream build and explicit documentation over hidden package-managed binary acquisition.

## Testing and Manual Verification

Automated coverage should prove:

- app-managed-first resolution order
- fallback to `FFMPEG_PATH` and `PATH`
- export readiness reporting
- doctor source/path reporting
- doctor direct export -> Ogg/Opus relay smoke readiness
- runtime logging of relay failures and fallback use

Manual Windows verification should prove:

- supported Pear fork starts on a real host
- `doctor` reaches `full-pass: YES` with the supported fork and app-managed binary
- Pear audio reaches Discord through the direct-export/FFmpeg path
- fallback behavior is still understandable and actionable when app-managed FFmpeg is missing
