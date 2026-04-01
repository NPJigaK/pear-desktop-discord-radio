# Pear Direct Audio Tap Findings

## Scope

- Purpose: record the spike findings for replacing the helper-based audio path with Pear-native direct audio export in v2.
- Primary decision order:
  1. plugin-first
  2. patch-fallback
  3. reject-v2 if neither approach can satisfy the export contract cleanly
- This document is a spike findings and recommendation record that feeds the later ADR.
- The ADR will make the final architecture decision; this document only records the evidence and recommended next path.

## Plugin Questions

- Can an official Pear plugin observe the real playback audio path early enough to avoid helper-style loopback capture?
- Can the plugin export stable PCM to the bot with the required contract:
  - 48 kHz
  - stereo
  - 16-bit PCM
- Can the transport stay debuggable and local-only?
- Can the export path survive pause, resume, track changes, startup, and teardown without stale state or duplicate playback?

Plugin-first success means all of the following are true:

- the plugin can reach the playback audio source directly
- the export transport is local-only and inspectable from the bot side
- the bot can receive the export stream reliably
- startup emits a clear ready signal for the export path
- end-of-stream is reported cleanly when playback stops or the track ends
- fatal export failures are surfaced explicitly instead of hanging silently
- the runtime does not require Windows session mute as the primary workaround
- same-machine duplicate audio is eliminated in normal use

If any of those are false, the plugin path is not sufficient for v2.

## Patch/Fork Questions

- If the plugin surface is insufficient, what is the smallest Pear-side patch or fork surface that can expose the same PCM export contract?
- Can that surface be kept narrow enough to maintain across Pear updates?
- Can the patch/fork path remain local, debuggable, and free of queue or playback authority duplication?
- Does the fallback path improve on the helper architecture instead of recreating its operational debt?

Patch-fallback success means:

- a minimal Pear patch or fork can provide the required PCM export
- the transport remains local-only and inspectable from the bot side
- startup, end-of-stream, and fatal failure behavior are explicit and testable
- the change surface is narrow and explicit
- upgrade and maintenance risk is acceptable for a local-only v2 path

If the fallback requires broad Pear changes or becomes harder to reason about than v1.1, it does not qualify.

## Decision

- This document does not approve v2 by itself.
- Task 5 decision: the official plugin path remains feasible enough to continue, but it is not yet proven end-to-end.
- The next path is Task 7, continuing with plugin implementation and runtime wiring.
- Task 6 is not triggered yet because the upstream evidence does not disprove the plugin path.
- The patch/fork fallback stays reserved for the case where later evidence shows the plugin path cannot satisfy the export contract.

## Decision Gate

- Continue with plugin implementation while the plugin path remains plausible and the upstream evidence still supports a direct renderer-side tap.
- Switch to the patch/fork fallback only if later investigation or runtime validation disproves the plugin path.
- Reject v2 only if neither the plugin path nor the patch/fork fallback can provide a stable direct-audio export path that is simpler and safer than the helper-based relay.
- If v2 is rejected, keep v1.1 as the production path and do not promote Windows session mute to the supported design.

## Official Plugin Surface Evidence

