# ADR 0003: v2 Pear Direct Audio Export

**Status:** Accepted

**Date:** 2026-03-31

## Context

The Windows v1.1 helper path solved local capture without changing the basic architecture, but it still kept audio extraction outside Pear. For v2, the supported path moves the audio export boundary into Pear through a direct audio export plugin transport, while keeping Pear authoritative for playback, search, and queue state.

This v2 path depends on a managed Pear fork that exposes the direct export transport and keeps the export client attachment stable without turning the bot into a second playback system.

## Decision

Adopt Pear direct audio export as the supported v2 runtime path:

`Pear direct audio export -> FFmpeg encode -> Ogg/Opus -> Discord voice`

As part of this contract:

- Pear remains the single source of truth for playback state, search, and queue state
- the bot stays a separate Discord and relay process, not a Pear fork or embedded playback engine
- the previous helper-based audio capture path is superseded
- the patched Pear dependency must be managed explicitly and documented as part of the supported setup

## Consequences

The supported v2 setup no longer depends on a local Windows loopback helper. Instead, the bot consumes the direct export stream from Pear, encodes it with FFmpeg, and forwards it to Discord.

This simplifies the runtime audio path for v2, but it also introduces a managed Pear dependency that must be tracked carefully. The repo must document the expected Pear fork, branch, launch contract, and required commits so maintainers can reproduce the supported build and know when the dependency has drifted.

The helper path remains a historical v1.1 reference only. New setup guidance, soak docs, and implementation notes should point at this ADR and the private Pear fork note instead of the old helper contract.
