import { type MachineDoneBody, STOP_MESSAGE } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  machine as machineTable,
  plan as planTable,
  project as projectTable,
  step as stepTable,
  stopPending as stopPendingTable,
  todo as todoTable,
} from '../src/db/schema.js';
import {
  applyStoppedStep,
  prepareStopForDone,
  sweepAbandonedBuildSteps,
} from '../src/services/builds.js';
import { type ChiefToolDeps, transitionTodos } from '../src/services/chief-tools.js';
import { claimStep, finishStep } from '../src/services/machines.js';
import { bootServer, req, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

interface World {
  s: TestServer;
  teamId: string;
  todoId: string;
  buildId: string;
  stepId: string;
  machineId: string;
  base: number;
}

function machineDepsOf(s: TestServer) {
  return { ...s.svc, box: s.secretBox, reposDir: s.reposDir, attachmentsDir: s.attachmentsDir };
}

function makeWorld(opts: {
  phase: 'queued' | 'planning' | 'building' | 'review' | 'closed';
  stepStatus: 'pending' | 'claimed' | 'done';
  stepKind?: 'plan' | 'build' | 'merge' | 'review';
  claimedAgo?: number;
  machineOnline?: boolean;
}): World {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const base = Date.now();
  const teamId = s.team.id;
  const suffix = Math.random().toString(36).slice(2);
  const todoId = `todo-${suffix}`;
  const buildId = `build-${suffix}`;
  const stepId = `step-${suffix}`;
  const machineId = `machine-${suffix}`;
  s.db
    .insert(projectTable)
    .values({ id: `proj-${suffix}`, name: 'close', teamId })
    .run();
  s.db
    .insert(machineTable)
    .values({
      id: machineId,
      teamId,
      name: machineId,
      online: opts.machineOnline ?? true,
      maxConcurrent: 8,
      enabledRuntimes: ['pi'],
    })
    .run();
  s.db
    .insert(agentTable)
    .values({
      id: `agent-${suffix}`,
      teamId,
      displayName: 'close-agent',
      provider: 'stub-gw',
      modelId: 'stub-model',
      machineId,
    })
    .run();
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId,
      projectId: `proj-${suffix}`,
      title: 'close target',
      phase: opts.phase,
      phaseAt: base,
      seqNum: 1,
      assignment: { plan: { agentId: `agent-${suffix}` }, build: { agentId: `agent-${suffix}` } },
      latestBuildId: buildId,
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: true,
      prevPhase: 'todo',
      triggerSource: 'user',
      createdAt: base - 60_000,
    })
    .run();
  const claimedAt = base - (opts.claimedAgo ?? 1_000);
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId,
      kind: opts.stepKind ?? 'plan',
      status: opts.stepStatus,
      ...(opts.stepStatus === 'claimed'
        ? { machineId, claimedAt, lastHeartbeatAt: claimedAt }
        : {}),
      createdAt: base - 60_000,
    })
    .run();
  return { s, teamId, todoId, buildId, stepId, machineId, base };
}

const chiefActor = { kind: 'agent' as const, name: '总管' };
const chiefDepsOf = (w: World) => ({ ...w.s.svc, box: w.s.secretBox }) as unknown as ChiefToolDeps;
const stepStatus = (w: World) =>
  w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!.status;
const todoPhase = (w: World) =>
  w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!.phase;
const claim = (w: World) =>
  claimStep(machineDepsOf(w.s), w.machineId, w.teamId, 10, 'http://localhost');

describe('#1445 closing a queued card stops pending steps', () => {
  test('close_todos (chief / MCP same funnel): step stopped, machine cannot claim it', async () => {
    const w = makeWorld({ phase: 'queued', stepStatus: 'pending' });
    const out = transitionTodos(chiefDepsOf(w), w.teamId, [w.todoId], 'closed', chiefActor);
    expect(out.transitioned).toEqual([w.todoId]);
    expect(todoPhase(w)).toBe('closed');
    expect(await claim(w)).toBeNull();
    expect(stepStatus(w)).toBe('stopped');
    expect(
      w.s.db.select().from(buildTable).where(eq(buildTable.id, w.buildId)).get()!.errorMessage,
    ).toBe(STOP_MESSAGE);
  });

  test('PATCH phase=closed: step stopped, machine cannot claim it', async () => {
    const w = makeWorld({ phase: 'queued', stepStatus: 'pending' });
    const res = await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { phase: 'closed' });
    expect(res.status).toBe(200);
    expect(todoPhase(w)).toBe('closed');
    expect(await claim(w)).toBeNull();
    expect(stepStatus(w)).toBe('stopped');
  });
});

