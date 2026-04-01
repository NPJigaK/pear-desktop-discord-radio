# FFmpeg Notice and Attribution

> This document is engineering provenance for the current v1 FFmpeg bootstrap path. It is not legal advice.

## Scope

This notice applies to the bootstrap-managed Windows source-install strategy documented in [docs/ffmpeg-management.md](ffmpeg-management.md).

The repo does not vendor FFmpeg binaries in git. Instead, `pnpm bootstrap:ffmpeg` downloads a pinned upstream ZIP, verifies its SHA-256, and caches the extracted build under `.cache/ffmpeg/` for local use.

## Pinned Build

- Provider: BtbN FFmpeg Builds
- Release tag: `autobuild-2026-01-31-12-57`
- Asset: `ffmpeg-n8.0.1-48-g0592be14ff-win64-lgpl-shared-8.0.zip`
- Variant: `win64-lgpl-shared-8.0`
- License: `LGPLv2.1-or-later`
- SHA-256: `c342db971175d1cdb8101e31b265019a52c75abb361e91dcb1ce757cc8a2827e`
- Source manifest: [config/ffmpeg-managed.json](../config/ffmpeg-managed.json)
- Bootstrap script: [scripts/bootstrap-ffmpeg.mjs](../scripts/bootstrap-ffmpeg.mjs)

Upstream source:

- [BtbN/FFmpeg-Builds releases](https://github.com/BtbN/FFmpeg-Builds/releases)

FFmpeg licensing reference:

- [FFmpeg License and Legal Considerations](https://ffmpeg.org/legal.html)

## Attribution

FFmpeg is used under the upstream FFmpeg licensing terms. The pinned bootstrap build is the shared LGPL variant chosen for the repo’s Windows-only local setup path.

If the manifest changes, update this file together with:

- [config/ffmpeg-managed.json](../config/ffmpeg-managed.json)
- [docs/ffmpeg-management.md](ffmpeg-management.md)
- [README.md](../README.md)

## Update Notes

Use this section to record future attribution changes without rewriting the whole document.

- `2026-03-29`: Created for the pinned BtbN `win64-lgpl-shared-8.0` bootstrap path.
