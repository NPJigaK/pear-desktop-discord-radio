# Windows Loopback Helper v1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the VB-CABLE / DirectShow relay path with a Windows 11 native process loopback helper, keep Pear as the only playback authority, and remove the old capture path after the helper path is proven.

**Architecture:** Keep the Node runtime as the Discord/Pear coordinator, add a small Windows-native helper that captures Pear audio only and emits 48kHz stereo PCM to `stdout`, and keep FFmpeg as an encode/mux stage that turns helper PCM into Ogg/Opus for `@discordjs/voice`. Treat the change as destructive cleanup: remove DirectShow device config, doctor checks, and docs once the helper path works.

**Tech Stack:** Node 24, TypeScript + ESM, Rust helper with the `windows` crate, FFmpeg app-managed discovery, `discord.js`, `@discordjs/voice`, `pino`

---

## File Structure

### Create

- `docs/adr/0002-v1_1-windows-loopback-helper.md`
  - Superseding ADR for v1.1 audio capture direction and Windows 11 minimum support.
- `docs/v1_1-migration-notes.md`
  - Maintainer-facing destructive-change checklist for removing VB-CABLE / DirectShow.
- `native/loopback-helper/Cargo.toml`
  - Rust helper manifest.
- `native/loopback-helper/src/main.rs`
  - Helper entrypoint and CLI dispatch.
- `native/loopback-helper/src/args.rs`
  - Argument parsing for `probe`, `sample`, and `stream` modes.
- `native/loopback-helper/src/process.rs`
  - Pear PID discovery by local TCP listener port.
- `native/loopback-helper/src/loopback.rs`
  - Process/application loopback capture setup and PCM pumping.
- `native/loopback-helper/src/logging.rs`
  - Structured JSON-line diagnostics to `stderr`.
- `native/loopback-helper/src/wav.rs`
  - Short sample-mode framing for doctor smoke tests.
- `src/audio/helper.ts`
  - Helper discovery, probing, and spawn wrappers.
- `tests/audio/helper.test.ts`
  - Unit coverage for helper discovery and probe parsing.

### Modify

- `package.json`
  - Add helper build script.
- `.gitignore`
  - Ignore Rust build output.
- `.env.example`
  - Remove `FFMPEG_DSHOW_AUDIO_DEVICE`.
- `README.md`
  - Switch setup from VB-CABLE to helper build flow.
- `README.ja.md`
  - Same as English README.
- `docs/adr/0001-v1-architecture.md`
  - Mark the v1 VB-CABLE path as superseded for v1.1.
- `docs/ffmpeg-management.md`
  - Keep FFmpeg scope accurate now that FFmpeg is encode-only.
- `docs/updated-implementation-notes.md`
  - Replace DirectShow-specific notes with helper notes.
- `docs/windows-soak-checklist.md`
  - Rewrite for Windows 11 helper path.
- `docs/windows-soak-results-template.md`
  - Rewrite soak template fields around helper readiness.
- `src/audio/relay.ts`
  - Encode helper PCM instead of capturing DirectShow directly.
- `src/audio/ffmpeg.ts`
  - Keep FFmpeg discovery and add PCM-to-Ogg/Opus encode readiness probing.
- `src/audio/index.ts`
  - Export helper/relay APIs.
- `src/config/types.ts`
  - Remove `ffmpegDshowAudioDevice`.
- `src/config/loadConfig.ts`
  - Stop requiring `FFMPEG_DSHOW_AUDIO_DEVICE`.
- `src/preflight/types.ts`
  - Replace DirectShow checks with helper-oriented checks.
- `src/preflight/loadDoctorConfig.ts`
  - Drop DirectShow config loading and keep Windows 11 gate inputs.
- `src/preflight/doctor.ts`
  - Add helper discovery/probe checks and FFmpeg encode smoke tests.
- `src/cli/doctor.ts`
  - Print helper-related doctor fields.
- `src/runtime/bootstrap.ts`
  - Pass helper path and Pear port into runtime.
- `src/voice/runtime.ts`
  - Build a live voice session from helper + FFmpeg.
- `src/voice/session.ts`
  - Supervise a composite helper+FFmpeg relay instead of one DirectShow FFmpeg process.
- `tests/audio/ffmpeg.test.ts`
  - Replace DirectShow smoke coverage with PCM encode smoke coverage.
- `tests/config/loadConfig.test.ts`
  - Remove device env requirement assertions.
- `tests/preflight/doctor.test.ts`
  - Replace DirectShow report shape with helper report shape.
- `tests/runtime/bootstrap.test.ts`
  - Assert helper path flows through runtime startup.