describe('#1445 closing a running card (claimed step)', () => {
  test('delegated stop: stopPending in place + machine receives stop; after reporting stopped the card is still closed', () => {
    const w = makeWorld({ phase: 'planning', stepStatus: 'claimed' });
    const events: { type: string }[] = [];
    w.s.machineHub.subscribe(w.teamId, (ev) => {
      if ('type' in ev) events.push(ev as { type: string });
    });
    const out = transitionTodos(chiefDepsOf(w), w.teamId, [w.todoId], 'closed', chiefActor);
    expect(out.transitioned).toEqual([w.todoId]);
    const pending = w.s.db.select().from(stopPendingTable).all();
    expect(pending.map((p) => p.stepId)).toEqual([w.stepId]);
    expect(events.some((e) => e.type === 'stop')).toBe(true);
    applyStoppedStep(w.s.svc, w.stepId);
    expect(stepStatus(w)).toBe('stopped');
    expect(todoPhase(w)).toBe('closed');
  });
});

describe('#1445 lost-contact sweep does not spare steps of already-closed cards', () => {
  test('legacy: a closed card still has a pending step -> sweep stops it; open queued cards untouched (control group)', async () => {
    const zombie = makeWorld({ phase: 'closed', stepStatus: 'pending' });
    sweepAbandonedBuildSteps(zombie.s.svc, zombie.base);
    expect(stepStatus(zombie)).toBe('stopped');
    expect(todoPhase(zombie)).toBe('closed');
    expect(await claim(zombie)).toBeNull();

    const live = makeWorld({ phase: 'queued', stepStatus: 'pending' });
    sweepAbandonedBuildSteps(live.s.svc, live.base);
    expect(stepStatus(live)).toBe('pending');
    expect(await claim(live)).not.toBeNull();
  });

  test('lost-contact claimed step of a closed card: stopped, not released back to pending', () => {
    const w = makeWorld({
      phase: 'closed',
      stepStatus: 'claimed',
      claimedAgo: 60 * 60_000,
      machineOnline: false,
    });
    sweepAbandonedBuildSteps(w.s.svc, w.base);
    expect(stepStatus(w)).toBe('stopped');
    expect(todoPhase(w)).toBe('closed');
  });
});

describe('#1445 closing a card cancels an in-flight stop-and-done reservation', () => {
  test('closing while a done reservation is in flight: after the report lands the card is still closed', async () => {
    const w = makeWorld({ phase: 'planning', stepStatus: 'claimed' });
    expect(prepareStopForDone(w.s.svc, w.todoId)).toEqual({ state: 'stopping' });
    const res = await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { phase: 'closed' });
    expect(res.status).toBe(200);
    applyStoppedStep(w.s.svc, w.stepId);
    expect(todoPhase(w)).toBe('closed');
  });
});

describe('#1447 / #1486 raw PATCH cannot move a queued card back to to-do', () => {
  test('queued -> todo: 409 pointing at /reset, card and pending step unchanged', async () => {
    const w = makeWorld({ phase: 'queued', stepStatus: 'pending' });
    const res = await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { phase: 'todo' });
    expect(res.status).toBe(409);
    expect(todoPhase(w)).toBe('queued');
    expect(stepStatus(w)).toBe('pending');
  });

  test('control group: a phase-unchanged PATCH (including queued to queued) does not touch pending steps', async () => {
    const w = makeWorld({ phase: 'queued', stepStatus: 'pending' });
    for (const body of [{ title: 'renamed' }, { phase: 'queued' }]) {
      const res = await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, body);
      expect(res.status).toBe(200);
    }
    expect(todoPhase(w)).toBe('queued');
    expect(stepStatus(w)).toBe('pending');
    expect(await claim(w)).not.toBeNull();
  });
});

