import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { step as stepTable, todo as todoTable } from '../src/db/schema.js';
import { newRecordId, nowMs } from '../src/lib/ids.js';
import { addChiefWatch, getChiefEnvelope, triggerChiefWakes } from '../src/services/chief.js';
import { getTodo } from '../src/services/todos.js';
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

  test('failed trigger -> report only, watch auto-cleared; the wake comes from the owner reconciler', async () => {
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
    expect(steps.some((row) => row.prompt?.includes('[wake:failed]'))).toBe(false);
    const env = getChiefEnvelope(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      H.teamId,
    );
    expect(env.watches).toHaveLength(0);
  });
});
