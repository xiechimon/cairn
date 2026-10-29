import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { openDbWithHandle } from '../src/db/client.js';
import { harnessEvalAttempt } from '../src/db/schema.js';
import {
  createHarnessEvalCoordinator,
  type HarnessEvalDispatchPort,
  type HarnessEvalDispatchRequest,
} from '../src/services/harness-eval-coordinator.js';

const REPO = 'xiechimon/cairn';
const PR = 1977;
const DIGEST_A = `pd2:${'a'.repeat(64)}`;
const DIGEST_B = `pd2:${'b'.repeat(64)}`;

const directories: { close(): void; dir: string }[] = [];

afterEach(() => {
  while (directories.length > 0) {
    const opened = directories.pop();
    if (opened === undefined) break;
    opened.close();
    rmSync(opened.dir, { recursive: true, force: true });
  }
});

function openWorld(opts: {
  dispatch?: HarnessEvalDispatchPort;
  now?: { value: number };
  attemptTimeoutMs?: number;
  ids?: string[];
}) {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-1977-'));
  const opened = openDbWithHandle(join(dir, 'db.sqlite'));
  directories.push({ close: opened.close, dir });
  const dispatches: HarnessEvalDispatchRequest[] = [];
  const now = opts.now ?? { value: 1_000_000 };
  const idQueue = opts.ids ?? [];
  let idSeq = 0;
  const dispatch: HarnessEvalDispatchPort =
    opts.dispatch ??
    (async (request) => {
      dispatches.push(request);
    });
  const coordinator = createHarnessEvalCoordinator({
    db: opened.db,
    dispatch,
    now: () => now.value,
    attemptTimeoutMs: opts.attemptTimeoutMs ?? 60_000,
    newId: () => {
      const next = idQueue.shift();
      if (next !== undefined) return next;
      idSeq += 1;
      return `id-${idSeq}`;
    },
  });
  return { db: opened.db, coordinator, dispatches, now };
}

