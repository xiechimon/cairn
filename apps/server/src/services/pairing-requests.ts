import { randomBytes } from 'node:crypto';
import {
  PAIRING_CODE_TTL_MS,
  PAIRING_REQUEST_CAP,
  PAIRING_REQUEST_CLAIM_GRACE_MS,
  PAIRING_REQUEST_RATE_CAP,
  PAIRING_REQUEST_RATE_WINDOW_MS,
  type PairedDevice,
  type PairingRequestView,
  type PairRequestSource,
} from '@cairn/shared';
import { and, asc, count, eq, gt, gte, isNull, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { pairingRequest } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { hashCredential } from '../lib/hash.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { browserJustSignedIn, issueBrowserSession } from './browser-session.js';
import { createPairedDevice, hasRoomForDevice } from './paired-devices.js';

const SECRET_BYTES = 32;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CODE_ATTEMPTS = 8;

type RequestRow = typeof pairingRequest.$inferSelect;

function toView(row: RequestRow): PairingRequestView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    detail: row.detail,
    source: row.source as PairRequestSource,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

function liveRows(db: Db, now: number): RequestRow[] {
  return db
    .select()
    .from(pairingRequest)
    .where(eq(pairingRequest.status, 'pending'))
    .orderBy(asc(pairingRequest.createdAt))
    .all()
    .filter((row) => row.expiresAt > now);
}

function newCode(taken: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const code = [...randomBytes(CODE_LENGTH)].map((b) => CODE_ALPHABET[b & 31]).join('');
    if (!taken.has(code)) return code;
  }
  throw new HttpError(409, 'could not draw a distinct pairing code; try again');
}

export interface IssuedPairRequest {
  id: string;
  secret: string;
  code: string;
  expiresAt: number;
}

export function createPairRequest(
  db: Db,
  input: {
    name: string;
    detail?: string | undefined;
    source: PairRequestSource;
    peer: string;
    browserMarkHash: string | null;
    fromSignedInBrowser: boolean;
  },
  now = nowMs(),
): IssuedPairRequest {
  return db.transaction((tx) => {
    tx.delete(pairingRequest)
      .where(lte(pairingRequest.createdAt, now - PAIRING_REQUEST_RATE_WINDOW_MS))
      .run();
    const created = tx
      .select({ n: count() })
      .from(pairingRequest)
      .where(
        and(
          eq(pairingRequest.peer, input.peer),
          gte(pairingRequest.createdAt, now - PAIRING_REQUEST_RATE_WINDOW_MS),
        ),
      )
      .get()?.n;
    if ((created ?? 0) >= PAIRING_REQUEST_RATE_CAP) {
      throw new HttpError(429, 'too many pairing requests from this source; wait and retry');
    }
    const live = tx
      .select()
      .from(pairingRequest)
      .where(eq(pairingRequest.status, 'pending'))
      .all()
      .filter((row) => row.expiresAt > now);
    if (live.length >= PAIRING_REQUEST_CAP) {
      throw new HttpError(429, 'too many pending pairing requests; wait and retry');
    }
    const bornVoid =
      input.fromSignedInBrowser ||
      (input.browserMarkHash !== null && browserJustSignedIn(tx, input.browserMarkHash, now));
    for (const row of live.filter((item) => !bornVoid && item.peer === input.peer)) {
      tx.update(pairingRequest)
        .set({ status: 'superseded', decidedAt: now })
        .where(eq(pairingRequest.id, row.id))
        .run();
    }
    const secret = randomBytes(SECRET_BYTES).toString('base64url');
    const code = newCode(new Set(live.map((row) => row.code)));
    const expiresAt = now + PAIRING_CODE_TTL_MS;
    const id = newRecordId();
    tx.insert(pairingRequest)
      .values({
        id,
        secretHash: hashCredential(secret),
        code,
        name: input.name,
        detail: input.detail ?? null,
        source: input.source,
        peer: input.peer,
        status: bornVoid ? 'superseded' : 'pending',
        expiresAt,
        createdAt: now,
        browserMarkHash: input.browserMarkHash,
      })
      .run();
    return { id, secret, code, expiresAt };
  });
}

export function listPairRequests(db: Db, now = nowMs()): PairingRequestView[] {
  return liveRows(db, now).map(toView);
}

export function decidePairRequest(
  db: Db,
  id: string,
  decision: 'approved' | 'denied',
  now = nowMs(),
): 'ok' | 'missing' | 'decided' {
  const row = db.select().from(pairingRequest).where(eq(pairingRequest.id, id)).get();
  if (row === undefined) return 'missing';
  if (row.status !== 'pending' || row.expiresAt <= now) return 'decided';
  const changed =
    db
      .update(pairingRequest)
      .set({
        status: decision,
        decidedAt: now,
        ...(decision === 'approved' ? { expiresAt: now + PAIRING_REQUEST_CLAIM_GRACE_MS } : {}),
      })
      .where(
        and(
          eq(pairingRequest.id, id),
          eq(pairingRequest.status, 'pending'),
          gt(pairingRequest.expiresAt, now),
        ),
      )
      .run().changes === 1;
  return changed ? 'ok' : 'decided';
}

export type PairClaimOutcome =
  | { status: 'pending' }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'missing' }
  | {
      status: 'approved';
      device: PairedDevice;
      token: string;
      sessionToken: string;
      sessionExpiresAt: number;
    };

export function claimPairRequest(
  db: Db,
  input: { id: string; secret: string; teamId: string; browserMarkHash: string | null },
  now = nowMs(),
): PairClaimOutcome {
  const row = db.select().from(pairingRequest).where(eq(pairingRequest.id, input.id)).get();
  if (
    row === undefined ||
    row.secretHash !== hashCredential(input.secret) ||
    row.status === 'consumed'
  ) {
    return { status: 'missing' };
  }
  if (row.status === 'denied') return { status: 'denied' };
  if (row.status === 'superseded' || row.expiresAt <= now) return { status: 'expired' };
  if (row.status === 'pending') return { status: 'pending' };
  return db.transaction((tx) => {
    if (!hasRoomForDevice(tx)) {
      throw new HttpError(409, 'too many paired devices; revoke one first');
    }
    const claimed =
      tx
        .update(pairingRequest)
        .set({ status: 'consumed', decidedAt: now })
        .where(
          and(
            eq(pairingRequest.id, row.id),
            eq(pairingRequest.status, 'approved'),
            gt(pairingRequest.expiresAt, now),
            isNull(pairingRequest.deviceId),
          ),
        )
        .run().changes === 1;
    if (!claimed) return { status: 'missing' } as const;
    const created = createPairedDevice(tx, { teamId: input.teamId, name: row.name });
    tx.update(pairingRequest)
      .set({ deviceId: created.device.id })
      .where(eq(pairingRequest.id, row.id))
      .run();
    const session = issueBrowserSession(tx, 'device', created.device.id, input.browserMarkHash);
    return {
      status: 'approved',
      device: created.device,
      token: created.token,
      sessionToken: session.token,
      sessionExpiresAt: session.expiresAt,
    } as const;
  });
}
