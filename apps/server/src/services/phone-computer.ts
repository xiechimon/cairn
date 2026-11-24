import {
  PHONE_AMBIGUOUS,
  PHONE_BUSY,
  PHONE_HANDOFF,
  PHONE_LOCKED,
  PHONE_NONE,
  PHONE_NOT_OWNER,
  PHONE_NOT_PAIRED,
  PHONE_PAIRING,
  PHONE_SIGNING_EXPIRED,
  PHONE_TOOL_NAMES,
  PHONE_UNREACHABLE,
  type PhoneActivity,
  type PhoneLinkState,
  type PhoneTool,
  phoneCallSummary,
} from '@cairn/shared';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefThread, computerCall, machine, phone, step } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import type { ComputerThread } from './computer-thread.js';
import { isOwner } from './instance-owner.js';
import type { MachineDeps } from './machine-deps.js';

export type PhoneRow = typeof phone.$inferSelect;
type MachineRow = typeof machine.$inferSelect;

const ACTIVITY_LIMIT = 200;

export function sanitizePhoneName(name: string): string {
  return name
    .replace(/[\p{Cc}\p{Cf}\\"'<>]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export function phoneLinkOf(host: MachineRow | undefined, deviceId: string): PhoneLinkState | null {
  const report = host?.capabilities?.phones?.find((entry) => entry.deviceId === deviceId);
  return report === undefined ? null : report.link;
}

function pairingInFlight(db: Db, phoneId: string): boolean {
  return db
    .select({ params: computerCall.params })
    .from(computerCall)
    .where(
      and(
        eq(computerCall.phoneId, phoneId),
        eq(computerCall.tool, 'phone_manage'),
        inArray(computerCall.state, ['dispatched', 'running']),
      ),
    )
    .all()
    .some((row) => row.params.action === 'pair');
}

export function machinePairingInFlight(db: Db, machineId: string): boolean {
  return db
    .select({ params: computerCall.params })
    .from(computerCall)
    .where(
      and(
        eq(computerCall.machineId, machineId),
        eq(computerCall.tool, 'phone_manage'),
        inArray(computerCall.state, ['dispatched', 'running']),
      ),
    )
    .all()
    .some((row) => row.params.action === 'pair');
}

export type JoinedRow = { row: PhoneRow; host: MachineRow | undefined };

function joinedPhones(db: Db, teamId: string): JoinedRow[] {
  const rows = db.select().from(phone).where(eq(phone.teamId, teamId)).all();
  const hosts = new Map(
    db
      .select()
      .from(machine)
      .where(eq(machine.teamId, teamId))
      .all()
      .map((row) => [row.id, row]),
  );
  return rows.map((row) => ({ row, host: hosts.get(row.machineId) }));
}

function liveOffered(deps: Pick<MachineDeps, 'db' | 'machineHub'>, joined: JoinedRow): boolean {
  if (joined.row.consentAt === null || joined.host === undefined) return false;
  if (!deps.machineHub.isConnected(joined.row.machineId)) return false;
  const link = phoneLinkOf(joined.host, joined.row.deviceId);
  return link === 'ready' || link === 'locked' || pairingInFlight(deps.db, joined.row.id);
}

export function offeredPhoneNames(
  deps: Pick<MachineDeps, 'db' | 'machineHub'>,
  threadId: string,
): string[] {
  const thread = deps.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
  if (thread === undefined || !isOwner(deps.db, thread.userId)) return [];
  return joinedPhones(deps.db, thread.teamId)
    .filter((joined) => liveOffered(deps, joined))
    .map((joined) => joined.row.name);
}

export type PhoneComputerTarget =
  | { kind: 'refused'; text: string }
  | {
      kind: 'ready';
      machineId: string;
      phoneId: string;
      deviceId: string;
      name: string;
      platform: 'android' | 'ios';
    };

export function resolveConsentedPhone(
  deps: Pick<MachineDeps, 'db' | 'machineHub'>,
  teamId: string,
  asked: string | null,
): { kind: 'refused'; text: string } | { kind: 'ready'; joined: JoinedRow } {
  const consented = joinedPhones(deps.db, teamId).filter((joined) => joined.row.consentAt !== null);
  if (consented.length === 0) return { kind: 'refused', text: PHONE_NONE };
  if (asked === null) {
    if (consented.length === 1) return { kind: 'ready', joined: consented[0]! };
    return {
      kind: 'refused',
      text: PHONE_AMBIGUOUS(consented.map((joined) => joined.row.name)),
    };
  }
  const matches = consented.filter(
    (joined) =>
      joined.row.name === asked ||
      joined.host?.capabilities?.phones?.find(
        (entry) => entry.deviceId === joined.row.deviceId && entry.name === asked,
      ) !== undefined,
  );
  if (matches.length === 0) return { kind: 'refused', text: PHONE_NOT_PAIRED };
  if (matches.length > 1)
    return {
      kind: 'refused',
      text: PHONE_AMBIGUOUS(matches.map((joined) => joined.row.name)),
    };
  return { kind: 'ready', joined: matches[0]! };
}

export function phoneComputerTarget(
  deps: Pick<MachineDeps, 'db' | 'machineHub'>,
  thread: ComputerThread,
  stepId: string,
  tool: PhoneTool,
  params: Record<string, unknown>,
): PhoneComputerTarget {
  if (!isOwner(deps.db, thread.userId)) return { kind: 'refused', text: PHONE_NOT_OWNER };
  const asked =
    typeof params.phone === 'string' && params.phone.trim() !== '' ? params.phone.trim() : null;
  const resolved = resolveConsentedPhone(deps, thread.teamId, asked);
  if (resolved.kind === 'refused') return resolved;
  const { row, host } = resolved.joined;
  if (row.handoffReason !== null) return { kind: 'refused', text: PHONE_HANDOFF };
  if (pairingInFlight(deps.db, row.id)) return { kind: 'refused', text: PHONE_PAIRING };
  const now = nowMs();
  const held =
    row.executionStepId !== null &&
    row.executionStepId !== stepId &&
    row.executionLeaseExpiresAt !== null &&
    row.executionLeaseExpiresAt > now;
  if (held) return { kind: 'refused', text: PHONE_BUSY };
  if (!deps.machineHub.isConnected(row.machineId))
    return { kind: 'refused', text: PHONE_UNREACHABLE };
  const link = phoneLinkOf(host, row.deviceId);
  if (link === 'signing_expired') return { kind: 'refused', text: PHONE_SIGNING_EXPIRED };
  if (link === 'locked') return { kind: 'refused', text: PHONE_LOCKED };
  if (link === 'ready') {
    return {
      kind: 'ready',
      machineId: row.machineId,
      phoneId: row.id,
      deviceId: row.deviceId,
      name: row.name,
      platform: row.platform,
    };
  }
  if (link === 'unauthorized' || link === 'seen')
    return { kind: 'refused', text: PHONE_NOT_PAIRED };
  return { kind: 'refused', text: PHONE_UNREACHABLE };
}

export function acquirePhoneLease(
  db: Db,
  phoneId: string,
  stepId: string,
  deadlineAt: number,
): void {
  const row = db.select().from(phone).where(eq(phone.id, phoneId)).get();
  if (!row) return;
  const now = nowMs();
  const held =
    row.executionStepId !== null &&
    row.executionStepId !== stepId &&
    row.executionLeaseExpiresAt !== null &&
    row.executionLeaseExpiresAt > now;
  if (held) return;
  const renewed = Math.max(now + 5 * 60_000, deadlineAt);
  db.update(phone)
    .set({
      executionStepId: stepId,
      executionLeaseExpiresAt: held ? Math.max(row.executionLeaseExpiresAt ?? 0, renewed) : renewed,
      executionFence: held ? row.executionFence : row.executionFence + 1,
      updatedAt: now,
    })
    .where(eq(phone.id, phoneId))
    .run();
}

export function phoneRecordOf(row: PhoneRow, db: Db) {
  const now = nowMs();
  return {
    id: row.id,
    machineId: row.machineId,
    platform: row.platform,
    deviceId: row.deviceId,
    name: row.name,
    consented: row.consentAt !== null,
    pairing: pairingInFlight(db, row.id),
    busy:
      row.executionStepId !== null &&
      row.executionLeaseExpiresAt !== null &&
      row.executionLeaseExpiresAt > now,
    handoff: row.handoffReason !== null,
    lastError: row.lastError,
    createdAt: row.createdAt,
  };
}

export function listPhones(db: Db, machineId: string) {
  return db
    .select()
    .from(phone)
    .where(eq(phone.machineId, machineId))
    .orderBy(phone.createdAt)
    .all()
    .map((row) => phoneRecordOf(row, db));
}

export function listPhoneActivity(db: Db, machineRow: MachineRow): PhoneActivity[] {
  return db
    .select({
      call: computerCall,
      phoneName: phone.name,
      threadId: chiefThread.id,
      threadTitle: chiefThread.title,
    })
    .from(computerCall)
    .leftJoin(phone, eq(phone.id, computerCall.phoneId))
    .leftJoin(step, eq(step.id, computerCall.stepId))
    .leftJoin(chiefThread, eq(chiefThread.id, step.buildId))
    .where(
      and(
        eq(computerCall.machineId, machineRow.id),
        inArray(computerCall.tool, [...PHONE_TOOL_NAMES]),
      ),
    )
    .orderBy(desc(computerCall.createdAt), sql`computer_call.rowid desc`)
    .limit(ACTIVITY_LIMIT)
    .all()
    .map(({ call, phoneName, threadId, threadTitle }) => ({
      callId: call.id,
      tool: call.tool as PhoneTool,
      phoneName,
      summary: phoneCallSummary(call.tool, call.params),
      state: call.state,
      exitCode: call.exitCode,
      error: call.errorMessage,
      threadId,
      threadTitle,
      createdAt: call.createdAt,
    }));
}

export function phoneRowsForPresence(
  db: Db,
  machineId: string,
): { deviceId: string; phoneId: string }[] {
  return db
    .select({ deviceId: phone.deviceId, phoneId: phone.id })
    .from(phone)
    .where(and(eq(phone.machineId, machineId), sql`${phone.consentAt} is not null`))
    .all();
}

export function handbackPhone(db: Db, phoneId: string): boolean {
  const row = db.select().from(phone).where(eq(phone.id, phoneId)).get();
  if (row === undefined || row.handoffReason === null) return false;
  db.update(phone)
    .set({
      handoffReason: null,
      handoffStepId: null,
      handoffRequestedAt: null,
      updatedAt: nowMs(),
    })
    .where(eq(phone.id, phoneId))
    .run();
  return true;
}

export function markPhoneHandoffIfNone(
  db: Db,
  phoneId: string,
  reason: 'login' | 'model',
  stepId: string,
  now: number,
): void {
  const row = db.select().from(phone).where(eq(phone.id, phoneId)).get();
  if (row === undefined || row.handoffReason !== null) return;
  db.update(phone)
    .set({ handoffReason: reason, handoffStepId: stepId, handoffRequestedAt: now, updatedAt: now })
    .where(eq(phone.id, phoneId))
    .run();
}

export function cancelPhoneCalls(db: Db, phoneId: string): void {
  db.update(computerCall)
    .set({ state: 'cancelled', finishedAt: nowMs() })
    .where(
      and(
        eq(computerCall.phoneId, phoneId),
        inArray(computerCall.state, ['dispatched', 'running']),
        isNull(computerCall.finishedAt),
      ),
    )
    .run();
}
