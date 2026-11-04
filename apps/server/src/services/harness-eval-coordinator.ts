import { and, eq, gt, inArray, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { harnessEvalAttempt } from '../db/schema.js';
import { newRecordId } from '../lib/ids.js';

export type HarnessEvalAttemptState = 'claimed' | 'dispatched' | 'dispatch_uncertain' | 'terminal';

export type HarnessEvalTerminalOutcome =
  | 'completed'
  | 'timeout'
  | 'worker_failure'
  | 'rejected_publication'
  | 'unavailable_worker'
  | 'budget_refusal';

export type HarnessEvalAttempt = {
  id: string;
  repo: string;
  pr: number;
  patchDigest: string;
  workerId: string;
  state: HarnessEvalAttemptState;
  deadlineAt: number;
  outcome: HarnessEvalTerminalOutcome | null;
  createdAt: number;
};

export type HarnessEvalDispatchRequest = {
  repo: string;
  pr: number;
  patchDigest: string;
  workerId: string;
  attemptId: string;
  ticket?: string;
  expectedHead?: string;
};

export type HarnessEvalDispatchPort = (request: HarnessEvalDispatchRequest) => Promise<void>;

export type HarnessEvalCoordinatorDeps = {
  db: Db;
  dispatch: HarnessEvalDispatchPort;
  now: () => number;
  attemptTimeoutMs: number;
  newId?: () => string;
};

export type ClaimAttemptInput = {
  repo: string;
  pr: number;
  patchDigest: string;
  ticket?: string;
  expectedHead?: string;
};

export type ClaimAttemptResult = {
  attempt: HarnessEvalAttempt;
  created: boolean;
  dispatched: boolean;
};

export type CompleteResult = {
  ok: boolean;
  reason?: 'missing' | 'unauthorized' | 'terminal';
};

const LIVE_STATES: HarnessEvalAttemptState[] = ['claimed', 'dispatched', 'dispatch_uncertain'];

function asAttempt(row: typeof harnessEvalAttempt.$inferSelect): HarnessEvalAttempt {
  return {
    id: row.id,
    repo: row.repo,
    pr: row.pr,
    patchDigest: row.patchDigest,
    workerId: row.workerId,
    state: row.state,
    deadlineAt: row.deadlineAt,
    outcome: row.outcome,
    createdAt: row.createdAt,
  };
}

function loadAttempt(db: Db, attemptId: string): HarnessEvalAttempt | null {
  const row = db
    .select()
    .from(harnessEvalAttempt)
    .where(eq(harnessEvalAttempt.id, attemptId))
    .get();
  return row === undefined ? null : asAttempt(row);
}

export function createHarnessEvalCoordinator(deps: HarnessEvalCoordinatorDeps) {
  const nextId = deps.newId ?? newRecordId;

  function recordDispatchAck(attemptId: string): HarnessEvalAttempt | null {
    const current = loadAttempt(deps.db, attemptId);
    if (current === null) return null;
    if (current.state !== 'claimed') return current;
    deps.db
      .update(harnessEvalAttempt)
      .set({ state: 'dispatched' })
      .where(and(eq(harnessEvalAttempt.id, attemptId), eq(harnessEvalAttempt.state, 'claimed')))
      .run();
    return loadAttempt(deps.db, attemptId);
  }

  async function claimAttempt(input: ClaimAttemptInput): Promise<ClaimAttemptResult> {
    const created = deps.db.transaction((tx) => {
      const id = nextId();
      const workerId = nextId();
      const createdAt = deps.now();
      const deadlineAt = createdAt + deps.attemptTimeoutMs;
      const inserted = tx
        .insert(harnessEvalAttempt)
        .values({
          id,
          repo: input.repo,
          pr: input.pr,
          patchDigest: input.patchDigest,
          workerId,
          state: 'claimed',
          deadlineAt,
          outcome: null,
          createdAt,
        })
        .onConflictDoNothing({
          target: [harnessEvalAttempt.repo, harnessEvalAttempt.pr, harnessEvalAttempt.patchDigest],
        })
        .returning()
        .all();
      if (inserted.length === 0) {
        const existing = tx
          .select()
          .from(harnessEvalAttempt)
          .where(
            and(
              eq(harnessEvalAttempt.repo, input.repo),
              eq(harnessEvalAttempt.pr, input.pr),
              eq(harnessEvalAttempt.patchDigest, input.patchDigest),
            ),
          )
          .get();
        if (existing === undefined) throw new Error('harness eval attempt conflict without row');
        return { kind: 'existing' as const, attempt: asAttempt(existing) };
      }
      const [row] = inserted;
      if (row === undefined) throw new Error('harness eval attempt insert returned no row');
      return { kind: 'created' as const, attempt: asAttempt(row) };
    });

    if (created.kind === 'existing') {
      return { attempt: created.attempt, created: false, dispatched: false };
    }

    try {
      await deps.dispatch({
        repo: created.attempt.repo,
        pr: created.attempt.pr,
        patchDigest: created.attempt.patchDigest,
        workerId: created.attempt.workerId,
        attemptId: created.attempt.id,
        ...(input.ticket !== undefined ? { ticket: input.ticket } : {}),
        ...(input.expectedHead !== undefined ? { expectedHead: input.expectedHead } : {}),
      });
      const acknowledged = recordDispatchAck(created.attempt.id) ?? created.attempt;
      return { attempt: acknowledged, created: true, dispatched: true };
    } catch {
      deps.db
        .update(harnessEvalAttempt)
        .set({ state: 'dispatch_uncertain' })
        .where(
          and(
            eq(harnessEvalAttempt.id, created.attempt.id),
            inArray(harnessEvalAttempt.state, ['claimed', 'dispatched']),
          ),
        )
        .run();
      const uncertain = loadAttempt(deps.db, created.attempt.id) ?? {
        ...created.attempt,
        state: 'dispatch_uncertain' as const,
      };
      return { attempt: uncertain, created: true, dispatched: false };
    }
  }

  function reconcile(now = deps.now()): { timedOut: string[] } {
    const expired = deps.db
      .select()
      .from(harnessEvalAttempt)
      .where(
        and(
          inArray(harnessEvalAttempt.state, LIVE_STATES),
          lte(harnessEvalAttempt.deadlineAt, now),
        ),
      )
      .all();
    const timedOut: string[] = [];
    for (const row of expired) {
      const updated = deps.db
        .update(harnessEvalAttempt)
        .set({ state: 'terminal', outcome: 'timeout' })
        .where(
          and(eq(harnessEvalAttempt.id, row.id), inArray(harnessEvalAttempt.state, LIVE_STATES)),
        )
        .run();
      if (updated.changes > 0) timedOut.push(row.id);
    }
    return { timedOut };
  }

  function complete(
    attemptId: string,
    workerId: string,
    outcome: HarnessEvalTerminalOutcome,
  ): CompleteResult {
    const now = deps.now();
    const current = loadAttempt(deps.db, attemptId);
    if (current === null) return { ok: false, reason: 'missing' };
    if (current.state === 'terminal') return { ok: false, reason: 'terminal' };
    if (current.workerId !== workerId) return { ok: false, reason: 'unauthorized' };
    if (current.deadlineAt <= now) {
      deps.db
        .update(harnessEvalAttempt)
        .set({ state: 'terminal', outcome: 'timeout' })
        .where(
          and(eq(harnessEvalAttempt.id, attemptId), inArray(harnessEvalAttempt.state, LIVE_STATES)),
        )
        .run();
      return { ok: false, reason: 'terminal' };
    }
    const updated = deps.db
      .update(harnessEvalAttempt)
      .set({ state: 'terminal', outcome })
      .where(
        and(
          eq(harnessEvalAttempt.id, attemptId),
          eq(harnessEvalAttempt.workerId, workerId),
          inArray(harnessEvalAttempt.state, LIVE_STATES),
          gt(harnessEvalAttempt.deadlineAt, now),
        ),
      )
      .run();
    if (updated.changes === 0) {
      const again = loadAttempt(deps.db, attemptId);
      if (again?.state === 'terminal') return { ok: false, reason: 'terminal' };
      return { ok: false, reason: 'unauthorized' };
    }
    return { ok: true };
  }

  function getAttempt(input: ClaimAttemptInput): HarnessEvalAttempt | null {
    const row = deps.db
      .select()
      .from(harnessEvalAttempt)
      .where(
        and(
          eq(harnessEvalAttempt.repo, input.repo),
          eq(harnessEvalAttempt.pr, input.pr),
          eq(harnessEvalAttempt.patchDigest, input.patchDigest),
        ),
      )
      .get();
    return row === undefined ? null : asAttempt(row);
  }

  return {
    claimAttempt,
    getAttempt,
    recordDispatchAck: (attemptId: string) => {
      recordDispatchAck(attemptId);
    },
    reconcile,
    complete,
  };
}
