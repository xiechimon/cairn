import { isDaemonReadSecretName } from '@cairn/shared';
import { and, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { actionProposal, machine, mailAccount, secret } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';

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
  db: Pick<Db, 'select'>,
  teamId: string,
  binding: z.infer<typeof browserPasswordBindingSchema>,
): boolean {
  return db
    .select({ inputJson: actionProposal.inputJson })
    .from(actionProposal)
    .where(
      and(
        eq(actionProposal.teamId, teamId),
        eq(actionProposal.actionId, BROWSER_PASSWORD_ACTION),
        eq(actionProposal.targetId, binding.secretId),
        eq(actionProposal.status, 'executed'),
        eq(actionProposal.decision, 'allow-once'),
        isNotNull(actionProposal.decidedBy),
      ),
    )
    .all()
    .some((row) => {
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