describe('#1445 after a card leaves in-progress, a stop report no longer changes the phase', () => {
  test('reopen after close, before the report: the report does not overwrite the reopened phase', async () => {
    const w = makeWorld({ phase: 'planning', stepStatus: 'claimed' });
    expect(
      (await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { phase: 'closed' })).status,
    ).toBe(200);
    expect(
      (await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { phase: 'review' })).status,
    ).toBe(200);
    applyStoppedStep(w.s.svc, w.stepId);
    expect(stepStatus(w)).toBe('stopped');
    expect(todoPhase(w)).toBe('review');
  });

  test('raw PATCH planning -> todo: 409 pointing at /reset, no stop sent (#1486)', async () => {
    const w = makeWorld({ phase: 'planning', stepStatus: 'claimed' });
    const events: { type: string }[] = [];
    w.s.machineHub.subscribe(w.teamId, (ev) => {
      if ('type' in ev) events.push(ev as { type: string });
    });
    const res = await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { phase: 'todo' });
    expect(res.status).toBe(409);
    expect(w.s.db.select().from(stopPendingTable).all()).toEqual([]);
    expect(events.some((e) => e.type === 'stop')).toBe(false);
    expect(todoPhase(w)).toBe('planning');
  });
});

describe('#1451 marking an in-progress card done also stops active steps', () => {
  const stopEvents = (w: World) => {
    const events: { type: string }[] = [];
    w.s.machineHub.subscribe(w.teamId, (ev) => {
      if ('type' in ev) events.push(ev as { type: string });
    });
    return events;
  };

  test('raw PATCH queued -> done: step stopped, machine cannot claim it', async () => {
    const w = makeWorld({ phase: 'queued', stepStatus: 'pending' });
    const res = await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { phase: 'done' });
    expect(res.status).toBe(200);
    expect(todoPhase(w)).toBe('done');
    expect(await claim(w)).toBeNull();
    expect(stepStatus(w)).toBe('stopped');
  });

  test('raw PATCH planning -> done: delegates stopping the claimed step, card still done after the report', async () => {
    const w = makeWorld({ phase: 'planning', stepStatus: 'claimed' });
    const events = stopEvents(w);
    const res = await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { phase: 'done' });
    expect(res.status).toBe(200);
    expect(
      w.s.db
        .select()
        .from(stopPendingTable)
        .all()
        .map((p) => p.stepId),
    ).toEqual([w.stepId]);
    expect(events.some((e) => e.type === 'stop')).toBe(true);
    applyStoppedStep(w.s.svc, w.stepId);
    expect(todoPhase(w)).toBe('done');
  });

  test('complete_todos marking a building card done: delegates stopping the claimed step, card still done after the report', () => {
    const w = makeWorld({ phase: 'building', stepStatus: 'claimed', stepKind: 'build' });
    const events = stopEvents(w);
    const out = transitionTodos(chiefDepsOf(w), w.teamId, [w.todoId], 'done', chiefActor);
    expect(out.transitioned).toEqual([w.todoId]);
    expect(
      w.s.db
        .select()
        .from(stopPendingTable)
        .all()
        .map((p) => p.stepId),
    ).toEqual([w.stepId]);
    expect(events.some((e) => e.type === 'stop')).toBe(true);
    applyStoppedStep(w.s.svc, w.stepId);
    expect(todoPhase(w)).toBe('done');
  });

  test('control group: review -> done (no active step) sends no stop', async () => {
    const patched = makeWorld({ phase: 'review', stepStatus: 'done', stepKind: 'build' });
    const patchEvents = stopEvents(patched);
    const res = await req(patched.s.app, 'PATCH', `/api/todos/${patched.todoId}`, {
      phase: 'done',
    });
    expect(res.status).toBe(200);
    expect(todoPhase(patched)).toBe('done');
    expect(patchEvents.some((e) => e.type === 'stop')).toBe(false);

    const completed = makeWorld({ phase: 'review', stepStatus: 'done', stepKind: 'build' });
    const completeEvents = stopEvents(completed);
    const out = transitionTodos(
      chiefDepsOf(completed),
      completed.teamId,
      [completed.todoId],
      'done',
      {
        kind: 'user',
        name: '我',
      },
    );
    expect(out.transitioned).toEqual([completed.todoId]);
    expect(completeEvents.some((e) => e.type === 'stop')).toBe(false);
    expect(completed.s.db.select().from(stopPendingTable).all()).toEqual([]);
  });
});

