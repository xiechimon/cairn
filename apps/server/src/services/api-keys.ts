import { randomBytes } from 'node:crypto';
import type { ApiKeyRow as SharedApiKeyRow } from '@cairn/shared';
import { BRAND, maskApiKey } from '@cairn/shared';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { apiKey } from '../db/schema.js';
import { hashCredential } from '../lib/hash.js';
import { newRecordId, nowMs } from '../lib/ids.js';

export interface ApiKeyDeps {
  db: Db;
}

type ApiKeyRow = typeof apiKey.$inferSelect;

export type ApiKeyRowView = SharedApiKeyRow;

export function toApiKeyRowView(row: ApiKeyRow): ApiKeyRowView {
  return {
    id: row.id,
    name: row.name,
    gitAccess: row.gitAccess,
    mcpAccess: row.mcpAccess,
    machineAccess: row.machineAccess,
    toolGrants: row.toolGrants,
    masked: row.masked,
    createdAt: row.createdAt,
  };
}

export function newApiKeyPlaintext(): string {
  return `${BRAND.apiKeyPrefix}${randomBytes(24).toString('hex')}`;
}

export function listApiKeys(deps: ApiKeyDeps, teamId: string): ApiKeyRowView[] {
  return deps.db
    .select()
    .from(apiKey)
    .where(eq(apiKey.teamId, teamId))
    .orderBy(asc(apiKey.createdAt))
    .all()
    .map(toApiKeyRowView);
}

export function createApiKey(
  deps: ApiKeyDeps,
  input: {
    teamId: string;
    name?: string | null;
    gitAccess: boolean;
    mcpAccess: boolean;
    machineAccess?: boolean;
    toolGrants: { read: string[]; write: string[] };
  },
): ApiKeyRowView & { plaintext: string } {
  const plaintext = newApiKeyPlaintext();
  const id = newRecordId();
  const createdAt = nowMs();
  const machineAccess = input.machineAccess ?? false;
  deps.db
    .insert(apiKey)
    .values({
      id,
      teamId: input.teamId,
      name: input.name ?? null,
      gitAccess: input.gitAccess,
      mcpAccess: input.mcpAccess,
      machineAccess,
      toolGrants: input.toolGrants,
      keyHash: hashCredential(plaintext),
      masked: maskApiKey(plaintext),
      createdAt,
    })
    .run();
  return {
    id,
    name: input.name ?? null,
    gitAccess: input.gitAccess,
    mcpAccess: input.mcpAccess,
    machineAccess,
    toolGrants: input.toolGrants,
    masked: maskApiKey(plaintext),
    createdAt,
    plaintext,
  };
}

export function verifyApiKey(
  deps: ApiKeyDeps,
  plaintext: string,
): (ApiKeyRowView & { teamId: string }) | null {
  const row = deps.db
    .select()
    .from(apiKey)
    .where(eq(apiKey.keyHash, hashCredential(plaintext)))
    .get();
  return row ? { ...toApiKeyRowView(row), teamId: row.teamId } : null;
}