- Upstream clone inspected at Pear commit `616bb5da3f2007bd5aadfe354e7d3b8fa45e9da4`.
- Pear upstream creates a renderer-side `AudioContext` and `MediaElementAudioSourceNode` from the real `<video>` element, connects that source to `audioContext.destination`, and dispatches both objects to plugins through the `peard:audio-can-play` event.
  - Evidence: `pear-desktop-upstream/src/renderer.ts` and [pear-devs/pear-desktop@616bb5d src/renderer.ts](https://github.com/pear-devs/pear-desktop/blob/616bb5da3f2007bd5aadfe354e7d3b8fa45e9da4/src/renderer.ts) create the audio graph and emit `peard:audio-can-play`.
- Existing official plugins already consume that event and modify the live playback graph in-process.
  - Evidence: `pear-desktop-upstream/src/plugins/audio-compressor.ts` and [pear-devs/pear-desktop@616bb5d src/plugins/audio-compressor.ts](https://github.com/pear-devs/pear-desktop/blob/616bb5da3f2007bd5aadfe354e7d3b8fa45e9da4/src/plugins/audio-compressor.ts) receive `{ audioSource, audioContext }` and insert a `DynamicsCompressorNode`.
  - Evidence: `pear-desktop-upstream/src/plugins/custom-output-device/renderer.ts` and [pear-devs/pear-desktop@616bb5d src/plugins/custom-output-device/renderer.ts](https://github.com/pear-devs/pear-desktop/blob/616bb5da3f2007bd5aadfe354e7d3b8fa45e9da4/src/plugins/custom-output-device/renderer.ts) receive the same `audioContext` and call `audioContext.setSinkId(...)`.
- The official plugin model is limited to `backend`, `preload`, `renderer`, and `menu` lifecycles plus Electron IPC helpers.
  - Evidence: `pear-desktop-upstream/src/types/plugins.ts` and [pear-devs/pear-desktop@616bb5d src/types/plugins.ts](https://github.com/pear-devs/pear-desktop/blob/616bb5da3f2007bd5aadfe354e7d3b8fa45e9da4/src/types/plugins.ts) define only those lifecycle slots.
  - Evidence: `pear-desktop-upstream/src/types/contexts.ts` and [pear-devs/pear-desktop@616bb5d src/types/contexts.ts](https://github.com/pear-devs/pear-desktop/blob/616bb5da3f2007bd5aadfe354e7d3b8fa45e9da4/src/types/contexts.ts) expose generic Electron IPC wrappers, but no named-pipe helper, PCM framing helper, or stream-export abstraction.

Inference from the upstream source:

- An official plugin can probably tap Pear playback audio early enough to inspect or transform the live graph inside the renderer.
- A real export spike still needs new Pear-side plugin code to serialize PCM frames and move them over an explicit transport to the bot. That code does not exist yet in the upstream clone.

## Official Plugin Producer Spike

- upstream branch: `spike/pear-direct-audio-export`
- upstream commit: `4cbe0d2a4363466aa5a3bb707fd6a83227728cee`
- transport chosen:
  - bootstrap: per-session JSON file at `%TEMP%\pear-direct-audio-export\<sessionId>.json`
  - live PCM path: renderer `ScriptProcessorNode` -> Electron IPC chunk relay -> backend-owned Windows named pipe `\\.\pipe\pear-direct-audio-<sessionId>`
- bootstrap contract:

```json
{
  "version": 1,
  "kind": "plugin",
  "transport": "named-pipe",
  "sessionId": "<uuid>",
  "bootstrapPath": "%TEMP%\\pear-direct-audio-export\\<uuid>.json",
  "bootstrapWrittenAt": "<ISO-8601 timestamp>",
  "pipePath": "\\\\.\\pipe\\pear-direct-audio-<uuid>",
  "streamState": "waiting-for-client | connected | dropping | stopped | error",
  "droppedFrameCount": 0,
  "pcm": {
    "sampleRate": 48000,
    "channels": 2,
    "bitsPerSample": 16
  }
}
```

- producer startup result:
  - `pnpm build`: PASS on the upstream spike branch after adding `src/plugins/direct-audio-export/`
  - `pnpm exec tsc -p tsconfig.json --noEmit`: FAIL, but only because the upstream branch already has unrelated type errors in `api-server`, `downloader`, and `skip-silences`
- result: DONE_WITH_CONCERNS
- notes:
  - playback authority remained in Pear. The plugin only observes the live renderer graph and relays PCM; it does not introduce a second queue or take over playback control.
  - duplicate local audio is still unresolved in the current bot runtime because Task 8 has not switched runtime selection away from the helper path yet.
  - the plugin now emits real PCM frames, but the sample rate comes from Pear's live `AudioContext`. The current bot relay still hardcodes `48000`, so Task 8 must carry the bootstrap sample rate into FFmpeg instead of assuming it.
  - bot-side transport contract is now stricter than the original Task 7 spike:
    - bootstrap loading can validate the embedded `bootstrapPath`, expected `sessionId`, and maximum bootstrap age
    - the live provider surfaces explicit terminal events for `stopped`, `producer-ended`, and `pipe-closed`
  - the spike uses `ScriptProcessorNode` for the narrowest workable tap. That is acceptable for this investigation, but it remains a concern for a production path and may need an `AudioWorklet` follow-up if runtime behavior is brittle.
  - the named pipe producer is single-client and now persists explicit `streamState` plus `droppedFrameCount` into the per-session bootstrap file when no client is attached, when backpressure starts, when the client drains, when the client reconnects, and when the producer stops. That keeps the spike inspectable without adding broader IPC plumbing.
  - backpressure behavior is now honest and bounded for the spike: once a write returns `false` or `writableNeedDrain` is already set, subsequent frames are dropped until `drain` fires instead of continuing to queue in memory.
  - remaining producer limitation: `droppedFrameCount` is surfaced as a spike-oriented diagnostic, not a guaranteed exact audit log. The bootstrap file is updated on state transitions and periodic drop milestones, not every single dropped frame.
  - missing bot-side runtime work remains:
    - `src/runtime/bootstrap.ts` still reads `helperDiscoverable` and logs `Loopback helper selected for runtime.`
    - `src/voice/runtime.ts` still spawns the helper process with `--mode stream` and pipes helper stdout into FFmpeg
