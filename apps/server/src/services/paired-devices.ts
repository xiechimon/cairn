import { randomBytes } from 'node:crypto';
import {
  DEVICE_TOKEN_PREFIX,
  maskDeviceToken,
  PAIRED_DEVICE_CAP,
  PAIRING_CODE_CAP,
  PAIRING_CODE_TTL_MS,
  type PairedDevice,
} from '@cairn/shared';
import { asc, count, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { pairedDevice } from '../db/schema.js';
import { hashCredential } from '../lib/hash.js';
import { newRecordId, nowMs } from '../lib/ids.js';

const LAST_SEEN_RESOLUTION_MS = 60_000;
const CODE_BYTES = 24;
const TOKEN_BYTES = 32;

export interface IssuedPairingCode {
  code: string;
  expiresAt: number;
}

export interface PairingBook {
  issue(now?: number): IssuedPairingCode;
  redeem(code: string, now?: number): boolean;
  size(): number;
}

export function createPairingBook(): PairingBook {
  const pending = new Map<string, number>();
  const sweep = (now: number): void => {
    for (const [hash, expiresAt] of pending) {
      if (expiresAt <= now) pending.delete(hash);
    }
  };
  return {
    issue(now = nowMs()) {
      sweep(now);
      while (pending.size >= PAIRING_CODE_CAP) {
        const oldest = pending.keys().next().value;
        if (oldest === undefined) break;
        pending.delete(oldest);
      }
      const code = randomBytes(CODE_BYTES).toString('base64url');
      const expiresAt = now + PAIRING_CODE_TTL_MS;
      pending.set(hashCredential(code), expiresAt);
      return { code, expiresAt };
    },
    redeem(code, now = nowMs()) {
      const hash = hashCredential(code);
      const expiresAt = pending.get(hash);
      if (expiresAt === undefined) return false;
      pending.delete(hash);
      return expiresAt > now;
    },
    size: () => pending.size,
  };
}

function toView(row: typeof pairedDevice.$inferSelect): PairedDevice {
  return {
    id: row.id,
    name: row.name,
    masked: row.masked,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
  };
}

export function pairedDeviceCount(db: Db): number {
  return db.select({ n: count() }).from(pairedDevice).get()?.n ?? 0;
}

export function hasRoomForDevice(db: Db): boolean {
  return pairedDeviceCount(db) < PAIRED_DEVICE_CAP;
}

export function createPairedDevice(
  db: Db,
  input: { teamId: string; name: string },
): { device: PairedDevice; token: string } {
  const token = `${DEVICE_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('hex')}`;
  const row = {
    id: newRecordId(),
    teamId: input.teamId,
    name: input.name,
    tokenHash: hashCredential(token),
    masked: maskDeviceToken(token),
    createdAt: nowMs(),
    lastSeenAt: null,
  };
  db.insert(pairedDevice).values(row).run();
  return { device: toView(row), token };
}

export function listPairedDevices(db: Db, teamId: string): PairedDevice[] {
  return db
    .select()
    .from(pairedDevice)
    .where(eq(pairedDevice.teamId, teamId))
    .orderBy(asc(pairedDevice.createdAt))
    .all()
    .map(toView);
}

export function revokePairedDevice(db: Db, teamId: string, id: string): boolean {
  const row = db.select().from(pairedDevice).where(eq(pairedDevice.id, id)).get();
  if (row === undefined || row.teamId !== teamId) return false;
  db.delete(pairedDevice).where(eq(pairedDevice.id, id)).run();
  return true;
}

export function isPairedDeviceToken(db: Db, plaintext: string, now = nowMs()): boolean {
  if (!plaintext.startsWith(DEVICE_TOKEN_PREFIX)) return false;
  const row = db
    .select()
    .from(pairedDevice)
    .where(eq(pairedDevice.tokenHash, hashCredential(plaintext)))
    .get();
  if (row === undefined) return false;
  if (row.lastSeenAt === null || now - row.lastSeenAt >= LAST_SEEN_RESOLUTION_MS) {
    db.update(pairedDevice).set({ lastSeenAt: now }).where(eq(pairedDevice.id, row.id)).run();
  }
  return true;
}
