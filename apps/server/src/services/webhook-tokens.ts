import { randomBytes } from 'node:crypto';
import { maskApiKey } from '@cairn/shared';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { webhookToken } from '../db/schema.js';
import { hashCredential } from '../lib/hash.js';
import { newRecordId, nowMs } from '../lib/ids.js';

export interface WebhookTokenDeps {
  db: Db;
}

type WebhookTokenRow = typeof webhookToken.$inferSelect;

export interface WebhookTokenRowView {
  id: string;
  name: string | null;
  masked: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export function toWebhookTokenRowView(row: WebhookTokenRow): WebhookTokenRowView {
  return {
    id: row.id,
    name: row.name,
    masked: row.masked,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

export function newWebhookTokenPlaintext(): string {
  return `cairn_wh_${randomBytes(18).toString('hex')}`;
}

export function listWebhookTokens(deps: WebhookTokenDeps, teamId: string): WebhookTokenRowView[] {
  return deps.db
    .select()
    .from(webhookToken)
    .where(eq(webhookToken.teamId, teamId))
    .orderBy(asc(webhookToken.createdAt))
    .all()
    .map(toWebhookTokenRowView);
}

export function createWebhookToken(
  deps: WebhookTokenDeps,
  input: { teamId: string; name?: string | null },
): WebhookTokenRowView & { plaintext: string } {
  const plaintext = newWebhookTokenPlaintext();
  const id = newRecordId();
  const createdAt = nowMs();
  deps.db
    .insert(webhookToken)
    .values({
      id,
      teamId: input.teamId,
      name: input.name ?? null,
      tokenHash: hashCredential(plaintext),
      masked: maskApiKey(plaintext),
      createdAt,
      lastUsedAt: null,
    })
    .run();
  return {
    id,
    name: input.name ?? null,
    masked: maskApiKey(plaintext),
    createdAt,
    lastUsedAt: null,
    plaintext,
  };
}

export function deleteWebhookToken(deps: WebhookTokenDeps, teamId: string, id: string): boolean {
  const row = deps.db
    .select({ id: webhookToken.id, teamId: webhookToken.teamId })
    .from(webhookToken)
    .where(eq(webhookToken.id, id))
    .get();
  if (!row || row.teamId !== teamId) return false;
  deps.db.delete(webhookToken).where(eq(webhookToken.id, id)).run();
  return true;
}

export function verifyWebhookToken(
  deps: WebhookTokenDeps,
  plaintext: string,
): (WebhookTokenRowView & { teamId: string }) | null {
  const row = deps.db
    .select()
    .from(webhookToken)
    .where(eq(webhookToken.tokenHash, hashCredential(plaintext)))
    .get();
  if (!row) return null;
  deps.db
    .update(webhookToken)
    .set({ lastUsedAt: nowMs() })
    .where(eq(webhookToken.id, row.id))
    .run();
  return { ...toWebhookTokenRowView(row), teamId: row.teamId };
}