describe('#1451 lost reservation and lost-contact sweep: completed behaves like closed', () => {
  test.each(['done', 'todo'] as const)(
    'keep 预定丢失后回报到达：卡已是 %s，不被 gate 回落改写',
    (phase) => {
      const w = makeWorld({ phase: 'planning', stepStatus: 'claimed' });
      w.s.db
        .insert(stepTable)
        .values({
          id: `${w.stepId}-done`,
          buildId: w.buildId,
          kind: 'plan',
          status: 'done',
          createdAt: w.base - 120_000,
        })
        .run();
      w.s.db.update(todoTable).set({ phase }).where(eq(todoTable.id, w.todoId)).run();
      applyStoppedStep(w.s.svc, w.stepId);
      expect(stepStatus(w)).toBe('stopped');
      expect(todoPhase(w)).toBe(phase);
    },
  );

  test('residual pending step of a completed card: sweep stops it', async () => {
    const w = makeWorld({ phase: 'queued', stepStatus: 'pending' });
    w.s.db.update(todoTable).set({ phase: 'done' }).where(eq(todoTable.id, w.todoId)).run();
    sweepAbandonedBuildSteps(w.s.svc, w.base);
    expect(stepStatus(w)).toBe('stopped');
    expect(todoPhase(w)).toBe('done');
    expect(await claim(w)).toBeNull();
  });

  test('lost-contact claimed step of a completed card: stopped, not released back to pending', () => {
    const w = makeWorld({
      phase: 'building',
      stepStatus: 'claimed',
      stepKind: 'build',
      claimedAgo: 60 * 60_000,
      machineOnline: false,
    });
    w.s.db.update(todoTable).set({ phase: 'done' }).where(eq(todoTable.id, w.todoId)).run();
    sweepAbandonedBuildSteps(w.s.svc, w.base);
    expect(stepStatus(w)).toBe('stopped');
    expect(todoPhase(w)).toBe('done');
  });
});

describe('#1453 a step finishing while a stop is in flight: no advance, no re-queue for a card that left in-progress', () => {
  const success = (extra: Partial<MachineDoneBody> = {}): MachineDoneBody => ({
    status: 'success',
    ...extra,
  });
  const report = (w: World, body: MachineDoneBody) =>
    finishStep(machineDepsOf(w.s), w.machineId, w.stepId, body);
  const withPlanDoc = (w: World) =>
    w.s.db
      .insert(planTable)
      .values({
        id: `plan-${w.buildId}`,
        buildId: w.buildId,
        content: '# plan',
        stepId: null,
        createdAt: w.base,
      })
      .run();
  const move = async (w: World, phase: string) =>
    expect((await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { phase })).status).toBe(200);

  test('plan step of a closed card reports success (with a plan document): report does not throw, step done, card still closed', async () => {
    const w = makeWorld({ phase: 'planning', stepStatus: 'claimed' });
    withPlanDoc(w);
    await move(w, 'closed');
    await expect(report(w, success())).resolves.toBeUndefined();
    expect(stepStatus(w)).toBe('done');
    expect(todoPhase(w)).toBe('closed');
  });

  test('build step of a done card reports success: report does not throw, card still done', async () => {
    const w = makeWorld({ phase: 'building', stepStatus: 'claimed', stepKind: 'build' });
    await move(w, 'done');
    await expect(report(w, success({ hasChanges: true }))).resolves.toBeUndefined();
    expect(stepStatus(w)).toBe('done');
    expect(todoPhase(w)).toBe('done');
  });

  test('plan step of a card closed then reopened to to-do reports success: card stays todo, no confirm', async () => {
    const w = makeWorld({ phase: 'planning', stepStatus: 'claimed' });
    withPlanDoc(w);
    await move(w, 'closed');
    await move(w, 'todo');
    await expect(report(w, success())).resolves.toBeUndefined();
    expect(todoPhase(w)).toBe('todo');
  });

  test('plan step of a closed card reports success (no plan document): no rewrite step re-enqueued, machine cannot claim', async () => {
    const w = makeWorld({ phase: 'planning', stepStatus: 'claimed' });
    await move(w, 'closed');
    await expect(report(w, success())).resolves.toBeUndefined();
    const steps = w.s.db.select().from(stepTable).where(eq(stepTable.buildId, w.buildId)).all();
    expect(steps.map((r) => r.status)).toEqual(['done']);
    expect(await claim(w)).toBeNull();
  });

  test('control group: plan step of a planning card reports success and proceeds to confirm as usual', async () => {
    const w = makeWorld({ phase: 'planning', stepStatus: 'claimed' });
    withPlanDoc(w);
    await expect(report(w, success())).resolves.toBeUndefined();
    expect(todoPhase(w)).toBe('confirm');
  });
});