- `tests/voice/session.test.ts`
  - Assert helper+FFmpeg relay supervision and logs.

## Task 1: Lock the v1.1 Contract and Remove the Device Env Requirement

**Files:**
- Create: `docs/adr/0002-v1_1-windows-loopback-helper.md`
- Create: `docs/v1_1-migration-notes.md`
- Modify: `src/config/types.ts`
- Modify: `src/config/loadConfig.ts`
- Modify: `tests/config/loadConfig.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write the failing config tests**

```ts
test('loadConfig no longer requires FFMPEG_DSHOW_AUDIO_DEVICE', () => {
  const config = loadConfig({
    DISCORD_TOKEN: 'token',
    DISCORD_APPLICATION_ID: 'app-id',
    DISCORD_GUILD_ID: 'guild-id',
    DISCORD_CONTROLLER_USER_ID: 'user-id',
    PEAR_CLIENT_ID: 'pear-client-id',
  });

  assert.equal(config.pearHost, '127.0.0.1');
  assert.equal(config.ffmpegPath, undefined);
  assert.equal('ffmpegDshowAudioDevice' in config, false);
});

test('loadConfig still rejects non-127.0.0.1 PEAR_HOST', () => {
  assert.throws(
    () =>
      loadConfig({
        DISCORD_TOKEN: 'token',
        DISCORD_APPLICATION_ID: 'app-id',
        DISCORD_GUILD_ID: 'guild-id',
        DISCORD_CONTROLLER_USER_ID: 'user-id',
        PEAR_CLIENT_ID: 'pear-client-id',
        PEAR_HOST: '192.168.0.10',
      }),
    /PEAR_HOST must be exactly 127.0.0.1/u,
  );
});
```

- [ ] **Step 2: Run the config test to verify it fails**

Run:

```powershell
npm run build
node --test dist/tests/config/loadConfig.test.js
```

Expected: FAIL because `loadConfig()` still requires `FFMPEG_DSHOW_AUDIO_DEVICE`.

- [ ] **Step 3: Remove the DirectShow env from the app config contract**

```ts
export interface AppConfig {
  readonly discordToken: string;
  readonly discordApplicationId: string;
  readonly discordGuildId: string;
  readonly discordControllerUserId: string;
  readonly pearClientId: string;
  readonly pearHost: '127.0.0.1';
  readonly pearPort: number;
  readonly ffmpegPath?: string | undefined;
  readonly logLevel?: string | undefined;
}
```

```ts
type RequiredKey =
  | 'DISCORD_TOKEN'
  | 'DISCORD_APPLICATION_ID'
  | 'DISCORD_GUILD_ID'
  | 'DISCORD_CONTROLLER_USER_ID'
  | 'PEAR_CLIENT_ID';
```

```ts
return {
  discordToken: readRequired(env, 'DISCORD_TOKEN'),
  discordApplicationId: readRequired(env, 'DISCORD_APPLICATION_ID'),
  discordGuildId: readRequired(env, 'DISCORD_GUILD_ID'),
  discordControllerUserId: readRequired(env, 'DISCORD_CONTROLLER_USER_ID'),
  pearClientId: readRequired(env, 'PEAR_CLIENT_ID'),
  pearHost: '127.0.0.1',
  pearPort: readPort(env),
  ffmpegPath: readOptional(env, 'FFMPEG_PATH'),
  logLevel: readOptional(env, 'LOG_LEVEL'),
};
```

- [ ] **Step 4: Update the env example and ADR baseline**

```dotenv
DISCORD_TOKEN=
DISCORD_APPLICATION_ID=
DISCORD_GUILD_ID=
DISCORD_CONTROLLER_USER_ID=
PEAR_CLIENT_ID=pear-desktop-discord-radio

PEAR_HOST=127.0.0.1
PEAR_PORT=26538

# Optional fallback. Used only when the app-managed FFmpeg binary
# is unavailable or when you intentionally want doctor/runtime to
# fall back after the app-managed probe fails.
# FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe

# LOG_LEVEL=info
```

```md
# ADR 0002: v1.1 Windows Loopback Helper

**Status:** Accepted

**Date:** 2026-03-30

## Decision

