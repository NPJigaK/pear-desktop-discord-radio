# v2 Cleanup, Private Fork, And Launcher Design

## Summary

This design defines the next phase after the successful Pear direct-audio-export spike.

The direct-audio-export path is now treated as the strategic v2 direction. The next work is not to merge the Discord runtime into Pear, but to turn the spike into a maintainable product shape:

1. clean the bot repository so v2 direct audio export is the only supported path
2. replace the temporary Pear spike worktree with a clean private fork or sibling repository
3. add a thin launcher so the user experience feels like one product while the internal responsibilities stay separated

## Goals

- Make the direct-audio-export path the only supported v2 audio path.
- Remove helper-era code, docs, and operational debt from the bot repository.
- Manage the patched Pear code as a clean private fork or sibling repository instead of an ad hoc worktree.
- Keep Pear as the only playback, search, and queue authority.
- Keep the Discord runtime and relay stack outside Pear itself.
- Give the user a simpler startup experience without collapsing the product into one process.

## Non-Goals

- Embedding the Discord runtime, token handling, FFmpeg management, or voice lifecycle into the Pear plugin.
- Preserving the helper path as a compatibility mode.
- Treating the temporary Pear worktree history as the production fork history.
- Packaging the final public distribution in this phase.
- Changing the `/radio` command surface.

## Recommended Approach

Three approaches were considered:

### Approach A: Clean The Bot Repo First, Then Create A Clean Pear Fork, Then Add A Launcher

Pros:

- removes v2 transitional debt early
- gives the launcher a stable target
- keeps bot and Pear responsibilities clear

Cons:

- requires disciplined sequencing
- launcher work waits until the cleanup and fork shape are stable

### Approach B: Create The Pear Fork First, Then Clean The Bot Repo, Then Add A Launcher

Pros:

- stabilizes the Pear dependency early

Cons:

- leaves helper-era debt in the bot repo longer
- makes the bot docs and startup path lag behind the accepted architecture

### Approach C: Build The Launcher First, Then Clean Everything Behind It

Pros:

- improves ergonomics quickly

Cons:

- hides unstable architecture under a convenience layer
- likely forces launcher rework after cleanup

### Decision

Use Approach A.

The best sequence is:

1. Phase A: clean the bot repository and remove helper-era debt
2. Phase B: create a clean private Pear fork or sibling repository from an upstream base commit and reapply only the minimal direct-audio-export changes
3. Phase C: add a thin launcher in the bot repository that starts the patched Pear build and the Discord runtime together

## Architecture Decision

The product should remain a single user-facing tool with two internal codebases and two runtime processes:

- Pear private fork or sibling repo
  - playback authority
  - search authority
  - queue authority
  - direct-audio-export provider
- pear-desktop-discord-radio
  - Discord command handling
  - relay lifecycle
  - FFmpeg management
  - doctor
  - soak tooling
  - launcher/orchestration

This preserves the cleanest boundary:

- Pear owns playback
- the bot owns Discord and relay
- the launcher owns orchestration only

## Phase A: Bot Repository Cleanup

Phase A converts the current repository into a clean v2 bot runtime.

### Remove

- `native/loopback-helper/`
- `src/audio/helper.ts`
- helper-specific tests
- `build:helper`
- helper-era docs and soak instructions
- helper-era ADR language that still reads as current architecture

### Keep

- app-managed FFmpeg
- direct audio export provider contract
- plugin export runtime path
- Discord runtime and `/radio` surface
- Pear runtime state coordination
- doctor and soak framework

### Add Or Update

- a v2 ADR that accepts direct audio export as the supported path
- README and Japanese README guidance that point to the direct-audio-export path
- soak docs that assume export-provider readiness rather than helper readiness
- explicit documentation of the patched Pear dependency

### Phase A Exit Condition

The bot repository no longer contains a supported helper path and all docs describe the direct-audio-export path as the only supported v2 runtime.

## Phase B: Clean Private Pear Fork Or Sibling Repository

The temporary Pear spike worktree should not become the production fork history.

Instead, create a clean private fork or sibling repository from a known upstream base and replay only the required changes as minimal commits.

### Preferred History Shape

The final Pear-side history should be small and intentional, for example:

1. `feat: add direct audio export plugin transport`
2. `fix: suppress local monitor while export client is attached`
3. `fix: keep bootstrap freshness alive while producer is idle`

### Why A Clean Fork Is Better

- easier upstream diff review
- easier maintenance across Pear updates
- lower risk of carrying machine-specific or experimental artifacts
- simpler recovery if the fork must be rebuilt from a newer upstream tag

### Bot Repo Contract To The Fork

The bot repo should document:

- the expected Pear private fork or sibling repo name
- the required commit or release identifier
- the required plugin or patch behavior
- the local setup and launch expectations

The bot repo should not vendor the Pear source.

### Phase B Exit Condition

The project no longer depends on the temporary Pear worktree as the canonical source of the direct-audio-export patch. A clean private fork or sibling repo exists and the bot repo points to it explicitly.

## Phase C: Thin Launcher

The launcher belongs in the bot repository because the Discord radio tool is the user-facing entry point.

### Launcher Responsibilities

- locate the configured Pear private fork or sibling repo
- start the patched Pear app
- start the bot runtime
- surface startup failures clearly
- stop child processes cleanly when the launcher exits

### Launcher Non-Responsibilities

- no queue or playback logic
- no Discord command logic
- no FFmpeg probing logic beyond delegating to existing bot startup
- no direct implementation of the export protocol

### Design Constraint

The launcher must not blur the architecture. It should make startup simple while preserving the two-process model internally.

### Phase C Exit Condition

The user can start the patched Pear app and the Discord bot runtime through one documented entry point while the underlying responsibilities remain separated.

## Documentation Strategy

After Phase A and Phase B, the docs should reflect a stable v2 story:

- v1.1 helper ADR is superseded
- v2 direct audio export ADR is current
- README documents the patched Pear dependency and direct-audio-export path
- soak docs validate the real v2 path
- archive-sharing guidance still assumes a clean source archive, not a whole worktree dump

## Testing And Validation

### Automated

- existing root repository test suite stays green after helper removal
- doctor tests reflect export-provider checks only
- runtime tests reflect export-provider startup only
- launcher tests cover path resolution and process-start failure reporting

### Manual Windows

- patched Pear starts and exposes the direct-audio-export bootstrap
- `pnpm run doctor` reaches `full-pass: YES`
- `pnpm run runtime` or the launcher starts successfully
- `/radio join`, `/radio now`, `/radio add`, `/radio control`, `/radio leave` all function
- same-machine double playback does not occur during normal use
- stopping the bot or launcher leaves Pear in a sane local state

## Risks

- helper deletion before docs are fully aligned could leave confusing setup instructions
- a dirty or overly broad Pear fork history would make long-term maintenance harder
- launcher work done too early could freeze the wrong operational contract
- the patched Pear fork may still need periodic revalidation against upstream updates

## Final Decision

Proceed in this order:

1. Phase A: clean the bot repository and remove helper-era debt
2. Phase B: replace the temporary Pear worktree dependency with a clean private fork or sibling repo
3. Phase C: add a thin launcher in the bot repository

Do not merge the Discord runtime into the Pear plugin. Keep the plugin narrow, keep the bot separate, and make the user experience simple through orchestration rather than architectural collapse.
