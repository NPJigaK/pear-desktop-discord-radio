# Pear Direct Audio Tap v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove and, if viable, implement a Pear-native direct audio export path for v2 that eliminates same-machine double playback without relying on Windows session mute.

**Architecture:** Start with a narrow spike that checks whether an official Pear plugin can expose a stable PCM export contract. If that fails, move to a private Pear patch or fork with the smallest possible audio-export surface. Only after the direct export path is proven should the current loopback-helper path be removed.

**Tech Stack:** TypeScript, Node.js 24, Discord.js, @discordjs/voice, FFmpeg, native Pear plugin or private Pear patch/fork, Windows 11 manual verification

---

## File Structure

### Files To Create

- `docs/research/pear-direct-audio-tap-findings.md`
  - Records plugin-capability findings, patch/fork decision criteria, and spike outcomes.
- `src/audio/export-provider.ts`
  - Defines the bot-side export-provider contract for PCM ingest and diagnostics.
- `src/audio/export-session.ts`
  - Manages export-provider lifecycle and translates provider events into relay-ready streams.
- `src/audio/plugin-export.ts`
  - First-pass provider implementation for the official-plugin spike.
- `tests/audio/export-provider.test.ts`
  - Covers contract parsing and provider selection behavior.
- `tests/audio/export-session.test.ts`
  - Covers lifecycle, failure propagation, and stream handoff.
- `tests/audio/plugin-export.test.ts`
  - Covers plugin-transport parsing, handshake, and fatal failure behavior.

### Files To Modify

- `src/audio/index.ts`
  - Export the new provider abstractions.
- `src/audio/plugin-export.ts`
  - Grow from handshake parsing into the live official-plugin provider once the transport is proven.
- `src/audio/relay.ts`
  - Accept the export-provider PCM contract instead of hardcoding helper-era PCM assumptions.
- `src/voice/session.ts`
  - Replace helper-specific relay spawn assumptions with export-stream-driven relay startup.
- `src/voice/runtime.ts`
  - Switch relay startup from helper-specific spawn to export-provider-driven PCM ingest.
- `src/preflight/doctor.ts`
  - Replace helper-specific readiness with export-provider readiness once the spike is proven.
- `src/preflight/types.ts`
  - Replace helper-oriented check types with export-provider-oriented checks.
- `src/runtime/bootstrap.ts`
  - Log the selected export provider instead of the loopback helper when v2 is active.
- `README.md`
  - Update the supported path and setup guidance after the spike decision is made.
- `README.ja.md`
  - Update the supported path and setup guidance after the spike decision is made.
- `docs/windows-soak-checklist.md`
  - Replace helper-oriented setup and doctor expectations after the spike decision is made.
- `docs/windows-soak-results-template.md`
  - Replace helper-oriented checklist items after the spike decision is made.
- `docs/adr/0002-v1_1-windows-loopback-helper.md`
  - Mark as superseded when v2 is accepted.
- `docs/adr/0003-v2-pear-direct-audio-tap.md`
  - New ADR that accepts the v2 path and explicitly supersedes the helper path.

### Files To Delete After Success

- `native/loopback-helper/Cargo.toml`
- `native/loopback-helper/src/main.rs`
- `native/loopback-helper/src/args.rs`
- `native/loopback-helper/src/logging.rs`
- `native/loopback-helper/src/loopback.rs`
- `native/loopback-helper/src/process.rs`
- `native/loopback-helper/src/wav.rs`
- `src/audio/helper.ts`
- `tests/audio/helper.test.ts`

### External Work

- A separate Pear plugin or private patched Pear workspace will be needed for the spike.
- Keep that work isolated in a separate clone or worktree of `pear-devs/pear-desktop`.
- Do not commit Pear source into this repository.

---

### Task 1: Capture Spike Findings And Decision Gates

**Files:**
- Create: `docs/research/pear-direct-audio-tap-findings.md`
- Test: manual review only