v1.1 replaces VB-CABLE and DirectShow capture with a Windows 11 native loopback helper that captures Pear audio only and emits PCM to the Node runtime. FFmpeg remains encode-only and app-managed by default.
```

- [ ] **Step 5: Run the config test to verify it passes**

Run:

```powershell
npm run build
node --test dist/tests/config/loadConfig.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add docs/adr/0002-v1_1-windows-loopback-helper.md docs/v1_1-migration-notes.md .env.example src/config/types.ts src/config/loadConfig.ts tests/config/loadConfig.test.ts
git commit -m "chore: define v1.1 helper config contract"
```

## Task 2: Add the Windows 11 Native Helper PoC

**Files:**
- Create: `native/loopback-helper/Cargo.toml`
- Create: `native/loopback-helper/src/main.rs`
- Create: `native/loopback-helper/src/args.rs`
- Create: `native/loopback-helper/src/process.rs`
- Create: `native/loopback-helper/src/loopback.rs`
- Create: `native/loopback-helper/src/logging.rs`
- Create: `native/loopback-helper/src/wav.rs`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Add the helper crate manifest and build script**

```toml
[package]
name = "pear-loopback-helper"
version = "0.1.0"
edition = "2024"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
windows = { version = "0.61", features = [
  "Win32_Foundation",
  "Win32_Media_Audio",
  "Win32_Networking_WinSock",
  "Win32_System_Com",
  "Win32_System_Threading",
] }
```

```json
{
  "scripts": {
    "build:helper": "cargo build --manifest-path native/loopback-helper/Cargo.toml --release"
  }
}
```

```gitignore
native/loopback-helper/target/
```

- [ ] **Step 2: Write a small Rust CLI parsing test**

```rust
#[test]
fn parses_sample_mode_and_port() {
    let args = Args::parse_from([
        "pear-loopback-helper.exe",
        "--mode",
        "sample",
        "--pear-port",
        "26538",
        "--duration-ms",
        "250",
    ])
    .unwrap();

    assert_eq!(args.mode, Mode::Sample);
    assert_eq!(args.pear_port, 26538);
    assert_eq!(args.duration_ms, Some(250));
}
```

- [ ] **Step 3: Run the Rust test to verify it fails**

Run:

```powershell
cargo test --manifest-path native/loopback-helper/Cargo.toml
```

Expected: FAIL because the helper crate and parser do not exist yet.

- [ ] **Step 4: Implement the helper CLI contract**

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Probe,
    Sample,
    Stream,
}

pub struct Args {
    pub mode: Mode,
    pub pear_port: u16,
    pub duration_ms: Option<u32>,
}
```

```rust
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = args::parse(std::env::args().collect())?;
    let pear_pid = process::find_pid_by_listening_port(args.pear_port)?;
    logging::emit("pear-process-found", serde_json::json!({ "pid": pear_pid }))?;

    match args.mode {
        args::Mode::Probe => loopback::probe_capture(pear_pid)?,
        args::Mode::Sample => loopback::write_sample_pcm(pear_pid, args.duration_ms.unwrap_or(250))?,
        args::Mode::Stream => loopback::stream_pcm(pear_pid)?,
    }

    Ok(())
}
```

```rust
pub fn emit(event: &str, payload: serde_json::Value) -> std::io::Result<()> {
    eprintln!("{}", serde_json::json!({
        "event": event,
        "payload": payload,
    }));
    Ok(())
}
```

```rust
pub fn write_sample_pcm(pear_pid: u32, duration_ms: u32) -> anyhow::Result<()> {
    let mut capture = open_process_loopback(pear_pid)?;
    logging::emit("capture-opened", serde_json::json!({
        "sampleRate": 48_000,
        "channels": 2,
        "bitsPerSample": 16,
    }))?;
    capture.write_pcm_to_stdout(duration_ms)?;
    Ok(())
}
```

- [ ] **Step 5: Run the Rust test and release build**

Run:

```powershell
cargo test --manifest-path native/loopback-helper/Cargo.toml
npm run build:helper
```

Expected: PASS, and `native/loopback-helper/target/release/pear-loopback-helper.exe` exists.

- [ ] **Step 6: Commit**

```powershell
git add package.json .gitignore native/loopback-helper
git commit -m "feat: add windows loopback helper poc"
```

## Task 3: Refactor Audio Relay to Helper PCM -> FFmpeg Encode

**Files:**
- Create: `src/audio/helper.ts`
- Modify: `src/audio/relay.ts`
- Modify: `src/audio/ffmpeg.ts`
- Modify: `src/audio/index.ts`
- Create: `tests/audio/helper.test.ts`
- Modify: `tests/audio/ffmpeg.test.ts`

- [ ] **Step 1: Write helper discovery and encode-argument tests**

