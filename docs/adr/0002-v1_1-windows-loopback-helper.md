# ADR 0002: v1.1 Windows Loopback Helper

**Status:** Accepted

**Superseded By:** [ADR 0003](0003-v2-pear-direct-audio-tap.md)

**Date:** 2026-03-30

## Context

v1.0 treated VB-CABLE plus DirectShow capture as the Windows audio path. That approach is now superseded by the v1.1 plan, which moves capture to a Windows 11 native loopback helper. Pear remains the single source of truth for playback state and queue state.

The helper PoC is intentionally narrow. If it succeeds, the helper path becomes the only supported runtime path for v1.1. The old VB-CABLE / DirectShow path is not being kept as a long-term compatibility mode.

## Decision

Approve the v1.1 Windows 11 native loopback helper direction as the replacement for the VB-CABLE / DirectShow capture contract.

As part of that contract:

- remove `FFMPEG_DSHOW_AUDIO_DEVICE` from the app config surface
- keep `PEAR_HOST` locked to `127.0.0.1`
- keep the existing required Discord and Pear environment variables
- treat VB-CABLE / DirectShow as superseded, not parallel-supported

## Consequences

This makes the v1.1 contract match the intended runtime direction before the helper is fully implemented. The config layer no longer advertises an obsolete capture-device dependency, and the docs now describe the helper path as the target state after PoC success.

The tradeoff is that any remaining DirectShow-based runtime code will need to be removed or replaced in later tasks. This ADR intentionally does not preserve a fallback device config for the old path.

The supported v2 path is now documented separately in [ADR 0003](0003-v2-pear-direct-audio-tap.md). This ADR remains the historical record for the v1.1 loopback-helper contract.
