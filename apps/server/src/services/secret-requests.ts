import {
  COMPUTER_HANDOFF_TIMEOUT_MS,
  SECRET_REQUEST_CANCELLED,
  SECRET_REQUEST_NOT_SAVED,
  SECRET_REQUEST_REFUSED_PREFIX,
  type SecretRequestAnswer,
  type SecretRequestAnswered,
  secretRequestParamsSchema,
  secretRequestSaved,
} from '@cairn/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { project, secret, step } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { COMPUTER_HANDOFF_POLL_MS, pause } from './computer-handoff.js';
import { listedProjects } from './personal-space.js';
import { createSecret, type SecretDeps, updateSecret } from './secrets.js';

export const NO_WAITING_SECRET_REQUEST = 'no Coordinator request is waiting for this secret';

type Outcome = 'saved' | 'cancelled';

interface WaitingRequest {
  teamId: string;
  projectId: string | null;
  name: string;
  outcome: Outcome | null;
}

const waitingRequests = new WeakMap<Db, Set<WaitingRequest>>();

function waitingRequestsOf(db: Db): Set<WaitingRequest> {
  let set = waitingRequests.get(db);
  if (set === undefined) {
    set = new Set<WaitingRequest>();
    waitingRequests.set(db, set);
  }
  return set;
}

function matching(
  waiting: Set<WaitingRequest>,
  teamId: string,
  projectId: string | null,
  name: string,
): WaitingRequest[] {
  return [...waiting].filter(
    (entry) =>
      entry.outcome === null &&
      entry.teamId === teamId &&
      entry.projectId === projectId &&
      entry.name === name,
  );
}

function projectListed(db: Db, teamId: string, projectId: string): boolean {
  return (
    db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, projectId), listedProjects(teamId)))
      .get() !== undefined
  );
}

export async function holdSecretRequest(
  db: Db,
  input: { teamId: string; stepId: string; params: Record<string, unknown> },
  opts: { signal?: AbortSignal; timeoutMs?: number; pollMs?: number } = {},
): Promise<string> {
  const parsed = secretRequestParamsSchema.safeParse(input.params);
  if (!parsed.success)
    return `${SECRET_REQUEST_REFUSED_PREFIX}${parsed.error.issues[0]?.message ?? 'invalid parameters'}`;
  const { name, scope, projectId } = parsed.data;
  if (projectId !== undefined && !projectListed(db, input.teamId, projectId))
    return `${SECRET_REQUEST_REFUSED_PREFIX}project ${projectId} is not a project of this team`;
  const entry: WaitingRequest = {
    teamId: input.teamId,
    projectId: projectId ?? null,
    name,
    outcome: null,
  };
  const waiting = waitingRequestsOf(db);
  waiting.add(entry);
  const deadline = Date.now() + (opts.timeoutMs ?? COMPUTER_HANDOFF_TIMEOUT_MS);
  const pollMs = opts.pollMs ?? COMPUTER_HANDOFF_POLL_MS;
  try {
    for (;;) {
      if (entry.outcome === 'saved') return secretRequestSaved(name, scope);
      if (entry.outcome === 'cancelled') return SECRET_REQUEST_CANCELLED;
      const current = db
        .select({ status: step.status })
        .from(step)
        .where(eq(step.id, input.stepId))
        .get();
      if (current?.status !== 'claimed' || opts.signal?.aborted === true || Date.now() >= deadline)
        return SECRET_REQUEST_NOT_SAVED;
      await pause(pollMs, opts.signal);
    }
  } finally {
    waiting.delete(entry);
  }
}

function existingSecret(db: Db, teamId: string, projectId: string | null, name: string) {
  return db
    .select({ id: secret.id, usernameCipher: secret.usernameCipher })
    .from(secret)
    .where(
      and(
        eq(secret.teamId, teamId),
        eq(secret.name, name),
        projectId === null ? isNull(secret.projectId) : eq(secret.projectId, projectId),
      ),
    )
    .get();
}

export function answerSecretRequest(
  deps: SecretDeps,
  teamId: string,
  answer: SecretRequestAnswer,
): SecretRequestAnswered {
  const entries = matching(waitingRequestsOf(deps.db), teamId, answer.projectId, answer.name);
  if (entries.length === 0) throw new HttpError(409, NO_WAITING_SECRET_REQUEST);
  if (answer.decision === 'save') {
    const existing = existingSecret(deps.db, teamId, answer.projectId, answer.name);
    if (existing === undefined)
      createSecret(deps, {
        teamId,
        projectId: answer.projectId,
        name: answer.name,
        value: answer.value,
        kind: 'secret',
      });
    else
      updateSecret(deps, teamId, existing.id, {
        value: answer.value,
        ...(existing.usernameCipher === null ? { kind: 'secret' as const } : {}),
      });
  }
  const outcome: Outcome = answer.decision === 'save' ? 'saved' : 'cancelled';
  for (const entry of entries) entry.outcome = outcome;
  return { name: answer.name };
}