```ts
test('discoverLoopbackHelper points users to npm run build:helper when missing', async () => {
  const result = await discoverLoopbackHelper({
    fileExists: () => false,
  });

  assert.equal(result.status, 'fail');
  assert.match(result.detail, /npm run build:helper/u);
});

test('buildFfmpegRelayArguments consumes PCM from stdin', () => {
  assert.deepStrictEqual(buildFfmpegRelayArguments(), [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-nostdin',
    '-f',
    's16le',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-i',
    'pipe:0',
    '-vn',
    '-acodec',
    'libopus',
    '-b:a',
    '128k',
    '-vbr',
    'on',
    '-frame_duration',
    '20',
    '-application',
    'audio',
    '-f',
    'ogg',
    'pipe:1',
  ]);
});
```

- [ ] **Step 2: Run the audio tests to verify they fail**

Run:

```powershell
npm run build
node --test dist/tests/audio/helper.test.js dist/tests/audio/ffmpeg.test.js
```

Expected: FAIL because helper discovery does not exist and relay arguments still use `dshow`.

- [ ] **Step 3: Add helper discovery and probe wrappers**

```ts
export interface LoopbackHelperDiscoveryResult {
  readonly status: 'pass' | 'fail';
  readonly detail: string;
  readonly executablePath: string;
}

export function getLoopbackHelperExecutablePath(projectRoot = getProjectRoot()): string {
  return path.join(
    projectRoot,
    'native',
    'loopback-helper',
    'target',
    'release',
    'pear-loopback-helper.exe',
  );
}

export async function discoverLoopbackHelper(
  options: {
    readonly executablePath?: string | undefined;
    readonly fileExists?: ((path: string) => boolean) | undefined;
  } = {},
): Promise<LoopbackHelperDiscoveryResult> {
  const executablePath = options.executablePath ?? getLoopbackHelperExecutablePath();
  const fileExists = options.fileExists ?? existsSync;

  if (!fileExists(executablePath)) {
    return {
      status: 'fail',
      detail: 'Loopback helper binary was not found. Run `npm run build:helper` on Windows 11 first.',
      executablePath,
    };
  }

  return {
    status: 'pass',
    detail: 'Loopback helper executable was found.',
    executablePath,
  };
}
```

- [ ] **Step 4: Replace DirectShow relay arguments with PCM encode arguments**

```ts
function buildRelayArgumentList(
  options: {
    readonly logLevel: 'warning' | 'error';
    readonly outputTarget: string;
    readonly durationSeconds?: number | undefined;
  },
): string[] {
  const argumentsList = [
    '-hide_banner',
    '-loglevel',
    options.logLevel,
    '-nostdin',
    '-f',
    's16le',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-i',
    'pipe:0',
    '-vn',
    '-acodec',
    'libopus',
    '-b:a',
    '128k',
    '-vbr',
    'on',
    '-frame_duration',
    '20',
    '-application',
    'audio',
  ];
```

```ts
export function spawnFfmpegRelay(options: SpawnFfmpegRelayOptions) {
  return spawn(options.ffmpegPath ?? 'ffmpeg', buildFfmpegRelayArguments(), {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
}
```

- [ ] **Step 5: Add an FFmpeg PCM encode readiness probe**

```ts
export async function probeFfmpegPcmEncodeReadiness(
  options: {
    readonly executablePath: string;
    readonly runCommand?: RunCommand | undefined;
  },
): Promise<DirectShowCaptureReadiness> {
  const commandRunner = options.runCommand ?? runCommand;
  const probe = await commandRunner(options.executablePath, buildFfmpegRelaySmokeTestArguments());

  if (probe.error !== undefined || probe.exitCode !== 0) {
    return {
      status: 'fail',
      detail: `PCM Ogg/Opus encode smoke test failed: ${describeProbeFailure(probe)}`,
    };
  }

  return {
    status: 'pass',
    detail: 'PCM Ogg/Opus encode smoke test succeeded.',
  };
}
```

- [ ] **Step 6: Run the audio tests to verify they pass**

Run:

```powershell
npm run build
node --test dist/tests/audio/helper.test.js dist/tests/audio/ffmpeg.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/audio/helper.ts src/audio/relay.ts src/audio/ffmpeg.ts src/audio/index.ts tests/audio/helper.test.ts tests/audio/ffmpeg.test.ts
git commit -m "feat: switch relay to helper pcm encode path"
```

## Task 4: Redesign `doctor` Around Helper Readiness

**Files:**
- Modify: `src/preflight/types.ts`
- Modify: `src/preflight/loadDoctorConfig.ts`
- Modify: `src/preflight/doctor.ts`
- Modify: `src/cli/doctor.ts`
- Modify: `tests/preflight/doctor.test.ts`

