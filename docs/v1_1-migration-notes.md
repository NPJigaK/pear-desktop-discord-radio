# v1.1 Migration Notes

> Superseded by [ADR 0003](adr/0003-v2-pear-direct-audio-tap.md) and [docs/private-pear-fork.md](private-pear-fork.md).

## What changed

- `FFMPEG_DSHOW_AUDIO_DEVICE` is removed from the app config contract.
- `.env.example` no longer documents a DirectShow capture device.
- `PEAR_HOST` remains guarded to `127.0.0.1`.
- The required Discord and Pear variables stay in place.

## What this means for v1.1

- Windows audio capture moved from VB-CABLE / DirectShow to a Windows 11 native loopback helper in v1.1.
- That helper path was the intended runtime path after PoC success, but it is now historical only.
- VB-CABLE / DirectShow should be treated as superseded, not as a second supported configuration.

## v2 Status

- The supported v2 path is Pear direct audio export through FFmpeg into Discord voice.
- The direct export transport depends on the managed Pear fork documented in [docs/private-pear-fork.md](private-pear-fork.md).
- This note is historical context only and should not be treated as current setup guidance.

## Maintainer check

When updating remaining runtime and doctor tasks, assume there is no supported device-name config to carry forward. Any code that still depends on `FFMPEG_DSHOW_AUDIO_DEVICE` belongs to the superseded path and should be removed as later work lands.