- [ ] **Step 1: Write the findings document skeleton**

```md
# Pear Direct Audio Tap Findings

## Scope

- Goal: determine whether v2 can replace the helper path with Pear-native direct audio export.
- Priority order:
  1. official plugin
  2. private patch/fork
  3. reject v2 if neither is viable

## Plugin Questions

- Can a plugin observe the real playback audio path?
- Can a plugin expose PCM 48kHz stereo to the bot?
- Can the transport survive track changes and pause/resume?

## Patch/Fork Questions

- What is the smallest Pear-side surface that can export PCM?
- Can that surface remain stable across Pear upgrades?

## Decision Gate

- plugin viable: continue with plugin implementation
- plugin not viable but patch viable: continue with private patch/fork
- neither viable: stay on v1.1 and stop
```

- [ ] **Step 2: Save the findings document and review for ambiguity**

Run: no command required  
Expected: `docs/research/pear-direct-audio-tap-findings.md` exists with explicit plugin-first and patch-fallback decision gates.

- [ ] **Step 3: Commit**

```bash
git add docs/research/pear-direct-audio-tap-findings.md
git commit -m "docs: add pear direct audio tap findings scaffold"
```

### Task 2: Introduce A Narrow Export-Provider Contract

**Files:**
- Create: `src/audio/export-provider.ts`
- Modify: `src/audio/index.ts`
- Test: `tests/audio/export-provider.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type AudioExportProviderReadyResult,
  createAudioExportProviderDescriptor,
} from '../../src/audio/export-provider.js';

test('createAudioExportProviderDescriptor preserves the provider identity and PCM contract', () => {
  const descriptor = createAudioExportProviderDescriptor({
    kind: 'plugin',
    transport: 'named-pipe',
    sampleRate: 48_000,
    channels: 2,
    bitsPerSample: 16,
  });

  assert.deepStrictEqual(descriptor, {
    kind: 'plugin',
    transport: 'named-pipe',
    pcm: {
      sampleRate: 48_000,
      channels: 2,
      bitsPerSample: 16,
    },
  } satisfies AudioExportProviderReadyResult);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsc -p tsconfig.json && node --test dist/tests/audio/export-provider.test.js`  
Expected: FAIL with module or export errors because `src/audio/export-provider.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface AudioExportProviderReadyResult {
  readonly kind: 'plugin' | 'private-patch';
  readonly transport: 'named-pipe' | 'ipc';
  readonly pcm: {
    readonly sampleRate: number;
    readonly channels: number;
    readonly bitsPerSample: number;
  };
}

export function createAudioExportProviderDescriptor(input: {
  readonly kind: 'plugin' | 'private-patch';
  readonly transport: 'named-pipe' | 'ipc';
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitsPerSample: number;
}): AudioExportProviderReadyResult {
  return {
    kind: input.kind,
    transport: input.transport,
    pcm: {
      sampleRate: input.sampleRate,
      channels: input.channels,
      bitsPerSample: input.bitsPerSample,
    },
  };
}
```

- [ ] **Step 4: Export the contract from the audio index**

```ts
export type {
  AudioExportProviderReadyResult,
} from './export-provider.js';
export {
  createAudioExportProviderDescriptor,
} from './export-provider.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec tsc -p tsconfig.json && node --test dist/tests/audio/export-provider.test.js`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/audio/export-provider.ts src/audio/index.ts tests/audio/export-provider.test.ts
git commit -m "feat: add audio export provider contract"
```

### Task 3: Add Export-Session Lifecycle Handling

**Files:**
- Create: `src/audio/export-session.ts`
- Test: `tests/audio/export-session.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { createAudioExportSession } from '../../src/audio/export-session.js';