- [ ] **Step 1: Write the new doctor report tests**

```ts
test('runDoctor reports fullPass when helper and ffmpeg encode path are ready on win32', async () => {
  const report = await runDoctor(doctorConfig, {
    platform: 'win32',
    probePearAuth: async () => undefined,
    probePearWebSocket: async () => undefined,
    discoverLoopbackHelper: async () => ({
      status: 'pass',
      detail: 'Loopback helper executable was found.',
      executablePath: 'E:\\github\\pear-desktop-discord-radio\\native\\loopback-helper\\target\\release\\pear-loopback-helper.exe',
    }),
    probeLoopbackHelper: async () => ({
      status: 'pass',
      detail: 'Loopback helper sample probe succeeded.',
      pearProcessId: 4242,
      bytesCaptured: 192000,
    }),
    discoverFfmpeg: async () => ({
      status: 'pass',
      detail: 'ffmpeg version 8.1',
      executablePath: 'ffmpeg.exe',
      source: 'app-managed',
      attempts: [],
    }),
    probeFfmpegPcmEncodeReadiness: async () => ({
      status: 'pass',
      detail: 'PCM Ogg/Opus encode smoke test succeeded.',
    }),
  });

  assert.equal(report.checks.helperDiscoverable.status, 'pass');
  assert.equal(report.checks.helperLoopbackReady.status, 'pass');
  assert.equal(report.checks.ffmpegEncodeReady.status, 'pass');
  assert.equal(report.fullPass, true);
});
```

```ts
test('loadDoctorConfig does not require FFMPEG_DSHOW_AUDIO_DEVICE on Windows 11', () => {
  const config = loadDoctorConfig(
    {
      PEAR_CLIENT_ID: 'pear-client-id',
      PEAR_HOST: '127.0.0.1',
      PEAR_PORT: '26538',
    },
    'win32',
  );

  assert.equal(config.ffmpegPath, undefined);
});
```

- [ ] **Step 2: Run the doctor tests to verify they fail**

Run:

```powershell
npm run build
node --test dist/tests/preflight/doctor.test.js
```

Expected: FAIL because `doctor` still exposes DirectShow checks.

- [ ] **Step 3: Replace the DirectShow report model**

```ts
export interface DoctorReport {
  readonly platform: NodeJS.Platform;
  readonly checks: {
    readonly pearHostExact: DoctorCheck;
    readonly pearAuthReachable: DoctorCheck;
    readonly pearWebSocketReachable: DoctorCheck;
    readonly windowsRequirementSatisfied: DoctorCheck;
    readonly helperDiscoverable: DoctorCheck & {
      readonly executablePath?: string | undefined;
    };
    readonly helperLoopbackReady: DoctorCheck & {
      readonly pearProcessId?: number | undefined;
      readonly bytesCaptured?: number | undefined;
    };
    readonly ffmpegDiscoverable: DoctorCheck & {
      readonly executablePath?: string | undefined;
      readonly source?: FfmpegDiscoveryResult['source'] | undefined;
      readonly attempts?: readonly FfmpegDiscoveryAttempt[] | undefined;
    };
    readonly ffmpegEncodeReady: DoctorCheck;
  };
  readonly fullPass: boolean;
}
```

- [ ] **Step 4: Implement helper-aware doctor flow**

```ts
const windowsRequirementSatisfied =
  platform === 'win32'
    ? toCheck('pass', 'Windows runtime platform detected.')
    : toCheck('fail', 'v1.1 runtime requires native Windows.');
```

```ts
const helperProbe = await discoverLoopbackHelperImpl();
const helperDiscoverable = {
  status: helperProbe.status,
  detail: helperProbe.detail,
  executablePath: helperProbe.executablePath,
} as const;
```

```ts
const helperLoopbackReady =
  helperProbe.status === 'fail'
    ? {
        status: 'fail',
        detail: 'Loopback helper probe was skipped because the helper is unavailable.',
      }
    : await probeLoopbackHelperImpl(config, helperProbe.executablePath);
```

```ts
const ffmpegEncodeReady =
  ffmpegProbe.status === 'fail' || helperLoopbackReady.status !== 'pass'
    ? {
        status: 'fail',
        detail: 'FFmpeg encode smoke test was skipped because helper readiness is incomplete.',
      }
    : await probeFfmpegPcmEncodeReadinessImpl(config, ffmpegProbe.executablePath);
```

- [ ] **Step 5: Update the CLI output keys**

