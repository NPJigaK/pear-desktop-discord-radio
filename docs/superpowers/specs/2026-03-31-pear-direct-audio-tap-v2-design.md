# Pear Direct Audio Tap v2 Design

## Summary

v2 replaces the current helper-based audio path:

`Pear process loopback helper -> PCM -> FFmpeg encode -> Ogg/Opus -> Discord`

with a Pear-native export path:

`Pear internal audio tap -> bot relay pipeline -> Discord`

The goal is to eliminate the double-audio problem on the same Windows machine without depending on Windows audio-session mute behavior. Pear remains the single source of truth for playback, search, and queue state. The bot continues to be a local Discord control and relay adapter rather than a second playback engine.

## Goals

- Eliminate local Pear direct-audio plus Discord relay double playback as a normal user experience problem.
- Preserve Pear as the only playback, search, and queue authority.
- Prefer an official Pear plugin integration over Windows session-level suppression.
- Avoid relying on upstream acceptance of project-specific Pear changes.
- Keep the final supported v2 audio path singular and explicit rather than carrying multiple long-lived relay architectures.
- Remove v1.1 helper-era operational and conceptual debt if v2 succeeds.

## Non-Goals

- Turning the bot into its own playback engine.
- Adding a bot-owned queue, playback timeline, search cache, or media resolver.
- Changing the `/radio` command surface as a prerequisite for v2.
- Adding cloud hosting, a public HTTP interactions endpoint, or a database.
- Preserving the v1.1 helper path as a first-class compatibility mode.
- Assuming Pear upstream will accept a new feature just because it helps this project.

## Product Boundary Decision

v2 keeps the same core product boundary:

- Pear stays the playback/search/queue source of truth.
- The bot stays local-only and Discord-focused.
- The runtime stays single-guild, single-controller-user, and single-session unless a later design explicitly changes that.

The v2 change is about audio extraction, not authority transfer.

## Problem Statement

The current v1.1 helper path works for relay, but it captures audio after Pear has already become a normal Windows-rendered application. On the same PC, the user hears:

- Pear local playback directly
- Discord playback relayed back from the bot

That creates audible duplication and latency smear. Windows-native suppression of Pear's render session could mask the symptom, but it creates crash-recovery and state-restoration risks because rendering-session mute and volume are persistent by default on Windows.

The better long-term answer is to extract the audio earlier, inside Pear's own playback path, so the relay uses a Pear-native feed instead of post-render loopback capture.

## Approaches Considered

### Approach A: Official Plugin Direct Audio Tap

Use Pear's official plugin surface to tap audio in-process and forward it to the bot through a narrow export channel.

Pros:

- Best fit for long-term maintainability if it is feasible.
- Keeps stock Pear as the product base.
- Avoids Windows session mute behavior.
- Solves the double-audio issue at the right layer.

Cons:

- Feasibility is not yet proven.
- The official plugin surface may not expose enough audio internals.

### Approach B: Plugin Plus Output-Routing Trick

Use official plugin features such as output-device routing to move Pear audio somewhere specialized, then capture that path.

Pros:

- Potentially easier than a true direct tap.
- Might reuse existing plugin capabilities.

Cons:

- Still fundamentally a routing workaround.
- Likely retains external device or session complexity.
- Does not cleanly reach the direct-audio end state.

### Approach C: Private Pear Patch or Fork Audio Export

If the plugin surface is insufficient, add a private export capability to Pear through a local patch or project-owned fork.

Pros:

- Highest chance of achieving a clean direct feed.
- Removes dependence on Windows session mute and loopback helper behavior.

Cons:

- Largest maintenance burden.
- Requires Pear-version tracking and patch ownership.

## Recommended Direction

Use a staged decision model:

1. Try an official plugin direct-audio tap first.
2. If the plugin surface cannot support the required extraction path cleanly, move to a private Pear patch or fork.
3. Do not make upstream PR acceptance a prerequisite for the design.
4. Do not treat Windows session mute as the final solution.
5. Do not treat helper-path compatibility as a requirement.

This keeps the design honest. It prefers the lowest-maintenance route that can actually solve the problem, but it does not block the project on upstream priorities or on preserving v1.1 compatibility layers.

## Architecture

### Preserved Components

- Discord command router
- Pear API/WebSocket coordination
- Explicit runtime state machines
- FFmpeg app-managed resolution and encode stage, unless a later spike proves FFmpeg can be removed cleanly
- Standalone `doctor`

### New Audio Path

The target v2 data flow is:

`Pear playback internals -> export provider -> bot ingest -> FFmpeg encode -> Discord voice`

