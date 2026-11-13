import type { SecretBox, SecretDelivery, SecretHttpPolicy, SecretRecord } from '@cairn/shared';
import {
  isDaemonReadSecretName,
  isHttpSecretValue,
  isMailSecretName,
  normalizeSecretOrigin,
} from '@cairn/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { project, secret } from '../db/schema.js';
import { conflict, HttpError, notFound } from '../lib/errors.js';
import { newRecordId } from '../lib/ids.js';
import { linkedMailSecretIds } from './mail.js';

export interface SecretDeps {
  db: Db;
  box: SecretBox;
}

type SecretRow = typeof secret.$inferSelect;

export function toSecretRecord(row: SecretRow): SecretRecord {
  return {
    id: row.id,
    teamId: row.teamId,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    delivery: row.delivery,
    http: httpPolicyOf(row),
    policyRevision: row.policyRevision,
  };
}

function httpPolicyOf(row: SecretRow): SecretHttpPolicy | null {
  if (row.httpOrigin === null || row.httpHeader === null || row.httpTemplate === null) return null;
  return { origin: row.httpOrigin, header: row.httpHeader, template: row.httpTemplate };
}

function policyColumns(delivery: SecretDelivery, policy: SecretHttpPolicy | undefined | null) {
  if (delivery === 'plaintext') {
    if (policy != null) throw new HttpError(400, 'a plaintext secret takes no http policy');
    return { delivery, httpOrigin: null, httpHeader: null, httpTemplate: null };
  }
  if (policy == null) throw new HttpError(400, 'an http secret needs origin, header and template');
  const httpOrigin = normalizeSecretOrigin(policy.origin);
  if (httpOrigin === null) throw new HttpError(400, 'origin must be https://host on port 443');
  return {
    delivery,
    httpOrigin,
    httpHeader: policy.header,
    httpTemplate: policy.template,
  };
}

function assertHttpDeliverable(name: string, value: string): void {
  if (isDaemonReadSecretName(name))
    throw new HttpError(400, `secret ${name} is read by the daemon and cannot use http delivery`);
  if (!isHttpSecretValue(value))
    throw new HttpError(400, 'an http secret value cannot be empty or hold control characters');
}

function getRow(deps: SecretDeps, teamId: string, id: string): SecretRow | undefined {
  return deps.db
    .select()
    .from(secret)
    .where(and(eq(secret.id, id), eq(secret.teamId, teamId)))
    .get();
}

