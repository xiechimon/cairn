import { CHIEF_NOTICE_KIND, type TranscriptRow } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import {
  build,
  chiefMessage,
  gateState,
  gateVerdict,
  message,
  step,
  todo,
} from '../src/db/schema.js';
import { addChiefWatch, sendChiefMessage } from '../src/services/chief.js';
import { upsertChiefRow } from '../src/services/machine-deps.js';
import { reportNoticeId } from '../src/services/report-turn.js';
import { createAutonomousTodo, getTodo, setTodoPhase } from '../src/services/todos.js';
import { buildVerified } from '../src/services/verified.js';
import { H, registerChiefHarness, relay } from './chief-harness.js';
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
    'a done report omits verified while the gate helper still matches the judged head or patch (%s, %s, %s)',
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
      const parsed = JSON.parse(report!.content as string) as { phase: string };
      expect(parsed).toMatchObject({ phase: 'done' });
      expect(parsed).not.toHaveProperty('verified');
      expect(buildVerified(deps.db, 'build-v')).toBe(verified);
    },
  );

  test.each([
    ['no gate state', undefined],
    ['a gate state with no judged head', null],
  ] as const)(
    'a passing verify verdict with %s does not mark the report verified',
    async (_label, judgedHead) => {
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
      const parsed = JSON.parse(report!.content as string) as { phase: string };
      expect(parsed).toMatchObject({ phase: 'done' });
      expect(parsed).not.toHaveProperty('verified');
      expect(buildVerified(deps.db, 'build-u')).toBe(false);
    },
  );

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
      expect(wake?.prompt).toContain(`(todo:${report.todoId})`);
    }
  });

  test('unwatched tasks report into the Coordinator thread and wake it to summarize', async () => {
    const { deps, todoId } = await seedTask(false);
    setTodoPhase(deps, todoId, 'done');
    const rows = await messages();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.role).toBe('system');
    const wake = H.s.db.select().from(step).where(eq(step.buildId, H.threadId)).get()!;
    expect(wake.prompt).toMatch(new RegExp(`^\\[wake:settle\\] provenance=watch:${todoId}\\n`));
    expect(wake.prompt).toContain(`(todo:${todoId})`);
    const report = JSON.parse(rows[0]!.content as string);
    expect(report).toMatchObject({
      kind: 'thread-report',
      todoId,
      phase: 'done',
      wakeStepId: wake.id,
    });
  });

  test('settle wake carries bounded delivery facts, clipped quoted excerpt, and permits notify_user', async () => {
    const { deps, todoId } = await seedTask(false);
    H.s.db
      .insert(build)
      .values({
        id: 'build-sum',
        todoId,
        triggerSource: 'user',
        withPlan: false,
        createdAt: 1,
      })
      .run();
    H.s.db
      .insert(step)
      .values({
        id: 'build-step-sum',
        buildId: 'build-sum',
        kind: 'build',
        status: 'done',
        checkpointCommit: 'abcdef1234567890',
        createdAt: 2,
      })
      .run();
    H.s.db
      .insert(message)
      .values({
        id: 'worker-out',
        conversationId: 'build-sum',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: `Done ![shot](attachment:team-1/a1.png). ${'总结细节'.repeat(300)}`,
          },
        ],
        createdAt: 3,
      })
      .run();
    H.s.db
      .update(todo)
      .set({ latestBuildId: 'build-sum', hasChanges: true })
      .where(eq(todo.id, todoId))
      .run();

    setTodoPhase(deps, todoId, 'done');
    const wake = H.s.db.select().from(step).where(eq(step.buildId, H.threadId)).get()!;
    expect(wake.prompt).toContain('交付事实：项目「demo」，改动保存在工作分支');
    expect(wake.prompt).toContain('commit abcdef12');
    expect(wake.prompt).toContain('Thread 结项摘录（conversationId=build-sum');
    expect(wake.prompt).toContain('> Done ![shot](attachment-disabled:team-1/a1.png).');
    expect(wake.prompt).toContain('（已截断）');
    expect(wake.prompt?.length ?? 0).toBeLessThan(2000);

    await relay(
      'notify_user',
      {
        message: `[Repair board counts](todo:${todoId}) 已完成，改动留在工作分支。`,
        provenance: `watch:${todoId}`,
      },
      { turnPrompt: wake.prompt },
    );
    const notices = H.s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, H.threadId))
      .all()
      .filter((row) => String(row.content).includes(CHIEF_NOTICE_KIND));
    expect(notices).toHaveLength(1);
  });

  test('complete_todos in the same thread and already-answered info reports skip a second settle wake', async () => {
    const { todoId: completedId } = await seedTask(true);
    const res = (await relay('complete_todos', { todoIds: [completedId] })) as {
      transitioned: string[];
    };
    expect(res.transitioned).toEqual([completedId]);
    expect(H.s.db.select().from(step).where(eq(step.buildId, H.threadId)).all()).toEqual([]);

    const answered = createAutonomousTodo(H.s, {
      teamId: H.teamId,
      projectId: H.projectId,
      title: 'Answered research',
      spec: 'Check docs.',
      createdBy: H.userId,
      ownerId: H.userId,
      output: 'info',
    });
    H.s.db
      .insert(build)
      .values({
        id: 'build-info-ack',
        todoId: answered.id,
        triggerSource: 'user',
        withPlan: false,
        reportAttachmentId: 'att-info-1',
        createdAt: 1,
      })
      .run();
    H.s.db
      .update(todo)
      .set({ phase: 'review', latestBuildId: 'build-info-ack' })
      .where(eq(todo.id, answered.id))
      .run();
    H.s.db
      .insert(chiefMessage)
      .values({
        id: reportNoticeId(H.threadId, {
          todoId: answered.id,
          buildId: 'build-info-ack',
          attachmentId: 'att-info-1',
        }),
        threadId: H.threadId,
        role: 'system',
        content: JSON.stringify({
          kind: CHIEF_NOTICE_KIND,
          message: 'done',
          provenance: `report:${answered.id}`,
        }),
        createdAt: 2,
      })
      .run();
    const svc = {
      db: H.s.db,
      hub: H.s.hub,
      convHub: H.s.convHub,
      machineHub: H.s.machineHub,
      user: H.s.user,
    };
    setTodoPhase(svc, answered.id, 'done');
    expect(H.s.db.select().from(step).where(eq(step.buildId, H.threadId)).all()).toEqual([]);
  });

  test('non-report phases do not create a report', async () => {
    const { deps, todoId } = await seedTask(true);
    setTodoPhase(deps, todoId, 'closed');
    expect(await messages()).toEqual([]);
  });
});
