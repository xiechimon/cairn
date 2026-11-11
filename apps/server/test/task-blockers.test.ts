import { stepKindSchema } from '@cairn/shared';
import { and, eq, like } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { build, machine, step, todo } from '../src/db/schema.js';
import {
  BLOCKED_BY_HOLD,
  BLOCKED_STEP_KINDS,
  releaseBlockedSteps,
} from '../src/services/blockers.js';
import { applyBuildStepAction, enqueueStep } from '../src/services/builds.js';
import { refreshClaudeRateParks } from '../src/services/claude-rate-limit.js';
import { claimStep, heartbeatStep } from '../src/services/machines.js';
import { reconcileOwners } from '../src/services/owner.js';
import { applyQuotaWaitStep, sweepQuotaWaitSteps } from '../src/services/quota-wait.js';
import * as shipGate from '../src/services/ship-gate.js';
import { getTodo, setTodoPhase } from '../src/services/todos.js';
import { H, ownerTodo, registerChiefHarness, relay, toolDeps } from './chief-harness.js';
import { req, seedRoute, seedSessionRoute } from './helpers.js';

registerChiefHarness();

const TASK_WORK_KINDS = stepKindSchema.options.filter((kind) => kind !== 'chief');

async function create(over: Record<string, unknown> = {}): Promise<string> {
  seedSessionRoute(H.s);
  const out = (await relay('create_todo', {
    ...ownerTodo('Do the work.'),
    ...over,
  })) as { id: string };
  return out.id;
}

function row(id: string) {
  return H.s.db.select().from(todo).where(eq(todo.id, id)).get()!;
}

function retarget(id: string, machineId: string) {
  H.s.db.update(todo).set({ routeOverride: { machineId } }).where(eq(todo.id, id)).run();
}

function sessions(id: string) {
  const latest = row(id).latestBuildId;
  if (latest === null) return [];
  return H.s.db.select().from(step).where(eq(step.buildId, latest)).all();
}

function finish(id: string, phase: 'done' | 'failed' | 'closed'): void {
  H.s.db.update(todo).set({ phase, phaseAt: Date.now() }).where(eq(todo.id, id)).run();
}

describe('the Coordinator starts what it creates (task stall class 3)', () => {
  test('create_todo starts a thread: queued, one session, triggered by the Coordinator', async () => {
    const id = await create();
    expect(row(id).phase).toBe('queued');
    expect(sessions(id).map((s) => [s.kind, s.holdReason])).toEqual([['session', null]]);
    const buildRow = H.s.db
      .select()
      .from(build)
      .where(eq(build.id, row(id).latestBuildId!))
      .get();
    expect(buildRow?.triggerSource).toBe('chief');
  });

  test('reopen_todos starts a new build instead of parking the task in todo', async () => {
    const id = await create();
    const first = row(id).latestBuildId;
    finish(id, 'closed');
    await relay('reopen_todos', { todoIds: [id] });
    expect(row(id).phase).toBe('queued');
    expect(row(id).latestBuildId).not.toBe(first);
  });
});

describe('reopen_todos reports a task it could not start', () => {
  test('a reopened task whose start is refused is listed with the reason', async () => {
    const id = await create();
    finish(id, 'closed');
    H.s.db.update(todo).set({ archivedAt: Date.now() }).where(eq(todo.id, id)).run();
    const out = (await relay('reopen_todos', { todoIds: [id] })) as {
      transitioned: string[];
      started: string[];
      notStarted?: Record<string, string>;
    };
    expect(out.transitioned).toEqual([id]);
    expect(out.started).toEqual([]);
    expect(out.notStarted?.[id]).toMatch(/Unarchive/);
  });
});