function assertNameFree(
  deps: SecretDeps,
  teamId: string,
  projectId: string | null,
  name: string,
  exceptId?: string,
): void {
  const dup = deps.db
    .select({ id: secret.id })
    .from(secret)
    .where(
      and(
        eq(secret.teamId, teamId),
        eq(secret.name, name),
        projectId === null ? isNull(secret.projectId) : eq(secret.projectId, projectId),
      ),
    )
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
  input: {
    teamId: string;
    name: string;
    description?: string | null;
    value: string;
    projectId?: string | null;
    delivery?: SecretDelivery;
    http?: SecretHttpPolicy;
  },
): SecretRecord {
  const policy = policyColumns(input.delivery ?? 'plaintext', input.http);
  if (policy.delivery === 'http') assertHttpDeliverable(input.name, input.value);
  const projectId = input.projectId ?? null;
  if (projectId !== null) {
    const owned = deps.db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, projectId), eq(project.teamId, input.teamId)))
      .get();
    if (!owned) throw notFound(`project ${projectId}`);
  }
  assertNameFree(deps, input.teamId, projectId, input.name);
  const id = newRecordId();
  deps.db
    .insert(secret)
    .values({
      id,
      teamId: input.teamId,
      projectId,
      name: input.name,
      description: input.description ?? null,
      valueCipher: deps.box.seal(input.value),
      ...policy,
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
  patch: {
    name?: string;
    description?: string | null;
    value?: string;
    delivery?: SecretDelivery;
    http?: SecretHttpPolicy;
  },
): SecretRecord {
  const row = getRow(deps, teamId, id);
  if (!row) throw notFound(`secret ${id}`);
  if (patch.name !== undefined && patch.name !== row.name) {
    assertNameFree(deps, teamId, row.projectId, patch.name, id);
  }
  const delivery = patch.delivery ?? row.delivery;
  const policy = policyColumns(
    delivery,
    delivery === 'http' ? (patch.http ?? httpPolicyOf(row)) : patch.http,
  );
  const policyChanged =
    policy.delivery !== row.delivery ||
    policy.httpOrigin !== row.httpOrigin ||
    policy.httpHeader !== row.httpHeader ||
    policy.httpTemplate !== row.httpTemplate;
  if (row.delivery === 'http' && policyChanged && patch.value === undefined)
    throw new HttpError(
      400,
      'changing the target of an http secret, or making it plaintext, needs a new value',
    );
  if (policy.delivery === 'http') {
    if (linkedMailSecretIds(deps.db, teamId).has(row.id))
      throw new HttpError(400, 'a secret linked to a mail account cannot use http delivery');
    const value = patch.value ?? (row.valueCipher === null ? '' : deps.box.open(row.valueCipher));
    assertHttpDeliverable(patch.name ?? row.name, value);
  }
  deps.db
    .update(secret)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.value !== undefined ? { valueCipher: deps.box.seal(patch.value) } : {}),
      ...policy,
      ...(policyChanged || patch.value !== undefined
        ? { policyRevision: row.policyRevision + 1 }
        : {}),
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

export interface HttpSecretRow {
  id: string;
  name: string;
  revision: number;
  policy: SecretHttpPolicy;
  valueCipher: string | null;
}

export interface SecretGrants {
  values: Record<string, string>;
  http: HttpSecretRow[];
}

export function openSecretValues(
  deps: SecretDeps,
  teamId: string,
  ids: readonly string[],
  projectId: string | null,
): Record<string, string> {
  return openSecretGrants(deps, teamId, ids, projectId).values;
}

export function openSecretGrants(
  deps: SecretDeps,
  teamId: string,
  ids: readonly string[],
  projectId: string | null,
): SecretGrants {
  if (ids.length === 0) return { values: {}, http: [] };
  const linked = linkedMailSecretIds(deps.db, teamId);
  const granted = deps.db
    .select()
    .from(secret)
    .where(and(eq(secret.teamId, teamId), inArray(secret.id, [...ids])))
    .all()
    .filter(
      (row) =>
        (row.projectId === null || row.projectId === projectId) &&
        !isMailSecretName(row.name) &&
        !linked.has(row.id),
    );
  const names = [...new Set(granted.map((row) => row.name))];
  const projectRows =
    projectId === null || names.length === 0
      ? []
      : deps.db
          .select()
          .from(secret)
          .where(
            and(
              eq(secret.teamId, teamId),
              eq(secret.projectId, projectId),
              inArray(secret.name, names),
            ),
          )
          .all();
  const values: Record<string, string> = {};
  const http = new Map<string, HttpSecretRow>();
  for (const row of [
    ...granted.filter((r) => r.projectId === null),
    ...projectRows,
    ...granted.filter((r) => r.projectId !== null),
  ]) {
    if (row.delivery === 'http') {
      delete values[row.name];
      const policy = httpPolicyOf(row);
      if (policy === null) http.delete(row.name);
      else
        http.set(row.name, {
          id: row.id,
          name: row.name,
          revision: row.policyRevision,
          policy,
          valueCipher: row.valueCipher,
        });
      continue;
    }
    if (row.valueCipher === null || isMailSecretName(row.name) || linked.has(row.id)) continue;
    http.delete(row.name);
    values[row.name] = deps.box.open(row.valueCipher);
  }
  return { values, http: [...http.values()] };
}
