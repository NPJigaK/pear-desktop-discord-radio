# Review Findings

> This file is append-friendly. Add a dated section for each later review pass without rewriting prior entries.

**Last updated:** 2026-04-01

## 2026-03-30 FFmpeg / Discord / Docs Pass

- Scope: FFmpeg app-management implementation completion, Discord interaction acknowledgement fixes, join/move behavior, observability, and doc alignment.
- Status: prior review pass; superseded by the 2026-03-31 section below.
- Outcome: the issues below were found during implementation/review and fixed in the current tree. A follow-up external review was requested before handoff and its findings were also addressed.

## Findings and Fixes

| ID | Severity | Finding | Fix |
|---|---:|---|---|
| CODE-001 | High | Slow Discord interaction paths could exceed Discord's acknowledgement window because `/radio join`, `/radio add`, and add-select submits were not deferred before slower voice or Pear work completed. | Updated [src/discord/runtime.ts](../src/discord/runtime.ts) to call `deferReply()` for `/radio join` and `/radio add`, `deferUpdate()` for add-select submits, and to complete the response with `editReply()`. Added coverage in [tests/discord/runtime-adapter.test.ts](../tests/discord/runtime-adapter.test.ts). |
| CODE-002 | High | `/radio join` did not meet the approved behavior when already connected elsewhere; it reported “already connected” instead of moving to the controller user's current standard voice channel. | Updated [src/voice/session.ts](../src/voice/session.ts) so a second join replaces only the voice connection, keeps the relay alive, and returns a move-specific response. Added coverage in [tests/voice/session.test.ts](../tests/voice/session.test.ts) and [tests/discord/router.test.ts](../tests/discord/router.test.ts). |
| CODE-003 | Medium | After a deferred interaction was acknowledged, an unexpected router exception could still leave the user without a terminal response. | Updated [src/discord/runtime.ts](../src/discord/runtime.ts) to send a generic failure reply when a deferred interaction fails before any terminal response is sent. Added failure-path coverage in [tests/discord/runtime-adapter.test.ts](../tests/discord/runtime-adapter.test.ts). |
| CODE-004 | Medium | A relay failure during an explicit join-move or reconnect attempt could land in a state window where the relay died but the voice path still reported success. | Kept the voice session in `reconnecting` until the replacement connection is actually ready, preserved `failed` relay state during move teardown, and added a regression test for relay failure during move in [src/voice/session.ts](../src/voice/session.ts) and [tests/voice/session.test.ts](../tests/voice/session.test.ts). |
| CODE-005 | Medium | `doctor` only proved raw DirectShow capture, which could report green even if the chosen FFmpeg could not encode the actual runtime Ogg/Opus relay path. | Updated [src/audio/relay.ts](../src/audio/relay.ts), [src/audio/ffmpeg.ts](../src/audio/ffmpeg.ts), and [src/preflight/doctor.ts](../src/preflight/doctor.ts) so the smoke test uses the real relay output shape (`libopus` + `ogg` to `pipe:1`). Added coverage in [tests/audio/ffmpeg.test.ts](../tests/audio/ffmpeg.test.ts) and [tests/preflight/doctor.test.ts](../tests/preflight/doctor.test.ts). |
| DOC-001 | Medium | Older docs still described system `ffmpeg.exe` as the normal prerequisite, which conflicted with the bootstrap-managed default path. | Added superseding language to [README.md](../README.md), [docs/ffmpeg-management.md](ffmpeg-management.md), [docs/architecture-review.md](architecture-review.md), and [docs/adr/0001-v1-architecture.md](adr/0001-v1-architecture.md). |
| DOC-002 | Medium | There was no dedicated attribution/provenance note for the pinned BtbN FFmpeg build. | Added [docs/ffmpeg-notice.md](ffmpeg-notice.md) and linked it from the main FFmpeg docs and README. |
| DOC-003 | Low | User-facing docs did not explicitly call out the final join-move behavior or the new Discord interaction deferral strategy, and the earlier review log still claimed the pass was docs-only. | Updated [README.md](../README.md), [docs/updated-implementation-notes.md](updated-implementation-notes.md), and [docs/review-findings.md](review-findings.md) to match the shipped runtime behavior and the actual review scope. |
| DOC-004 | Medium | Repo docs and the Japanese README used machine-specific absolute file links, which broke on GitHub and in other clones. | Rewrote README/doc markdown links to repository-relative targets in [README.ja.md](../README.ja.md) and the files under [docs/](./). |
| DOC-005 | Low | The Japanese README missed the Pear `v3.11.x` API-surface requirement and understated FFmpeg fallback behavior. | Updated [README.ja.md](../README.ja.md) to match the English README on Pear requirements, fallback behavior, and doctor wording. |
| REPO-001 | Low | `.codex/` was not ignored and the docs did not explicitly state that shared source archives should be clean source snapshots rather than whole worktree dumps. | Added `.codex/` to [.gitignore](../.gitignore) and documented clean source-archive expectations in [README.md](../README.md) and [README.ja.md](../README.ja.md). |

## 2026-03-30 Helper Migration Pass

- Scope: v1.1 Windows 11 native loopback helper migration, helper-based `doctor`/runtime path, destructive cleanup of VB-CABLE/DirectShow assumptions, and soak-ready documentation.
- Outcome: the findings below were raised during task-level reviews and fixed in the current branch. A final branch review then approved the committed state with only manual Windows soak risk remaining.

