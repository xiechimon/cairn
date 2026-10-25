import { MERGE_HUMAN_ONLY_COPY } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { agent as agentTable, step as stepTable, todo as todoTable } from '../src/db/schema.js';
import { AGENT_ID, AGENT2_ID, H, registerChiefHarness, relay } from './chief-harness.js';

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

describe('dispatch + single-todo direct dispatch + dual-Agent assignment (r5 sections 3.3/3.4/5)', () => {
  test('agents read tool returns the responsibility text (dispatch weight input)', async () => {
    const agents = (await relay('agents', {})) as { id: string; description: string }[];
    expect(agents.find((a) => a.id === AGENT_ID)?.description).toContain('文档');
    expect(agents.find((a) => a.id === AGENT2_ID)?.description).toContain('代码');
  });

  test('agents projection carries the grant set tools/skillsAllowlist/mcpServers (XMON-77 dispatch-surface permission visibility)', async () => {
    H.s.db
      .update(agentTable)
      .set({
        tools: ['合并分支', '推送分支'],
        defaultSkill: 'slug-a',
        skillsAllowlist: ['slug-a'],
        mcpServers: ['mcp-1'],
      })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const agents = (await relay('agents', {})) as {
      id: string;
      tools: string[];
      defaultSkill: string | null;
      skillsAllowlist: string[] | null;
      mcpServers: string[];
    }[];
    const me = agents.find((a) => a.id === AGENT_ID)!;
    expect(me.tools).toEqual(['合并分支', '推送分支']);
    expect(me.defaultSkill).toBe('slug-a');
    expect(me.skillsAllowlist).toEqual(['slug-a']);
    expect(me.mcpServers).toEqual(['mcp-1']);
    const other = agents.find((a) => a.id === AGENT2_ID)!;
    expect(other.tools).toEqual([]);
  });

  test('create_agent lands the creation default set [push branch] (XMON-84 B4)', async () => {
    const out = (await relay('create_agent', { displayName: 'chief 建的交付号' })) as {
      id: string;
    };
    expect(H.s.db.select().from(agentTable).where(eq(agentTable.id, out.id)).get()!.tools).toEqual([
      '推送分支',
    ]);
  });

  test('run_builds with withPlan defaulting goes plan-first: response withPlan=true + first step=plan + triggerSource:chief + assignment slots filled (#903)', async () => {
    const todoRec = (await relay('create_todo', {
      projectId: H.projectId,
      title: '写文档',
      spec: 's',
    })) as {
      id: string;
    };
    const out = (await relay('run_builds', {
      todoIds: [todoRec.id],
      assignment: { build: { agentId: AGENT_ID } },
    })) as {
      builds: { withPlan: boolean; triggerSource: string }[];
      withPlan: boolean;
      dispatchReason: string | null;
    };
    expect(out.withPlan).toBe(true);
    expect(out.dispatchReason).toBeNull();
    expect(out.builds[0]!.withPlan).toBe(true);
    expect(out.builds[0]!.triggerSource).toBe('chief');
    const row = H.s.db.select().from(todoTable).where(eq(todoTable.id, todoRec.id)).get()!;
    expect(row.assignment?.build?.agentId).toBe(AGENT_ID);
    expect(row.phase).toBe('queued');
    const steps = H.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, row.latestBuildId!))
      .all();
    expect(steps[0]!.kind).toBe('plan');
  });

  test('run_builds withPlan=false -> chief decides to fix directly: first step=build + dispatchReason echoed (#903)', async () => {
    const todoRec = (await relay('create_todo', {
      projectId: H.projectId,
      title: '直接干',
      spec: 's',
    })) as {
      id: string;
    };
    const out = (await relay('run_builds', {
      todoIds: [todoRec.id],
      assignment: { build: { agentId: AGENT_ID } },
      withPlan: false,
      dispatchReason: '缺陷有可复现步骤，信号一 → 直接修',
    })) as {
      builds: { withPlan: boolean }[];
      withPlan: boolean;
      dispatchReason: string | null;
    };
    expect(out.withPlan).toBe(false);
    expect(out.dispatchReason).toBe('缺陷有可复现步骤，信号一 → 直接修');
    expect(out.builds[0]!.withPlan).toBe(false);
    const row = H.s.db.select().from(todoTable).where(eq(todoTable.id, todoRec.id)).get()!;
    const steps = H.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, row.latestBuildId!))
      .all();
    expect(steps[0]!.kind).toBe('build');
  });

  test('run_builds withPlan=true explicitly plan-first + first step=plan (#903)', async () => {
    const todoRec = (await relay('create_todo', {
      projectId: H.projectId,
      title: '新能力',
      spec: 's',
    })) as {
      id: string;
    };
    const out = (await relay('run_builds', {
      todoIds: [todoRec.id],
      assignment: { build: { agentId: AGENT_ID } },
      withPlan: true,
      dispatchReason: '引入新能力，信号二 → 先规划',
    })) as { builds: { withPlan: boolean }[]; withPlan: boolean; dispatchReason: string | null };
    expect(out.withPlan).toBe(true);
    expect(out.dispatchReason).toBe('引入新能力，信号二 → 先规划');
    const row = H.s.db.select().from(todoTable).where(eq(todoTable.id, todoRec.id)).get()!;
    const steps = H.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, row.latestBuildId!))
      .all();
    expect(steps[0]!.kind).toBe('plan');
  });

  test('dual-Agent dispatch: assignment.plan != assignment.build two slots persisted independently (r5 section 5)', async () => {
    const todoRec = (await relay('create_todo', {
      projectId: H.projectId,
      title: '规划执行分离',
      spec: 's',
    })) as { id: string };
    await relay('run_builds', {
      todoIds: [todoRec.id],
      assignment: { plan: { agentId: AGENT2_ID }, build: { agentId: AGENT_ID } },
    });
    const row = H.s.db.select().from(todoTable).where(eq(todoTable.id, todoRec.id)).get()!;
    expect(row.assignment?.plan?.agentId).toBe(AGENT2_ID);
    expect(row.assignment?.build?.agentId).toBe(AGENT_ID);
    const steps = H.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, row.latestBuildId!))
      .all();
    expect(steps[0]!.kind).toBe('plan');
  });
});

describe('merge_builds machine entry hard-refused (#1256)', () => {
  test('chief calls merge_builds -> refusal JSON, text names the human exit, no merge step landed', async () => {
    const todoRec = (await relay('create_todo', {
      projectId: H.projectId,
      title: '合并只由人触发',
      spec: 's',
    })) as { id: string };
    const { build: buildTable } = await import('../src/db/schema.js');
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