describe('#1453 other shapes of the same race', () => {
  const report = (w: World, body: MachineDoneBody) =>
    finishStep(machineDepsOf(w.s), w.machineId, w.stepId, body);
  const move = async (w: World, phase: string) =>
    expect((await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { phase })).status).toBe(200);
  const buildError = (w: World) =>
    w.s.db.select().from(buildTable).where(eq(buildTable.id, w.buildId)).get()!.errorMessage;

  test('merge step of a closed card reports success: report does not throw, card still closed', async () => {
    const w = makeWorld({ phase: 'review', stepStatus: 'claimed', stepKind: 'merge' });
    await move(w, 'closed');
    await expect(report(w, { status: 'success' })).resolves.toBeUndefined();
    expect(stepStatus(w)).toBe('done');
    expect(todoPhase(w)).toBe('closed');
  });

  test('review step of a closed card reports success with blocking: report does not throw, no replan enqueued', async () => {
    const w = makeWorld({ phase: 'review', stepStatus: 'claimed', stepKind: 'review' });
    await move(w, 'closed');
    const findings = {
      conclusion: 'blocking',
      findings: [{ id: '1', severity: 'blocking' as const, summary: 'x' }],
    };
    await expect(report(w, { status: 'success', findings })).resolves.toBeUndefined();
    expect(todoPhase(w)).toBe('closed');
    const steps = w.s.db.select().from(stepTable).where(eq(stepTable.buildId, w.buildId)).all();
    expect(steps.map((r) => r.status)).toEqual(['done']);
  });

  test('build step of a done card reports success with zero changes: step done, not marked failed by the artifact gate', async () => {
    const w = makeWorld({ phase: 'building', stepStatus: 'claimed', stepKind: 'build' });
    await move(w, 'done');
    await expect(report(w, { status: 'success', hasChanges: false })).resolves.toBeUndefined();
    expect(stepStatus(w)).toBe('done');
    expect(buildError(w)).toBeNull();
    expect(todoPhase(w)).toBe('done');
  });

  test('reopen after close and rerun (new build): the old build late-success does not advance the card', async () => {
    const w = makeWorld({ phase: 'planning', stepStatus: 'claimed' });
    w.s.db
      .insert(planTable)
      .values({ id: `plan-${w.buildId}`, buildId: w.buildId, content: '# plan', createdAt: w.base })
      .run();
    await move(w, 'closed');
    w.s.db
      .insert(buildTable)
      .values({
        id: `${w.buildId}-rerun`,
        todoId: w.todoId,
        withPlan: true,
        prevPhase: 'todo',
        triggerSource: 'user',
        createdAt: w.base,
      })
      .run();
    w.s.db
      .update(todoTable)
      .set({ phase: 'planning', latestBuildId: `${w.buildId}-rerun` })
      .where(eq(todoTable.id, w.todoId))
      .run();
    await expect(report(w, { status: 'success' })).resolves.toBeUndefined();
    expect(stepStatus(w)).toBe('done');
    expect(todoPhase(w)).toBe('planning');
  });

  test('build step finishes while a stop-and-done reservation is in flight: card lands done, no review', async () => {
    const w = makeWorld({ phase: 'building', stepStatus: 'claimed', stepKind: 'build' });
    const res = await req(w.s.app, 'POST', `/api/todos/${w.todoId}/stop-and-done`, {});
    expect(res.status).toBe(200);
    expect(todoPhase(w)).toBe('building');
    await expect(report(w, { status: 'success', hasChanges: true })).resolves.toBeUndefined();
    expect(stepStatus(w)).toBe('done');
    expect(todoPhase(w)).toBe('done');
  });
});
