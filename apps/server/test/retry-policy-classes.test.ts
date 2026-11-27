import {
  AUTOMATIC_RETRY_ROW_KIND,
  type StepFailureCode,
  type StepFailureDetail,
  systemRowOf,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  build as buildTable,
  chiefMessage as chiefMessageTable,
  message as messageTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { newRecordId, newUuidv7, nowMs } from '../src/lib/ids.js';
import { applyStepFailure, type BuildDeps } from '../src/services/builds.js';
import { sweepFailedRetries } from '../src/services/needs-you.js';
import { applyQuotaWaitStep } from '../src/services/quota-wait.js';
import { getTodo } from '../src/services/todos.js';
import { bootServer, insertMachine, req, seedSessionRoute, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const dispose of disposables) dispose();
});

interface World {
  s: TestServer;
  deps: BuildDeps;
  projectId: string;
  todoId: string;
  buildId: string;
  stepId: string;
}

function openWorld(): World {
  const s = bootServer();
  disposables.push(() => s.dispose());
  seedSessionRoute(s);
  insertMachine(s);
  const suffix = newRecordId(8);
  const projectId = `proj-${suffix}`;
  const todoId = `todo-${suffix}`;
  const buildId = newUuidv7();
  const stepId = newRecordId();
  s.db
    .insert(projectTable)
    .values({ id: projectId, name: `retry-classes-${suffix}`, teamId: s.team.id })
    .run();
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId,
      title: `Task ${suffix}`,
      spec: 'Do the work.',
      phase: 'building',
      phaseAt: nowMs(),
      seqNum: 1,
      latestBuildId: buildId,
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      prevPhase: 'todo',
      triggerSource: 'user',
      createdAt: nowMs() - 60_000,
    })
    .run();
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId,
      kind: 'session',
      status: 'claimed',
      createdAt: nowMs() - 30_000,
    })
    .run();
  const deps: BuildDeps = { ...s.svc, reposDir: s.reposDir, box: s.secretBox };
  return { s, deps, projectId, todoId, buildId, stepId };
}

function phaseOf(w: World): string {
  return w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()?.phase ?? '';
}

function buildCount(w: World): number {
  return w.s.db.select().from(buildTable).where(eq(buildTable.todoId, w.todoId)).all().length;
}

function latestBuild(w: World) {
  const latestId = w.s.db
    .select()
    .from(todoTable)
    .where(eq(todoTable.id, w.todoId))
    .get()?.latestBuildId;
  return w.s.db
    .select()
    .from(buildTable)
    .where(eq(buildTable.id, latestId ?? ''))
    .get();
}

function failStep(
  w: World,
  stepId: string,
  error: string,
  failure?: { code?: StepFailureCode | null; detail?: StepFailureDetail | null },
): void {
  const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get();
  if (row === undefined) throw new Error(`missing step ${stepId}`);
  applyStepFailure(w.deps, row, error, undefined, failure);
}

function pendingStep(w: World, buildId: string) {
  const row = w.s.db
    .select()
    .from(stepTable)
    .where(eq(stepTable.buildId, buildId))
    .all()
    .find((s) => s.status === 'pending' && s.kind === 'session');
  if (row === undefined) throw new Error(`missing pending session step on ${buildId}`);
  return row;
}

