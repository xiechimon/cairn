import type { TranscriptRow } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { build, gateState, gateVerdict, step, todo } from '../src/db/schema.js';
import { addChiefWatch, sendChiefMessage } from '../src/services/chief.js';
import { upsertChiefRow } from '../src/services/machine-deps.js';
import { createAutonomousTodo, getTodo, setTodoPhase } from '../src/services/todos.js';
import { H, registerChiefHarness } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();

async function seedTask(watched: boolean) {
  const record = createAutonomousTodo(H.s, {
    teamId: H.teamId,
    projectId: H.projectId,
    title: 'Repair board counts',
    spec: 'Refresh counts after dragging a task.',
    createdBy: H.userId,
    ownerId: H.userId,
    orchestration: { threadId: H.threadId },
  });
  H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, record.id)).run();
  const deps = {
    db: H.s.db,
    hub: H.s.hub,
    convHub: H.s.convHub,
    machineHub: H.s.machineHub,
    user: H.s.user,
  };
  if (watched)
    addChiefWatch(deps, {
      teamId: H.teamId,
      todo: getTodo(deps, record.id)!,
      projectName: 'demo',
      threadId: H.threadId,
    });
  return { deps, todoId: record.id };
}

async function messages(threadId = H.threadId) {
  const response = await req(H.s.app, 'GET', `/api/conversations/${threadId}/messages`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { messages: TranscriptRow[] }).messages;
}

