import { readdirSync } from 'node:fs';
import { CONFIRM_ANNOUNCEMENT } from '@cairn/shared';
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import webpush from 'web-push';
import {
  build as buildTable,
  externalEffect,
  message as messageTable,
  plan as planTable,
  pushSubscription,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import * as runtimeOtel from '../src/runtime-otel.js';
import { applyBuildConfirm } from '../src/services/build-confirm.js';
import { applyStepFailure, completeStep, startBuilds } from '../src/services/builds.js';
import { storeInfoReport } from '../src/services/info-handoff.js';
import { scopeMachineClaim } from '../src/services/machine-claim-scope.js';
import { withFencedTransaction } from '../src/services/machine-deps.js';
import {
  createSchedule,
  setScheduleClockListener,
  updateNextRunAt,
} from '../src/services/schedules.js';
import { isViewingThread, recordThreadPresence } from '../src/services/thread-presence.js';
import { setTodoPhase } from '../src/services/todos.js';
import {
  bootServer,
  insertMachine,
  postProject,
  req,
  seedSessionRoute,
  startLegacyBuild,
  type TestServer,
} from './helpers.js';

async function todoAtConfirm(s: TestServer) {
  const projectId = await postProject(s.app);
  const todoDoc = (await (
    await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      title: '原子收尾',
      spec: '',
    })
  ).json()) as { id: string };
  const buildId = startLegacyBuild(s, todoDoc.id, { withPlan: true });
  setTodoPhase(s.svc, todoDoc.id, 'planning');
  const steps = (await (await req(s.app, 'GET', `/api/builds/${buildId}/steps`)).json()) as {
    id: string;
    kind: string;
  }[];
  s.db
    .insert(planTable)
    .values({ id: 'plan-atomic', buildId, version: 1, content: '# 方案', createdAt: Date.now() })
    .run();
  completeStep(s.svc, steps[0]?.id ?? '');
  return { projectId, todoId: todoDoc.id, buildId };
}

function phaseOf(s: TestServer, todoId: string) {
  return s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()?.phase;
}

