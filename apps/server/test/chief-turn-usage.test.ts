import type { MachineDoneBody } from '@cairn/shared';
import { machineDoneBodySchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { build, chiefTurnUsage, step as stepTable, todo, tokenUsage } from '../src/db/schema.js';
import { finishStep } from '../src/services/machines.js';
import { H, registerChiefHarness } from './chief-harness.js';
import { insertMachine } from './helpers.js';

registerChiefHarness();

function deps() {
  return {
    ...H.s.svc,
    box: H.s.secretBox,
    reposDir: H.s.reposDir,
    attachmentsDir: H.s.attachmentsDir,
  };
}

function claimedStep(
  machineId: string,
  id: string,
  over: Partial<typeof stepTable.$inferInsert> = {},
): void {
  const now = Date.now();
  H.s.db
    .insert(stepTable)
    .values({
      id,
      buildId: H.threadId,
      kind: 'chief',
      prompt: 'hello',
      status: 'claimed',
      machineId,
      claimedAt: now,
      lastHeartbeatAt: now,
      createdAt: now,
      ...over,
    })
    .run();
}

function reclaim(machineId: string, id: string): void {
  H.s.db
    .update(stepTable)
    .set({ status: 'claimed', machineId, claimedAt: Date.now() + 1 })
    .where(eq(stepTable.id, id))
    .run();
}

const usage = (
  model: string,
  input: number,
  cacheRead: number,
  extra: Partial<NonNullable<MachineDoneBody['usage']>[number]> = {},
) => ({ model, input, output: 7, cacheRead, cacheWrite: 3, ...extra });

function turnRows() {
  return H.s.db.select().from(chiefTurnUsage).orderBy(chiefTurnUsage.stepId).all();
}

describe('chief turns record their own usage per step', () => {
  test('one turn writes one row with that turn tokens and its time to first token', async () => {
    const machineId = insertMachine(H.s);
    claimedStep(machineId, 'turn-1');
    await finishStep(deps(), machineId, 'turn-1', {
      status: 'success',
      usage: [usage('pi/glm', 1000, 800, { ttftMs: 412 })],
    });
    expect(turnRows()).toMatchObject([
      {
        stepId: 'turn-1',
        threadId: H.threadId,
        model: 'pi/glm',
        input: 1000,
        output: 7,
        cacheRead: 800,
        cacheWrite: 3,
        ttftMs: 412,
      },
    ]);
  });

  test('a second turn gets its own row while the cumulative total keeps adding', async () => {
    const machineId = insertMachine(H.s);
    claimedStep(machineId, 'turn-1');
    await finishStep(deps(), machineId, 'turn-1', {
      status: 'success',
      usage: [usage('pi/glm', 1000, 800)],
    });
    claimedStep(machineId, 'turn-2');
    await finishStep(deps(), machineId, 'turn-2', {
      status: 'success',
      usage: [usage('pi/glm', 1500, 1200)],
    });
    expect(turnRows().map((r) => [r.stepId, r.input, r.cacheRead, r.ttftMs])).toEqual([
      ['turn-1', 1000, 800, null],
      ['turn-2', 1500, 1200, null],
    ]);
    expect(
      H.s.db.select().from(tokenUsage).where(eq(tokenUsage.buildId, H.threadId)).get(),
    ).toMatchObject({ input: 2500, cacheRead: 2000 });
  });

  test('a turn that used two models writes one row per model', async () => {
    const machineId = insertMachine(H.s);
    claimedStep(machineId, 'turn-1');
    await finishStep(deps(), machineId, 'turn-1', {
      status: 'success',
      usage: [usage('pi/a', 10, 0), usage('pi/b', 20, 5)],
    });
    expect(turnRows().map((r) => [r.model, r.input])).toEqual([
      ['pi/a', 10],
      ['pi/b', 20],
    ]);
  });

  test('a reclaimed step reporting again adds to its row and keeps the first measured ttft', async () => {
    const machineId = insertMachine(H.s);
    claimedStep(machineId, 'turn-1');
    await finishStep(deps(), machineId, 'turn-1', {
      status: 'stopped',
      usage: [usage('pi/glm', 100, 50, { ttftMs: 900 })],
    });
    reclaim(machineId, 'turn-1');
    await finishStep(deps(), machineId, 'turn-1', {
      status: 'success',
      usage: [usage('pi/glm', 200, 150, { ttftMs: 300 })],
    });
    expect(turnRows()).toMatchObject([
      { stepId: 'turn-1', input: 300, output: 14, cacheRead: 200, cacheWrite: 6, ttftMs: 900 },
    ]);
  });

  test('a failed or stopped turn still records the tokens it spent', async () => {
    const machineId = insertMachine(H.s);
    claimedStep(machineId, 'turn-1');
    await finishStep(deps(), machineId, 'turn-1', {
      status: 'stopped',
      usage: [usage('pi/glm', 40, 0)],
    });
    expect(turnRows().map((r) => r.input)).toEqual([40]);
  });

  test('a late report for a step that is no longer claimed writes nothing', async () => {
    const machineId = insertMachine(H.s);
    claimedStep(machineId, 'turn-1', { status: 'done' });
    await finishStep(deps(), machineId, 'turn-1', {
      status: 'success',
      usage: [usage('pi/glm', 40, 0)],
    });
    expect(turnRows()).toEqual([]);
  });

  test('a report from a machine that does not own the step is refused and writes nothing', async () => {
    const owner = insertMachine(H.s);
    const other = insertMachine(H.s);
    claimedStep(owner, 'turn-1');
    await expect(
      finishStep(deps(), other, 'turn-1', { status: 'success', usage: [usage('pi/glm', 40, 0)] }),
    ).rejects.toThrow();
    expect(turnRows()).toEqual([]);
  });

  test('a build step keeps only the cumulative total', async () => {
    const machineId = insertMachine(H.s);
    const now = Date.now();
    H.s.db
      .insert(todo)
      .values({
        id: 'todo-1',
        teamId: H.teamId,
        projectId: H.projectId,
        title: 't',
        phase: 'building',
        phaseAt: now,
        seqNum: 1,
        latestBuildId: 'build-1',
      })
      .run();
    H.s.db
      .insert(build)
      .values({
        id: 'build-1',
        todoId: 'todo-1',
        withPlan: false,
        prevPhase: 'todo',
        triggerSource: 'user',
        createdAt: now,
      })
      .run();
    claimedStep(machineId, 'build-step', { buildId: 'build-1', kind: 'build' });
    await finishStep(deps(), machineId, 'build-step', {
      status: 'success',
      usage: [usage('pi/glm', 40, 0)],
    });
    expect(turnRows()).toEqual([]);
    expect(
      H.s.db.select().from(tokenUsage).where(eq(tokenUsage.buildId, 'build-1')).get()?.input,
    ).toBe(40);
  });
});

describe('the done report carries time to first token', () => {
  test('ttftMs is kept and a negative one is rejected', () => {
    const body = { status: 'success', usage: [usage('m', 1, 0, { ttftMs: 12 })] };
    expect(machineDoneBodySchema.parse(body).usage?.[0]?.ttftMs).toBe(12);
    expect(
      machineDoneBodySchema.safeParse({
        status: 'success',
        usage: [usage('m', 1, 0, { ttftMs: -1 })],
      }).success,
    ).toBe(false);
  });
});
