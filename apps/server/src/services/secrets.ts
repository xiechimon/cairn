import type {
  SecretBox,
  SecretDelivery,
  SecretHttpPolicy,
  SecretKind,
  SecretListEntry,
  SecretRecord,
} from '@cairn/shared';
import {
  isComposioSecretName,
  isDaemonReadSecretName,
  isHttpSecretValue,
  isMailSecretName,
  normalizeSecretOrigin,
} from '@cairn/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { project, secret } from '../db/schema.js';
import { sha256Hex } from '../lib/crypto.js';
import { conflict, HttpError, notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { browserPasswordIds } from './browser-passwords.js';
import { linkedMailSecretIds } from './mail.js';
import { listedProjects } from './personal-space.js';

export interface SecretDeps {
  db: Db;
  box: SecretBox;
}

type SecretRow = typeof secret.$inferSelect;

function isEnvRow(row: SecretRow, linked: ReadonlySet<string>): boolean {
  return (
    row.valueCipher !== null &&
    row.delivery === 'plaintext' &&
    row.envSeal === sha256Hex(row.valueCipher) &&
    !linked.has(row.id)
  );
}

function toSecretRecord(row: SecretRow, linked: ReadonlySet<string>): SecretRecord {
  return {
    id: row.id,
    teamId: row.teamId,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    delivery: row.delivery,
    http: httpPolicyOf(row),
    policyRevision: row.policyRevision,
    kind: row.usernameCipher !== null ? 'pair' : isEnvRow(row, linked) ? 'env' : 'secret',
    updatedAt: row.updatedAt,
  };
}

function sealValue(deps: SecretDeps, value: string, kind: SecretKind) {
  const valueCipher = deps.box.seal(value);
  return { valueCipher, envSeal: kind === 'env' ? sha256Hex(valueCipher) : null };
}

function assertStorable(kind: SecretKind, delivery: SecretDelivery, value: string): void {
  if (kind === 'env' && delivery === 'http')
    throw new HttpError(400, 'an environment variable cannot use http delivery');
  if (kind === 'pair' && delivery === 'http')
    throw new HttpError(400, 'a username+password pair cannot use http delivery');
  if ((kind === 'secret' || kind === 'pair') && value === '')
    throw new HttpError(400, 'a secret value cannot be empty');
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

function teamRows(deps: SecretDeps, teamId: string): SecretRow[] {
  return deps.db
    .select()
    .from(secret)
    .where(eq(secret.teamId, teamId))
    .orderBy(asc(secret.name))
    .all();
}

export function listSecrets(deps: SecretDeps, teamId: string): SecretRecord[] {
  const linked = linkedMailSecretIds(deps.db, teamId);
  return teamRows(deps, teamId).map((row) => toSecretRecord(row, linked));
}

export function listSecretsWithEnvValues(deps: SecretDeps, teamId: string): SecretListEntry[] {
  const linked = linkedMailSecretIds(deps.db, teamId);
  return teamRows(deps, teamId).map((row) => {
    const record = toSecretRecord(row, linked);
    if (record.kind !== 'env' || row.valueCipher === null) return record;
    return { ...record, value: deps.box.open(row.valueCipher) };
  });
}

function pairUsername(deps: SecretDeps, kind: SecretKind, username: string | undefined) {
  if (kind !== 'pair') {
    if (username !== undefined)
      throw new HttpError(400, 'only a username+password pair takes a username');
    return { usernameCipher: null };
  }
  if (username === undefined || username === '')
    throw new HttpError(400, 'a username+password pair needs a username');
  return { usernameCipher: deps.box.seal(username) };
}

export function createSecret(
  deps: SecretDeps,
  input: {
    teamId: string;
    name: string;
    description?: string | null;
    value: string;
    username?: string;
    projectId?: string | null;
    delivery?: SecretDelivery;
    http?: SecretHttpPolicy;
    kind?: SecretKind;
  },
): SecretRecord {
  const kind = input.kind ?? 'secret';
  const policy = policyColumns(input.delivery ?? 'plaintext', input.http);
  assertStorable(kind, policy.delivery, input.value);
  const pair = pairUsername(deps, kind, input.username);
  if (policy.delivery === 'http') assertHttpDeliverable(input.name, input.value);
  const projectId = input.projectId ?? null;
  if (projectId !== null) {
    const owned = deps.db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, projectId), listedProjects(input.teamId)))
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
      ...sealValue(deps, input.value, kind),
      ...pair,
      ...policy,
      updatedAt: nowMs(),
    })
    .run();
  const row = getRow(deps, input.teamId, id);
  if (!row) throw new Error('secret missing after insert');
  return toSecretRecord(row, linkedMailSecretIds(deps.db, input.teamId));
}