describe('worker reports in the chief conversation', () => {
  test.each(['failed', 'review'] as const)(
    '%s persists and publishes a system report; any wake comes from the owner reconciler',
    async (phase) => {
      const { deps, todoId } = await seedTask(true);
      const publish = vi.spyOn(H.s.convHub, 'publishMessage');
      setTodoPhase(deps, todoId, phase);
      const rows = await messages();
      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0]!.content as string)).toEqual({
        kind: 'thread-report',
        todoId,
        phase,
        seqNum: 1,
        title: 'Repair board counts',
      });
      expect(publish).toHaveBeenCalledWith(H.threadId, expect.objectContaining(rows[0]));
    },
  );

  test.each(['done'] as const)(
    '%s persists and publishes a system report before the wake reply',
    async (phase) => {
      const { deps, todoId } = await seedTask(true);
      const publish = vi.spyOn(H.s.convHub, 'publishMessage');
      setTodoPhase(deps, todoId, phase);
      const rows = await messages();
      expect(rows).toHaveLength(1);
      const report = rows[0]!;
      const wake = H.s.db.select().from(step).where(eq(step.buildId, H.threadId)).get()!;
      expect(report.role).toBe('system');
      expect(JSON.parse(report.content as string)).toEqual({
        kind: 'thread-report',
        todoId,
        phase,
        seqNum: 1,
        title: 'Repair board counts',
        wakeStepId: wake.id,
        ...(phase === 'done' ? { verified: false } : {}),
      });
      expect(publish).toHaveBeenCalledWith(H.threadId, expect.objectContaining(report));
      expect(wake.prompt).toMatch(/^\[wake:settle\]/);
      expect(report.createdAt).toBeLessThanOrEqual(wake.createdAt);
      upsertChiefRow(deps, {
        id: `reply-${wake.id}`,
        threadId: H.threadId,
        role: 'assistant',
        content: 'The worker result has been checked.',
        createdAt: report.createdAt,
      });
      expect((await messages()).map((row) => row.id)).toEqual([report.id, `reply-${wake.id}`]);
      setTodoPhase(deps, todoId, phase);
      expect(await messages()).toHaveLength(2);
    },
  );

  test.each([
    ['pass', 'head-1', null, true],
    ['pass', 'head-0', 'patch-1', true],
    ['pass', 'head-0', 'patch-0', false],
    ['pass', 'head-0', null, false],
    ['block', 'head-1', 'patch-1', false],
  ] as const)(
    'a done report records verified only for a passing verify verdict on the judged head or patch (%s, %s, %s)',
    async (outcome, verdictHead, verdictDigest, verified) => {
      const { deps, todoId } = await seedTask(true);
      H.s.db
        .insert(build)
        .values({
          id: 'build-v',
          todoId,
          triggerSource: 'chief',
          withPlan: false,
          createdAt: 1,
        })
        .run();
      H.s.db.update(todo).set({ latestBuildId: 'build-v' }).where(eq(todo.id, todoId)).run();
      H.s.db
        .insert(gateState)
        .values({
          buildId: 'build-v',
          ready: true,
          policy: 'autonomous',
          headSha: 'head-1',
          patchDigest: 'patch-1',
          blockers: [],
          evaluatedAt: 2,
        })
        .run();
      H.s.db
        .insert(gateVerdict)
        .values({
          stepId: 'verify-step',
          buildId: 'build-v',
          kind: 'verify',
          outcome,
          headSha: verdictHead,
          patchDigest: verdictDigest,
          expectedHeadSha: verdictHead,
          createdAt: 2,
        })
        .run();
      setTodoPhase(deps, todoId, 'done');
      const [report] = await messages();
      expect(JSON.parse(report!.content as string)).toMatchObject({ phase: 'done', verified });
    },
  );

  test.each([
    ['no gate state', undefined],
    ['a gate state with no judged head', null],
  ] as const)('a passing verify verdict with %s is not verified', async (_label, judgedHead) => {
    const { deps, todoId } = await seedTask(true);
    H.s.db
      .insert(build)
      .values({ id: 'build-u', todoId, triggerSource: 'chief', withPlan: false, createdAt: 1 })
      .run();
    H.s.db.update(todo).set({ latestBuildId: 'build-u' }).where(eq(todo.id, todoId)).run();
    if (judgedHead !== undefined)
      H.s.db
        .insert(gateState)
        .values({
          buildId: 'build-u',
          ready: true,
          policy: 'autonomous',
          headSha: judgedHead,
          patchDigest: null,
          blockers: [],
          evaluatedAt: 2,
        })
        .run();
    H.s.db
      .insert(gateVerdict)
      .values({
        stepId: 'verify-unbound',
        buildId: 'build-u',
        kind: 'verify',
        outcome: 'pass',
        headSha: 'head-1',
        expectedHeadSha: 'head-1',
        createdAt: 2,
      })
      .run();
    setTodoPhase(deps, todoId, 'done');
    const [report] = await messages();
    expect(JSON.parse(report!.content as string)).toMatchObject({ phase: 'done', verified: false });
  });

  test('two reports queued behind a busy chief identify distinct wake steps', async () => {
    const { deps, todoId: firstId } = await seedTask(true);
    const { todoId: secondId } = await seedTask(true);
    const current = sendChiefMessage(deps, H.teamId, {
      threadId: H.threadId,
      content: 'Check current progress',
    });
    H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, current.message.id)).run();
    setTodoPhase(deps, firstId, 'done');
    setTodoPhase(deps, secondId, 'done');
    const reports = (await messages())
      .filter((message) => message.role === 'system')
      .map(
        (message) =>
          JSON.parse(message.content as string) as { todoId: string; wakeStepId: string },
      );
    expect(reports).toHaveLength(2);
    expect(new Set(reports.map((report) => report.wakeStepId)).size).toBe(2);
    for (const report of reports) {
      const wake = H.s.db.select().from(step).where(eq(step.id, report.wakeStepId)).get();
      expect(wake).toMatchObject({ buildId: H.threadId, kind: 'chief', status: 'pending' });
      expect(wake?.prompt).toContain(`任务 #${getTodo(deps, report.todoId)!.seqNum}`);
    }
  });

  test('unwatched tasks report into the Coordinator thread without waking it', async () => {
    const { deps, todoId } = await seedTask(false);
    setTodoPhase(deps, todoId, 'done');
    const rows = await messages();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.role).toBe('system');
    const report = JSON.parse(rows[0]!.content as string);
    expect(report).toMatchObject({ kind: 'thread-report', todoId, phase: 'done' });
    expect(report.wakeStepId).toBeUndefined();
    expect(H.s.db.select().from(step).where(eq(step.buildId, H.threadId)).all()).toEqual([]);
  });

  test('non-report phases do not create a report', async () => {
    const { deps, todoId } = await seedTask(true);
    setTodoPhase(deps, todoId, 'closed');
    expect(await messages()).toEqual([]);
  });
});
