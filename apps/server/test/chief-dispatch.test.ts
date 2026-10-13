// 措辞→spec 溯源 + 分派/assignment（#1128 自 chief.test.ts 拆分；判定口径与 M4a 组头注见
// ./chief-harness.ts）。共享 harness 收编位 = ./chief-harness.ts，
// 状态经 H 单出口每用例重绑。

import { MERGE_HUMAN_ONLY_COPY } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { agent as agentTable, step as stepTable, todo as todoTable } from '../src/db/schema.js';
import { AGENT_ID, AGENT2_ID, H, registerChiefHarness, relay } from './chief-harness.js';

registerChiefHarness();

// —— AC r5 §3.2: 措辞→spec 三段变换（宿主机制：溯源落库）———————————————

describe('措辞→spec 三段变换 + 溯源（r5 §3.2）', () => {
  test('create_todo 落三段式 spec 原文 + 溯源 createdBy/sourceBuildId/ownerId', async () => {
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
    // 三段式 spec 原样落库（宿主不改写 LLM 产出的 spec 文本）
    expect(created.spec).toContain('> 帮 demo'); // ① 用户原文 blockquote
    expect(created.spec).toContain('要求：'); // ② 要求 bullet
    expect(created.spec).toContain('补充信息（探测得出，非用户确认）：'); // ③ 补充信息段
    // 溯源三字段（r5 §3.2：sourceBuildId = chief id `chief-<H.userId>-<H.teamId>`）
    expect(created.createdBy).toBe(AGENT_ID); // = Chief 绑定 Agent id
    expect(created.ownerId).toBe(H.userId); // = 用户
    expect(created.sourceBuildId).toBe(H.chiefId); // = chief 实例 id（非 thread/conv id）
    // 落库校验
    const row = H.s.db.select().from(todoTable).where(eq(todoTable.id, created.id)).get()!;
    expect(row.sourceBuildId).toBe(H.chiefId);
    expect(row.createdBy).toBe(AGENT_ID);
  });
});

// —— AC r5 §3.3/§3.4/§5: 分派职责权重 + 单 todo 直派 + 双 Agent 分槽 ————————

describe('分派 + 单 todo 直派 + 双 Agent assignment（r5 §3.3/§3.4/§5）', () => {
  test('agents 读工具返回职责文本（分派权重输入）', async () => {
    const agents = (await relay('agents', {})) as { id: string; description: string }[];
    expect(agents.find((a) => a.id === AGENT_ID)?.description).toContain('文档');
    expect(agents.find((a) => a.id === AGENT2_ID)?.description).toContain('代码');
  });

  // XMON-77 权限闭环读面：chief 分派要能看到每个 Agent 的授权集（合并步
  // 派给无「合并分支/推送分支」的 Agent 会在 requestMerge 403——提前可见才
  // 能挑对 Agent）。失败方式：投影缺 tools/skillsAllowlist/mcpServers 任一 →
  // 分派面对权限态盲选。
  test('agents 投影携带授权集 tools/skillsAllowlist/mcpServers（XMON-77 分派面权限可见）', async () => {
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
    // 未勾选的邻 Agent = 空集（least-privilege 可分辨，不是缺字段）。
    const other = agents.find((a) => a.id === AGENT2_ID)!;
    expect(other.tools).toEqual([]);
  });

  // XMON-84 B4：chief create_agent 无 tools 形参，落创建默认集——缺「推送
  // 分支」的 Agent 收尾推不了工作分支（daemon 软拒），chief 建的 Agent 同样
  // 要能交付。失败方式：落 [] → chief 建号即无推送权。
  test('create_agent 落创建默认集 [推送分支]（XMON-84 B4）', async () => {
    const out = (await relay('create_agent', { displayName: 'chief 建的交付号' })) as {
      id: string;
    };
    expect(H.s.db.select().from(agentTable).where(eq(agentTable.id, out.id)).get()!.tools).toEqual([
      '推送分支',
    ]);
  });

  // #903（ADR 0014）：withPlan = chief 的逐次派发判定（工具面收回
  // 参数，D1），缺省 = 先规划（D2 fail-safe：判不准的方向是「多问一次」，
  // 不是静默跳过闸）。失败方式：① 缺省仍直执行（#892 的 8/8 病灶回归）；
  // ② 显式 false 被顶回 true（旧设置 clamp 残留 = 判定权没还给 chief）；
  // ③ dispatchReason 不回显（D4 审计面断：判定不可审计 = 换了个黑箱）。
  test('run_builds 缺省 withPlan 走先规划：响应 withPlan=true + 首步=plan + triggerSource:chief + assignment 落槽（#903）', async () => {
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
    expect(out.withPlan).toBe(true); // 缺省 = 先规划（fail-safe，D2）
    expect(out.dispatchReason).toBeNull(); // 未给理由 → null 回显（不炸）
    expect(out.builds[0]!.withPlan).toBe(true);
    expect(out.builds[0]!.triggerSource).toBe('chief');
    const row = H.s.db.select().from(todoTable).where(eq(todoTable.id, todoRec.id)).get()!;
    expect(row.assignment?.build?.agentId).toBe(AGENT_ID);
    expect(row.phase).toBe('queued');
    // 首步 = 规划步（方案停在确认闸）
    const steps = H.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, row.latestBuildId!))
      .all();
    expect(steps[0]!.kind).toBe('plan');
  });

  test('run_builds withPlan=false → chief 判定直接修：首步=build + dispatchReason 回显（#903）', async () => {
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
    expect(out.withPlan).toBe(false); // 判定权在 chief（D1），不再被 clamp
    expect(out.dispatchReason).toBe('缺陷有可复现步骤，信号一 → 直接修'); // D4 审计面
    expect(out.builds[0]!.withPlan).toBe(false);
    const row = H.s.db.select().from(todoTable).where(eq(todoTable.id, todoRec.id)).get()!;
    const steps = H.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, row.latestBuildId!))
      .all();
    expect(steps[0]!.kind).toBe('build');
  });

  test('run_builds withPlan=true 显式先规划 + 首步=plan（#903）', async () => {
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

  test('双 Agent 分派：assignment.plan ≠ assignment.build 两槽独立落库（r5 §5）', async () => {
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
    expect(row.assignment?.plan?.agentId).toBe(AGENT2_ID); // 规划 = 代码 Agent
    expect(row.assignment?.build?.agentId).toBe(AGENT_ID); // 执行 = 文档 Agent
    // 首步 = 规划步（withPlan 缺省 = 先规划，#903）
    const steps = H.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, row.latestBuildId!))
      .all();
    expect(steps[0]!.kind).toBe('plan');
  });
});

// —— #1256（ADR 0018「合并动作留人，不在名册内」）：合并只由人触发——————

describe('merge_builds 机器入口硬拒（#1256）', () => {
  test('chief 调 merge_builds → 拒绝 JSON，文案指认人工出口，不落任何合并步', async () => {
    const todoRec = (await relay('create_todo', {
      projectId: H.projectId,
      title: '合并只由人触发',
      spec: 's',
    })) as { id: string };
    // 造一条 review 态 build（正常合并闸的相位），证明拒绝不是相位不满足而是
    // 机器入口本身被堵死。
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
    expect(out.reason).toBe(MERGE_HUMAN_ONLY_COPY); // 文案 = shared 单源
    expect(out.reason).toContain('完成'); // 指认人工出口（web 界面 review 关口按钮）
    // 无 merge 步入队（拒绝即止，不落任何副作用）。
    const steps = H.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, 'build-merge-reject'))
      .all();
    expect(steps).toHaveLength(0);
  });
});
