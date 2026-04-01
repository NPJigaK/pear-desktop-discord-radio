# Windows Loopback Helper v1.1 Design

## Summary

v1.1 replaces the current Windows audio capture path:

`Pear -> VB-CABLE -> FFmpeg dshow capture -> Ogg/Opus -> Discord`

with a Windows 11-first native helper path:

`Pear process/application loopback helper -> PCM 48kHz stereo -> FFmpeg encode -> Ogg/Opus -> Discord`

The product remains a single local Windows application that treats Pear Desktop as the only playback, search, and queue authority. The change is intentionally destructive. If the helper path is proven viable on Windows 11, v1.1 removes VB-CABLE, DirectShow capture, and related configuration and diagnostics instead of keeping long-term compatibility layers.

## Goals

- Make the default audio path behave like a better Windows application.
- Remove the user requirement to install and configure VB-CABLE.
- Keep Pear Desktop as the single source of truth for playback, search, and queue state.
- Reuse the existing FFmpeg app-management and Discord relay stack where that still makes sense.
- Reduce Windows-specific operational complexity rather than adding a second long-lived capture path.

## Non-Goals

- Changing the `/radio` command surface.
- Adding bot-owned queue state, playback state, search caching, or media resolution.
- Adding cloud hosting, a public interactions endpoint, a database, or Pear plugin/fork work.
- Preserving Windows 10 support.
- Preserving the VB-CABLE / DirectShow path after v1.1 is accepted and proven.

## Platform Decision

- Minimum supported runtime OS becomes Windows 11.
- Windows 10 is removed from the supported runtime matrix in v1.1.
- v1.1 may use a short-lived branch-only coexistence period while the helper PoC is being proven, but the target release state is a single helper-based path, not a dual-path product.

## Architecture

### Preserved Boundaries

- Pear remains the only playback/search/queue authority.
- The repo remains a single product and single release train.
- Runtime remains local-only, single-guild, single-controller-user, and single-session.
- Pear host guard remains `127.0.0.1` only.
- `doctor` remains a standalone diagnostic command.
- FFmpeg remains app-managed by default with `FFMPEG_PATH` and `PATH` fallback.

### New Default Audio Path

The v1.1 runtime audio path becomes:

`Pear Desktop -> native loopback helper -> PCM -> FFmpeg encode/mux -> Discord voice`

The native helper captures Pear audio only. It does not know about Discord, slash commands, queues, or playback control. FFmpeg no longer owns capture. FFmpeg becomes an encoder/muxer stage fed by the helper's PCM stream.

## Component Responsibilities

### Node Runtime

- Start and supervise Pear integration, Discord runtime, the native helper, and FFmpeg.
- Keep the explicit `pear`, `voice`, and `relay` state machines.
- Run preflight and `doctor`.
- Surface actionable runtime logs.

### Native Loopback Helper

- Run on Windows 11.
- Identify the Pear target process or process tree.
- Open process/application loopback capture for Pear audio.
- Emit 48kHz stereo PCM to `stdout`.
- Emit diagnostic logs and structured failure details to `stderr`.
- Stay strictly capture-only.

### FFmpeg

- Accept PCM from the helper.
- Encode/mux to the same Ogg/Opus shape used by the Discord voice layer.
- Continue to use the app-managed-first resolution order:
  1. app-managed
  2. `FFMPEG_PATH`
  3. `PATH`

### Discord Voice Layer

- Continue to consume Ogg/Opus from FFmpeg.
- Keep the existing voice-session and relay lifecycle patterns as much as possible.

## Packaging And Build Strategy

v1.1 stays a single product with one user-facing release. The native helper is an internal component, not a separately operated application.

- Keep one repository.
- Keep one product version.
- Keep one user-facing install/update flow.
- Store helper source in-repo.
- Do not commit generated helper binaries.
- Build the helper as a separate internal artifact and package it with the main product.

This preserves maintainability without introducing user-visible version skew between the Node runtime and the helper.

## Configuration Changes

### Remove

