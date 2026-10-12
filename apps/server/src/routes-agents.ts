// Agent 域：agent CRUD + 记忆读/删 + 详情概览「进行中」段数据源。
// #1125 拆域：本模块是 routes.ts 的一个资源域切片（词表单源与
// 对拍契约不变——shared WEB_REST_ENDPOINTS + test/wire.test.ts 拍的是组合
// 后的 app，不是文件布局）。编排位 = routes.ts 的 registerRoutes。

import {
  AGENT_TOOL_DEFAULTS,
  agentMachineFitResponseSchema,
  agentTaskSchema,
  capabilityMissingLabels,
  createAgentBodySchema,
  filterAgentTools,
  IN_PROGRESS_PHASES,
  patchAgentBodySchema,
} from '@pacman/shared';
import { and, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { agent, agentMemory, machine, todo } from './db/schema.js';
import { HttpError, notFound, parseWith } from './lib/errors.js';
import { newRecordId } from './lib/ids.js';
import {
  agentRecordOf,
  jsonBody,
  requireAgentRow,
  requireTeam,
  toMemoryRecord,
} from './routes-helpers.js';
import { deleteAgent } from './services/agents.js';
import {
  declaredMcpGaps,
  homeMachineRejectReason,
  missingCapabilityItems,
  runtimeGatePasses,
} from './services/dispatch-eligibility.js';
import { filterKnownSkillIds } from './services/skills.js';

export function registerAgentRoutes(app: Hono, ctx: AppContext): void {
  // —— 记忆读面（02 §4.4/r5 §6：GET agents/{aid}/memories 词表内）————————————
  app.get('/api/teams/:id/agents/:aid/memories', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const agentId = c.req.param('aid');
    const rows = ctx.db
      .select()
      .from(agentMemory)
      .where(and(eq(agentMemory.agentId, agentId), eq(agentMemory.teamId, teamId)))
      .all();
    return c.json(rows.map(toMemoryRecord));
  });

  // 记忆删除面（02 §4.4「列表/删除 API 保形」；条目卡删除图标 r5 §6 UI 实测，
  // DELETE 同名 [推断]，02 §6.1 规则族 + DELETE_FACE 登记）。
  app.delete('/api/teams/:id/agents/:aid/memories/:mid', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const res = ctx.db
      .delete(agentMemory)
      .where(
        and(
          eq(agentMemory.id, c.req.param('mid')),
          eq(agentMemory.agentId, c.req.param('aid')),
          eq(agentMemory.teamId, teamId),
        ),
      )
      .run();
    if (res.changes === 0) throw notFound(`memory ${c.req.param('mid')}`);
    return c.body(null, 204);
  });

  // —— Agent 面（r3 §4/r5 §1：POST → 201 {id}、GET 单条词表内；PATCH 同名
  // [推断]——per-Agent mcpServers[] 授权勾选（02 §7.1「授权在每个 Agent 的
  // 页面上单独进行」）+ 配置面编辑走此路径）———————————————————————————————
  app.post('/api/teams/:id/agents', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(createAgentBodySchema, await jsonBody(c), 'body');
    // #1259 归属机：创建必填（契约在 createAgentBodySchema）。机器须在本
    // 团队，且过归属机校验（runtime 已启用 + claude-code 模型已配——
    // 单源 = dispatch-eligibility.homeMachineRejectReason）。
    const machineRow = ctx.db
      .select()
      .from(machine)
      .where(and(eq(machine.id, body.machineId), eq(machine.teamId, teamId)))
      .get();
    if (!machineRow) throw notFound(`machine ${body.machineId}`);
    const createReject = homeMachineRejectReason(machineRow, {
      provider: body.provider ?? null,
      modelId: body.modelId ?? null,
    });
    if (createReject) throw new HttpError(400, createReject);
    const id = newRecordId();
    ctx.db
      .insert(agent)
      .values({
        id,
        teamId,
        displayName: body.displayName,
        description: body.description ?? null,
        status: 'active',
        avatarUrl: null,
        provider: body.provider ?? null,
        modelId: body.modelId ?? null,
        thinkingLevel: body.thinkingLevel ?? null,
        // tools 写侧过滤（XMON-77：词表外值静默丢弃——filterKnownSkillIds 同
        // 律，存量残值随下一次写自然清退；词表 = shared AGENT_TOOL_SWITCHES）。
        // 创建缺省 = AGENT_TOOL_DEFAULTS（XMON-84 B4）：「推送分支」默认开——
        // 收尾闸落地后新建即推不了工作分支会破坏交付；显式携带（含 [] = 全关）
        // 照旧尊重，缺省才补默认。
        tools: filterAgentTools(body.tools ?? [...AGENT_TOOL_DEFAULTS]),
        secrets: body.secrets ?? [],
        // #1169 拆字段：defaultSkill（携带，单值）/ skillsAllowlist（授权）。
        // 校验源同 #367 律 = 本地现扫存在性：defaultSkill 未知 id 静默回落
        // null（不报错）；skillsAllowlist 缺省 null（不限制——本票主修位：
        // 新建 agent 出生即全量可读），显式 [] 原样存（有意全拒）。
        defaultSkill:
          body.defaultSkill != null
            ? (filterKnownSkillIds(ctx.skillsDir, [body.defaultSkill])[0] ?? null)
            : null,
        skillsAllowlist:
          body.skillsAllowlist == null
            ? null
            : filterKnownSkillIds(ctx.skillsDir, body.skillsAllowlist),
        mcpServers: body.mcpServers ?? [],
        // #1138 agent 并发上限：nullish——显式 null 与缺省同值（不限）。
        maxConcurrentTasks: body.maxConcurrentTasks ?? null,
        machineId: body.machineId,
        // #1250 persona 角色位：nullish——词表校验在 createAgentBodySchema
        //（personaRoleSchema），团队内唯一性由 partial unique index 兜底
        //（撞角色 = sqlite 唯一约束错，写面如实上抛）。
        persona: body.persona ?? null,
        // #1251 能力要求声明：nullish——显式 null 与缺省同值（无要求）；
        // 形状校验在 createAgentBodySchema（requiredCapabilitiesSchema）。
        requiredCapabilities: body.requiredCapabilities ?? null,
      })
      .run();
    return c.json({ id }, 201); // r5 §1/§8 补录：创建 → 201 {id}
  });

  app.get('/api/teams/:id/agents/:aid', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const row = requireAgentRow(ctx, teamId, c.req.param('aid'));
    return c.json(agentRecordOf(row));
  });

  app.patch('/api/teams/:id/agents/:aid', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const row = requireAgentRow(ctx, teamId, c.req.param('aid'));
    const body = parseWith(patchAgentBodySchema, await jsonBody(c), 'body');
    const sets: Partial<typeof row> = {};
    // #1169 拆字段：defaultSkill / skillsAllowlist 与 #367 律同——现扫存在性
    // 过滤，未知 id 静默跳过。显式 null 各自清空（defaultSkill → 不携带、
    // skillsAllowlist → 不限制）；缺省不动（undefined ≠ null 的序列化坑）。
    if (body.defaultSkill !== undefined) {
      sets.defaultSkill =
        body.defaultSkill == null
          ? null
          : (filterKnownSkillIds(ctx.skillsDir, [body.defaultSkill])[0] ?? null);
    }
    if (body.skillsAllowlist !== undefined) {
      sets.skillsAllowlist =
        body.skillsAllowlist == null
          ? null
          : filterKnownSkillIds(ctx.skillsDir, body.skillsAllowlist);
    }
    // XMON-77：tools[] 与 create 同律——写侧过滤（词表外值静默丢弃）。
    if (body.tools !== undefined) {
      sets.tools = filterAgentTools(body.tools);
    }
    // #1259 换绑：目标机须在本团队并过归属机校验（按 patch 后的有效
    // provider/modelId 判——同 body 换 provider/model 时以新值为准）。
    if (body.machineId !== undefined) {
      const target = ctx.db
        .select()
        .from(machine)
        .where(and(eq(machine.id, body.machineId), eq(machine.teamId, teamId)))
        .get();
      if (!target) throw notFound(`machine ${body.machineId}`);
      const reject = homeMachineRejectReason(target, {
        provider: body.provider !== undefined ? body.provider : row.provider,
        modelId: body.modelId !== undefined ? body.modelId : row.modelId,
      });
      if (reject) throw new HttpError(400, reject);
      sets.machineId = body.machineId;
    } else if ((body.provider !== undefined || body.modelId !== undefined) && row.machineId) {
      // 未换绑但改了 provider/modelId：对当前归属机复核，洞不从 patch 后门
      // 溜回（机器行缺失 = 归属机已被移除，留 null 形态给 UI 补）。
      const home = ctx.db
        .select()
        .from(machine)
        .where(and(eq(machine.id, row.machineId), eq(machine.teamId, teamId)))
        .get();
      if (home) {
        const reject = homeMachineRejectReason(home, {
          provider: body.provider !== undefined ? body.provider : row.provider,
          modelId: body.modelId !== undefined ? body.modelId : row.modelId,
        });
        if (reject) throw new HttpError(400, reject);
      }
    }
    for (const key of [
      'displayName',
      'description',
      'provider',
      'modelId',
      'thinkingLevel',
      'secrets',
      'mcpServers',
      // #1250：persona 同律——显式 null = 摘掉角色（词表校验在
      // patchAgentBodySchema；团队唯一性由 partial unique index 兜底）。
      'persona',
      // #1138：可空列同律——显式 null = 清回不限（undefined = 不动，值域
      // 1..50 的边界校验在 patchAgentBodySchema）。
      'maxConcurrentTasks',
      // #1251：可空列同律——显式 null = 清回无要求（undefined = 不动，形状
      // 校验在 patchAgentBodySchema）。
      'requiredCapabilities',
    ] as const) {
      if (body[key] !== undefined) {
        // null 语义：可空列显式清空（description/provider/modelId/thinkingLevel）。
        sets[key] = (body[key] === null ? null : body[key]) as never;
      }
    }
    if (Object.keys(sets).length > 0) {
      ctx.db.update(agent).set(sets).where(eq(agent.id, row.id)).run();
    }
    const updated = requireAgentRow(ctx, teamId, row.id);
    return c.json(agentRecordOf(updated));
  });

  // Agent 删除面（XMON-19 / B2）：删除入口与二次确认文案直读原版产线 bundle
  // （agent_modal.remove/remove_title/remove_confirm/remove_over_quota 四语
  // 语料），删除语义直读 todos.dev 官方 docs——canon 出处与关联面三件取舍
  // （memories 不级联 / assignment 摘槽 / chief 摘绑定）的完整论证在
  // services/agents.ts，此处不再复述。路由 = REST 同名 DELETE（02 §6.1 规则族
  // + DELETE_FACE），wire 未采——登记 wire.test.ts INFERRED_ROUTES。
  app.delete('/api/teams/:id/agents/:aid', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const agentId = c.req.param('aid');
    if (!deleteAgent({ db: ctx.db }, teamId, agentId)) throw notFound(`agent ${agentId}`);
    return c.body(null, 204);
  });

  // Agent 详情概览「进行中」段的数据源（词表内 r3 §8.2 观测路由；行形状 =
  // shared agentTaskSchema，其注释记了逐个字段的原件出处）。
  // 三条判据，每条都有实测依据：
  // · assignment 双槽任一指向该 Agent——r3 §4 观测到的归属关系；
  // · phase ∈ IN_PROGRESS_PHASES（queued/planning/building）——原件把
  //   review/confirm 归「等你」、failed 单列，只有跑着的才算「进行中」；
  // · latestBuildId 在位——行以 build 为主体（原件 key = buildId），没有
  //   build 的在跑 todo 不存在，不收进来。
  // 实测反证（2026-09-30，参考账号）：3 条 phase=review 且双槽指向该 Agent 的
  // todo，该端点恒返回 []——故「按 assignment 过滤 todo」的旧实现是错的。
  // —— Agent 机器匹配面（#1251 / ADR 0018 决策 4.6：「哪些机器可跑它」=
  // requiredCapabilities × 各机上报清单的交集）。判定单源 = claim/sweep 同一
  // 份 dispatch-eligibility 原语（读面不得与派发面各说各话）；MCP 对账位
  // （mcpGaps）= agent.mcpServers 声明 vs 机器实装的缺口，可见不挡（daemon
  // 对未知 slug 跳过降级的既有语义不动）。行序 = 机器名字典序（确定性）。
  app.get('/api/teams/:id/agents/:aid/machine-fit', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const row = requireAgentRow(ctx, teamId, c.req.param('aid'));
    const machines = ctx.db
      .select()
      .from(machine)
      .where(eq(machine.teamId, teamId))
      .all()
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const rows = machines.map((m) => {
      const runtimeOk = runtimeGatePasses(m, row.provider);
      // 未上报任何快照（capabilities 与 claudeCodeReport 双 null）= 未知：
      // missing null（显示面闭嘴），canRun 跟随 runtimeOk（fail-open 与闸
      // 同律——读面说的就是派发面做的）。
      const noSnapshot = m.capabilities === null && m.claudeCodeReport === null;
      const missing = noSnapshot
        ? null
        : capabilityMissingLabels(missingCapabilityItems(m, row.requiredCapabilities));
      return {
        machineId: m.id,
        name: m.name,
        online: m.online,
        runtimeOk,
        missing,
        mcpGaps: declaredMcpGaps(m, row),
        canRun: runtimeOk && (missing === null || missing.length === 0),
      };
    });
    return c.json(agentMachineFitResponseSchema.parse({ machines: rows }));
  });

  app.get('/api/teams/:id/agents/:aid/tasks', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const agentId = c.req.param('aid');
    const rows = ctx.db.select().from(todo).where(eq(todo.teamId, teamId)).all();
    const inFlight = rows.filter(
      (r) =>
        (r.assignment?.plan?.agentId === agentId || r.assignment?.build?.agentId === agentId) &&
        (IN_PROGRESS_PHASES as readonly string[]).includes(r.phase) &&
        r.latestBuildId !== null,
    );
    return c.json(
      inFlight.map((r) =>
        agentTaskSchema.parse({
          kind: 'build',
          // 等机器（queued）= 原件唯一的等待 token；跑起来后发 null，消费面
          // 回落 todo.phase（见 schema 注释）。
          state: r.phase === 'queued' ? 'waiting' : null,
          buildId: r.latestBuildId,
          todo: { id: r.id, seqNum: r.seqNum, title: r.title, phase: r.phase },
        }),
      ),
    );
  });
}
