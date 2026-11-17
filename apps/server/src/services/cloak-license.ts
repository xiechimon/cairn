import {
  CLOAK_LICENSE_NOT_SAVED,
  CLOAK_LICENSE_SAVED,
  CLOAK_LICENSE_SECRET,
  type CloakLicenseSaved,
  COMPUTER_HANDOFF_TIMEOUT_MS,
} from '@cairn/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefThread, machine, secret, step } from '../db/schema.js';
import { NotFoundError } from './builds.js';
import { COMPUTER_HANDOFF_POLL_MS, pause } from './computer-handoff.js';
import { createSecret, type SecretDeps, updateSecret } from './secrets.js';

export function teamHasVmComputer(db: Db, teamId: string): boolean {
  return db
    .select({ capabilities: machine.capabilities })
    .from(machine)
    .where(eq(machine.teamId, teamId))
    .all()
    .some((row) => row.capabilities?.computerKind === 'vm');
}

function licenseRow(db: Db, teamId: string) {
  return db
    .select({ id: secret.id, revision: secret.policyRevision, updatedAt: secret.updatedAt })
    .from(secret)
    .where(
      and(
        eq(secret.teamId, teamId),
        eq(secret.name, CLOAK_LICENSE_SECRET),
        isNull(secret.projectId),
      ),
    )
    .get();
}

function licenseMark(db: Db, teamId: string): string | null {
  const row = licenseRow(db, teamId);
  return row === undefined ? null : `${row.id}:${row.revision}:${row.updatedAt}`;
}

export function saveCloakLicense(
  deps: SecretDeps,
  teamId: string,
  value: string,
): CloakLicenseSaved {
  const existing = licenseRow(deps.db, teamId);
  if (existing === undefined)
    createSecret(deps, { teamId, name: CLOAK_LICENSE_SECRET, value, kind: 'secret' });
  else updateSecret(deps, teamId, existing.id, { value, kind: 'secret' });
  return { name: CLOAK_LICENSE_SECRET };
}

export async function holdCloakLicense(
  deps: { db: Db },
  input: { stepId: string },
  opts: { signal?: AbortSignal; timeoutMs?: number; pollMs?: number } = {},
): Promise<string> {
  const { db } = deps;
  const owner = db.select().from(step).where(eq(step.id, input.stepId)).get();
  if (owner === undefined) throw new NotFoundError(`step ${input.stepId}`);
  const thread = db.select().from(chiefThread).where(eq(chiefThread.id, owner.buildId)).get();
  if (thread === undefined) throw new NotFoundError(`chief thread ${owner.buildId}`);
  const before = licenseMark(db, thread.teamId);
  const deadline = Date.now() + (opts.timeoutMs ?? COMPUTER_HANDOFF_TIMEOUT_MS);
  const pollMs = opts.pollMs ?? COMPUTER_HANDOFF_POLL_MS;
  for (;;) {
    const mark = licenseMark(db, thread.teamId);
    if (mark !== null && mark !== before) return CLOAK_LICENSE_SAVED;
    const current = db
      .select({ status: step.status })
      .from(step)
      .where(eq(step.id, input.stepId))
      .get();
    if (current?.status !== 'claimed' || opts.signal?.aborted === true || Date.now() >= deadline)
      return CLOAK_LICENSE_NOT_SAVED;
    await pause(pollMs, opts.signal);
  }
}
