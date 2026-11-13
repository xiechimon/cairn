import { randomBytes } from 'node:crypto';
import {
  DEVICE_TOKEN_PREFIX,
  maskDeviceToken,
  PAIRED_DEVICE_CAP,
  PAIRING_CODE_CAP,
  PAIRING_CODE_TTL_MS,
  type PairedDevice,
} from '@cairn/shared';
import { and, asc, count, eq, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { pairedDevice, pairingGrant, pushSubscription } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { hashCredential } from '../lib/hash.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { issueBrowserSession } from './browser-session.js';

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

export interface DeviceStreamRegistry {
  bind(deviceId: string | null, close: () => void): () => void;
  closeAll(deviceId: string): void;
  isRevoked(deviceId: string | null): boolean;
  size(): number;
}

const REVOKED_MEMORY = 1000;

export function createDeviceStreamRegistry(): DeviceStreamRegistry {
  const open = new Map<string, Set<() => void>>();
  const revoked = new Set<string>();
  return {
    bind(deviceId, close) {
      if (deviceId === null) return () => {};
      const closers = open.get(deviceId) ?? new Set<() => void>();
      closers.add(close);
      open.set(deviceId, closers);
      return () => {
        closers.delete(close);
        if (closers.size === 0) open.delete(deviceId);
      };
    },
    closeAll(deviceId) {
      revoked.add(deviceId);
      if (revoked.size > REVOKED_MEMORY) {
        const oldest = revoked.values().next().value;
        if (oldest !== undefined) revoked.delete(oldest);
      }
      for (const close of [...(open.get(deviceId) ?? [])]) close();
      open.delete(deviceId);
    },
    isRevoked: (deviceId) => deviceId !== null && revoked.has(deviceId),
    size: () => [...open.values()].reduce((total, closers) => total + closers.size, 0),
  };
}

export const deviceStreams = createDeviceStreamRegistry();

export function assertDeviceActive(deviceId: string | null): void {
  if (deviceStreams.isRevoked(deviceId)) throw new HttpError(401, 'this device was revoked');
}

export function pairedDeviceExists(db: Db, id: string): boolean {
  return (
    db.select({ id: pairedDevice.id }).from(pairedDevice).where(eq(pairedDevice.id, id)).get() !==
    undefined
  );
}

export interface IssuedPairingGrant {
  id: string;
  code: string;
  expiresAt: number;
}

export interface PairingGrantView {
  id: string;
  expiresAt: number;
  createdAt: number;
}

export function issuePairingGrant(db: Db, now = nowMs()): IssuedPairingGrant {
  db.delete(pairingGrant)
    .where(
      or(
        isNotNull(pairingGrant.revokedAt),
        isNotNull(pairingGrant.redeemedAt),
        lte(pairingGrant.expiresAt, now),
      ),
    )
    .run();
  const active = db
    .select()
    .from(pairingGrant)
    .where(and(isNull(pairingGrant.revokedAt), isNull(pairingGrant.redeemedAt)))
    .all()
    .filter((row) => row.expiresAt > now);
  const overflow = active.length - PAIRING_CODE_CAP + 1;
  if (overflow > 0) {
    for (const row of active.slice(0, overflow)) {
      db.update(pairingGrant).set({ revokedAt: now }).where(eq(pairingGrant.id, row.id)).run();
    }
  }
  const code = randomBytes(CODE_BYTES).toString('base64url');
  const id = newRecordId();
  const expiresAt = now + PAIRING_CODE_TTL_MS;
  db.insert(pairingGrant)
    .values({ id, codeHash: hashCredential(code), expiresAt, createdAt: now })
    .run();
  return { id, code, expiresAt };
}

export function listPairingGrants(db: Db, now = nowMs()): PairingGrantView[] {
  return db
    .select()
    .from(pairingGrant)
    .where(and(isNull(pairingGrant.revokedAt), isNull(pairingGrant.redeemedAt)))
    .all()
    .filter((row) => row.expiresAt > now)
    .map((row) => ({ id: row.id, expiresAt: row.expiresAt, createdAt: row.createdAt }));
}

export function revokePairingGrant(db: Db, id: string, now = nowMs()): boolean {
  const row = db.select().from(pairingGrant).where(eq(pairingGrant.id, id)).get();
  if (row === undefined || row.revokedAt !== null || row.redeemedAt !== null) return false;
  db.update(pairingGrant).set({ revokedAt: now }).where(eq(pairingGrant.id, id)).run();
  return true;
}

export function pairFromGrant(
  db: Db,
  input: { code: string; teamId: string; name: string },
): { device: PairedDevice; token: string; sessionToken: string } | null {
  return db.transaction((tx) => {
    if (!hasRoomForDevice(tx)) {
      throw new HttpError(409, 'too many paired devices; revoke one first');
    }
    if (!redeemPairingGrant(tx, input.code)) return null;
    const created = createPairedDevice(tx, { teamId: input.teamId, name: input.name });
    const session = issueBrowserSession(tx, 'device', created.device.id);
    return { device: created.device, token: created.token, sessionToken: session.token };
  });
}

export function redeemPairingGrant(db: Db, code: string, now = nowMs()): boolean {
  const row = db
    .select()
    .from(pairingGrant)
    .where(eq(pairingGrant.codeHash, hashCredential(code)))
    .get();
  if (row === undefined || row.revokedAt !== null || row.redeemedAt !== null) return false;
  if (row.expiresAt <= now) return false;
  db.update(pairingGrant).set({ redeemedAt: now }).where(eq(pairingGrant.id, row.id)).run();
  return true;
}

export function revokePairedDevice(db: Db, teamId: string, id: string): boolean {
  const row = db.select().from(pairedDevice).where(eq(pairedDevice.id, id)).get();
  if (row === undefined || row.teamId !== teamId) return false;
  db.transaction((tx) => {
    tx.delete(pushSubscription).where(eq(pushSubscription.pairedDeviceId, id)).run();
    tx.delete(pairedDevice).where(eq(pairedDevice.id, id)).run();
  });
  deviceStreams.closeAll(id);
  return true;
}

export function pairedDeviceIdOfToken(db: Db, plaintext: string, now = nowMs()): string | null {
  if (!plaintext.startsWith(DEVICE_TOKEN_PREFIX)) return null;
  const row = db
    .select()
    .from(pairedDevice)
    .where(eq(pairedDevice.tokenHash, hashCredential(plaintext)))
    .get();
  if (row === undefined) return null;
  if (row.lastSeenAt === null || now - row.lastSeenAt >= LAST_SEEN_RESOLUTION_MS) {
    db.update(pairedDevice).set({ lastSeenAt: now }).where(eq(pairedDevice.id, row.id)).run();
  }
  return row.id;
}
