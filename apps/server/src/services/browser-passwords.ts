import { type BrowserPasswordGrant, isDaemonReadSecretName } from '@cairn/shared';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { actionProposal, machine, mailAccount, secret } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import { isOwner } from './instance-owner.js';

export const BROWSER_PASSWORD_ACTION = 'browser.secret.authorize';

export const browserPasswordBindingSchema = z.object({
  secretId: z.string(),
  revision: z.number().int().positive(),
  origin: z.string(),
  machineId: z.string(),
});

export function browserPasswordIds(db: Pick<Db, 'select'>, teamId: string): Set<string> {
  return new Set(
    db
      .select({ id: actionProposal.targetId })
      .from(actionProposal)
      .where(
        and(
          eq(actionProposal.teamId, teamId),
          eq(actionProposal.actionId, BROWSER_PASSWORD_ACTION),
        ),
      )
      .all()
      .map((row) => row.id),
  );
}

export function requireBrowserPassword(db: Pick<Db, 'select'>, teamId: string, id: string) {
  const row = db
    .select()
    .from(secret)
    .where(and(eq(secret.teamId, teamId), eq(secret.id, id)))
    .get();
  const linked = db
    .select({ id: mailAccount.id })
    .from(mailAccount)
    .where(and(eq(mailAccount.teamId, teamId), eq(mailAccount.secretId, id)))
    .get();
  if (
    row === undefined ||
    row.valueCipher === null ||
    row.delivery !== 'plaintext' ||
    row.envSeal !== null ||
    row.projectId !== null ||
    isDaemonReadSecretName(row.name) ||
    linked !== undefined
  )
    throw new HttpError(
      400,
      'Save a workspace secret in Secrets settings first, not an environment variable or service credential.',
    );
  return { ...row, valueCipher: row.valueCipher };
}

export function hasBrowserPasswordGrant(
  db: Db,
  teamId: string,
  binding: z.infer<typeof browserPasswordBindingSchema>,
): boolean {
  return db
    .select({ inputJson: actionProposal.inputJson, decidedBy: actionProposal.decidedBy })
    .from(actionProposal)
    .where(
      and(
        eq(actionProposal.teamId, teamId),
        eq(actionProposal.actionId, BROWSER_PASSWORD_ACTION),
        eq(actionProposal.targetId, binding.secretId),
        eq(actionProposal.status, 'executed'),
        eq(actionProposal.decision, 'allow-once'),
        isNotNull(actionProposal.decidedBy),
        isNull(actionProposal.revokedAt),
      ),
    )
    .all()
    .some((row) => {
      if (row.decidedBy === null || !isOwner(db, row.decidedBy)) return false;
      const saved = browserPasswordBindingSchema.parse(JSON.parse(row.inputJson));
      return (
        saved.secretId === binding.secretId &&
        saved.revision === binding.revision &&
        saved.origin === binding.origin &&
        saved.machineId === binding.machineId
      );
    });
}

export function validateBrowserPasswordApproval(
  db: Pick<Db, 'select'>,
  teamId: string,
  input: unknown,
): void {
  const binding = browserPasswordBindingSchema.parse(input);
  const row = requireBrowserPassword(db, teamId, binding.secretId);
  const host = db
    .select()
    .from(machine)
    .where(and(eq(machine.teamId, teamId), eq(machine.id, binding.machineId)))
    .get();
  if (
    row.policyRevision !== binding.revision ||
    host?.capabilities?.browserSecretFill !== true ||
    host.browserOverride === false
  )
    throw new HttpError(409, 'The password or browser machine changed; ask for approval again.');
}

export function listBrowserPasswordGrants(db: Db, teamId: string): BrowserPasswordGrant[] {
  const secretsById = new Map(
    db
      .select({ id: secret.id, name: secret.name, revision: secret.policyRevision })
      .from(secret)
      .where(eq(secret.teamId, teamId))
      .all()
      .map((row) => [row.id, row] as const),
  );
  const machinesById = new Map(
    db
      .select({ id: machine.id, name: machine.name })
      .from(machine)
      .where(eq(machine.teamId, teamId))
      .all()
      .map((row) => [row.id, row] as const),
  );
  return db
    .select()
    .from(actionProposal)
    .where(
      and(
        eq(actionProposal.teamId, teamId),
        eq(actionProposal.actionId, BROWSER_PASSWORD_ACTION),
        eq(actionProposal.status, 'executed'),
        eq(actionProposal.decision, 'allow-once'),
        isNotNull(actionProposal.decidedBy),
      ),
    )
    .orderBy(desc(actionProposal.createdAt))
    .all()
    .flatMap((row) => {
      if (row.decidedBy === null || !isOwner(db, row.decidedBy)) return [];
      const bound = browserPasswordBindingSchema.safeParse(JSON.parse(row.inputJson));
      if (!bound.success) return [];
      const saved = secretsById.get(bound.data.secretId);
      const host = machinesById.get(bound.data.machineId);
      const live =
        saved !== undefined && saved.revision === bound.data.revision && host !== undefined;
      return [
        {
          grantId: row.id,
          secretId: bound.data.secretId,
          secretName: saved?.name ?? null,
          origin: bound.data.origin,
          machineId: bound.data.machineId,
          machineName: host?.name ?? null,
          state: row.revokedAt !== null ? 'revoked' : live ? 'active' : 'stale',
          createdAt: row.createdAt,
          grantedAt: row.decidedAt,
          revokedAt: row.revokedAt,
        } satisfies BrowserPasswordGrant,
      ];
    });
}

export function revokeBrowserPasswordGrant(
  db: Db,
  teamId: string,
  grantId: string,
  now = nowMs(),
): void {
  const row = db
    .select({ id: actionProposal.id, decidedBy: actionProposal.decidedBy })
    .from(actionProposal)
    .where(
      and(
        eq(actionProposal.id, grantId),
        eq(actionProposal.teamId, teamId),
        eq(actionProposal.actionId, BROWSER_PASSWORD_ACTION),
        eq(actionProposal.status, 'executed'),
        eq(actionProposal.decision, 'allow-once'),
        isNotNull(actionProposal.decidedBy),
        isNull(actionProposal.revokedAt),
      ),
    )
    .get();
  if (row === undefined || row.decidedBy === null || !isOwner(db, row.decidedBy))
    throw notFound(`grant ${grantId}`);
  db.update(actionProposal)
    .set({ revokedAt: now })
    .where(and(eq(actionProposal.id, row.id), isNull(actionProposal.revokedAt)))
    .run();
}