| ID | Severity | Finding | Fix |
|---|---:|---|---|
| HELPER-001 | High | The approved helper path was wired into runtime and `doctor`, but the native helper still returned a stubbed “not implemented” capture error. That left the new default path non-functional. | Implemented real Windows process loopback capture in [native/loopback-helper/src/loopback.rs](../native/loopback-helper/src/loopback.rs) using `ActivateAudioInterfaceAsync`, packet draining through `IAudioCaptureClient`, WAV-framed sample output for `doctor`, and raw PCM stream output for runtime. Added helper build/test coverage in the Rust crate. |
| HELPER-002 | High | The first helper implementation could go falsely green by succeeding after timeout-only behavior and zero-padding sample output without ever observing a loopback packet batch. | Tightened [native/loopback-helper/src/loopback.rs](../native/loopback-helper/src/loopback.rs) so `probe` and `sample` require an observed packet batch before success, and added unit tests for the wait/drain control flow and timeout gating. |
| DOC-006 | Medium | Public docs and soak instructions still described VB-CABLE / DirectShow / `FFMPEG_DSHOW_AUDIO_DEVICE` as the supported path, and some helper-path logs were named incorrectly for soak execution. | Rewrote [README.md](../README.md), [README.ja.md](../README.ja.md), [docs/windows-soak-checklist.md](windows-soak-checklist.md), [docs/windows-soak-results-template.md](windows-soak-results-template.md), and related architecture notes to the Windows 11 helper path. Historical docs such as [docs/implementation-plan.md](implementation-plan.md) and [docs/updated-implementation-notes.md](updated-implementation-notes.md) are now explicitly marked as superseded/history-only where appropriate. |
| TEST-001 | Medium | Removing DirectShow tests also dropped a useful regression check for FFmpeg child-process spawning on Windows, and later cleanup tests initially gave false confidence for removed type-only exports. | Added a focused `windowsHide: true` spawn regression test via `createRunCommand` in [tests/audio/ffmpeg.test.ts](../tests/audio/ffmpeg.test.ts), then corrected the cleanup assertions so removed value exports are checked at runtime while removed type-only exports are enforced in type position with `@ts-expect-error`. |
| CLEANUP-001 | Medium | Even after the helper migration landed, dead DirectShow-era source surfaces and stale test fixtures remained in the audio/preflight layers, which kept obsolete APIs and names alive. | Removed the dead DirectShow exports/functions/types from [src/audio/ffmpeg.ts](../src/audio/ffmpeg.ts) and [src/audio/index.ts](../src/audio/index.ts), removed unused `ffmpegDshowAudioDevice` plumbing from [src/audio/relay.ts](../src/audio/relay.ts), renamed the encode readiness type in [src/preflight/types.ts](../src/preflight/types.ts), and deleted stale `FFMPEG_DSHOW_AUDIO_DEVICE` fixtures from [tests/runtime/bootstrap.test.ts](../tests/runtime/bootstrap.test.ts). |

Final branch review status:

- Result: approved
- Remaining risk: no automated end-to-end test exists for the real Windows host path through Pear + helper + FFmpeg + Discord voice; the remaining confidence gap is the manual native Windows soak.

## 2026-03-31 V2 Cleanup / Private Fork / Launcher Pass

- Scope: helper-path cleanup in the bot repo, direct audio export adoption in docs/ADR, thin launcher hardening, and the sibling private-fork contract.
- Findings: none.
- Outcome: the helper path was removed from the bot repo, the docs and ADR now describe the direct audio export path, the thin launcher was added and hardened, and the clean sibling-repo contract for the private Pear fork is documented.
- Verification state: `pnpm lint`, `pnpm typecheck`, and `pnpm test` passed in the root repo. Manual Windows verification against the patched/private sibling Pear repo also reached `full-pass: YES` in `pnpm run doctor`, runtime logs showed the selected audio export provider path, and the direct audio export path worked on Windows with the patched Pear app.
- Caveat: that manual Windows verification depended on the external patched/private sibling Pear repo, so it is not reproducible from this repo alone. No separate automated host-path soak was added here.

## 2026-04-01 Single-Repo Topology Migration Pass

- Scope: repo-guidance rewrite for the current single-repo topology where the patched Pear fork lives at the root and the Discord bot/runtime package lives under `apps/discord-radio-bot`.
- Findings: none.
- Outcome: `README.md`, `README.ja.md`, `docs/private-pear-fork.md`, `docs/architecture-review.md`, soak docs, `AGENTS.md`, and the new topology checklist now describe the supported root+subdir model and eliminate sibling-repo setup language.
- Verification state: Task 4 did not change runtime behavior. Verification was limited to root/app command-surface alignment, stale-reference cleanup, and `pnpm run test:radio-bot` from the repo root to confirm the wrapper path still delegates into the bot package.
- Caveat: no new manual Windows host-path soak was run in this pass because the task only rewrote docs/guidance and intentionally left runtime behavior unchanged.

## Future Update Format

Add future entries below this section using the same table columns:

| ID | Severity | Finding | Fix |
|---|---:|---|---|
| DOC-003 | High | Example future finding. | Example future fix. |