describe('settle atomicity (effect-paths-audit rows 2 and 3)', () => {
  test('confirm: enqueueStep throwing after the phase write leaves the whole settle uncommitted', async () => {
    const s = bootServer({});
    const { todoId, buildId } = await todoAtConfirm(s);
    expect(phaseOf(s, todoId)).toBe('confirm');

    s.db
      .update(buildTable)
      .set({ errorMessage: 'Task parked (quota)' })
      .where(eq(buildTable.id, buildId))
      .run();

    expect(() => applyBuildConfirm(s.svc, buildId, 'server', false)).toThrow();

    expect(phaseOf(s, todoId)).toBe('confirm');
    const buildSteps = s.db
      .select()
      .from(stepTable)
      .where(and(eq(stepTable.buildId, buildId), eq(stepTable.kind, 'build')))
      .all();
    expect(buildSteps).toHaveLength(0);
    const announcements = s.db
      .select()
      .from(messageTable)
      .where(
        and(
          eq(messageTable.conversationId, buildId),
          eq(messageTable.content, CONFIRM_ANNOUNCEMENT),
        ),
      )
      .all();
    expect(announcements).toHaveLength(0);
  });

  test('completeStep: a mid-settle failure leaves the step and the phase uncommitted', async () => {
    const s = bootServer({});
    const { todoId, buildId } = await todoAtConfirm(s);
    applyBuildConfirm(s.svc, buildId, 'server', false);
    const steps = (await (await req(s.app, 'GET', `/api/builds/${buildId}/steps`)).json()) as {
      id: string;
      kind: string;
      status: string;
    }[];
    const buildStep = steps.find((r) => r.kind === 'build');
    expect(buildStep?.status).toBe('pending');

    s.db.run(sql`CREATE TEMP TABLE settle_failure (armed INTEGER NOT NULL)`);
    s.db.run(sql`INSERT INTO settle_failure VALUES (1)`);
    s.db.run(sql`
      CREATE TEMP TRIGGER abort_settle BEFORE UPDATE OF phase ON todo
      WHEN NEW.phase = 'done' AND (SELECT armed FROM settle_failure) = 1
      BEGIN SELECT RAISE(ABORT, 'simulated settle failure'); END
    `);
    expect(() => completeStep(s.svc, buildStep?.id ?? '')).toThrow('simulated settle failure');
    s.db.run(sql`UPDATE settle_failure SET armed = 0`);

    const settled = s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, buildStep?.id ?? ''))
      .get();
    expect(settled?.status).not.toBe('done');
    expect(phaseOf(s, todoId)).toBe('building');

    expect(() => completeStep(s.svc, buildStep?.id ?? '')).not.toThrow();
    expect(phaseOf(s, todoId)).toBe('done');
  });

  test('applyStepFailure: a failure after build-span scheduling exports nothing and commits nothing', async () => {
    const s = bootServer({});
    const projectId = await postProject(s.app);
    const todoDoc = (await (
      await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
        title: 'span 原子性',
        spec: '',
      })
    ).json()) as { id: string };
    const buildId = startLegacyBuild(s, todoDoc.id, { withPlan: false });
    s.db.update(todoTable).set({ phase: 'building' }).where(eq(todoTable.id, todoDoc.id)).run();
    const stepRow = s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).get();
    expect(stepRow).toBeDefined();
    s.db
      .update(stepTable)
      .set({ status: 'claimed', machineId: 'm-span', claimedAt: Date.now() })
      .where(eq(stepTable.id, stepRow?.id ?? ''))
      .run();
    const claimed = s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, stepRow?.id ?? ''))
      .get();
    expect(claimed).toBeDefined();
    const span = vi.spyOn(runtimeOtel, 'emitRuntimeBuildSpan').mockImplementation(() => {});
    s.db.run(sql`CREATE TEMP TABLE settle_span_failure (armed INTEGER NOT NULL)`);
    s.db.run(sql`INSERT INTO settle_span_failure VALUES (1)`);
    s.db.run(sql`
      CREATE TEMP TRIGGER abort_span_settle BEFORE UPDATE OF phase ON todo
      WHEN NEW.phase = 'failed' AND (SELECT armed FROM settle_span_failure) = 1
      BEGIN SELECT RAISE(ABORT, 'simulated settle failure'); END
    `);
    try {
      expect(() =>
        withFencedTransaction(s.svc, (settled) => {
          if (claimed) applyStepFailure(settled, claimed, 'fixture failure');
        }),
      ).toThrow('simulated settle failure');
      expect(span).not.toHaveBeenCalled();
      expect(
        s.db
          .select()
          .from(stepTable)
          .where(eq(stepTable.id, stepRow?.id ?? ''))
          .get()?.status,
      ).toBe('claimed');
      expect(phaseOf(s, todoDoc.id)).toBe('building');
      expect(
        s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()?.errorMessage,
      ).toBeNull();

      s.db.run(sql`UPDATE settle_span_failure SET armed = 0`);
      expect(() =>
        withFencedTransaction(s.svc, (settled) => {
          if (claimed) applyStepFailure(settled, claimed, 'fixture failure');
        }),
      ).not.toThrow();
      expect(span).toHaveBeenCalledTimes(1);
      expect(
        s.db
          .select()
          .from(stepTable)
          .where(eq(stepTable.id, stepRow?.id ?? ''))
          .get()?.status,
      ).toBe('failed');
      expect(phaseOf(s, todoDoc.id)).toBe('failed');
    } finally {
      span.mockRestore();
    }
  });

  test('owner push providers and effect draining wait for the outermost commit', async () => {
    const s = bootServer({});
    const vapidKeys = s.svc.vapidKeys;
    s.svc.vapidKeys = null;
    const { todoId } = await todoAtConfirm(s);
    s.svc.vapidKeys = vapidKeys;
    s.db
      .insert(pushSubscription)
      .values({
        id: 'fixture-push',
        userId: s.user.id,
        teamId: s.team.id,
        endpoint: 'https://push.example/fixture',
        p256dh: 'fixture',
        auth: 'fixture',
        createdAt: Date.now(),
      })
      .run();
    const send = vi
      .spyOn(webpush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    const prepare = () =>
      s.db
        .update(todoTable)
        .set({ phase: 'planning', lastNotifiedOwner: null, lastNotifiedWork: null })
        .where(eq(todoTable.id, todoId))
        .run();
    prepare();
    const effectsBefore = s.db.select().from(externalEffect).all();
    try {
      expect(() =>
        withFencedTransaction(s.svc, (outer) => {
          withFencedTransaction(outer, (inner) => setTodoPhase(inner, todoId, 'confirm'));
          expect(send).not.toHaveBeenCalled();
          throw new Error('rollback owner push');
        }),
      ).toThrow('rollback owner push');
      await Promise.resolve();
      expect(send).not.toHaveBeenCalled();
      expect(s.db.select().from(externalEffect).all()).toEqual(effectsBefore);
      expect(phaseOf(s, todoId)).toBe('planning');
      withFencedTransaction(s.svc, (outer) => {
        withFencedTransaction(outer, (inner) => setTodoPhase(inner, todoId, 'confirm'));
        expect(send).not.toHaveBeenCalled();
      });
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      send.mockRestore();
      s.dispose();
    }
  });

  test('schedule clock wakes wait for the outermost commit and disappear on rollback', async () => {
    const s = bootServer({});
    const { todoId, projectId, buildId } = await todoAtConfirm(s);
    s.db
      .update(stepTable)
      .set({ status: 'claimed', machineId: 'fixture-clock', claimedAt: 23 })
      .where(eq(stepTable.buildId, buildId))
      .run();
    const claim = s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).get()!;
    const deps = scopeMachineClaim(
      { ...s.svc, box: s.secretBox, reposDir: s.reposDir, attachmentsDir: s.attachmentsDir },
      { stepId: claim.id, machineId: 'fixture-clock', generation: 23 },
    );
    recordThreadPresence(s.db, s.user.id, s.team.id, todoId, 'fixture-tab');
    expect(isViewingThread(deps.db, s.user.id, s.team.id, `/app/todo/${todoId}`)).toBe(true);
    const scheduled = createSchedule(
      s.svc,
      {
        teamId: s.team.id,
        projectId,
        todoId,
        kind: 'once',
        at: Date.now() + 3600_000,
        createdBy: s.user.id,
      },
      { allowAnyMinute: true },
    );
    const wake = vi.fn();
    setScheduleClockListener(s.db, wake);
    try {
      expect(() =>
        withFencedTransaction(deps, (outer) => {
          withFencedTransaction(outer, (inner) => updateNextRunAt(inner, scheduled.id, null));
          expect(wake).not.toHaveBeenCalled();
          throw new Error('rollback clock wake');
        }),
      ).toThrow('rollback clock wake');
      expect(wake).not.toHaveBeenCalled();
      withFencedTransaction(deps, (outer) => {
        withFencedTransaction(outer, (inner) => updateNextRunAt(inner, scheduled.id, null));
        expect(wake).not.toHaveBeenCalled();
      });
      expect(wake).toHaveBeenCalledTimes(1);
    } finally {
      setScheduleClockListener(s.db, null);
      s.dispose();
    }
  });

  test('rolling back a fenced info report leaves no attachment bytes on disk', async () => {
    const s = bootServer({});
    const { buildId } = await todoAtConfirm(s);
    const deps = { ...s.svc, attachmentsDir: s.attachmentsDir };
    const report = { buildId, teamId: s.team.id, createdBy: s.user.id, report: 'Fixture report' };
    expect(() =>
      withFencedTransaction(deps, (settled) => {
        withFencedTransaction(settled, (nested) => storeInfoReport(nested, report));
        throw new Error('rollback fenced report');
      }),
    ).toThrow('rollback fenced report');
    expect(readdirSync(s.attachmentsDir)).toEqual([]);
    expect(
      s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()?.reportAttachmentId,
    ).toBeNull();

    withFencedTransaction(deps, (settled) => storeInfoReport(settled, report));
    expect(readdirSync(s.attachmentsDir)).toEqual([s.team.id]);
  });

  test('startBuilds: a mid-dispatch failure leaves no orphan build or step (audit row 1)', async () => {
    const s = bootServer({});
    const machineId = insertMachine(s);
    seedSessionRoute(s, { machineId });
    const projectId = await postProject(s.app);
    const todoDoc = (await (
      await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
        title: '派发原子性',
        spec: '',
      })
    ).json()) as { id: string };

    const machineHub = s.machineHub as { wake: unknown };
    const originalWake = machineHub.wake;
    machineHub.wake = () => {
      throw new Error('simulated kill after step insert');
    };
    try {
      expect(() =>
        startBuilds(s.svc, { projectId, todoIds: [todoDoc.id], triggerSource: 'user' }),
      ).toThrow('simulated kill');
    } finally {
      machineHub.wake = originalWake;
    }

    expect(phaseOf(s, todoDoc.id)).toBe('todo');
    expect(
      s.db.select().from(buildTable).where(eq(buildTable.todoId, todoDoc.id)).all(),
    ).toHaveLength(0);
    expect(s.db.select().from(stepTable).all()).toHaveLength(0);

    expect(() =>
      startBuilds(s.svc, { projectId, todoIds: [todoDoc.id], triggerSource: 'user' }),
    ).not.toThrow();
    expect(phaseOf(s, todoDoc.id)).toBe('queued');
  });
});