describe('harness eval coordinator', () => {
  test('two concurrent claims for the same repo/pr/digest create one attempt and dispatch once', async () => {
    const { coordinator, dispatches, db } = openWorld({
      ids: ['attempt-1', 'worker-1', 'attempt-2', 'worker-2'],
    });
    const [first, second] = await Promise.all([
      coordinator.claimAttempt({ repo: REPO, pr: PR, patchDigest: DIGEST_A }),
      coordinator.claimAttempt({ repo: REPO, pr: PR, patchDigest: DIGEST_A }),
    ]);
    const created = [first, second].filter((result) => result.created);
    expect(created).toHaveLength(1);
    expect(first.attempt.id).toBe(second.attempt.id);
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]?.attemptId).toBe(created[0]?.attempt.id);
    expect(db.select().from(harnessEvalAttempt).all()).toHaveLength(1);
  });

  test('claimAttempt forwards ticket and expectedHead into dispatch', async () => {
    const { coordinator, dispatches } = openWorld({
      ids: ['attempt-1', 'worker-1'],
    });
    const expectedHead = 'b'.repeat(40);
    await coordinator.claimAttempt({
      repo: REPO,
      pr: PR,
      patchDigest: DIGEST_A,
      ticket: '1979',
      expectedHead,
    });
    expect(dispatches).toEqual([
      expect.objectContaining({
        repo: REPO,
        pr: PR,
        patchDigest: DIGEST_A,
        ticket: '1979',
        expectedHead,
        attemptId: 'attempt-1',
        workerId: 'worker-1',
      }),
    ]);
  });

  test('repeated polling after a claim does not dispatch again', async () => {
    const { coordinator, dispatches } = openWorld({
      ids: ['attempt-1', 'worker-1', 'attempt-2', 'worker-2'],
    });
    const first = await coordinator.claimAttempt({
      repo: REPO,
      pr: PR,
      patchDigest: DIGEST_A,
    });
    expect(first.created).toBe(true);
    expect(dispatches).toHaveLength(1);
    const second = await coordinator.claimAttempt({
      repo: REPO,
      pr: PR,
      patchDigest: DIGEST_A,
    });
    expect(second.created).toBe(false);
    expect(second.dispatched).toBe(false);
    expect(second.attempt.id).toBe(first.attempt.id);
    expect(dispatches).toHaveLength(1);
  });

  test('a restart (new coordinator on the same db) sees the in-flight attempt and does not dispatch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-1977-restart-'));
    const path = join(dir, 'db.sqlite');
    let opened = openDbWithHandle(path);
    const firstDispatches: HarnessEvalDispatchRequest[] = [];
    const firstCoordinator = createHarnessEvalCoordinator({
      db: opened.db,
      dispatch: async (request) => {
        firstDispatches.push(request);
      },
      now: () => 1_000_000,
      attemptTimeoutMs: 60_000,
      newId: (() => {
        const ids = ['attempt-1', 'worker-1'];
        return () => ids.shift() ?? 'extra';
      })(),
    });
    const claimed = await firstCoordinator.claimAttempt({
      repo: REPO,
      pr: PR,
      patchDigest: DIGEST_A,
    });
    expect(claimed.created).toBe(true);
    expect(firstDispatches).toHaveLength(1);
    opened.close();

    opened = openDbWithHandle(path);
    directories.push({
      close: () => {
        opened.close();
        rmSync(dir, { recursive: true, force: true });
      },
      dir,
    });
    const secondDispatches: HarnessEvalDispatchRequest[] = [];
    const secondCoordinator = createHarnessEvalCoordinator({
      db: opened.db,
      dispatch: async (request) => {
        secondDispatches.push(request);
      },
      now: () => 1_000_000,
      attemptTimeoutMs: 60_000,
      newId: () => 'should-not-use',
    });
    const again = await secondCoordinator.claimAttempt({
      repo: REPO,
      pr: PR,
      patchDigest: DIGEST_A,
    });
    expect(again.created).toBe(false);
    expect(again.attempt.id).toBe(claimed.attempt.id);
    expect(secondDispatches).toHaveLength(0);
  });

  test('the dispatch port throws after the request may have gone out: attempt becomes dispatch-uncertain, no second dispatch, escalates at the deadline', async () => {
    let calls = 0;
    const now = { value: 1_000_000 };
    const { coordinator, db } = openWorld({
      now,
      ids: ['attempt-1', 'worker-1', 'attempt-2', 'worker-2'],
      dispatch: async () => {
        calls += 1;
        throw new Error('ack lost after send');
      },
    });
    const first = await coordinator.claimAttempt({
      repo: REPO,
      pr: PR,
      patchDigest: DIGEST_A,
    });
    expect(first.created).toBe(true);
    expect(first.attempt.state).toBe('dispatch_uncertain');
    expect(calls).toBe(1);
    const second = await coordinator.claimAttempt({
      repo: REPO,
      pr: PR,
      patchDigest: DIGEST_A,
    });
    expect(second.created).toBe(false);
    expect(calls).toBe(1);
    now.value = first.attempt.deadlineAt;
    const timedOut = coordinator.reconcile(now.value);
    expect(timedOut.timedOut).toEqual([first.attempt.id]);
    const row = db.select().from(harnessEvalAttempt).all()[0];
    expect(row?.state).toBe('terminal');
    expect(row?.outcome).toBe('timeout');
  });

  test('worker failure, rejected publication, unavailable worker and budget refusal each end in a terminal human-escalation outcome', async () => {
    const outcomes = [
      'worker_failure',
      'rejected_publication',
      'unavailable_worker',
      'budget_refusal',
    ] as const;
    for (const [index, outcome] of outcomes.entries()) {
      const { coordinator, db } = openWorld({
        ids: [`attempt-${index}`, `worker-${index}`],
      });
      const digest = `pd2:${String(index).repeat(64)}`;
      const claimed = await coordinator.claimAttempt({
        repo: REPO,
        pr: PR,
        patchDigest: digest,
      });
      const result = coordinator.complete(claimed.attempt.id, claimed.attempt.workerId, outcome);
      expect(result.ok).toBe(true);
      const row = db
        .select()
        .from(harnessEvalAttempt)
        .all()
        .find((entry) => entry.id === claimed.attempt.id);
      expect(row?.state).toBe('terminal');
      expect(row?.outcome).toBe(outcome);
    }
  });

  test('deadline passes with no completion: terminal timeout outcome', async () => {
    const now = { value: 1_000_000 };
    const { coordinator, db } = openWorld({
      now,
      attemptTimeoutMs: 5_000,
      ids: ['attempt-1', 'worker-1'],
    });
    const claimed = await coordinator.claimAttempt({
      repo: REPO,
      pr: PR,
      patchDigest: DIGEST_A,
    });
    expect(claimed.attempt.deadlineAt).toBe(1_005_000);
    expect(coordinator.reconcile(1_004_999).timedOut).toEqual([]);
    expect(db.select().from(harnessEvalAttempt).all()[0]?.state).toBe('dispatched');
    const timedOut = coordinator.reconcile(1_005_000);
    expect(timedOut.timedOut).toEqual([claimed.attempt.id]);
    const row = db.select().from(harnessEvalAttempt).all()[0];
    expect(row?.state).toBe('terminal');
    expect(row?.outcome).toBe('timeout');
  });

  test('a late completion from a timed-out or superseded worker id is refused', async () => {
    const now = { value: 1_000_000 };
    const { coordinator, db } = openWorld({
      now,
      attemptTimeoutMs: 1_000,
      ids: ['attempt-1', 'worker-1'],
    });
    const claimed = await coordinator.claimAttempt({
      repo: REPO,
      pr: PR,
      patchDigest: DIGEST_A,
    });
    now.value = claimed.attempt.deadlineAt;
    const lateWithoutReconcile = coordinator.complete(
      claimed.attempt.id,
      claimed.attempt.workerId,
      'completed',
    );
    expect(lateWithoutReconcile.ok).toBe(false);
    expect(lateWithoutReconcile.reason).toBe('terminal');
    const row = db.select().from(harnessEvalAttempt).all()[0];
    expect(row?.state).toBe('terminal');
    expect(row?.outcome).toBe('timeout');
    const again = coordinator.complete(claimed.attempt.id, claimed.attempt.workerId, 'completed');
    expect(again.ok).toBe(false);

    const second = openWorld({
      ids: ['attempt-2', 'worker-2'],
    });
    const active = await second.coordinator.claimAttempt({
      repo: REPO,
      pr: PR,
      patchDigest: DIGEST_B,
    });
    const superseded = second.coordinator.complete(active.attempt.id, 'wrong-worker', 'completed');
    expect(superseded.ok).toBe(false);
    const ok = second.coordinator.complete(active.attempt.id, active.attempt.workerId, 'completed');
    expect(ok.ok).toBe(true);
  });

  test('a new patch digest for the same PR creates a new attempt; an evidence-only head change (same digest) does not', async () => {
    const { coordinator, dispatches } = openWorld({
      ids: ['attempt-1', 'worker-1', 'attempt-2', 'worker-2', 'attempt-3', 'worker-3'],
    });
    const first = await coordinator.claimAttempt({
      repo: REPO,
      pr: PR,
      patchDigest: DIGEST_A,
    });
    const evidenceOnly = await coordinator.claimAttempt({
      repo: REPO,
      pr: PR,
      patchDigest: DIGEST_A,
    });
    expect(evidenceOnly.created).toBe(false);
    expect(evidenceOnly.attempt.id).toBe(first.attempt.id);
    const nextDigest = await coordinator.claimAttempt({
      repo: REPO,
      pr: PR,
      patchDigest: DIGEST_B,
    });
    expect(nextDigest.created).toBe(true);
    expect(nextDigest.attempt.id).not.toBe(first.attempt.id);
    expect(dispatches).toHaveLength(2);
  });

  test('recordDispatchAck marks a claimed attempt dispatched', async () => {
    let resolveDispatch: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      resolveDispatch = resolve;
    });
    const { coordinator, db } = openWorld({
      ids: ['attempt-1', 'worker-1'],
      dispatch: async () => {
        await gate;
      },
    });
    const pending = coordinator.claimAttempt({
      repo: REPO,
      pr: PR,
      patchDigest: DIGEST_A,
    });
    let mid = db.select().from(harnessEvalAttempt).all()[0];
    for (let i = 0; i < 50 && mid === undefined; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      mid = db.select().from(harnessEvalAttempt).all()[0];
    }
    expect(mid?.state).toBe('claimed');
    coordinator.recordDispatchAck(mid!.id);
    expect(db.select().from(harnessEvalAttempt).all()[0]?.state).toBe('dispatched');
    resolveDispatch?.();
    const finished = await pending;
    expect(finished.dispatched).toBe(true);
    expect(finished.attempt.state).toBe('dispatched');
  });
});