describe('blockedBy holds a task until its blockers are satisfied', () => {
  test('dependency holds cover every task-work kind and exclude the Coordinator', () => {
    expect(BLOCKED_STEP_KINDS).toEqual(TASK_WORK_KINDS);
  });

  test('a task created behind an unfinished blocker is held, and released once the blocker is done', async () => {
    const blocker = await create();
    const id = await create({ blockedBy: [blocker] });
    expect(row(id).blockedBy).toEqual([blocker]);
    expect(sessions(id)[0]?.holdReason).toBe(BLOCKED_BY_HOLD);
    releaseBlockedSteps(toolDeps());
    expect(sessions(id)[0]?.holdReason).toBe(BLOCKED_BY_HOLD);
    finish(blocker, 'done');
    releaseBlockedSteps(toolDeps());
    expect(sessions(id)[0]?.holdReason).toBeNull();
    expect(sessions(id)[0]?.holdUntil).toBeNull();
  });

  test('dependsOn and blockedBy both hold the automatically started session', async () => {
    const first = await create();
    const second = await create();
    const id = await create({ dependsOn: [first], blockedBy: [second, first] });
    expect(row(id).blockedBy).toEqual([first, second]);
    expect(sessions(id)[0]?.holdReason).toBe(BLOCKED_BY_HOLD);
    finish(first, 'done');
    releaseBlockedSteps(toolDeps());
    expect(sessions(id)[0]?.holdReason).toBe(BLOCKED_BY_HOLD);
    finish(second, 'done');
    releaseBlockedSteps(toolDeps());
    expect(sessions(id)[0]?.holdReason).toBeNull();
  });

  test.each(TASK_WORK_KINDS)(
    'update_todo parks a pending %s and completion releases it',
    async (kind) => {
      const blocker = await create();
      const id = await create();
      H.s.db
        .update(step)
        .set({ kind })
        .where(eq(step.id, sessions(id)[0]!.id))
        .run();
      await relay('update_todo', { todoId: id, blockedBy: [blocker] });
      expect(sessions(id)[0]?.holdReason).toBe(BLOCKED_BY_HOLD);
      finish(blocker, 'done');
      releaseBlockedSteps(toolDeps());
      expect(sessions(id)[0]?.holdReason).toBeNull();
      expect(sessions(id)[0]?.holdUntil).toBeNull();
    },
  );

  test.each(['before-confirm', 'after-confirm'])(
    'plan confirmation enqueues a blocked build when the edge is added %s',
    async (timing) => {
      const blocker = await create();
      const id = await create();
      const buildId = row(id).latestBuildId!;
      H.s.db
        .update(step)
        .set({ kind: 'plan', status: 'done' })
        .where(eq(step.buildId, buildId))
        .run();
      H.s.db.update(todo).set({ phase: 'confirm' }).where(eq(todo.id, id)).run();
      if (timing === 'before-confirm')
        await relay('update_todo', { todoId: id, blockedBy: [blocker] });
      await applyBuildStepAction(toolDeps(), buildId, { action: 'confirm' });
      if (timing === 'after-confirm')
        await relay('update_todo', { todoId: id, blockedBy: [blocker] });
      const work = sessions(id).find((entry) => entry.kind === 'build')!;
      expect(work).toMatchObject({ status: 'pending', holdReason: BLOCKED_BY_HOLD });
      finish(blocker, 'done');
      releaseBlockedSteps(toolDeps());
      expect(sessions(id).find((entry) => entry.id === work.id)?.holdReason).toBeNull();
    },
  );

  test.each(['tool', 'rest'] as const)(
    'deleting a blocker through %s keeps its dependent held and owned',
    async (route) => {
      const blocker = await create();
      const id = await create({ blockedBy: [blocker] });
      if (route === 'tool') await relay('delete_todos', { todoIds: [blocker] });
      else expect((await req(H.s.app, 'DELETE', `/api/todos/${blocker}`)).status).toBe(204);
      releaseBlockedSteps(toolDeps());
      reconcileOwners(toolDeps());
      expect(sessions(id)[0]?.holdReason).toBe(BLOCKED_BY_HOLD);
      expect(getTodo(toolDeps(), id)?.owner).toBe('coordinator');
      const record = getTodo(toolDeps(), id)!;
      enqueueStep(toolDeps(), record.latestBuildId!, 'session', H.teamId, 'Continue.');
      expect(sessions(id).every((entry) => entry.holdReason === BLOCKED_BY_HOLD)).toBe(true);
      await relay('update_todo', { todoId: id, blockedBy: [] });
      releaseBlockedSteps(toolDeps());
      expect(sessions(id).every((entry) => entry.holdReason === null)).toBe(true);
    },
  );

  test('a blocker-only update publishes the new dependency with an increased version', async () => {
    const blocker = await create();
    const id = await create();
    const before = row(id).v;
    const publish = vi.spyOn(H.s.hub, 'publishTodoDoc');
    await relay('update_todo', { todoId: id, blockedBy: [blocker] });
    expect(row(id).v).toBeGreaterThan(before);
    expect(publish).toHaveBeenCalledWith(
      H.teamId,
      expect.objectContaining({ id, blockedBy: [blocker], v: row(id).v }),
    );
  });

  test.each(TASK_WORK_KINDS)('a later %s is held at insert', async (kind) => {
    const blocker = await create();
    const id = await create({ blockedBy: [blocker] });
    const record = getTodo(toolDeps(), id)!;
    enqueueStep(toolDeps(), record.latestBuildId!, kind, H.teamId, 'Continue.');
    expect(sessions(id).every((s) => s.holdReason === BLOCKED_BY_HOLD)).toBe(true);
  });

  test.each([
    ['an unknown id', () => ['missing-task']],
    ['the task itself', (self: string) => [self]],
  ])('blockedBy naming %s is refused', async (_name, ids) => {
    const id = await create();
    await expect(relay('update_todo', { todoId: id, blockedBy: ids(id) })).rejects.toMatchObject({
      status: 400,
    });
    expect(row(id).blockedBy ?? []).toEqual([]);
  });

  test('create_todo with two online machines and no pin creates nothing', async () => {
    const before = H.s.db.select().from(todo).all().length;
    H.s.db
      .insert(machine)
      .values({
        ...readyMachine({
          teamId: H.teamId,
          name: 'second-online',
          cliVersion: '0.1.0',
        }),
        id: 'second-online',
        online: true,
      })
      .run();
    H.s.db.update(machine).set({ online: true }).where(eq(machine.teamId, H.teamId)).run();
    await expect(create()).rejects.toMatchObject({ status: 409 });
    expect(H.s.db.select().from(todo).all()).toHaveLength(before);
  });

  test('create_todo with an invalid blockedBy creates nothing', async () => {
    const before = H.s.db.select().from(todo).all().length;
    await expect(create({ blockedBy: ['missing-task'] })).rejects.toMatchObject({ status: 400 });
    expect(H.s.db.select().from(todo).all()).toHaveLength(before);
    expect(H.s.db.select().from(build).all()).toHaveLength(0);
  });

  test('update_todo that fails on another field leaves blockedBy unchanged', async () => {
    const blocker = await create();
    const id = await create();
    await expect(
      relay('update_todo', { todoId: id, blockedBy: [blocker], projectId: 'missing-project' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(row(id).blockedBy ?? []).toEqual([]);
    expect(sessions(id)[0]?.holdReason).toBeNull();
  });

  test.each(TASK_WORK_KINDS)('a blocker cannot be added under a running %s', async (kind) => {
    const blocker = await create();
    const id = await create();
    const [session] = sessions(id);
    H.s.db.update(step).set({ kind, status: 'claimed' }).where(eq(step.id, session!.id)).run();
    heartbeatStep(
      {
        ...H.s.svc,
        box: H.s.secretBox,
        reposDir: H.s.reposDir,
        attachmentsDir: H.s.attachmentsDir,
      },
      null,
      session!.id,
    );
    await expect(relay('update_todo', { todoId: id, blockedBy: [blocker] })).rejects.toMatchObject({
      status: 409,
    });
    expect(row(id).blockedBy ?? []).toEqual([]);
  });

  test.each(TASK_WORK_KINDS)(
    'a quota-waiting %s stays blocked through recovery and claim',
    async (kind) => {
      const blocker = await create();
      const id = await create();
      finish(blocker, 'done');
      H.s.db
        .update(step)
        .set({ status: 'done' })
        .where(eq(step.buildId, row(blocker).latestBuildId!))
        .run();
      const machineId = 'blocker-claim-machine';
      H.s.db
        .insert(machine)
        .values(
          readyMachine({
            id: machineId,
            teamId: H.teamId,
            name: 'Blocker claim',
            online: true,
            enabledRuntimes: ['pi'],
          }),
        )
        .run();
      seedSessionRoute(H.s, { provider: 'stub-gw', modelId: 'stub-model', machineId });
      seedRoute(H.s, 'review', { provider: 'stub-gw', modelId: 'stub-model', machineId });
      retarget(id, machineId);
      const [session] = sessions(id);
      H.s.db.update(step).set({ kind }).where(eq(step.id, session!.id)).run();
      applyQuotaWaitStep(toolDeps(), sessions(id)[0]!, {
        kind: 'quota',
        providerId: 'stub-gw',
        reason: 'Quota exhausted',
        retryAfterMs: 1,
      });
      finish(blocker, 'failed');
      await relay('update_todo', { todoId: id, blockedBy: [blocker] });
      sweepQuotaWaitSteps(toolDeps(), Date.now() + 1000);
      expect(sessions(id)[0]?.status).toBe('pending');
      const claim = () =>
        claimStep(
          {
            ...H.s.svc,
            box: H.s.secretBox,
            reposDir: H.s.reposDir,
            attachmentsDir: H.s.attachmentsDir,
          },
          machineId,
          H.teamId,
          0,
          'http://localhost',
        );
      expect(await claim()).toBeNull();
      expect(sessions(id)[0]?.holdReason).toBe(BLOCKED_BY_HOLD);
      finish(blocker, 'done');
      releaseBlockedSteps(toolDeps());
      expect((await claim())?.step.id).toBe(session!.id);
    },
  );

  test('a recovered subscription-policy park preserves dependency holds', async () => {
    const blocker = await create();
    const id = await create();
    const [session] = sessions(id);
    applyQuotaWaitStep(toolDeps(), session!, {
      kind: 'quota',
      providerId: 'stub-gw',
      reason: 'subscription-only',
    });
    const quotaBlock = sessions(id)[0]!.quotaBlock!;
    H.s.db
      .update(step)
      .set({ quotaBlock: { ...quotaBlock, source: 'subscription_policy' } })
      .where(eq(step.id, session!.id))
      .run();
    await relay('update_todo', { todoId: id, blockedBy: [blocker] });
    H.s.db.update(todo).set({ routeOverride: null }).where(eq(todo.id, id)).run();
    refreshClaudeRateParks(
      {
        ...H.s.svc,
        box: H.s.secretBox,
        reposDir: H.s.reposDir,
        attachmentsDir: H.s.attachmentsDir,
      },
      H.teamId,
    );
    expect(sessions(id)[0]?.status).toBe('pending');
    expect(sessions(id)[0]?.holdReason).toBe(BLOCKED_BY_HOLD);
  });

  test.each(TASK_WORK_KINDS)(
    'an edge added during asynchronous %s claim prevents it',
    async (kind) => {
      const blocker = await create();
      const id = await create();
      finish(blocker, 'done');
      H.s.db
        .update(step)
        .set({ status: 'done' })
        .where(eq(step.buildId, row(blocker).latestBuildId!))
        .run();
      const machineId = 'blocker-race-machine';
      H.s.db
        .insert(machine)
        .values(
          readyMachine({
            id: machineId,
            teamId: H.teamId,
            name: 'Blocker race',
            online: true,
            enabledRuntimes: ['pi'],
          }),
        )
        .run();
      seedSessionRoute(H.s, { provider: 'stub-gw', modelId: 'stub-model', machineId });
      seedRoute(H.s, 'review', { provider: 'stub-gw', modelId: 'stub-model', machineId });
      retarget(id, machineId);
      H.s.db
        .update(step)
        .set({ kind })
        .where(eq(step.id, sessions(id)[0]!.id))
        .run();
      let resume = () => {};
      const prepared = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const gate = vi.spyOn(shipGate, 'reverifyShip').mockImplementation(async () => {
        await prepared;
        return null;
      });
      const result = claimStep(
        {
          ...H.s.svc,
          box: H.s.secretBox,
          reposDir: H.s.reposDir,
          attachmentsDir: H.s.attachmentsDir,
        },
        machineId,
        H.teamId,
        0,
        'http://localhost',
      );
      try {
        expect(gate).toHaveBeenCalledOnce();
        await relay('update_todo', { todoId: id, blockedBy: [blocker] });
        finish(blocker, 'failed');
        await relay('update_todo', { todoId: id, blockedBy: [blocker] });
        resume();
        expect(await result).toBeNull();
        expect(sessions(id)[0]).toMatchObject({ status: 'pending', holdReason: BLOCKED_BY_HOLD });
      } finally {
        resume();
        await result;
        gate.mockRestore();
      }
    },
  );

  test.each(TASK_WORK_KINDS)(
    'claim rechecks an unheld %s against current blockers',
    async (kind) => {
      const blocker = await create();
      const id = await create({ blockedBy: [blocker] });
      H.s.db
        .update(step)
        .set({ status: 'done' })
        .where(eq(step.buildId, row(blocker).latestBuildId!))
        .run();
      const machineId = 'unheld-claim-machine';
      H.s.db
        .insert(machine)
        .values(
          readyMachine({
            id: machineId,
            teamId: H.teamId,
            name: 'Unheld claim',
            online: true,
            enabledRuntimes: ['pi'],
          }),
        )
        .run();
      seedSessionRoute(H.s, { provider: 'stub-gw', modelId: 'stub-model', machineId });
      seedRoute(H.s, 'review', { provider: 'stub-gw', modelId: 'stub-model', machineId });
      retarget(id, machineId);
      const pending = sessions(id)[0]!;
      H.s.db
        .update(step)
        .set({ kind, holdReason: null, holdUntil: null })
        .where(eq(step.id, pending.id))
        .run();
      const claim = () =>
        claimStep(
          {
            ...H.s.svc,
            box: H.s.secretBox,
            reposDir: H.s.reposDir,
            attachmentsDir: H.s.attachmentsDir,
          },
          machineId,
          H.teamId,
          0,
          'http://localhost',
        );
      expect(await claim()).toBeNull();
      expect(sessions(id)[0]).toMatchObject({ status: 'pending', holdReason: BLOCKED_BY_HOLD });
      finish(blocker, 'done');
      releaseBlockedSteps(toolDeps());
      expect((await claim())?.step.id).toBe(pending.id);
    },
  );

  test('a cycle is refused', async () => {
    const a = await create();
    const b = await create({ blockedBy: [a] });
    await expect(relay('update_todo', { todoId: a, blockedBy: [b] })).rejects.toMatchObject({
      status: 400,
    });
  });

  test('a failed blocker hands the held task to the Coordinator once', async () => {
    const blocker = await create();
    const id = await create({ blockedBy: [blocker] });
    finish(blocker, 'failed');
    releaseBlockedSteps(toolDeps());
    reconcileOwners(toolDeps());
    reconcileOwners(toolDeps());
    expect(getTodo(toolDeps(), id)?.owner).toBe('coordinator');
    expect(sessions(id)[0]?.holdReason).toBe(BLOCKED_BY_HOLD);
    const wakes = H.s.db
      .select()
      .from(step)
      .where(and(eq(step.kind, 'chief'), like(step.prompt, `%watch:${id}%`)))
      .all();
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.prompt).toContain(`#${row(blocker).seqNum}`);
  });

  test('an ended blocked-task wake hands the unchanged task to the owner', async () => {
    const blocker = await create();
    const id = await create({ blockedBy: [blocker] });
    finish(blocker, 'failed');
    reconcileOwners(toolDeps());
    const turn = row(id).coordinatorTurn;
    expect(turn).not.toBeNull();
    H.s.db.update(step).set({ status: 'done' }).where(eq(step.id, turn!.stepId)).run();
    reconcileOwners(toolDeps());
    expect(getTodo(toolDeps(), id)?.owner).toBe('owner');
    expect(sessions(id)[0]?.holdReason).toBe(BLOCKED_BY_HOLD);
  });

  test('the Coordinator dropping the edge releases the task', async () => {
    const blocker = await create();
    const id = await create({ blockedBy: [blocker] });
    finish(blocker, 'failed');
    await relay('update_todo', { todoId: id, blockedBy: [] });
    releaseBlockedSteps(toolDeps());
    expect(sessions(id)[0]?.holdReason).toBeNull();
    setTodoPhase(toolDeps(), id, 'building');
    expect(getTodo(toolDeps(), id)?.owner).toBeNull();
  });
});