test('createAudioExportSession surfaces a PCM stream and propagates provider failure', async () => {
  const stream = new PassThrough();
  const failures: string[] = [];

  const session = createAudioExportSession({
    provider: {
      async start() {
        return {
          stream,
          stop: async () => undefined,
          onFatalError(listener) {
            listener(new Error('provider failed'));
          },
        };
      },
    },
  });

  const running = await session.start();
  running.onFatalError((error) => {
    failures.push(error.message);
  });

  assert.equal(running.stream, stream);
  assert.deepStrictEqual(failures, ['provider failed']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsc -p tsconfig.json && node --test dist/tests/audio/export-session.test.js`  
Expected: FAIL because `createAudioExportSession` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { Readable } from 'node:stream';

export interface RunningAudioExport {
  readonly stream: Readable;
  readonly stop: () => Promise<void>;
  readonly onFatalError: (listener: (error: Error) => void) => void;
}

export interface AudioExportProvider {
  start(): Promise<RunningAudioExport>;
}

export function createAudioExportSession(input: {
  readonly provider: AudioExportProvider;
}) {
  return {
    start(): Promise<RunningAudioExport> {
      return input.provider.start();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsc -p tsconfig.json && node --test dist/tests/audio/export-session.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/audio/export-session.ts tests/audio/export-session.test.ts
git commit -m "feat: add audio export session lifecycle wrapper"
```

### Task 4: Implement The Official-Plugin Spike Transport

**Files:**
- Create: `src/audio/plugin-export.ts`
- Test: `tests/audio/plugin-export.test.ts`
- Reference: `docs/research/pear-direct-audio-tap-findings.md`

- [ ] **Step 1: Write the failing test for handshake parsing**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePluginExportHandshake } from '../../src/audio/plugin-export.js';

test('parsePluginExportHandshake accepts the required PCM contract', () => {
  const result = parsePluginExportHandshake(JSON.stringify({
    kind: 'plugin',
    transport: 'named-pipe',
    pcm: {
      sampleRate: 48_000,
      channels: 2,
      bitsPerSample: 16,
    },
  }));

  assert.deepStrictEqual(result, {
    kind: 'plugin',
    transport: 'named-pipe',
    pcm: {
      sampleRate: 48_000,
      channels: 2,
      bitsPerSample: 16,
    },
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsc -p tsconfig.json && node --test dist/tests/audio/plugin-export.test.js`  
Expected: FAIL because `src/audio/plugin-export.ts` does not exist yet.

- [ ] **Step 3: Write minimal handshake implementation**

```ts
import {
  createAudioExportProviderDescriptor,
  type AudioExportProviderReadyResult,
} from './export-provider.js';

export function parsePluginExportHandshake(raw: string): AudioExportProviderReadyResult {
  const parsed = JSON.parse(raw) as {
    kind: 'plugin';
    transport: 'named-pipe' | 'ipc';
    pcm: {
      sampleRate: number;
      channels: number;
      bitsPerSample: number;
    };
  };

  return createAudioExportProviderDescriptor({
    kind: parsed.kind,
    transport: parsed.transport,
    sampleRate: parsed.pcm.sampleRate,
    channels: parsed.pcm.channels,
    bitsPerSample: parsed.pcm.bitsPerSample,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsc -p tsconfig.json && node --test dist/tests/audio/plugin-export.test.js`  
Expected: PASS

- [ ] **Step 5: Update findings with real spike evidence**
- [ ] **Step 5: Update findings with the plugin-surface evidence gathered so far**

```md
## Plugin Spike Outcome

- transport attempted: handshake parser only so far
- handshake contract: 48kHz stereo 16-bit PCM
- result: PLAUSIBLE or BLOCKED
- notes:
  - upstream renderer plugin evidence
  - missing Pear-side export implementation
  - missing bot runtime wiring
```

- [ ] **Step 6: Do not claim a runtime spike result yet**

Run: no command required
Expected: Task 4 ends with parser coverage plus documented upstream evidence only. End-to-end runtime validation moves to Task 8 after a real producer exists and runtime wiring is in place.

- [ ] **Step 7: Commit**

```bash
git add src/audio/plugin-export.ts tests/audio/plugin-export.test.ts docs/research/pear-direct-audio-tap-findings.md
git commit -m "feat: add plugin audio export spike"
```

### Task 5: Decision Gate After The Plugin Spike

**Files:**
- Modify: `docs/research/pear-direct-audio-tap-findings.md`
- Test: manual review only

- [ ] **Step 1: Record the decision outcome**

```md
## Decision

- plugin viable: yes or no
- next path:
  - continue with plugin implementation
  - switch to private patch/fork
  - stop and keep v1.1
```

- [ ] **Step 2: Branch based on feasibility, not a premature runtime claim**

Run: no command required  
Expected: If the upstream evidence shows the official plugin path is still plausible, continue to Task 7 and defer final viability to the real runtime spike in Task 8.

- [ ] **Step 3: Continue to Task 6 only if the investigation disproves the plugin path**

Run: no command required  
Expected: The plan branches explicitly instead of mixing plugin and fork work in parallel. Use Task 6 only when the plugin surface is clearly insufficient, not merely incomplete.

- [ ] **Step 4: Commit**

```bash
git add docs/research/pear-direct-audio-tap-findings.md
git commit -m "docs: record plugin spike decision"
```

### Task 6: Implement The Private Patch Or Fork Spike Only If Needed

**Files:**
- Modify externally: private Pear patch or fork workspace
- Modify: `docs/research/pear-direct-audio-tap-findings.md`
- Modify: `src/audio/plugin-export.ts` or replace with `src/audio/private-export.ts`
- Test: `tests/audio/plugin-export.test.ts` or `tests/audio/private-export.test.ts`

- [ ] **Step 1: Write the failing test for the patched export handshake**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePrivateExportHandshake } from '../../src/audio/private-export.js';

test('parsePrivateExportHandshake accepts the required PCM contract', () => {
  const result = parsePrivateExportHandshake(JSON.stringify({
    kind: 'private-patch',
    transport: 'named-pipe',
    pcm: {
      sampleRate: 48_000,
      channels: 2,
      bitsPerSample: 16,
    },
  }));

  assert.equal(result.kind, 'private-patch');
  assert.equal(result.transport, 'named-pipe');
  assert.deepStrictEqual(result.pcm, {
    sampleRate: 48_000,
    channels: 2,
    bitsPerSample: 16,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsc -p tsconfig.json && node --test dist/tests/audio/private-export.test.js`  
Expected: FAIL because the private export implementation does not exist yet.

- [ ] **Step 3: Implement the minimal private-export parser**

```ts
import {
  createAudioExportProviderDescriptor,
  type AudioExportProviderReadyResult,
} from './export-provider.js';

export function parsePrivateExportHandshake(raw: string): AudioExportProviderReadyResult {
  const parsed = JSON.parse(raw) as {
    kind: 'private-patch';
    transport: 'named-pipe' | 'ipc';
    pcm: {
      sampleRate: number;
      channels: number;
      bitsPerSample: number;
    };
  };

  return createAudioExportProviderDescriptor({
    kind: parsed.kind,
    transport: parsed.transport,
    sampleRate: parsed.pcm.sampleRate,
    channels: parsed.pcm.channels,
    bitsPerSample: parsed.pcm.bitsPerSample,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsc -p tsconfig.json && node --test dist/tests/audio/private-export.test.js`  
Expected: PASS

- [ ] **Step 5: Record the patch surface in findings**

```md
## Private Patch Spike Outcome

- patched surface:
  - exact Pear file(s)
  - exact export contract
- result: PASS or FAIL
- maintenance notes:
  - patch size
  - upgrade concerns
```

- [ ] **Step 6: Run the real patched-export spike on Windows**

Run: `pnpm exec tsc -p tsconfig.json && pnpm run runtime`  
Expected: runtime can ingest the patched direct PCM export and relay it to Discord without helper capture.

- [ ] **Step 7: Commit**

```bash
git add src/audio/private-export.ts tests/audio/private-export.test.ts docs/research/pear-direct-audio-tap-findings.md
git commit -m "feat: add private patched audio export spike"
```

### Task 7: Build The Official-Plugin Producer And Live Provider

**Files:**
- Modify externally: local plugin spike branch in `E:\github\pear-desktop-discord-radio\.worktrees\pear-desktop-upstream`
- Modify: `src/audio/plugin-export.ts`
- Modify: `src/audio/export-session.ts`
- Modify: `src/audio/index.ts`
- Modify: `tests/audio/plugin-export.test.ts`
- Modify: `docs/research/pear-direct-audio-tap-findings.md`

- [ ] **Step 1: Extend the plugin transport test to cover live bootstrap details**

```ts
test('parsePluginExportHandshake preserves the live transport details needed by the bot', () => {
  const result = parsePluginExportHandshake(JSON.stringify({
    kind: 'plugin',
    transport: 'named-pipe',
    pipePath: '\\\\.\\pipe\\pear-direct-audio',
    pcm: {
      sampleRate: 48_000,
      channels: 2,
      bitsPerSample: 16,
    },
  }));

  assert.equal(result.transport, 'named-pipe');
  assert.equal(result.pipePath, '\\\\.\\pipe\\pear-direct-audio');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsc -p tsconfig.json && node --test dist/tests/audio/plugin-export.test.js`
Expected: FAIL because the bot-side plugin provider does not yet preserve the live bootstrap details.

- [ ] **Step 3: Implement the local-only official plugin producer in the Pear workspace**

Requirements:
- Listen to Pear's renderer-side playback graph via the official plugin surface already documented in the findings.
- Emit a local-only bootstrap handshake plus PCM frames over an explicit transport.
- Keep Pear as playback/search/queue authority.
- Do not commit Pear source into this repository.

- [ ] **Step 4: Expand `src/audio/plugin-export.ts` into a live provider**

Requirements:
- Preserve the validated handshake contract.
- Represent the live transport details the bot needs.
- Expose a provider/session shape that can hand a PCM stream to the relay path once runtime wiring is ready.
- Keep the file focused on official-plugin transport only.

- [ ] **Step 5: Update findings with the exact plugin spike transport**

```md
## Official Plugin Producer Spike

- upstream branch or commit:
- transport chosen:
- bootstrap contract:
- producer startup result:
- notes:
  - playback authority remained in Pear
  - duplicate local audio still unresolved until runtime wiring or not
```

- [ ] **Step 6: Run the focused plugin-provider tests**

Run: `pnpm exec tsc -p tsconfig.json && node --test dist/tests/audio/plugin-export.test.js`
Expected: PASS

- [ ] **Step 7: Commit this repository's changes and record the external Pear commit separately**

```bash
git add src/audio/plugin-export.ts src/audio/export-session.ts src/audio/index.ts tests/audio/plugin-export.test.ts docs/research/pear-direct-audio-tap-findings.md
git commit -m "feat: add official plugin export producer contract"
```

### Task 8: Switch Runtime To The Proven Export Provider

**Files:**
- Modify: `src/audio/plugin-export.ts`
- Modify: `src/audio/relay.ts`
- Modify: `src/voice/session.ts`
- Modify: `src/voice/runtime.ts`
- Modify: `src/runtime/bootstrap.ts`
- Modify: `src/audio/index.ts`
- Test: `tests/runtime/bootstrap.test.ts`
- Test: `tests/voice/session.test.ts`
- Test: `tests/audio/plugin-export.test.ts`

- [ ] **Step 1: Write the failing runtime test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { startRuntime } from '../../src/runtime/bootstrap.js';

test('startRuntime logs the selected audio export provider instead of the helper', async () => {
  const messages: string[] = [];

  await startRuntime({
    env: {
      DISCORD_TOKEN: 'token',
      DISCORD_APPLICATION_ID: 'app',
      DISCORD_GUILD_ID: 'guild',
      DISCORD_CONTROLLER_USER_ID: 'user',
      PEAR_CLIENT_ID: 'pear-client',
    },
    createLogger() {
      return {
        child() {
          return this;
        },
        info(message: string) {
          messages.push(message);
        },
        warn() {},
        error() {},
        debug() {},
      };
    },
    async assertRuntimePreflight() {
      return undefined;
    },
    async createPearRuntimeState() {
      return {
        async start() {},
        async stop() {},
        getState() {
          return { status: 'ready' } as const;
        },
      };
    },
    async createDiscordRuntime() {
      return {
        async start() {},
        async stop() {},
      };
    },
  });

  assert.ok(messages.includes('Audio export provider selected for runtime.'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsc -p tsconfig.json && node --test dist/tests/runtime/bootstrap.test.js`  
Expected: FAIL because runtime still logs loopback-helper selection.

- [ ] **Step 3: Implement the minimal runtime switch**

```ts
logger.info('Audio export provider selected for runtime.', {
  kind: exportProvider.kind,
  transport: exportProvider.transport,
});
```

- [ ] **Step 4: Remove helper-specific startup assumptions from runtime wiring**

```ts
spawnRelay({ exportStream, pcm, ffmpegPath }) {
  return spawnAudioRelay({
    inputStream: exportStream,
    pcm,
    ffmpegPath,
  });
}
```

- [ ] **Step 5: Discover the freshest valid plugin bootstrap and carry its PCM contract into FFmpeg**

Requirements:
- Do not rely on a hardcoded helper path.
- Use the plugin bootstrap/session contract created in Task 7.
- Reject stale or non-connectable bootstrap state before trying to relay.
- Carry the actual exported PCM sample rate into the FFmpeg relay arguments instead of assuming `48000`.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm exec tsc -p tsconfig.json && node --test dist/tests/runtime/bootstrap.test.js`  
Expected: PASS

- [ ] **Step 7: Run the real plugin spike on Windows after runtime wiring exists**

Run: `pnpm exec tsc -p tsconfig.json && pnpm run runtime`
Expected: runtime can ingest plugin-exported PCM without helper-specific capture if the plugin path is truly viable.

- [ ] **Step 8: Commit**

```bash
git add src/audio/plugin-export.ts src/audio/relay.ts src/voice/session.ts src/voice/runtime.ts src/runtime/bootstrap.ts src/audio/index.ts tests/audio/plugin-export.test.ts tests/runtime/bootstrap.test.ts tests/voice/session.test.ts
git commit -m "feat: switch runtime to direct audio export provider"
```

### Task 9: Replace Helper Checks In Doctor

**Files:**
- Modify: `src/preflight/doctor.ts`
- Modify: `src/preflight/types.ts`
- Modify: `src/cli/doctor.ts`
- Test: `tests/preflight/doctor.test.ts`

- [ ] **Step 1: Write the failing doctor test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { runDoctor } from '../../src/preflight/doctor.js';

test('runDoctor reports export-provider readiness instead of helper readiness', async () => {
  const report = await runDoctor({
    pearHost: '127.0.0.1',
    pearPort: 26538,
    pearClientId: 'pear-client',
  }, {
    discoverExportProvider: async () => ({
      status: 'pass',
      detail: 'plugin export provider ready',
    }),
  });

  assert.equal(report.checks.helperDiscoverable, undefined);
  assert.equal(report.checks.exportProviderReady?.status, 'pass');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsc -p tsconfig.json && node --test dist/tests/preflight/doctor.test.js`  
Expected: FAIL because doctor still exposes helper checks.

- [ ] **Step 3: Implement the minimal doctor type and report change**

```ts
readonly exportProviderReady?: DoctorCheck;
readonly exportPcmContractReady?: DoctorCheck;
```

```ts
exportProviderReady,
exportPcmContractReady,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsc -p tsconfig.json && node --test dist/tests/preflight/doctor.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/preflight/doctor.ts src/preflight/types.ts src/cli/doctor.ts tests/preflight/doctor.test.ts
git commit -m "feat: replace helper checks with export provider readiness"
```

### Task 10: Update Docs And ADRs For The Accepted v2 Path

**Files:**
- Create: `docs/adr/0003-v2-pear-direct-audio-tap.md`
- Modify: `README.md`
- Modify: `README.ja.md`
- Modify: `docs/windows-soak-checklist.md`
- Modify: `docs/windows-soak-results-template.md`
- Modify: `docs/adr/0002-v1_1-windows-loopback-helper.md`

- [ ] **Step 1: Write the new ADR**

```md
# ADR 0003: v2 Pear Direct Audio Tap

## Decision

Accept Pear-native direct audio export as the supported v2 relay path.

## Consequences

- v1.1 helper path is superseded
- Windows session mute is not the strategic solution
- official plugin is preferred
- private patch/fork is allowed if plugin access is insufficient
```

- [ ] **Step 2: Mark ADR 0002 as superseded**

```md
**Status:** Superseded by ADR 0003
```

- [ ] **Step 3: Update README paths**

```md
The supported audio path is:

`Pear native audio export -> FFmpeg encode -> Ogg/Opus -> Discord voice`
```

- [ ] **Step 4: Verify documentation link hygiene**

Run: `git diff --check -- README.md README.ja.md docs/adr/0002-v1_1-windows-loopback-helper.md docs/adr/0003-v2-pear-direct-audio-tap.md docs/windows-soak-checklist.md docs/windows-soak-results-template.md`  
Expected: no content errors

- [ ] **Step 5: Commit**

```bash
git add README.md README.ja.md docs/adr/0002-v1_1-windows-loopback-helper.md docs/adr/0003-v2-pear-direct-audio-tap.md docs/windows-soak-checklist.md docs/windows-soak-results-template.md
git commit -m "docs: adopt pear direct audio tap v2 path"
```

### Task 11: Delete The Helper Path Only After Direct Export Is Proven

**Files:**
- Delete: `native/loopback-helper/Cargo.toml`
- Delete: `native/loopback-helper/src/main.rs`
- Delete: `native/loopback-helper/src/args.rs`
- Delete: `native/loopback-helper/src/logging.rs`
- Delete: `native/loopback-helper/src/loopback.rs`
- Delete: `native/loopback-helper/src/process.rs`
- Delete: `native/loopback-helper/src/wav.rs`
- Delete: `src/audio/helper.ts`
- Delete: `tests/audio/helper.test.ts`
- Modify: `package.json`
- Modify: `src/audio/index.ts`

- [ ] **Step 1: Remove helper exports and scripts**

```json
{
  "scripts": {
    "build:helper": undefined
  }
}
```

```ts
// remove helper exports from src/audio/index.ts
```

- [ ] **Step 2: Delete helper files**

Run: delete the files listed above  
Expected: no helper-specific runtime path remains in the repo.

- [ ] **Step 3: Run the full validation suite**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm run doctor`  
Expected: all pass on Windows with the new export path

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove superseded helper audio path"
```

## Self-Review

### Spec Coverage

- direct-audio export goal: covered by Tasks 2 through 9
- plugin-first, patch-fallback decision: covered by Tasks 4 through 8, with the real runtime spike deferred until runtime wiring exists
- helper-path deletion after success: covered by Task 11
- doctor redesign: covered by Task 9
- docs and ADR updates: covered by Task 10

### Placeholder Scan

- No `TODO`, `TBD`, or deferred “implement later” markers remain.
- The only branch point is the explicit plugin success/failure gate in Task 5.

### Type Consistency

- `AudioExportProviderReadyResult` is introduced in Task 2 and reused consistently later.
- Runtime uses `Audio export provider selected for runtime.` after Task 8.
- `exportProviderReady` and `exportPcmContractReady` are the new doctor-facing names in Task 9.
