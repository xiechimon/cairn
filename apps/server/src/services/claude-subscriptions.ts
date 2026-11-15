import type {
  ClaudeSubscription,
  ClaudeSubscriptionVerifyResult,
  CreateClaudeSubscription,
  SecretBox,
} from '@cairn/shared';
import { and, desc, eq, gt, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { claudeSubscription } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { verifyClaudeSubscription } from './claude-subscription-verification.js';

type Deps = { db: Db; box: SecretBox };
type Row = typeof claudeSubscription.$inferSelect;

const verificationWindows = new WeakMap<Db, Map<string, number>>();

function toRecord(row: Row): ClaudeSubscription {
  return {
    id: row.id,
    kind: 'claude-subscription',
    label: row.label,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

export function listClaudeSubscriptions(deps: Deps, teamId: string): ClaudeSubscription[] {
  return deps.db
    .select()
    .from(claudeSubscription)
    .where(eq(claudeSubscription.teamId, teamId))
    .orderBy(desc(claudeSubscription.createdAt), desc(claudeSubscription.id))
    .all()
    .map(toRecord);
}

export function createClaudeSubscription(
  deps: Deps,
  teamId: string,
  body: CreateClaudeSubscription,
): ClaudeSubscription {
  if (body.label.includes(body.token))
    throw new HttpError(400, 'Connection label must not contain the token');
  const now = nowMs();
  const row = {
    id: newRecordId(),
    teamId,
    label: body.label,
    tokenCipher: deps.box.seal(body.token),
    expiresAt: body.expiresAt ?? null,
    enabledAt: null as number | null,
    createdAt: now,
  };
  deps.db.transaction((tx) => {
    tx.update(claudeSubscription)
      .set({ enabledAt: null })
      .where(
        and(
          eq(claudeSubscription.teamId, teamId),
          isNotNull(claudeSubscription.enabledAt),
          isNotNull(claudeSubscription.expiresAt),
          lte(claudeSubscription.expiresAt, now),
        ),
      )
      .run();
    row.enabledAt = activeSubscriptionRow({ db: tx }, teamId) === undefined ? now : null;
    tx.insert(claudeSubscription).values(row).run();
  });
  return toRecord(row);
}

export async function verifySubscriptionConnection(
  deps: Deps,
  teamId: string,
  id: string,
): Promise<ClaudeSubscriptionVerifyResult> {
  const row = deps.db
    .select()
    .from(claudeSubscription)
    .where(and(eq(claudeSubscription.teamId, teamId), eq(claudeSubscription.id, id)))
    .get();
  if (!row) throw notFound('Claude subscription connection');
  if (row.expiresAt !== null && row.expiresAt <= nowMs()) return { ok: false };
  const now = nowMs();
  const windows = verificationWindows.get(deps.db) ?? new Map<string, number>();
  for (const [connectionId, retryAt] of windows) {
    if (retryAt <= now) windows.delete(connectionId);
  }
  if (windows.has(row.id)) {
    throw new HttpError(
      429,
      'Please wait 10 seconds between verification attempts for this connection.',
    );
  }
  windows.set(row.id, now + 10_000);
  verificationWindows.set(deps.db, windows);
  try {
    return await verifyClaudeSubscription(deps.box.open(row.tokenCipher));
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

export function openClaudeSubscription(
  deps: Deps,
  teamId: string,
  provider: string | null | undefined,
  boundSubscriptionId: string | null | undefined,
): string | undefined {
  if (provider !== 'claude-code' || !boundSubscriptionId) return undefined;
  const row = deps.db
    .select()
    .from(claudeSubscription)
    .where(
      and(
        eq(claudeSubscription.teamId, teamId),
        eq(claudeSubscription.id, boundSubscriptionId),
        or(isNull(claudeSubscription.expiresAt), gt(claudeSubscription.expiresAt, nowMs())),
      ),
    )
    .get();
  return row ? deps.box.open(row.tokenCipher) : undefined;
}

export function enabledSubscriptionId(
  deps: { db: Pick<Db, 'select'> },
  teamId: string,
): string | null {
  return activeSubscriptionRow(deps, teamId)?.id ?? null;
}

export function hasActiveClaudeSubscription(
  deps: { db: Pick<Db, 'select'> },
  teamId: string,
): boolean {
  return activeSubscriptionRow(deps, teamId) !== undefined;
}

function activeSubscriptionRow(deps: { db: Pick<Db, 'select'> }, teamId: string): Row | undefined {
  return deps.db
    .select()
    .from(claudeSubscription)
    .where(
      and(
        eq(claudeSubscription.teamId, teamId),
        isNotNull(claudeSubscription.enabledAt),
        or(isNull(claudeSubscription.expiresAt), gt(claudeSubscription.expiresAt, nowMs())),
      ),
    )
    .get();
}

export function deleteClaudeSubscription(deps: { db: Db }, teamId: string, id: string): boolean {
  return (
    deps.db
      .delete(claudeSubscription)
      .where(and(eq(claudeSubscription.teamId, teamId), eq(claudeSubscription.id, id)))
      .run().changes > 0
  );
}
