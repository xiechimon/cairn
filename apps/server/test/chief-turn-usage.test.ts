import type { MachineDoneBody } from '@cairn/shared';
import { chiefDigestThreadId, machineDoneBodySchema } from '@cairn/shared';
import { and, desc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { isColdResume, SHORT_RETENTION_MS } from '../src/coordinator/runtime/cold-slim.js';
import { compactionWindow } from '../src/coordinator/runtime/compaction.js';
import {
  build,
  chiefThread,
  chiefTurnUsage,
  provider as providerTable,
  routingRule,
  step as stepTable,
  todo,
  tokenUsage,
} from '../src/db/schema.js';
import { getChiefEnvelope } from '../src/services/chief.js';
import {
  DEFAULT_CONTEXT_WINDOW,
  lastContextBearingTurnUsage,
  lastTurnUsageForColdResume,
  setCoordinatorServerContextEnabled,
} from '../src/services/coordinator-context.js';
import { finishStep } from '../src/services/machines.js';
import { H, registerChiefHarness } from './chief-harness.js';
import { insertMachine } from './helpers.js';

registerChiefHarness();
beforeEach(() => setCoordinatorServerContextEnabled(true));
afterEach(() => setCoordinatorServerContextEnabled(false));

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

  test('a background digest step is not a Coordinator turn and writes no turn row', async () => {
    const machineId = insertMachine(H.s);
    claimedStep(machineId, 'digest-step', { buildId: chiefDigestThreadId(H.chiefId) });
    await finishStep(deps(), machineId, 'digest-step', {
      status: 'success',
      usage: [usage('pi/glm', 9000, 0)],
    });
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

describe('the context meter under CAIRN_COORDINATOR_SERVER_CONTEXT', () => {
  test('flag off: no turn row is written and the meter stays empty', async () => {
    setCoordinatorServerContextEnabled(false);
    const machineId = insertMachine(H.s);
    claimedStep(machineId, 'turn-off');
    await finishStep(deps(), machineId, 'turn-off', {
      status: 'success',
      usage: [usage('pi/glm', 1000, 800, { contextTokens: 1810 })],
    });
    expect(turnRows()).toEqual([]);
    expect(getChiefEnvelope(H.s.svc, H.teamId).context).toBeNull();
  });

  test('flag off after prior rows: retained turn usage does not keep the meter lit', async () => {
    const machineId = insertMachine(H.s);
    claimedStep(machineId, 'turn-prior');
    await finishStep(deps(), machineId, 'turn-prior', {
      status: 'success',
      usage: [usage('pi/glm', 1000, 800, { contextTokens: 1810 })],
    });
    expect(getChiefEnvelope(H.s.svc, H.teamId, H.threadId).context).toMatchObject({
      tokens: 1810,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
    });
    setCoordinatorServerContextEnabled(false);
    expect(getChiefEnvelope(H.s.svc, H.teamId, H.threadId).context).toBeNull();
  });

  test('threadId scopes the meter to that thread, not the newest chief-wide turn', async () => {
    const machineId = insertMachine(H.s);
    claimedStep(machineId, 'turn-scope-a');
    await finishStep(deps(), machineId, 'turn-scope-a', {
      status: 'success',
      usage: [usage('pi/glm', 100, 0, { contextTokens: 1_000 })],
    });
    const otherThread = `chief-other-scope`;
    const now = Date.now();
    H.s.db
      .insert(chiefThread)
      .values({
        id: otherThread,
        chiefId: H.chiefId,
        userId: H.userId,
        teamId: H.teamId,
        title: 'other',
        createdAt: now,
        updatedAt: now,
        sessionRuntime: 'pi',
        sessionId: '',
        sessionOpenedAt: now,
        toolDefHashes: {},
        toolResultHashes: {},
        archivedAt: now,
      })
      .run();
    H.s.db
      .insert(chiefTurnUsage)
      .values({
        stepId: 'turn-scope-b',
        threadId: otherThread,
        model: 'pi/glm',
        input: 1,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        contextTokens: 9_000,
        createdAt: now + 10,
      })
      .run();
    expect(getChiefEnvelope(H.s.svc, H.teamId).context).toMatchObject({
      tokens: 9_000,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
    });
    expect(getChiefEnvelope(H.s.svc, H.teamId, H.threadId).context).toMatchObject({
      tokens: 1_000,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
    });
    expect(getChiefEnvelope(H.s.svc, H.teamId, otherThread).context).toMatchObject({
      tokens: 9_000,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
    });
  });

  test('a subscription model with no window on its provider row reads its window from the catalog', async () => {
    const machineId = insertMachine(H.s);
    claimedStep(machineId, 'turn-codex');
    await finishStep(deps(), machineId, 'turn-codex', {
      status: 'success',
      usage: [usage('openai-codex/gpt-6.1-sol', 37_321, 23, { contextTokens: 49_376 })],
    });
    expect(getChiefEnvelope(H.s.svc, H.teamId, H.threadId).context).toMatchObject({
      tokens: 49_376,
      contextWindow: 500_000,
      compactAt: compactionWindow(500_000).backgroundAt,
    });
  });

  test('flag on: the meter shows the last turn context the provider reported, not the running sum', async () => {
    const machineId = insertMachine(H.s);
    claimedStep(machineId, 'turn-a');
    await finishStep(deps(), machineId, 'turn-a', {
      status: 'success',
      usage: [usage('stub-gw/stub-model', 9000, 40000, { contextTokens: 21_000 })],
    });
    claimedStep(machineId, 'turn-b', { createdAt: Date.now() + 5 });
    await finishStep(deps(), machineId, 'turn-b', {
      status: 'success',
      usage: [usage('stub-gw/stub-model', 6000, 50000, { contextTokens: 23_456 })],
    });
    expect(turnRows().map((r) => [r.stepId, r.contextTokens])).toEqual([
      ['turn-a', 21_000],
      ['turn-b', 23_456],
    ]);
    const context = getChiefEnvelope(H.s.svc, H.teamId, H.threadId).context;
    expect(context).toMatchObject({
      tokens: 23_456,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      resume: 'warm',
    });
    const turnB = turnRows().find((r) => r.stepId === 'turn-b');
    expect(turnB).toBeDefined();
    expect(context?.resumeExpiresAt).toBe((turnB?.createdAt ?? 0) + SHORT_RETENTION_MS);
    expect(context?.resumeExpiresInMs).toBeGreaterThan(0);
    expect((context?.resumeExpiresAt ?? 0) - (context?.resumeExpiresInMs ?? 0)).toBeLessThanOrEqual(
      Date.now() + 100,
    );
  });

  test('flag on: a coordinator model-route change reports cold resume', async () => {
    const machineId = insertMachine(H.s);
    claimedStep(machineId, 'turn-route-a');
    await finishStep(deps(), machineId, 'turn-route-a', {
      status: 'success',
      usage: [usage('stub-gw/stub-model', 1000, 800, { contextTokens: 1810 })],
    });
    expect(getChiefEnvelope(H.s.svc, H.teamId, H.threadId).context).toMatchObject({
      tokens: 1810,
      resume: 'warm',
    });
    H.s.db
      .update(routingRule)
      .set({ modelId: 'stub-model-2', updatedAt: Date.now() })
      .where(eq(routingRule.use, 'coordinator'))
      .run();
    const after = getChiefEnvelope(H.s.svc, H.teamId, H.threadId).context;
    expect(after).toMatchObject({
      tokens: 1810,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      resume: 'cold',
    });
    expect(after?.resumeExpiresAt).toBeUndefined();
    expect(after?.resumeExpiresInMs).toBeUndefined();
  });

  test('flag on: a turn without contextTokens (claude-code) leaves the meter empty', async () => {
    const machineId = insertMachine(H.s);
    claimedStep(machineId, 'turn-cc');
    await finishStep(deps(), machineId, 'turn-cc', {
      status: 'success',
      usage: [usage('claude-code/claude-haiku-5-5', 9000, 40000)],
    });
    expect(getChiefEnvelope(H.s.svc, H.teamId).context).toBeNull();
  });

  test('flag on: cold-resume still sees a context-less turn model for route mismatch', async () => {
    const machineId = insertMachine(H.s);
    claimedStep(machineId, 'turn-cc-cold');
    await finishStep(deps(), machineId, 'turn-cc-cold', {
      status: 'success',
      usage: [usage('claude-code/claude-haiku-5-5', 9000, 40000)],
    });
    expect(lastContextBearingTurnUsage(H.s.db, H.threadId)).toBeNull();
    const raw = lastTurnUsageForColdResume(H.s.db, H.threadId);
    expect(raw).toMatchObject({
      model: 'claude-code/claude-haiku-5-5',
      contextTokens: null,
      stepId: 'turn-cc-cold',
    });
    expect(
      isColdResume({
        activeModel: 'stub-gw/stub-model',
        lastUsage:
          raw === null
            ? null
            : {
                createdAt: raw.createdAt,
                cacheRead: raw.cacheRead,
                input: raw.input,
                contextTokens: raw.contextTokens,
                model: raw.model,
              },
      }),
    ).toBe(true);
    expect(getChiefEnvelope(H.s.svc, H.teamId, H.threadId).context).toBeNull();
  });

  test('flag on: a multi-model turn keeps the context-bearing model for the meter', async () => {
    const machineId = insertMachine(H.s);
    claimedStep(machineId, 'turn-multi');
    await finishStep(deps(), machineId, 'turn-multi', {
      status: 'success',
      usage: [usage('pi/model-a', 100, 0, { contextTokens: 5_000 }), usage('pi/model-b', 50, 0)],
    });
    expect(turnRows().map((r) => [r.model, r.contextTokens])).toEqual([
      ['pi/model-a', 5_000],
      ['pi/model-b', null],
    ]);
    expect(getChiefEnvelope(H.s.svc, H.teamId, H.threadId).context).toMatchObject({
      tokens: 5_000,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
    });
  });

  test('flag on: A→B→A keeps meter and cold-resume send path on the final model (Warm)', async () => {
    const machineId = insertMachine(H.s);
    const modelA = 'stub-gw/stub-model';
    const modelB = 'stub-gw/other-model';
    claimedStep(machineId, 'turn-aba');
    await finishStep(deps(), machineId, 'turn-aba', {
      status: 'success',
      usage: [
        usage(modelA, 100, 0, { contextTokens: 1_000 }),
        usage(modelB, 50, 0),
        usage(modelA, 200, 800, { contextTokens: 5_000 }),
      ],
    });
    const rows = turnRows().filter((r) => r.stepId === 'turn-aba');
    expect(Object.fromEntries(rows.map((r) => [r.model, r.contextTokens]))).toEqual({
      [modelA]: 5_000,
      [modelB]: null,
    });
    const modelARow = rows.find((r) => r.model === modelA);
    expect(modelARow).toBeDefined();
    H.s.db
      .update(chiefTurnUsage)
      .set({ createdAt: (modelARow?.createdAt ?? 0) + 10 })
      .where(and(eq(chiefTurnUsage.stepId, 'turn-aba'), eq(chiefTurnUsage.model, modelB)))
      .run();
    const newestByCreatedAt = H.s.db
      .select()
      .from(chiefTurnUsage)
      .where(eq(chiefTurnUsage.threadId, H.threadId))
      .orderBy(desc(chiefTurnUsage.createdAt))
      .get();
    expect(newestByCreatedAt?.model).toBe(modelB);
    expect(lastContextBearingTurnUsage(H.s.db, H.threadId)).toMatchObject({
      model: modelA,
      contextTokens: 5_000,
      stepId: 'turn-aba',
    });
    const shared = lastTurnUsageForColdResume(H.s.db, H.threadId);
    expect(shared).toMatchObject({
      model: modelA,
      contextTokens: 5_000,
      stepId: 'turn-aba',
    });
    const meter = getChiefEnvelope(H.s.svc, H.teamId, H.threadId).context;
    expect(meter).toMatchObject({
      tokens: 5_000,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      resume: 'warm',
    });
    const sendCold = isColdResume({
      lastUsage:
        shared === null
          ? null
          : {
              createdAt: shared.createdAt,
              cacheRead: shared.cacheRead,
              input: shared.input,
              contextTokens: shared.contextTokens,
              model: shared.model,
            },
      activeModel: modelA,
    });
    expect(sendCold).toBe(false);
    expect(meter?.resume === 'warm').toBe(!sendCold);
    expect(
      isColdResume({
        lastUsage:
          newestByCreatedAt === undefined
            ? null
            : {
                createdAt: newestByCreatedAt.createdAt,
                cacheRead: newestByCreatedAt.cacheRead,
                input: newestByCreatedAt.input,
                contextTokens: newestByCreatedAt.contextTokens,
                model: newestByCreatedAt.model,
              },
        activeModel: modelA,
      }),
    ).toBe(true);
  });

  test('flag on: a later turn without contextTokens hides the meter instead of keeping the prior percent', async () => {
    const machineId = insertMachine(H.s);
    claimedStep(machineId, 'turn-prior-ctx');
    await finishStep(deps(), machineId, 'turn-prior-ctx', {
      status: 'success',
      usage: [usage('pi/glm', 1000, 800, { contextTokens: 1810 })],
    });
    expect(getChiefEnvelope(H.s.svc, H.teamId, H.threadId).context).toMatchObject({
      tokens: 1810,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
    });
    claimedStep(machineId, 'turn-no-ctx', { createdAt: Date.now() + 5 });
    await finishStep(deps(), machineId, 'turn-no-ctx', {
      status: 'success',
      usage: [usage('claude-code/claude-haiku-5-5', 9000, 40000)],
    });
    expect(getChiefEnvelope(H.s.svc, H.teamId, H.threadId).context).toBeNull();
    expect(lastContextBearingTurnUsage(H.s.db, H.threadId)).toBeNull();
    expect(lastTurnUsageForColdResume(H.s.db, H.threadId)).toMatchObject({
      model: 'claude-code/claude-haiku-5-5',
      contextTokens: null,
      stepId: 'turn-no-ctx',
    });
  });

  test('flag on: the window comes from the model that ran the last turn, from its provider catalog', async () => {
    expect(DEFAULT_CONTEXT_WINDOW).toBe(200_000);
    H.s.db
      .insert(providerTable)
      .values({
        id: 'prov-stub',
        teamId: H.teamId,
        providerId: 'stub-gw',
        label: 'stub',
        baseUrl: 'https://example.invalid/v1',
        api: 'anthropic-messages',
        compat: {},
        models: [{ id: 'stub-model', name: 'stub-model' }],
        createdBy: H.userId,
        createdAt: 1,
        updatedAt: 1,
      } as typeof providerTable.$inferInsert)
      .run();
    const machineId = insertMachine(H.s);
    claimedStep(machineId, 'turn-w');
    await finishStep(deps(), machineId, 'turn-w', {
      status: 'success',
      usage: [usage('stub-gw/stub-model', 100, 0, { contextTokens: 110 })],
    });
    expect(getChiefEnvelope(H.s.svc, H.teamId, H.threadId).context).toMatchObject({
      tokens: 110,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      resume: 'warm',
    });
    claimedStep(machineId, 'turn-fallback', { createdAt: Date.now() + 5 });
    await finishStep(deps(), machineId, 'turn-fallback', {
      status: 'success',
      usage: [usage('other-gw/fallback-model', 100, 800, { contextTokens: 120 })],
    });
    expect(getChiefEnvelope(H.s.svc, H.teamId, H.threadId).context).toMatchObject({
      tokens: 120,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      resume: 'cold',
    });
  });
});