`export provider` is intentionally abstract in the design because it can be implemented in one of two supported ways:

- official plugin
- private Pear patch/fork

### Export Provider Responsibility

The export provider owns exactly three things:

- obtaining a stable feed of Pear playback audio
- exposing that feed to the bot using a narrow, inspectable contract
- surfacing explicit diagnostics when the export path cannot be opened or maintained

It does not own Discord, queueing, playback authority, or command handling.

### Bot Responsibility

The bot owns:

- command handling
- Pear coordination
- audio export consumption
- encode/mux to the Discord voice format
- relay lifecycle
- diagnostics and soak tooling

## Export Contract

The v2 spike should choose the narrowest viable contract. The initial target contract is:

- 48kHz stereo PCM
- explicit lifecycle events for startup, stream ready, stream ended, and fatal failure
- a transport that is inspectable and debuggable from the bot side

The transport mechanism is left open for the spike. Candidate transports include:

- local IPC channel
- named pipe
- local child-process stdio style stream if the plugin path naturally maps to a companion process

The spike should choose the transport that keeps failure handling and local debugging simplest.

## Why Windows Session Mute Is Not The Target

Windows-native Pear session mute is a workable mitigation, but not the desired architecture.

Reasons:

- it controls another application's render session from the outside
- rendering-session mute state is persistent by default, which creates stale-state risk on crashes
- it fixes the symptom rather than improving the relay architecture
- it adds restore and repair logic that should not exist if audio is extracted correctly

If session suppression is ever used at all, it should only be as a temporary mitigation during investigation, not the v2 destination.

## Doctor Redesign

If v2 succeeds, `doctor` should stop validating helper readiness and start validating export-provider readiness.

Target checks:

- Pear host exactness
- Pear auth reachability
- Pear WebSocket reachability
- export provider discoverable
- export provider handshake reachable
- PCM contract confirmed
- FFmpeg discoverable
- FFmpeg encode readiness
- relay readiness

`full-pass: YES` should mean the direct-audio path is ready, not merely that a Windows loopback workaround is available.

## Deletion Strategy

v2 should not preserve helper compatibility if the direct-audio path is proven.

Planned deletion scope after success:

- native loopback helper crate
- helper discovery and readiness probe logic
- helper-specific docs and soak instructions
- helper-specific runtime logs
- helper build step
- helper-only tests

What remains:

- command surface
- Pear authority model
- FFmpeg app-managed strategy unless deliberately replaced later
- Discord relay stack
- soak and doctor framework

This treats v2 as a replacement, not an additive compatibility layer.

## Spike Plan

### Spike 1: Plugin Feasibility

Question:

- Can an official Pear plugin observe or tap the real playback audio early enough to provide a stable export feed?

Success criteria:

- audio tap is technically possible
- transport to the bot is possible
- runtime survives pause/resume and track changes
- duplicate local-versus-Discord audio can be eliminated without Windows session mute tricks

Failure criteria:

- plugin surface cannot reach the audio path
- tap is unstable
- the required transport is too invasive or too opaque

### Spike 2: Private Patch/Fork Feasibility

Only run if Spike 1 fails or proves insufficient.

Question:

- What is the smallest Pear-owned patch surface that can expose a stable direct-audio export contract?

Success criteria:

- a minimal patch can provide a stable PCM feed
- patch surface is narrow enough to maintain across Pear updates
- relay path becomes simpler than the helper path

Failure criteria:

- patch surface is too broad
- breakage risk across Pear updates is too high
- relay path becomes harder to debug than v1.1

## Testing Strategy

### Automated

- export-provider contract parsing
- relay ingest from the new export provider
- FFmpeg encode path from exported PCM
- doctor pass/fail behavior for export-provider readiness
- runtime logging and failure handling

### Manual Windows

- same-machine usage without audible duplicate playback
- `/radio join`, `/radio add`, `/radio now`, `/radio control`, `/radio leave`
- pause/resume and track change stability
- startup and teardown behavior
- stale-state absence after abnormal shutdown

## Risks

- Official plugin APIs may not expose enough of Pear's playback internals.
- A private patch/fork may be required sooner than preferred.
- Export transport design could introduce new local-debugging complexity if chosen poorly.
- Removing the helper path too early would be risky unless the replacement path is already proven.

## Decision Gate

Proceed to v2 implementation only if Spike 1 or Spike 2 proves that direct audio export can replace helper-based loopback capture cleanly.

If neither spike succeeds, the project should stay on v1.1 for production use and explicitly reject Windows session mute as the strategic answer.
