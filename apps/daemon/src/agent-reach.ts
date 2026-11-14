import { execFile } from 'node:child_process';
import { type AgentReachReport, agentReachReportSchema } from '@cairn/shared';
import { z } from 'zod';

export const AGENT_REACH_BINARY = 'agent-reach';
export const AGENT_REACH_REFRESH_MS = 10 * 60_000;
const DOCTOR_TIMEOUT_MS = 15_000;

const doctorOutputSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    version: z.string(),
    channels: z.array(z.object({ channel: z.string(), status: z.string() })),
  }),
});

export function parseAgentReachDoctor(stdout: string): AgentReachReport | undefined {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  const doctor = doctorOutputSchema.safeParse(data);
  if (!doctor.success) return undefined;
  const report = agentReachReportSchema.safeParse({
    version: doctor.data.result.version,
    channels: doctor.data.result.channels.map(({ channel, status }) => ({ channel, status })),
  });
  return report.success ? report.data : undefined;
}

export type RunDoctor = () => Promise<string | null>;

const runDoctor: RunDoctor = () =>
  new Promise((resolve) => {
    execFile(
      AGENT_REACH_BINARY,
      ['doctor'],
      { timeout: DOCTOR_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (error, stdout) => resolve(error ? null : stdout),
    );
  });

export class AgentReachProbe {
  private report: AgentReachReport | undefined;
  private checkedAt = Number.NEGATIVE_INFINITY;
  private running: Promise<void> | null = null;

  constructor(
    private readonly run: RunDoctor = runDoctor,
    private readonly now: () => number = Date.now,
  ) {}

  current(): AgentReachReport | undefined {
    if (this.running === null && this.now() - this.checkedAt >= AGENT_REACH_REFRESH_MS) {
      this.checkedAt = this.now();
      this.running = this.run().then((stdout) => {
        this.report = stdout === null ? undefined : parseAgentReachDoctor(stdout);
        this.running = null;
      });
    }
    return this.report;
  }

  settled(): Promise<void> {
    return this.running ?? Promise.resolve();
  }
}