export function updateSecret(
  deps: SecretDeps,
  teamId: string,
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    value?: string;
    username?: string;
    delivery?: SecretDelivery;
    http?: SecretHttpPolicy;
    kind?: 'secret' | 'pair';
  },
): SecretRecord {
  const row = getRow(deps, teamId, id);
  if (!row) throw notFound(`secret ${id}`);
  const linked = linkedMailSecretIds(deps.db, teamId);
  const wasEnv = isEnvRow(row, linked);
  const kind: SecretKind =
    patch.kind ?? (wasEnv ? 'env' : row.usernameCipher !== null ? 'pair' : 'secret');
  if (patch.username !== undefined && kind !== 'pair')
    throw new HttpError(400, 'only a username+password pair takes a username');
  if (
    kind === 'pair' &&
    (patch.username === '' || (row.usernameCipher === null && patch.username === undefined))
  )
    throw new HttpError(400, 'a username+password pair needs a username');
  const usernameCipher =
    kind === 'pair'
      ? patch.username !== undefined
        ? deps.box.seal(patch.username)
        : row.usernameCipher
      : null;
  if (patch.name !== undefined && patch.name !== row.name) {
    assertNameFree(deps, teamId, row.projectId, patch.name, id);
  }
  const delivery = patch.delivery ?? row.delivery;
  if (
    browserPasswordIds(deps.db, teamId).has(id) &&
    (delivery !== 'plaintext' || isDaemonReadSecretName(patch.name ?? row.name))
  )
    throw new HttpError(
      400,
      'a saved browser password must stay a secret, not a service credential',
    );
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
  const resultingValue =
    patch.value ?? (row.valueCipher === null ? '' : deps.box.open(row.valueCipher));
  assertStorable(kind, policy.delivery, resultingValue);
  if (policy.delivery === 'http') {
    if (linked.has(row.id))
      throw new HttpError(400, 'a secret linked to a mail account cannot use http delivery');
    assertHttpDeliverable(patch.name ?? row.name, resultingValue);
  }
  deps.db
    .update(secret)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.value !== undefined
        ? sealValue(deps, patch.value, kind)
        : kind === 'env'
          ? {}
          : { envSeal: null }),
      usernameCipher,
      ...policy,
      updatedAt: nowMs(),
      ...(policyChanged || patch.value !== undefined || usernameCipher !== row.usernameCipher
        ? { policyRevision: row.policyRevision + 1 }
        : {}),
    })
    .where(eq(secret.id, id))
    .run();
  const updated = getRow(deps, teamId, id);
  if (!updated) throw new Error('secret missing after update');
  return toSecretRecord(updated, linked);
}

export function deleteSecret(deps: SecretDeps, teamId: string, id: string): boolean {
  const row = getRow(deps, teamId, id);
  if (!row) return false;
  deps.db.delete(secret).where(eq(secret.id, id)).run();
  return true;
}

export function openMailPassword(
  deps: SecretDeps,
  teamId: string,
  secretId: string,
): string | null {
  const row = getRow(deps, teamId, secretId);
  if (row === undefined || !isMailSecretName(row.name) || row.valueCipher === null) return null;
  return deps.box.open(row.valueCipher);
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
  const browser = browserPasswordIds(deps.db, teamId);
  const granted = deps.db
    .select()
    .from(secret)
    .where(and(eq(secret.teamId, teamId), inArray(secret.id, [...ids])))
    .all()
    .filter(
      (row) =>
        (row.projectId === null || row.projectId === projectId) &&
        !isMailSecretName(row.name) &&
        !isComposioSecretName(row.name) &&
        !linked.has(row.id) &&
        !browser.has(row.id),
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
          .all()
          .filter((row) => !linked.has(row.id) && !browser.has(row.id));
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
    if (
      row.delivery !== 'plaintext' ||
      row.valueCipher === null ||
      isMailSecretName(row.name) ||
      isComposioSecretName(row.name) ||
      linked.has(row.id) ||
      browser.has(row.id)
    )
      continue;
    http.delete(row.name);
    values[row.name] =
      row.usernameCipher === null
        ? deps.box.open(row.valueCipher)
        : JSON.stringify({
            username: deps.box.open(row.usernameCipher),
            password: deps.box.open(row.valueCipher),
          });
  }
  return { values, http: [...http.values()] };
}
