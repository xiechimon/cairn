import { CHIEF_WATCH_REASON_DISPATCH } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { step as stepTable, todo as todoTable } from '../src/db/schema.js';
import { newRecordId, nowMs } from '../src/lib/ids.js';
import { addChiefWatch, getChiefEnvelope, triggerChiefWakes } from '../src/services/chief.js';
import { getTodo, setTodoPhase } from '../src/services/todos.js';
import { AGENT_ID, H, registerChiefHarness, relay } from './chief-harness.js';

registerChiefHarness();

describe('watch/wake active loop three triggers (r5 section 3.5)', () => {
  function seedWatchedTodo(): string {
    const id = newRecordId();
    const now = nowMs();
    H.s.db
      .insert(todoTable)
      .values({
        id,
        teamId: H.teamId,
        projectId: H.projectId,
        title: '被关注任务',
        spec: '',
        phase: 'todo',
        phaseAt: now,
        seqNum: 1,
        orderIndex: 0,
        assignment: null,
        latestBuildId: null,
        lastRunAt: null,
        hasChanges: false,
        hasPlan: false,
        sourceTodo: null,
        v: 1,
        createdBy: null,
        ownerId: H.userId,
        sourceBuildId: null,
      })
      .run();
    return id;
  }

  test('run_builds dispatching a job auto-watches it (reason canon)', async () => {
    const todoRec = (await relay('create_todo', {
      projectId: H.projectId,
      title: 't',
      spec: 's',
    })) as {
      id: string;
    };
    await relay('run_builds', {
      todoIds: [todoRec.id],
      assignment: { build: { agentId: AGENT_ID } },
    });
    const env = getChiefEnvelope(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      H.teamId,
    );
    expect(env.watches).toHaveLength(1);
    expect(env.watches[0]!.reason).toBe(CHIEF_WATCH_REASON_DISPATCH);
    expect(env.watches[0]!.todoId).toBe(todoRec.id);
  });

  test('gate trigger (at review) -> chief wake step enqueued, watch kept', async () => {
    const todoId = seedWatchedTodo();
    const rec = getTodo({ db: H.s.db, hub: H.s.hub, user: H.s.user }, todoId)!;
    addChiefWatch(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      { teamId: H.teamId, todo: rec, projectName: 'demo', threadId: H.threadId },
    );
    setTodoPhase(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      todoId,
      'queued',
    );
    const before = H.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, H.threadId))
      .all().length;
    triggerChiefWakes(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      getTodo({ db: H.s.db, hub: H.s.hub, user: H.s.user }, todoId)!,
      'review',
    );
    const after = H.s.db.select().from(stepTable).where(eq(stepTable.buildId, H.threadId)).all();
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)!.kind).toBe('chief');
    expect(after.at(-1)!.prompt).toContain('[wake:gate]');
    const env = getChiefEnvelope(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      H.teamId,
    );
    expect(env.watches).toHaveLength(1);
  });

  test('settle trigger (done) -> wake + watch auto-cleared (r5 section 3.5)', async () => {
    const todoId = seedWatchedTodo();
    const rec = getTodo({ db: H.s.db, hub: H.s.hub, user: H.s.user }, todoId)!;
    addChiefWatch(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      { teamId: H.teamId, todo: rec, projectName: 'demo', threadId: H.threadId },
    );
    triggerChiefWakes(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      rec,
      'done',
    );
    const steps = H.s.db.select().from(stepTable).where(eq(stepTable.buildId, H.threadId)).all();
    expect(steps.at(-1)!.prompt).toContain('[wake:settle]');
    const env = getChiefEnvelope(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      H.teamId,
    );
    expect(env.watches).toHaveLength(0);
  });

  test('failed trigger -> wake (forensic reporting guidance) + watch auto-cleared', async () => {
    const todoId = seedWatchedTodo();
    const rec = getTodo({ db: H.s.db, hub: H.s.hub, user: H.s.user }, todoId)!;
    addChiefWatch(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      { teamId: H.teamId, todo: rec, projectName: 'demo', threadId: H.threadId },
    );
    triggerChiefWakes(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      rec,
      'failed',
    );
    const steps = H.s.db.select().from(stepTable).where(eq(stepTable.buildId, H.threadId)).all();
    expect(steps.at(-1)!.prompt).toContain('[wake:failed]');
    expect(steps.at(-1)!.prompt).toContain('machines');
    const env = getChiefEnvelope(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      H.teamId,
    );
    expect(env.watches).toHaveLength(0);
  });

  test('#1254 split-parent gate -> wake text carries the split_todo parent-card stay instruction', async () => {
    const parentId = seedWatchedTodo();
    const childId = newRecordId();
    const now = nowMs();
    H.s.db
      .insert(todoTable)
      .values({
        id: childId,
        teamId: H.teamId,
        projectId: H.projectId,
        title: '子卡',
        spec: '',
        phase: 'todo',
        phaseAt: now,
        seqNum: 2,
        orderIndex: 1,
        assignment: null,
        latestBuildId: null,
        lastRunAt: null,
        hasChanges: false,
        hasPlan: false,
        sourceTodo: parentId,
        v: 1,
        createdBy: null,
        ownerId: H.userId,
        sourceBuildId: null,
      })
      .run();
    const parentRec = getTodo({ db: H.s.db, hub: H.s.hub, user: H.s.user }, parentId)!;
    addChiefWatch(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      { teamId: H.teamId, todo: parentRec, projectName: 'demo', threadId: H.threadId },
    );
    setTodoPhase(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      parentId,
      'queued',
    );
    triggerChiefWakes(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      getTodo({ db: H.s.db, hub: H.s.hub, user: H.s.user }, parentId)!,
      'confirm',
    );
    const steps = H.s.db.select().from(stepTable).where(eq(stepTable.buildId, H.threadId)).all();
    expect(steps.at(-1)!.kind).toBe('chief');
    expect(steps.at(-1)!.prompt).toContain('[wake:gate]');
    expect(steps.at(-1)!.prompt).toContain('split_todo 父卡');
    expect(steps.at(-1)!.prompt).toContain('拆解方案必须人审');
  });

  test('#1254 ordinary card (not split parent) gate -> wake text carries auto-confirm rules', async () => {
    const todoId = seedWatchedTodo();
    const rec = getTodo({ db: H.s.db, hub: H.s.hub, user: H.s.user }, todoId)!;
    addChiefWatch(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      { teamId: H.teamId, todo: rec, projectName: 'demo', threadId: H.threadId },
    );
    setTodoPhase(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      todoId,
      'queued',
    );
    triggerChiefWakes(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      getTodo({ db: H.s.db, hub: H.s.hub, user: H.s.user }, todoId)!,
      'confirm',
    );
    const steps = H.s.db.select().from(stepTable).where(eq(stepTable.buildId, H.threadId)).all();
    expect(steps.at(-1)!.kind).toBe('chief');
    expect(steps.at(-1)!.prompt).toContain('[wake:gate]');
    expect(steps.at(-1)!.prompt).toContain('自动确认规则');
    expect(steps.at(-1)!.prompt).toContain('confirm_builds');
    expect(steps.at(-1)!.prompt).not.toContain('split_todo 父卡');
  });

  test('#1403 G9 (G3): a watched card reaches review through the phase funnel -> wake text is the review-gate one, not the auto-confirm rules', async () => {
    const todoId = seedWatchedTodo();
    const deps = { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user };
    addChiefWatch(deps, {
      teamId: H.teamId,
      todo: getTodo({ db: H.s.db, hub: H.s.hub, user: H.s.user }, todoId)!,
      projectName: 'demo',
      threadId: H.threadId,
    });
    for (const phase of ['queued', 'building', 'review'] as const) {
      setTodoPhase(deps, todoId, phase);
    }
    const steps = H.s.db.select().from(stepTable).where(eq(stepTable.buildId, H.threadId)).all();
    const prompt = steps.at(-1)!.prompt ?? '';
    expect(steps.at(-1)!.kind).toBe('chief');
    expect(prompt).toContain('[wake:gate]');
    expect(prompt).not.toContain('自动确认规则');
    expect(prompt).toContain('autonomous');
    expect(prompt).toContain('human');
    expect(prompt).toContain('ADR 0026');
  });
});