- `FFMPEG_DSHOW_AUDIO_DEVICE`

### Keep

- `DISCORD_TOKEN`
- `DISCORD_APPLICATION_ID`
- `DISCORD_GUILD_ID`
- `DISCORD_CONTROLLER_USER_ID`
- `PEAR_CLIENT_ID`
- `PEAR_HOST`
- `PEAR_PORT`
- `FFMPEG_PATH`
- `LOG_LEVEL`

## Doctor Redesign

`doctor` must stop validating DirectShow and start validating the actual v1.1 relay path.

### Required Checks

- Pear host exactness
- Pear auth reachability
- Pear WebSocket reachability
- Windows 11 requirement satisfied
- helper discoverable
- helper can identify the Pear target process
- helper can open process/application loopback capture
- helper emits valid 48kHz stereo PCM
- FFmpeg discoverable
- FFmpeg can encode the helper PCM stream to the required Ogg/Opus output shape

`full-pass: YES` is only valid when the complete helper-based path is ready.

## Runtime Logging

Runtime logging must make helper failures at least as debuggable as the current FFmpeg DirectShow path.

Required runtime log surface:

- selected FFmpeg source and executable path
- helper executable path
- helper startup success/failure
- Pear process discovery success/failure
- helper exit/error and stderr tail
- FFmpeg exit/error and stderr tail
- relay restart attempts and outcomes
- final teardown reason

## Deletions And Simplifications

If the helper PoC succeeds, v1.1 removes the following rather than carrying them forward:

- VB-CABLE as a normal prerequisite
- DirectShow capture from runtime and `doctor`
- DirectShow device enumeration and configured-device checks
- `FFMPEG_DSHOW_AUDIO_DEVICE`
- VB-CABLE setup guidance from README and Windows soak documents
- docs that describe VB-CABLE / dshow as the default architecture

The intent is to pay down operational and conceptual debt, not to preserve a larger compatibility matrix.

## PoC Scope

The helper PoC is intentionally narrow. It exists to prove that the helper path can become the only v1.1 path.

### Minimum Success Criteria

- Runs on Windows 11
- Finds Pear reliably enough for runtime use
- Opens process/application loopback capture for Pear
- Emits stable 48kHz stereo PCM to `stdout`
- Feeds FFmpeg successfully
- Produces audible Discord playback through the existing relay path
- Survives normal playback transitions such as pause/resume and track changes
- Produces actionable diagnostics on failure

### Failure Criteria

- Pear cannot be identified reliably enough for runtime use
- loopback capture is too fragile across normal playback transitions
- the helper path is harder to debug than the current path
- audio quality, continuity, or stability is materially worse than the current path

## Migration Plan

1. Add an ADR that supersedes the current VB-CABLE / DirectShow default for v1.1.
2. Build a Windows 11-only native helper PoC.
3. Add helper-aware `doctor` probes.
4. Add runtime support for `helper -> FFmpeg -> Discord`.
5. Validate on native Windows 11.
6. Remove VB-CABLE / DirectShow code, docs, env vars, and tests once the helper path is proven.

## Testing Strategy

### Automated

- helper process discovery success/failure handling
- helper process supervision
- FFmpeg encode path from helper PCM
- `doctor` checks for helper readiness
- runtime failure observability for helper and FFmpeg failures

### Manual Windows 11

- first-run setup on a clean host
- `doctor` full pass
- `/radio join`, `/radio add`, `/radio now`, `/radio control`, `/radio leave`
- real audio continuity across track changes and pause/resume
- helper failure diagnostics

## Risks

- Pear's actual rendering process model may be more complex than expected.
- process/application loopback behavior may still have app-specific edge cases.
- adding a native helper introduces native build and packaging work.
- Windows 11-only targeting is a deliberate narrowing of supported platforms.

## Exit Decision

If the PoC succeeds against the criteria above, v1.1 should remove the VB-CABLE / DirectShow architecture rather than preserve it as a first-class fallback. If the PoC does not succeed, the project should explicitly stay on the current v1 architecture until a different replacement path is proven.
