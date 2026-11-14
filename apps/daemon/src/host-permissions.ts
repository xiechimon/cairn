import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { type HostPermissions, hostPermissionsSchema } from '@cairn/shared';
import { z } from 'zod';
import { defaultAgentDesktopBinary } from './computer/host-screen.js';

export const HOST_PERMISSIONS_REFRESH_MS = 10 * 60_000;
const STATUS_TIMEOUT_MS = 15_000;

const statusOutputSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    permissions: z.object({
      accessibility: z.object({ state: z.string() }),
      automation: z.object({ state: z.string() }),
      screen_recording: z.object({ state: z.string() }),
    }),
  }),
});

export function parseAgentDesktopStatus(stdout: string): HostPermissions | undefined {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  const status = statusOutputSchema.safeParse(data);
  if (!status.success) return undefined;
  const report = hostPermissionsSchema.safeParse({
    accessibility: status.data.data.permissions.accessibility.state,
    automation: status.data.data.permissions.automation.state,
    screenRecording: status.data.data.permissions.screen_recording.state,
  });
  return report.success ? report.data : undefined;
}

export type RunStatus = () => Promise<string | null>;

const runStatus =
  (binary: string): RunStatus =>
  () =>
    new Promise((resolve) => {
      execFile(
        binary,
        ['status'],
        { timeout: STATUS_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
        (error, stdout) => resolve(error ? null : stdout),
      );
    });

export class HostPermissionsProbe {
  private report: HostPermissions | undefined;
  private checkedAt = Number.NEGATIVE_INFINITY;
  private running: Promise<void> | null = null;

  constructor(
    private readonly run: RunStatus = runStatus(defaultAgentDesktopBinary(homedir())),
    private readonly now: () => number = Date.now,
  ) {}

  current(): HostPermissions | undefined {
    if (this.running === null && this.now() - this.checkedAt >= HOST_PERMISSIONS_REFRESH_MS) {
      this.checkedAt = this.now();
      this.running = this.run().then((stdout) => {
        this.report = stdout === null ? undefined : parseAgentDesktopStatus(stdout);
        this.running = null;
      });
    }
    return this.report;
  }

  settled(): Promise<void> {
    return this.running ?? Promise.resolve();
  }
}
