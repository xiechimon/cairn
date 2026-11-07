import { MERGE_HUMAN_ONLY_COPY } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { build as buildTable, step as stepTable, todo as todoTable } from '../src/db/schema.js';
import { AGENT_ID, H, registerChiefHarness, relay } from './chief-harness.js';

registerChiefHarness();

describe('wording -> spec three-segment transform + provenance (r5 section 3.2)', () => {
  test('create_todo lands the three-segment spec verbatim + provenance createdBy/sourceBuildId/ownerId', async () => {
    const spec = [
      '> 帮 demo 写一份 CONTRIBUTING.md 贡献指南',
      '',
      '要求：',
      '- 说明怎么给 Agent 提任务',
      '- 说明怎么验收改动',
      '',
      '补充信息（探测得出，非用户确认）：',
      '- 当前仓库仅有 README.md',
    ].join('\n');
    const created = (await relay('create_todo', {
      projectId: H.projectId,
      title: '编写 CONTRIBUTING.md 贡献指南',
      spec,
    })) as {
      id: string;
      createdBy: string | null;
      ownerId: string | null;
      sourceBuildId: string | null;
      spec: string;
    };
    expect(created.spec).toContain('> 帮 demo');
    expect(created.spec).toContain('要求：');
    expect(created.spec).toContain('补充信息（探测得出，非用户确认）：');
    expect(created.createdBy).toBe(AGENT_ID);
    expect(created.ownerId).toBe(H.userId);
    expect(created.sourceBuildId).toBe(H.chiefId);
    const row = H.s.db.select().from(todoTable).where(eq(todoTable.id, created.id)).get()!;
    expect(row.sourceBuildId).toBe(H.chiefId);
    expect(row.createdBy).toBe(AGENT_ID);
  });
});

describe('open_thread dispatch', () => {
  test('open_thread starts one session step triggered by the chief and queues the todo (#903)', async () => {
    const todoRec = (await relay('create_todo', {
      projectId: H.projectId,
      title: '写文档',
      spec: 's',
    })) as {
      id: string;
    };
    const out = (await relay('open_thread', { todoId: todoRec.id })) as {
      todoId: string;
      buildId: string;
    };
    expect(out.todoId).toBe(todoRec.id);
    const row = H.s.db.select().from(todoTable).where(eq(todoTable.id, todoRec.id)).get()!;
    expect(row.phase).toBe('queued');
    expect(row.latestBuildId).toBe(out.buildId);
    const build = H.s.db.select().from(buildTable).where(eq(buildTable.id, out.buildId)).get()!;
    expect(build).toMatchObject({ withPlan: false, triggerSource: 'chief' });
    const steps = H.s.db.select().from(stepTable).where(eq(stepTable.buildId, out.buildId)).all();
    expect(steps.map((r) => r.kind)).toEqual(['session']);
  });
});

describe('merge_builds machine entry hard-refused (#1256)', () => {
  test('chief calls merge_builds -> refusal JSON, text names the human exit, no merge step landed', async () => {
    const todoRec = (await relay('create_todo', {
      projectId: H.projectId,
      title: '合并只由人触发',
      spec: 's',
    })) as { id: string };
    const now = Date.now();
    H.s.db
      .insert(buildTable)
      .values({
        id: 'build-merge-reject',
        todoId: todoRec.id,
        withPlan: false,
        triggerSource: 'user',
        createdAt: now,
      })
      .run();
    H.s.db
      .update(todoTable)
      .set({ phase: 'review', phaseAt: now })
      .where(eq(todoTable.id, todoRec.id))
      .run();

    const out = (await relay('merge_builds', { buildIds: ['build-merge-reject'] })) as {
      rejected: boolean;
      buildIds: string[];
      reason: string;
    };
    expect(out.rejected).toBe(true);
    expect(out.buildIds).toEqual(['build-merge-reject']);
    expect(out.reason).toBe(MERGE_HUMAN_ONLY_COPY);
    expect(out.reason).toContain('完成');
    const steps = H.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, 'build-merge-reject'))
      .all();
    expect(steps).toHaveLength(0);
  });
});
