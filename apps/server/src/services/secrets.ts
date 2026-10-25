import type { SecretBox, SecretRecord } from '@cairn/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { secret } from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';
import { newRecordId } from '../lib/ids.js';

export interface SecretDeps {
  db: Db;
  box: SecretBox;
}

type SecretRow = typeof secret.$inferSelect;

export function toSecretRecord(row: SecretRow): SecretRecord {
  return { id: row.id, teamId: row.teamId, name: row.name, description: row.description };
}

function getRow(deps: SecretDeps, teamId: string, id: string): SecretRow | undefined {
  return deps.db
    .select()
    .from(secret)
    .where(and(eq(secret.id, id), eq(secret.teamId, teamId)))
    .get();
}

function assertNameFree(deps: SecretDeps, teamId: string, name: string, exceptId?: string): void {
  const dup = deps.db
    .select({ id: secret.id })
    .from(secret)
    .where(and(eq(secret.teamId, teamId), eq(secret.name, name)))
    .all()
    .find((r) => r.id !== exceptId);
  if (dup) throw conflict(`secret ${name} already exists`);
}

export function listSecrets(deps: SecretDeps, teamId: string): SecretRecord[] {
  return deps.db
    .select()
    .from(secret)
    .where(eq(secret.teamId, teamId))
    .orderBy(asc(secret.name))
    .all()
    .map(toSecretRecord);
}

export function createSecret(
  deps: SecretDeps,
  input: { teamId: string; name: string; description?: string | null; value: string },
): SecretRecord {
  assertNameFree(deps, input.teamId, input.name);
  const id = newRecordId();
  deps.db
    .insert(secret)
    .values({
      id,
      teamId: input.teamId,
      name: input.name,
      description: input.description ?? null,
      valueCipher: deps.box.seal(input.value),
    })
    .run();
  const row = getRow(deps, input.teamId, id);
  if (!row) throw new Error('secret missing after insert');
  return toSecretRecord(row);
}

export function updateSecret(
  deps: SecretDeps,
  teamId: string,
  id: string,
  patch: { name?: string; description?: string | null; value?: string },
): SecretRecord {
  const row = getRow(deps, teamId, id);
  if (!row) throw notFound(`secret ${id}`);
  if (patch.name !== undefined && patch.name !== row.name) {
    assertNameFree(deps, teamId, patch.name, id);
  }
  deps.db
    .update(secret)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.value !== undefined ? { valueCipher: deps.box.seal(patch.value) } : {}),
    })
    .where(eq(secret.id, id))
    .run();
  const updated = getRow(deps, teamId, id);
  if (!updated) throw new Error('secret missing after update');
  return toSecretRecord(updated);
}

export function deleteSecret(deps: SecretDeps, teamId: string, id: string): boolean {
  const row = getRow(deps, teamId, id);
  if (!row) return false;
  deps.db.delete(secret).where(eq(secret.id, id)).run();
  return true;
}

export function openSecretValues(
  deps: SecretDeps,
  teamId: string,
  ids: readonly string[],
): Record<string, string> {
  if (ids.length === 0) return {};
  const rows = deps.db
    .select()
    .from(secret)
    .where(and(eq(secret.teamId, teamId), inArray(secret.id, [...ids])))
    .all();
  const values: Record<string, string> = {};
  for (const row of rows) {
    if (row.valueCipher === null) continue;
    values[row.name] = deps.box.open(row.valueCipher);
  }
  return values;
}