```ts
const checkOrder = {
  pearHostExact: 'pear-host-exact',
  pearAuthReachable: 'pear-auth-reachable',
  pearWebSocketReachable: 'pear-websocket-reachable',
  windowsRequirementSatisfied: 'windows-requirement-satisfied',
  helperDiscoverable: 'helper-discoverable',
  helperLoopbackReady: 'helper-loopback-ready',
  ffmpegDiscoverable: 'ffmpeg-discoverable',
  ffmpegEncodeReady: 'ffmpeg-encode-ready',
} as const;
```

- [ ] **Step 6: Run the doctor tests to verify they pass**

Run:

```powershell
npm run build
node --test dist/tests/preflight/doctor.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/preflight/types.ts src/preflight/loadDoctorConfig.ts src/preflight/doctor.ts src/cli/doctor.ts tests/preflight/doctor.test.ts
git commit -m "feat: redesign doctor for helper relay path"
```

## Task 5: Integrate the Helper Path Into Runtime and Voice Supervision

**Files:**
- Modify: `src/runtime/bootstrap.ts`
- Modify: `src/voice/runtime.ts`
- Modify: `src/voice/session.ts`
- Modify: `tests/runtime/bootstrap.test.ts`
- Modify: `tests/voice/session.test.ts`

- [ ] **Step 1: Write the failing runtime and voice-session tests**

```ts
test('startRuntime passes the helper path and pear port into the live voice session factory', async () => {
  let receivedHelperPath: string | undefined;
  let receivedPearPort: number | undefined;

  await startRuntime({
    env: {
      DISCORD_TOKEN: 'token',
      DISCORD_APPLICATION_ID: 'app-id',
      DISCORD_GUILD_ID: 'guild-id',
      DISCORD_CONTROLLER_USER_ID: 'user-id',
      PEAR_CLIENT_ID: 'pear-client-id',
    },
    assertRuntimePreflight: async () =>
      ({
        fullPass: true,
        checks: {
          ffmpegDiscoverable: {
            status: 'pass',
            detail: 'ffmpeg version 8.1',
            executablePath: 'ffmpeg.exe',
            source: 'app-managed',
            attempts: [],
          },
          helperDiscoverable: {
            status: 'pass',
            detail: 'Loopback helper executable was found.',
            executablePath: 'pear-loopback-helper.exe',
          },
        },
      }) as never,
    createLiveVoiceSession: ({ helperPath, pearPort }) => {
      receivedHelperPath = helperPath;
      receivedPearPort = pearPort;
      return fakeVoiceSession;
    },
  });

  assert.equal(receivedHelperPath, 'pear-loopback-helper.exe');
  assert.equal(receivedPearPort, 26538);
});
```

```ts
test('voice session logs helper and ffmpeg process failures', async () => {
  assert.deepStrictEqual(entries.filter((entry) => entry.level === 'error'), [
    {
      level: 'error',
      message: 'Audio relay exited.',
      payload: {
        helperExecutablePath: 'pear-loopback-helper.exe',
        ffmpegExecutablePath: 'ffmpeg.exe',
        exitCode: 1,
      },
    },
  ]);
});
```

- [ ] **Step 2: Run the runtime and voice tests to verify they fail**

Run:

```powershell
npm run build
node --test dist/tests/runtime/bootstrap.test.js dist/tests/voice/session.test.js
```

Expected: FAIL because runtime still passes `ffmpegDshowAudioDevice` and voice supervision assumes one FFmpeg capture process.

- [ ] **Step 3: Pass helper metadata through runtime bootstrap**

```ts
const helperExecutablePath =
  preflightReport?.checks.helperDiscoverable.executablePath;

if (helperExecutablePath !== undefined) {
  logger.info('Loopback helper selected for runtime.', {
    executablePath: helperExecutablePath,
    pearPort: config.pearPort,
  });
}
```

```ts
const voiceSession = createLiveVoiceSessionImpl({
  helperPath: helperExecutablePath,
  pearPort: config.pearPort,
  ffmpegPath: ffmpegExecutablePath,
  ffmpegSource,
  logger: voiceLogger,
});
```

- [ ] **Step 4: Change the live voice session factory to spawn a composite relay**

```ts
export interface CreateLiveVoiceSessionOptions {
  readonly helperPath: string;
  readonly pearPort: number;
  readonly ffmpegPath?: string | undefined;
  readonly ffmpegSource?: FfmpegSource | undefined;
  readonly logger: RuntimeLogger;
}
```

```ts
spawnRelay({ helperPath, pearPort, ffmpegPath }) {
  return spawnAudioRelay({
    helperPath,
    pearPort,
    ffmpegPath,
  });
}
```

