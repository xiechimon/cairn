import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { MachineClient } from './machine-client.js';
import { writePrivateFile } from './private-fs.js';
import type { StatePaths } from './state.js';
import { saveMachineJson } from './state.js';

const ENROLL_TTL_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 2_000;

const pendingSchema = z.object({
  enrollId: z.string().min(1),
  url: z.string().min(1),
  expiresAt: z.number(),
  serverUrl: z.string().optional(),
});

export type PendingEnrollment = z.infer<typeof pendingSchema>;

export interface EnrollIo {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
  stop?: AbortSignal;
}

export interface EnrolledMachine {
  machineId: string;
  token: string;
  teamId: string;
  serverUrl: string;
}

function pendingPath(paths: StatePaths): string {
  return join(paths.home, 'enroll.json');
}

function readPending(path: string): PendingEnrollment | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = pendingSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type EnrollApi = Pick<MachineClient, 'enrollStart' | 'enrollPoll'>;

function asEnrollApi(client: unknown): EnrollApi {
  const candidate = client as Partial<EnrollApi>;
  if (typeof candidate?.enrollStart !== 'function' || typeof candidate.enrollPoll !== 'function')
    throw new Error('this daemon client cannot start a browser enrollment');
  return candidate as EnrollApi;
}

export async function enrollThroughBrowser(
  client: unknown,
  paths: StatePaths,
  serverUrl: string,
  name: string,
  io: EnrollIo,
): Promise<EnrolledMachine> {
  const api = asEnrollApi(client);
  const path = pendingPath(paths);
  let pending = readPending(path);
  if (
    pending !== null &&
    (pending.expiresAt <= io.now() ||
      (pending.serverUrl !== undefined && pending.serverUrl !== serverUrl))
  ) {
    rmSync(path, { force: true });
    pending = null;
  }
  if (pending === null) {
    const started = await api.enrollStart({ name });
    pending = {
      enrollId: started.enrollId,
      url: started.url,
      expiresAt: io.now() + ENROLL_TTL_MS,
      serverUrl,
    };
    writePrivateFile(path, `${JSON.stringify(pending, null, 2)}\n`);
    io.log(`Open ${pending.url} and approve this machine (expires in 10 minutes).`);
  } else {
    io.log(`Waiting for approval of the pending enrollment: ${pending.url}`);
  }
  for (;;) {
    if (io.stop?.aborted === true) throw new Error('enrollment stopped before approval');
    const polled = await api.enrollPoll(pending.enrollId);
    if (polled.status === 'authorized') {
      if (existsSync(paths.machineJson))
        throw new Error('machine.json appeared during enrollment: refusing to overwrite it');
      const machine: EnrolledMachine = {
        machineId: polled.machine.machineId,
        token: polled.machine.token,
        teamId: polled.machine.teamId,
        serverUrl: polled.machine.serverUrl,
      };
      saveMachineJson(paths, {
        machineId: machine.machineId,
        token: machine.token,
        teamId: machine.teamId,
        serverUrl: machine.serverUrl,
      });
      rmSync(path, { force: true });
      return machine;
    }
    if (polled.status === 'expired') {
      rmSync(path, { force: true });
      throw new Error(
        'enrollment expired: nobody approved this machine within 10 minutes; run start again',
      );
    }
    if (io.now() >= pending.expiresAt) {
      rmSync(path, { force: true });
      throw new Error(
        'enrollment expired: nobody approved this machine within 10 minutes; run start again',
      );
    }
    await io.sleep(POLL_INTERVAL_MS);
  }
}

export async function pendingEnrollmentUrl(
  paths: StatePaths,
  serverUrl: string,
  waitMs: number,
  sleep: (ms: number) => Promise<void>,
  now: () => number,
): Promise<string | null> {
  const deadline = now() + waitMs;
  for (;;) {
    const pending = readPending(pendingPath(paths));
    if (
      pending !== null &&
      pending.expiresAt > now() &&
      (pending.serverUrl === undefined || pending.serverUrl === serverUrl)
    )
      return pending.url;
    if (now() >= deadline) return null;
    await sleep(200);
  }
}
