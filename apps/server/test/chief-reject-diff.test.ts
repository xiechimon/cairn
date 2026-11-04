import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { build as buildTable, plan as planTable, step as stepTable } from '../src/db/schema.js';
import { newRecordId, newUuidv7, nowMs } from '../src/lib/ids.js';
import { planDocumentDiff } from '../src/services/documents.js';
import { setTodoPhase } from '../src/services/todos.js';
import { AGENT_ID, H, registerChiefHarness, relay } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();

describe('rejection loop plan v2 + unified diff (r5 section 4 / 02 section 4.2)', () => {
  test('documents/{id}/diff = plan.md file-level unified diff (v1->v2 + hunk header)', async () => {
    const todoRec = (await relay('create_todo', {
      projectId: H.projectId,
      title: 'plan diff',
      spec: 's',
    })) as {
      id: string;
    };
    const buildId = newUuidv7();
    const now = nowMs();
    H.s.db
      .insert(buildTable)
      .values({
        id: buildId,
        todoId: todoRec.id,
        withPlan: true,
        triggerSource: 'user',
        createdAt: now,
      })
      .run();
    const v1 = ['# 方案', '', 'Context: 后缀用「·r3-lifecycle」。', 'Changes: 改 README。'].join(
      '\n',
    );
    const v2 = [
      '# 方案',
      '',
      'Context: 后缀用「·静态演示页」，不重复项目名。',
      'Changes: 改 README。',
    ].join('\n');
    const id1 = newRecordId();
    const id2 = newRecordId();
    H.s.db
      .insert(planTable)
      .values({ id: id1, buildId, version: 1, content: v1, createdAt: now })
      .run();
    H.s.db
      .insert(planTable)
      .values({ id: id2, buildId, version: 2, content: v2, createdAt: now })
      .run();
    H.s.db.update(buildTable).set({ planDocId: id2 }).where(eq(buildTable.id, buildId)).run();

    const diff = planDocumentDiff(H.s.db, id2);
    expect(diff.fromVersion).toBe(1);
    expect(diff.toVersion).toBe(2);
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]!.path).toBe('plan.md');
    expect(diff.files[0]!.hunks[0]!.header).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@$/);
    const lines = diff.files[0]!.hunks[0]!.lines;
    expect(lines.some((l) => l.startsWith('-') && l.includes('r3-lifecycle'))).toBe(true);
    expect(lines.some((l) => l.startsWith('+') && l.includes('静态演示页'))).toBe(true);
    expect(diff.files[0]!.additions).toBeGreaterThanOrEqual(1);
    expect(diff.files[0]!.deletions).toBeGreaterThanOrEqual(1);
  });

  test('rejection -> replan step enqueued carrying the feedback instruction (v2 faithfully executes the feedback host half, r5 section 4)', async () => {
    const todoRec = (await relay('create_todo', {
      projectId: H.projectId,
      title: 't',
      spec: 's',
    })) as {
      id: string;
    };
    const out = (await relay('run_builds', {
      todoIds: [todoRec.id],
      assignment: { plan: { agentId: AGENT_ID } },
    })) as { builds: { id: string }[] };
    const buildId = out.builds[0]!.id;
    setTodoPhase(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      todoRec.id,
      'planning',
    );
    setTodoPhase(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      todoRec.id,
      'confirm',
    );
    const res = await req(H.s.app, 'POST', `/api/builds/${buildId}/steps`, {
      action: 'revision',
      side: 'plan',
      feedback: '后缀不要重复项目名',
      clientMessageId: newUuidv7(),
    });
    expect(res.status).toBe(202);
    const steps = H.s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
    const replan = steps.filter((st) => st.kind === 'plan').at(-1)!;
    expect(replan.prompt).toContain('后缀不要重复项目名');
  });
});
