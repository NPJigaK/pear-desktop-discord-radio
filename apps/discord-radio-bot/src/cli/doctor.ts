#!/usr/bin/env node

import { loadLocalEnvIfPresent } from './env.js';
import { loadDoctorConfig, runDoctor } from '../preflight/index.js';
import type { DoctorReport } from '../preflight/index.js';

const CHECK_LABELS = {
  pearHostExact: 'pear-host-exact',
  pearAuthReachable: 'pear-auth-reachable',
  pearWebSocketReachable: 'pear-websocket-reachable',
  windowsRequirementSatisfied: 'windows-requirement-satisfied',
  exportProviderReady: 'export-provider-ready',
  exportPcmContractReady: 'export-pcm-contract-ready',
  ffmpegDiscoverable: 'ffmpeg-discoverable',
  ffmpegEncodeReady: 'ffmpeg-encode-ready',
} as const;

function formatStatus(status: 'pass' | 'fail' | 'unsupported'): string {
  return status.toUpperCase();
}

function formatCheckDetail(
  key: keyof typeof CHECK_LABELS,
  check: NonNullable<
    DoctorReport['checks'][keyof typeof CHECK_LABELS]
  >,
): string {
  if (
    key === 'ffmpegDiscoverable' &&
    'source' in check &&
    'executablePath' in check &&
    check.source !== undefined &&
    check.executablePath !== undefined
  ) {
    return `${check.detail} (source: ${check.source}, path: ${check.executablePath})`;
  }

  if (key === 'exportProviderReady') {
    const suffix: string[] = [];
    if ('sessionId' in check && check.sessionId !== undefined) {
      suffix.push(`session-id: ${check.sessionId}`);
    }
    if ('bootstrapPath' in check && check.bootstrapPath !== undefined) {
      suffix.push(`bootstrap-path: ${check.bootstrapPath}`);
    }
    if ('pipePath' in check && check.pipePath !== undefined) {
      suffix.push(`pipe-path: ${check.pipePath}`);
    }
    if ('streamState' in check && check.streamState !== undefined) {
      suffix.push(`stream-state: ${check.streamState}`);
    }
    if ('droppedFrameCount' in check && check.droppedFrameCount !== undefined) {
      suffix.push(`dropped-frames: ${check.droppedFrameCount}`);
    }
    if (suffix.length > 0) {
      return `${check.detail} (${suffix.join(', ')})`;
    }
  }

  return check.detail;
}

async function main(): Promise<void> {
  loadLocalEnvIfPresent();
  const config = loadDoctorConfig(process.env);
  const report = await runDoctor(config);

  console.log(`platform: ${report.platform}`);

  for (const [key, label] of Object.entries(CHECK_LABELS)) {
    const check = report.checks[key as keyof typeof report.checks];
    if (check === undefined) {
      continue;
    }
    console.log(
      `${label}: ${formatStatus(check.status)} - ${formatCheckDetail(
        key as keyof typeof CHECK_LABELS,
        check,
      )}`,
    );

    if (
      key === 'ffmpegDiscoverable' &&
      'attempts' in check &&
      Array.isArray(check.attempts)
    ) {
      for (const attempt of check.attempts) {
        console.log(
          `  ffmpeg-attempt[${attempt.source}]: ${attempt.status.toUpperCase()} - ${attempt.executablePath} - ${attempt.detail}`,
        );
      }
    }
  }

  console.log(`full-pass: ${report.fullPass ? 'YES' : 'NO'}`);
  process.exitCode = report.fullPass ? 0 : 1;
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`doctor failed: ${detail}`);
  process.exitCode = 1;
});
