import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { step as stepTable, todo as todoTable } from '../src/db/schema.js';
import { newRecordId, nowMs } from '../src/lib/ids.js';
import { addChiefWatch, getChiefEnvelope, triggerChiefWakes } from '../src/services/chief.js';
import { getTodo, setTodoPhase } from '../src/services/todos.js';
import { H, registerChiefHarness } from './chief-harness.js';

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

  test('#1254 a confirm gate wake tells the Coordinator not to release the gate itself', async () => {
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
    expect(steps.at(-1)!.prompt).toContain('停驻在 confirm 关口');
    expect(steps.at(-1)!.prompt).toContain('不要自己放行');
    expect(steps.at(-1)!.prompt).not.toContain('confirm_builds');
  });

  test('#1403 G9 (G3): a watched card reaches review through the phase funnel -> wake text is the same hold-for-a-person text', async () => {
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
    expect(prompt).toContain('停驻在 review 关口');
    expect(prompt).toContain('不要自己放行');
    expect(prompt).not.toContain('自动确认规则');
  });
});