describe('classified retry policy (permanent / transient / rate_limit / unknown)', () => {
  test('permanent: setup-hook exit (e.g. corepack missing) parks on first failure with zero automatic retries', async () => {
    const w = openWorld();
    const error = 'workspace hook .agents/setup exited 1 — corepack: command not found';
    failStep(w, w.stepId, error);

    expect(phaseOf(w)).toBe('failed');
    expect(latestBuild(w)?.errorMessage).toContain('Task parked');
    expect(getTodo(w.deps, w.todoId)?.owner).toBe('coordinator');

    w.s.db
      .update(todoTable)
      .set({ phaseAt: nowMs() - 60 * 60_000 })
      .where(eq(todoTable.id, w.todoId))
      .run();
    await sweepFailedRetries(w.deps);
    expect(phaseOf(w)).toBe('failed');
    expect(buildCount(w)).toBe(1);
  });

  test('transient: 5xx / network errors keep retrying past 3 attempts within the 6h window', async () => {
    const w = openWorld();
    let stepId = w.stepId;
    for (let i = 0; i < 4; i++) {
      failStep(w, stepId, 'upstream error: HTTP 503 Service Unavailable');
      const current = latestBuild(w);
      expect(current?.errorMessage ?? '').not.toContain('Task parked');
      expect(getTodo(w.deps, w.todoId)?.owner).toBeNull();

      w.s.db
        .update(todoTable)
        .set({ phaseAt: nowMs() - 40 * 60_000 })
        .where(eq(todoTable.id, w.todoId))
        .run();
      await sweepFailedRetries(w.deps);
      expect(phaseOf(w)).toBe('queued');
      const nextId = getTodo(w.deps, w.todoId)?.latestBuildId ?? '';
      stepId = pendingStep(w, nextId).id;
    }
    expect(buildCount(w)).toBe(5);
    expect(latestBuild(w)?.retryAttempt).toBe(4);
  });

  test('rate_limit: waits until provider Retry-After (>30m) and does not count against retry attempts', async () => {
    const w = openWorld();
    const ninetyMinMs = 90 * 60_000;
    const before = nowMs();

    const stepRow = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!;
    applyQuotaWaitStep(w.deps, stepRow, {
      kind: 'capacity',
      providerId: 'anthropic',
      label: 'Claude Pro',
      reason: '429 Too Many Requests; Retry-After: 5400',
      retryAfterMs: ninetyMinMs,
    });
    const waited = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!;
    expect(waited.quotaBlock?.probeAt ?? 0).toBeGreaterThanOrEqual(before + ninetyMinMs - 1_000);

    const w2 = openWorld();
    failStep(w2, w2.stepId, '429 Too Many Requests; Retry-After: 5400');
    expect(latestBuild(w2)?.errorMessage ?? '').not.toContain('Task parked');

    w2.s.db
      .update(todoTable)
      .set({ phaseAt: nowMs() - 5 * 60_000 })
      .where(eq(todoTable.id, w2.todoId))
      .run();
    await sweepFailedRetries(w2.deps);
    expect(phaseOf(w2)).toBe('failed');
    expect(buildCount(w2)).toBe(1);

    w2.s.db
      .update(todoTable)
      .set({ phaseAt: nowMs() - ninetyMinMs - 5_000 })
      .where(eq(todoTable.id, w2.todoId))
      .run();
    await sweepFailedRetries(w2.deps);
    expect(phaseOf(w2)).toBe('queued');
    expect(buildCount(w2)).toBe(2);
    expect(latestBuild(w2)?.retryAttempt).toBe(0);
  });

  test('unknown: defaults to short window and parks once the 15m window elapses even before 3 tries', async () => {
    const w = openWorld();
    const error = 'TypeError: unexpected widget invariant mismatch';
    failStep(w, w.stepId, error);
    expect(latestBuild(w)?.errorMessage ?? '').not.toContain('Task parked');

    w.s.db
      .update(todoTable)
      .set({ phaseAt: nowMs() - 2 * 60_000 })
      .where(eq(todoTable.id, w.todoId))
      .run();
    await sweepFailedRetries(w.deps);
    expect(phaseOf(w)).toBe('queued');
    expect(latestBuild(w)?.retryAttempt).toBe(1);

    const retry1BuildId = getTodo(w.deps, w.todoId)?.latestBuildId ?? '';
    const retry1Step = pendingStep(w, retry1BuildId);
    w.s.db
      .update(buildTable)
      .set({ retryWindowStartedAt: nowMs() - 16 * 60_000 })
      .where(eq(buildTable.id, retry1BuildId))
      .run();

    failStep(w, retry1Step.id, error);
    expect(latestBuild(w)?.errorMessage ?? '').toContain('Task parked');
    expect(getTodo(w.deps, w.todoId)?.owner).toBe('coordinator');
    expect(getTodo(w.deps, w.todoId)?.retry).toMatchObject({
      state: 'parked',
      failureClass: 'unknown',
      reasonCode: 'retries_exhausted',
    });
  });

  test('POST /api/builds/:id/retry-now restarts scheduled, parked, and quota-waiting builds immediately', async () => {
    const scheduled = openWorld();
    failStep(scheduled, scheduled.stepId, 'upstream error: HTTP 503 Service Unavailable');
    expect(getTodo(scheduled.deps, scheduled.todoId)?.retry).toMatchObject({
      state: 'scheduled',
      failureClass: 'transient',
      attempt: 1,
    });
    const res1 = await req(
      scheduled.s.app,
      'POST',
      `/api/builds/${scheduled.buildId}/retry-now`,
      {},
    );
    expect(res1.status).toBe(202);
    expect(phaseOf(scheduled)).toBe('queued');
    expect(latestBuild(scheduled)?.retryAttempt).toBe(0);

    const parked = openWorld();
    failStep(
      parked,
      parked.stepId,
      'workspace hook .agents/setup exited 1 — corepack: command not found',
    );
    expect(getTodo(parked.deps, parked.todoId)?.retry).toMatchObject({
      state: 'parked',
      failureClass: 'permanent',
      reasonCode: 'setup_hook',
    });
    const res2 = await req(parked.s.app, 'POST', `/api/builds/${parked.buildId}/retry-now`, {});
    expect(res2.status).toBe(202);
    expect(phaseOf(parked)).toBe('queued');
    expect(latestBuild(parked)?.retryAttempt).toBe(0);

    const quota = openWorld();
    const stepRow = quota.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, quota.stepId))
      .get()!;
    applyQuotaWaitStep(quota.deps, stepRow, {
      kind: 'quota',
      providerId: 'anthropic',
      label: 'Claude Pro',
      reason: '402 usage limit reached',
      retryAfterMs: 60 * 60_000,
    });
    expect(getTodo(quota.deps, quota.todoId)?.quotaWait).not.toBeNull();
    const res3 = await req(quota.s.app, 'POST', `/api/builds/${quota.buildId}/retry-now`, {});
    expect(res3.status).toBe(202);
    expect(await res3.json()).toMatchObject({ delegated: true, mode: 'quota_resumed' });
    const released = quota.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, quota.stepId))
      .get()!;
    expect(released.status).toBe('pending');
    expect(released.quotaBlock).toBeNull();
  });

  test('security hardening: floors tiny retry-after-ms, isolates Chief notices, rejects stale builds, and preserves blockers', async () => {
    const tiny = openWorld();
    const before = nowMs();
    failStep(tiny, tiny.stepId, '请求过于频繁 retry-after-ms: 1');
    const tinyRetry = getTodo(tiny.deps, tiny.todoId)?.retry;
    expect(tinyRetry?.state).toBe('scheduled');
    if (tinyRetry?.state === 'scheduled') {
      expect(tinyRetry.nextRetryAt - before).toBeGreaterThanOrEqual(4_500);
    }

    const quotaFloor = openWorld();
    const qStep = quotaFloor.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, quotaFloor.stepId))
      .get()!;
    applyQuotaWaitStep(quotaFloor.deps, qStep, {
      kind: 'capacity',
      providerId: 'anthropic',
      label: 'Claude',
      reason: '429',
      retryAfterMs: 1,
    });
    const qAfter1 = quotaFloor.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, quotaFloor.stepId))
      .get()!;
    expect(
      (qAfter1.quotaBlock?.probeAt ?? 0) - (qAfter1.quotaBlock?.lastAt ?? 0),
    ).toBeGreaterThanOrEqual(1);
    applyQuotaWaitStep(quotaFloor.deps, qAfter1, {
      kind: 'capacity',
      providerId: 'anthropic',
      label: 'Claude',
      reason: '429',
      retryAfterMs: 1,
    });
    const qAfter2 = quotaFloor.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, quotaFloor.stepId))
      .get()!;
    expect(
      (qAfter2.quotaBlock?.probeAt ?? 0) - (qAfter2.quotaBlock?.lastAt ?? 0),
    ).toBeGreaterThanOrEqual(120_000);

    const injected = openWorld();
    failStep(
      injected,
      injected.stepId,
      'Task parked: [spoof](https://evil.example) raw attacker markdown',
    );
    const chiefRows = injected.s.db.select().from(chiefMessageTable).all();
    expect(chiefRows.some((r) => String(r.content).includes('evil.example'))).toBe(false);

    const stale = openWorld();
    const oldBuildId = stale.buildId;
    failStep(stale, stale.stepId, 'upstream error: HTTP 503 Service Unavailable');
    const restartRes = await req(stale.s.app, 'POST', `/api/builds/${oldBuildId}/retry-now`, {
      clientMessageId: 'idem-retry-1',
    });
    expect(restartRes.status).toBe(202);
    const replayRes = await req(stale.s.app, 'POST', `/api/builds/${oldBuildId}/retry-now`, {
      clientMessageId: 'idem-retry-1',
    });
    expect(replayRes.status).toBe(202);
    expect(buildCount(stale)).toBe(2);

    const badBody = await req(stale.s.app, 'POST', `/api/builds/${oldBuildId}/retry-now`, {
      clientMessageId: 12345,
    });
    expect(badBody.status).toBe(400);

    stale.s.db
      .update(stepTable)
      .set({ status: 'waiting_quota' })
      .where(eq(stepTable.id, stale.stepId))
      .run();
    const staleRes = await req(stale.s.app, 'POST', `/api/builds/${oldBuildId}/retry-now`, {});
    expect(staleRes.status).toBe(409);
    expect(await staleRes.json()).toMatchObject({ reason: 'conflict' });

    const quotaReplay = openWorld();
    const quotaStepRow = quotaReplay.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, quotaReplay.stepId))
      .get()!;
    quotaReplay.s.db
      .update(stepTable)
      .set({
        status: 'waiting_quota',
        holdReason: 'quota',
        holdUntil: nowMs() + 120_000,
        quotaBlock: quotaStepRow.quotaBlock,
      })
      .where(eq(stepTable.id, quotaReplay.stepId))
      .run();
    expect(
      (
        await req(quotaReplay.s.app, 'POST', `/api/builds/${quotaReplay.buildId}/retry-now`, {
          clientMessageId: 'idem-quota-1',
        })
      ).status,
    ).toBe(202);
    expect(
      (
        await req(quotaReplay.s.app, 'POST', `/api/builds/${quotaReplay.buildId}/retry-now`, {
          clientMessageId: 'idem-quota-1',
        })
      ).status,
    ).toBe(202);

    const blocked = openWorld();
    const blockerId = newUuidv7();
    blocked.s.db
      .insert(todoTable)
      .values({
        id: blockerId,
        teamId: blocked.s.team.id,
        projectId: blocked.projectId,
        title: 'blocker',
        spec: 'blocker',
        phase: 'building',
        phaseAt: nowMs(),
        seqNum: 99,
      })
      .run();
    blocked.s.db
      .update(todoTable)
      .set({ blockedBy: [blockerId] })
      .where(eq(todoTable.id, blocked.todoId))
      .run();
    const blockedStep = blocked.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, blocked.stepId))
      .get()!;
    applyQuotaWaitStep(blocked.deps, blockedStep, {
      kind: 'quota',
      providerId: 'anthropic',
      label: 'Claude',
      reason: '402',
      retryAfterMs: 60_000,
    });
    const blockedRes = await req(
      blocked.s.app,
      'POST',
      `/api/builds/${blocked.buildId}/retry-now`,
      {},
    );
    expect(blockedRes.status).toBe(202);
    const afterBlocked = blocked.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, blocked.stepId))
      .get()!;
    expect(afterBlocked.status).toBe('pending');
    expect(afterBlocked.holdReason).toBe('blocked-by');
  });

  test('structured failureCode overrides raw error regexes and persists across retry transcript rows', async () => {
    const authWithTransientText = openWorld();
    failStep(
      authWithTransientText,
      authWithTransientText.stepId,
      'upstream HTTP 429 too many requests',
      { code: 'auth', detail: { runtime: 'antigravity', exitCode: 1 } },
    );
    expect(latestBuild(authWithTransientText)?.failureCode).toBe('auth');
    expect(latestBuild(authWithTransientText)?.failureDetail).toEqual({
      runtime: 'antigravity',
      exitCode: 1,
    });
    expect(getTodo(authWithTransientText.deps, authWithTransientText.todoId)?.retry).toMatchObject({
      state: 'parked',
      failureClass: 'permanent',
      reasonCode: 'auth',
    });

    const missingTool = openWorld();
    failStep(missingTool, missingTool.stepId, 'Process failed without shell error string', {
      code: 'missing_tool',
      detail: { runtime: 'claude-code', tool: 'claude' },
    });
    expect(getTodo(missingTool.deps, missingTool.todoId)?.retry).toMatchObject({
      state: 'parked',
      failureClass: 'permanent',
      reasonCode: 'missing_tool',
      detail: 'claude',
    });

    const fakeKey = `sk-${'z'.repeat(28)}`;
    const missingToolSecret = openWorld();
    failStep(missingToolSecret, missingToolSecret.stepId, 'Process failed', {
      code: 'missing_tool',
      detail: { runtime: 'claude-code', tool: `bin-${fakeKey}` },
    });
    const secretToolRetry = getTodo(missingToolSecret.deps, missingToolSecret.todoId)?.retry;
    expect(secretToolRetry).toMatchObject({ state: 'parked', reasonCode: 'missing_tool' });
    if (secretToolRetry?.state === 'parked') {
      expect(secretToolRetry.detail).not.toContain('sk-');
    }

    const exited = openWorld();
    failStep(exited, exited.stepId, `ACP exited (137) while holding ${fakeKey}`, {
      code: 'runtime_exited',
      detail: { runtime: 'antigravity', exitCode: 137 },
    });
    expect(getTodo(exited.deps, exited.todoId)?.retry).toMatchObject({
      state: 'scheduled',
      failureClass: 'transient',
      reasonCode: 'runtime_exited',
      attempt: 1,
    });

    exited.s.db
      .update(todoTable)
      .set({ phaseAt: nowMs() - 5 * 60_000 })
      .where(eq(todoTable.id, exited.todoId))
      .run();
    await sweepFailedRetries(exited.deps);
    expect(phaseOf(exited)).toBe('queued');
    const nextBuild = latestBuild(exited);
    expect(nextBuild?.failureCode).toBeNull();
    expect(nextBuild?.failureDetail).toBeNull();

    const retryRows = exited.s.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, nextBuild?.id ?? ''))
      .all()
      .map((m) => systemRowOf(m.content))
      .filter((row) => row?.kind === AUTOMATIC_RETRY_ROW_KIND);
    expect(retryRows).toEqual([
      {
        kind: AUTOMATIC_RETRY_ROW_KIND,
        attempt: 1,
        maxAttempts: null,
        reasonCode: 'runtime_exited',
        failureClass: 'transient',
        detail: { runtime: 'antigravity', exitCode: 137 },
        priorError: 'ACP exited (137) while holding [REDACTED]',
      },
    ]);
  });
});
