import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { enrollDisplayName, stripAnsiEscapes } from '@cairn/shared';
import { z } from 'zod';
import type { MachineClient } from './machine-client.js';
import { writePrivateFile } from './private-fs.js';
import type { StatePaths } from './state.js';
import { loadMachineJson, saveMachineJson } from './state.js';

const ENROLL_TTL_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 2_000;
export const ENROLLMENT_PRINT_WAIT_MS = 15_000;

const pendingSchema = z.object({
  enrollId: z.string().min(1),
  url: z.string().min(1),
  code: z.string().optional(),
  pollSecret: z.string().min(1).optional(),
  expiresAt: z.number(),
  serverUrl: z.string().optional(),
  name: z.string().optional(),
  hostKey: z.string().optional(),
  legacyHostKeys: z.array(z.string()).optional(),
});

const enrollErrorSchema = z.object({
  serverUrl: z.string(),
  message: z.string().min(1),
  at: z.number(),
});

export type PendingEnrollment = z.infer<typeof pendingSchema>;

export type PendingEnrollmentOutcome =
  | { kind: 'pending'; url: string; code?: string }
  | { kind: 'enrolled' }
  | { kind: 'error'; message: string }
  | { kind: 'timeout' };

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

function enrollErrorPath(paths: StatePaths): string {
  return join(paths.home, 'enroll-error.json');
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

function readEnrollError(path: string): z.infer<typeof enrollErrorSchema> | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = enrollErrorSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function clearEnrollError(paths: StatePaths): void {
  rmSync(enrollErrorPath(paths), { force: true });
}

export function sanitizeEnrollErrorMessage(raw: string): string {
  const cleaned = stripAnsiEscapes(raw)
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'unknown error').slice(0, 300);
}

function recordEnrollError(paths: StatePaths, serverUrl: string, err: unknown, at: number): void {
  const message = sanitizeEnrollErrorMessage(err instanceof Error ? err.message : String(err));
  try {
    writePrivateFile(
      enrollErrorPath(paths),
      `${JSON.stringify({ serverUrl, message, at }, null, 2)}\n`,
    );
  } catch {}
}

export function formatApprovalCode(code: string): string {
  const clean = code.replace(/[\s-]+/g, '').toUpperCase();
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : code;
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
  hostKey?: string,
  legacyHostKeys?: readonly string[],
): Promise<EnrolledMachine> {
  const api = asEnrollApi(client);
  const path = pendingPath(paths);
  let pending = readPending(path);
  const normalizedLegacy = legacyHostKeys?.filter((key) => key !== hostKey) ?? [];
  if (
    pending !== null &&
    (pending.expiresAt <= io.now() ||
      pending.pollSecret === undefined ||
      (pending.serverUrl !== undefined && pending.serverUrl !== serverUrl) ||
      (pending.name !== undefined && pending.name !== name) ||
      (hostKey !== undefined && pending.hostKey !== hostKey))
  ) {
    rmSync(path, { force: true });
    pending = null;
  }
  if (pending === null) {
    clearEnrollError(paths);
    let started: Awaited<ReturnType<EnrollApi['enrollStart']>>;
    try {
      started = await api.enrollStart({
        name,
        ...(hostKey !== undefined ? { hostKey } : {}),
        ...(normalizedLegacy.length > 0 ? { legacyHostKeys: normalizedLegacy } : {}),
      });
    } catch (err) {
      recordEnrollError(paths, serverUrl, err, io.now());
      throw err;
    }
    pending = {
      enrollId: started.enrollId,
      url: started.url,
      ...(started.code !== undefined ? { code: started.code } : {}),
      ...(started.pollSecret !== undefined ? { pollSecret: started.pollSecret } : {}),
      expiresAt: io.now() + ENROLL_TTL_MS,
      serverUrl,
      name,
      ...(hostKey !== undefined ? { hostKey } : {}),
      ...(normalizedLegacy.length > 0 ? { legacyHostKeys: normalizedLegacy } : {}),
    };
    writePrivateFile(path, `${JSON.stringify(pending, null, 2)}\n`);
    io.log(
      `Open ${pending.url} and approve this machine${machineNameSuffix(name)} (expires in 10 minutes).`,
    );
  } else {
    clearEnrollError(paths);
    io.log(
      `Waiting for approval of the pending enrollment: ${pending.url}${machineNameSuffix(name)}`,
    );
  }
  if (pending.code !== undefined) {
    io.log(
      `Or type approval code ${formatApprovalCode(pending.code)} in Add Runner on the Cairn desktop.`,
    );
  }
  for (;;) {
    if (io.stop?.aborted === true) throw new Error('enrollment stopped before approval');
    const polled = await api.enrollPoll(pending.enrollId, pending.pollSecret);
    if (polled.status === 'authorized') {
      if (polled.machine === undefined) {
        rmSync(path, { force: true });
        throw new Error(
          'enrollment credentials were already claimed or missing poll secret; run start again',
        );
      }
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
        ...(hostKey !== undefined ? { hostKey } : {}),
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

export function machineNameSuffix(name: string): string {
  const shown = enrollDisplayName(name);
  return shown === undefined ? '' : ` (machine name: ${shown})`;
}

export async function waitForPendingEnrollment(
  paths: StatePaths,
  serverUrl: string,
  waitMs: number,
  sleep: (ms: number) => Promise<void>,
  now: () => number,
  name?: string,
  startedAt = 0,
): Promise<PendingEnrollmentOutcome> {
  const deadline = now() + waitMs;
  for (;;) {
    const pending = readPending(pendingPath(paths));
    if (
      pending !== null &&
      pending.expiresAt > now() &&
      (pending.serverUrl === undefined || pending.serverUrl === serverUrl) &&
      (pending.name === undefined || name === undefined || pending.name === name)
    ) {
      return {
        kind: 'pending',
        url: pending.url,
        ...(pending.code !== undefined ? { code: formatApprovalCode(pending.code) } : {}),
      };
    }
    if (loadMachineJson(paths) !== null) return { kind: 'enrolled' };
    const enrollError = readEnrollError(enrollErrorPath(paths));
    if (
      enrollError !== null &&
      enrollError.serverUrl === serverUrl &&
      enrollError.at >= startedAt
    ) {
      return { kind: 'error', message: sanitizeEnrollErrorMessage(enrollError.message) };
    }
    if (now() >= deadline) return { kind: 'timeout' };
    await sleep(200);
  }
}

export async function pendingEnrollmentUrl(
  paths: StatePaths,
  serverUrl: string,
  waitMs: number,
  sleep: (ms: number) => Promise<void>,
  now: () => number,
  name?: string,
): Promise<string | null> {
  const outcome = await waitForPendingEnrollment(paths, serverUrl, waitMs, sleep, now, name);
  return outcome.kind === 'pending' ? outcome.url : null;
}