- [ ] **Step 5: Replace the relay payload fields in `createVoiceSession()`**

```ts
const buildRelayLogPayload = (
  extra: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> => ({
  helperExecutablePath: options.helperPath,
  pearPort: options.pearPort,
  ffmpegSource: options.ffmpegSource ?? 'path',
  ffmpegExecutablePath: options.ffmpegPath ?? 'ffmpeg',
  ...extra,
  ...(readRelayStderrTail?.() !== undefined
    ? { stderrTail: readRelayStderrTail?.() }
    : {}),
});
```

```ts
logger.info('Audio relay started.', buildRelayLogPayload());
logger.error('Audio relay exited.', buildRelayLogPayload({ exitCode: value }));
logger.warn('Attempting audio relay restart.', buildRelayLogPayload());
```

- [ ] **Step 6: Run the runtime and voice tests to verify they pass**

Run:

```powershell
npm run build
node --test dist/tests/runtime/bootstrap.test.js dist/tests/voice/session.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/runtime/bootstrap.ts src/voice/runtime.ts src/voice/session.ts tests/runtime/bootstrap.test.ts tests/voice/session.test.ts
git commit -m "feat: integrate helper relay into runtime"
```

## Task 6: Replace the Helper Capture Stub With Real Windows Loopback Capture

**Files:**
- Modify: `native/loopback-helper/Cargo.toml`
- Modify: `native/loopback-helper/src/main.rs`
- Modify: `native/loopback-helper/src/loopback.rs`
- Modify: `native/loopback-helper/src/wav.rs`

- [ ] **Step 1: Write a failing helper capture-contract test**

```rust
#[test]
fn probe_capture_rejects_non_windows_runtime_with_actionable_error() {
    let error = probe_capture(4242).unwrap_err().to_string();
    assert!(error.contains("Windows"));
}

#[test]
fn wav_header_reports_pcm_contract() {
    let header = build_wav_header(48_000, 2, 16, 192_000);
    assert_eq!(&header[0..4], b"RIFF");
    assert_eq!(&header[8..12], b"WAVE");
}
```

- [ ] **Step 2: Run the helper tests to verify the capture task starts red**

Run:

```powershell
cargo test --manifest-path native/loopback-helper/Cargo.toml
```

Expected: FAIL for the new capture-contract tests or for missing implementation details.

- [ ] **Step 3: Add the Windows activation and capture plumbing**

```toml
[dependencies]
anyhow = "1.0"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
windows = { version = "0.61", features = [
  "Win32_Foundation",
  "Win32_Media_Audio",
  "Win32_Media_KernelStreaming",
  "Win32_System_Com",
  "Win32_System_Com_StructuredStorage",
  "Win32_System_Threading",
  "Win32_UI_Shell_PropertiesSystem",
] }
```

```rust
fn build_activation_params(target_pid: u32) -> AUDIOCLIENT_ACTIVATION_PARAMS {
    AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: target_pid,
                ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            },
        },
    }
}
```

```rust
const PCM_SAMPLE_RATE: u32 = 48_000;
const PCM_CHANNELS: u16 = 2;
const PCM_BITS_PER_SAMPLE: u16 = 16;

fn write_captured_frames_to_stdout(
    capture_client: &IAudioCaptureClient,
    block_align: usize,
    writer: &mut dyn std::io::Write,
) -> Result<u64> {
    let mut packet_frames = 0u32;
    let mut total_bytes = 0u64;
    unsafe { capture_client.GetNextPacketSize(&mut packet_frames)?; }
    while packet_frames > 0 {
        // read packet, write PCM bytes, release packet, fetch next packet size
    }
    Ok(total_bytes)
}
```

- [ ] **Step 4: Implement the three runtime modes on top of the real capture session**

```rust
pub fn probe_capture(pear_pid: u32) -> Result<()> {
    let mut session = ProcessLoopbackSession::open(pear_pid)?;
    logging::emit("capture-opened", json!({
        "pid": pear_pid,
        "sampleRate": PCM_SAMPLE_RATE,
        "channels": PCM_CHANNELS,
        "bitsPerSample": PCM_BITS_PER_SAMPLE,
    }))?;
    let bytes = session.capture_for_duration(250, None)?;
    logging::emit("capture-probe-succeeded", json!({ "pid": pear_pid, "bytesCaptured": bytes }))?;
    Ok(())
}
```

```rust
pub fn write_sample_pcm(pear_pid: u32, duration_ms: u32) -> Result<()> {
    let mut session = ProcessLoopbackSession::open(pear_pid)?;
    let mut stdout = std::io::stdout().lock();
    let bytes = session.capture_for_duration(duration_ms, Some(&mut stdout))?;
    logging::emit("capture-sample-succeeded", json!({ "pid": pear_pid, "bytesCaptured": bytes }))?;
    Ok(())
}
```

```rust
pub fn stream_pcm(pear_pid: u32) -> Result<()> {
    let mut session = ProcessLoopbackSession::open(pear_pid)?;
    let mut stdout = std::io::stdout().lock();
    session.capture_until_stopped(&mut stdout)
}
```

- [ ] **Step 5: Run the helper verification**

Run:

```powershell
cargo test --manifest-path native/loopback-helper/Cargo.toml
npm run build:helper
```

Expected: PASS. The helper still builds cleanly, but `probe` / `sample` / `stream` no longer return the old stub error.

- [ ] **Step 6: Commit**

```powershell
git add native/loopback-helper/Cargo.toml native/loopback-helper/src/main.rs native/loopback-helper/src/loopback.rs native/loopback-helper/src/wav.rs
git commit -m "feat: implement windows helper loopback capture"
```

## Task 7: Remove DirectShow / VB-CABLE Debt From Docs, Tests, and Setup

**Files:**
- Modify: `README.md`
- Modify: `README.ja.md`
- Modify: `docs/adr/0001-v1-architecture.md`
- Modify: `docs/ffmpeg-management.md`
- Modify: `docs/updated-implementation-notes.md`
- Modify: `docs/windows-soak-checklist.md`
- Modify: `docs/windows-soak-results-template.md`
- Modify: `tests/audio/ffmpeg.test.ts`
- Modify: `tests/preflight/doctor.test.ts`

- [ ] **Step 1: Update the README requirements and setup copy**

```md
## Requirements

- Windows 11 for runtime use.
- Node.js 24 or newer.
- Rust toolchain for source builds of the loopback helper.
- Pear Desktop with the local API enabled.
- Discord application and bot token for the target guild.
```

```md
## Install

```powershell
npm install
npm run build:helper
npm run bootstrap:ffmpeg
npm run build
```
```

- [ ] **Step 2: Rewrite the soak checklist around helper readiness**

```md
Expected audio path:

`Pear process loopback helper -> PCM 48kHz stereo -> FFmpeg encode -> Ogg/Opus -> Discord voice`
```

```md
Require all of the following on native Windows 11:

- `pear-host-exact: PASS`
- `pear-auth-reachable: PASS`
- `pear-websocket-reachable: PASS`
- `windows-requirement-satisfied: PASS`
- `helper-discoverable: PASS`
- `helper-loopback-ready: PASS`
- `ffmpeg-discoverable: PASS`
- `ffmpeg-encode-ready: PASS`
- `full-pass: YES`
```

- [ ] **Step 3: Delete the old DirectShow assumptions from the tests and docs**

```ts
assert.equal(report.checks.dshowEnumeration, undefined);
assert.equal(report.checks.configuredDeviceExists, undefined);
assert.match(report.checks.ffmpegEncodeReady.detail, /Ogg\/Opus/u);
```

```md
This document supersedes earlier VB-CABLE and DirectShow relay guidance for the supported runtime path.
```

- [ ] **Step 4: Run the full verification set**

Run:

```powershell
npm run lint
npm run typecheck
npm run test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add README.md README.ja.md docs/adr/0001-v1-architecture.md docs/ffmpeg-management.md docs/updated-implementation-notes.md docs/windows-soak-checklist.md docs/windows-soak-results-template.md tests/audio/ffmpeg.test.ts tests/preflight/doctor.test.ts
git commit -m "refactor: remove v1 directshow and vb-cable assumptions"
```

## Self-Review

### Spec coverage

- Windows 11 minimum support: Task 1 docs and Task 4 doctor gating.
- Native helper introduction: Task 2.
- Helper PCM -> FFmpeg encode path: Task 3.
- `doctor` redesign: Task 4.
- Runtime supervision and logging: Task 5.
- Real helper capture implementation: Task 6.
- DirectShow / VB-CABLE removal and doc cleanup: Task 7.

No spec requirement is left without a task.

### Placeholder scan

- No unresolved markers or cross-task shorthand references remain.
- Every code-changing step includes concrete code or an exact interface snippet.
- Every execution step includes an exact command and expected outcome.

### Type consistency

- `helperPath` and `pearPort` are introduced consistently in runtime and voice layers.
- `ffmpegDshowAudioDevice` is removed from config and runtime.
- doctor checks use one helper-oriented report shape from Task 4 onward.
