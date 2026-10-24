// 任务域：todo CRUD + orchestrate 单出口（#640）+ 来源 issue 回显/重试
// （ADR 0006）+ 重置（#755）。
// #1125 拆域：本模块是 routes.ts 的一个资源域切片（词表单源与
// 对拍契约不变——shared WEB_REST_ENDPOINTS + test/wire.test.ts 拍的是组合
// 后的 app，不是文件布局）。编排位 = routes.ts 的 registerRoutes。

import {
  createTodoBodySchema,
  githubIssueEchoSchema,
  IN_PROGRESS_PHASES,
  phaseSchema,
  type TodoRecord,
} from '@cairn/shared';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from './context.js';
import { conflict, notFound, parseWith } from './lib/errors.js';
import {
  githubIssueDepsOf,
  jsonBody,
  patchTodoBodySchema,
  requireProject,
  svcOf,
} from './routes-helpers.js';
import {
  advanceSplitWaves,
  prepareStopForDone,
  stopActiveStepsAfterExit,
} from './services/builds.js';
import { readSourceIssueEcho } from './services/github-issues.js';
import { orchestrateTodo } from './services/orchestrate.js';
import { PhaseTransitionError } from './services/phase.js';
import {
  createTodo,
  deleteTodo,
  getTodo,
  isStartedTodoRow,
  listTodos,
  resetTodo,
  retrySelfIssueCreate,
  updateTodo,
} from './services/todos.js';

export function registerTodoRoutes(app: Hono, ctx: AppContext): void {
  const svc = svcOf(ctx);

  // —— GitHub 写向（#452 / ADR 0006）：来源 issue 只读回显 + 未建成重试 ——
  // 回显（D5/D6）：详情页进入时拉一次；任何拉不到 = 非 200（web 整行隐藏，
  // 不显示陈旧值不弹错）。重试（D2）：未建成 → 同步建站补来源；已建成/在飞
  // → 409（不双建）。封套单源 = shared githubIssueEchoSchema。
  app.get('/api/todos/:id/github-issue', async (c) => {
    const echo = await readSourceIssueEcho(githubIssueDepsOf(ctx), c.req.param('id'));
    return c.json(githubIssueEchoSchema.parse(echo));
  });

  app.post('/api/todos/:id/github-issue/retry', async (c) => {
    const record = await retrySelfIssueCreate(svc, c.req.param('id'));
    return c.json(record);
  });

  app.get('/api/todos', (c) => {
    const teamId = c.req.query('teamId') ?? ctx.team.id;
    return c.json(listTodos(svc, { teamId }));
  });

  app.get('/api/todos/:id', (c) => {
    const id = c.req.param('id');
    const record = getTodo(svc, id);
    if (!record) throw notFound(`todo ${id}`);
    return c.json(record);
  });

  // 开始任务 = 单出口直发总管编排回合（#640 / r14 §5.7，用户 2026-10-02
  // 前置裁决：入口不再给「先做规划/立即执行」选择，编排为唯一默认路径）。
  // #1137：实现收口 services/orchestrate.ts（REST 与 webhook receiver 共用），
  // 路由变薄转发——行为面由 orchestration-source.test.ts D 组钉住。
  // wire 未采 → INFERRED_ROUTES 登记（todos/{id}/… REST 同族规则）。
  app.post('/api/todos/:id/orchestrate', (c) => {
    const result = orchestrateTodo(svc, c.req.param('id'));
    return c.json(result, 201);
  });

  app.post('/api/projects/:id/todos', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    const body = parseWith(createTodoBodySchema, await jsonBody(c), 'body');
    const record = createTodo(svc, {
      teamId: row.teamId,
      projectId: row.id,
      title: body.title,
      spec: body.spec,
      ...(body.tagIds !== undefined ? { tagIds: body.tagIds } : {}),
      ...(body.output !== undefined ? { output: body.output } : {}),
      createdBy: ctx.user.id, // 人工建 = seed 用户（createdBy 取值 [推断]，records/todo.ts）
      ownerId: ctx.user.id,
    });
    return c.json(record, 201); // 响应封套 [推断]：全记录（安全超集）
  });

  app.patch('/api/todos/:id', async (c) => {
    const id = c.req.param('id');
    const body = parseWith(patchTodoBodySchema, await jsonBody(c), 'body');
    const prior = getTodo(svc, id);
    // #1486（2026-10-22 裁决）：已开始的卡（进行中，或带构建历史）挪回待开始只走
    // 重置——PATCH 改相会留下旧 build 与产物位，下一轮被 #1217 守卫误判重复
    // 交付。closed → todo 是重新打开（保留历史，与 reopen_todos 同语义），不拦。
    if (
      body.phase === 'todo' &&
      prior != null &&
      prior.phase !== 'todo' &&
      prior.phase !== 'closed' &&
      isStartedTodoRow(prior)
    ) {
      throw conflict(
        `这张卡已经开始过，挪回待开始要重置（清空构建历史）：POST /api/todos/${id}/reset`,
      );
    }
    let record: TodoRecord | null;
    try {
      // #160：HTTP PATCH phase = 看板拖拽手动改相面（六列 dropPhase 目标
      // 放行漏斗非法边）；系统流不经本路由，漏斗不变。
      record = updateTodo(svc, id, body, { manualPhase: true });
    } catch (err) {
      if (err instanceof PhaseTransitionError) throw conflict(err.message);
      throw err;
    }
    if (!record) throw notFound(`todo ${id}`);
    // #1250（ADR 0018 层 2）：手动 done 落地（拖拽/更多菜单）同触发拆卡
    // 波次推进（completeStep 的 merge 半边与 transitionTodos 的工具半边
    // 同律——子卡 done 解锁后续波次自动派发；非子卡零动作）。
    // #1247：failed 源是关卡，不是成功交付。跳过波次，避免把「失败子卡标
    // 完成」当成阻塞解除去派发下一张。父卡收口仍走 updateTodo 里的
    // settleSplitOnDone（兄弟都 done 时父收，不在这里派发新构建）。
    if (body.phase === 'done' && prior?.phase !== 'failed') advanceSplitWaves(svc, id);
    // #1445：手动关闭（详情 关闭 / 看板 已取消）同停活动步，机器不再领这张卡。
    // raw PATCH 把执行中的卡标完成（web 走 stop-and-done，不经这里）同理
    // （#1451）：pending 步留着会被领走，claimed 步零通知继续跑。挪回待开始
    // 已在上面拒收（#1486，只走 /reset）。漏斗边（building→review 等）不在此
    // 列。判 record（写后值）不判 body：同相位 PATCH 在 updateTodo 里静默 no-op。
    const closing = record.phase === 'closed' && prior?.phase !== 'closed';
    const exited =
      prior != null &&
      (IN_PROGRESS_PHASES as readonly string[]).includes(prior.phase) &&
      record.phase === 'done';
    if (closing || exited) stopActiveStepsAfterExit(svc, id);
    return c.json(record);
  });

  // #1247 stop-then-done：在飞卡拖入已完成——先停活动步再标 done。
  // pending = 同步停+done；claimed = 委托停并预定 afterStop=done，等 daemon
  // 回报后落 done（卡停在执行中直到停成功，不会出现「done 仍在跑」）。
  app.post('/api/todos/:id/stop-and-done', async (c) => {
    const id = c.req.param('id');
    const prior = getTodo(svc, id);
    if (!prior) throw notFound(`todo ${id}`);
    let prep: ReturnType<typeof prepareStopForDone>;
    try {
      prep = prepareStopForDone(svc, id);
    } catch (err) {
      if (err instanceof PhaseTransitionError) throw conflict(err.message);
      throw err;
    }
    if (prep.state === 'stopping') {
      const record = getTodo(svc, id);
      if (!record) throw notFound(`todo ${id}`);
      return c.json({ state: 'stopping' as const, todo: record });
    }
    let record: TodoRecord | null;
    try {
      record = updateTodo(svc, id, { phase: 'done' }, { manualPhase: true });
    } catch (err) {
      if (err instanceof PhaseTransitionError) throw conflict(err.message);
      throw err;
    }
    if (!record) throw notFound(`todo ${id}`);
    if (prior.phase !== 'failed') advanceSplitWaves(svc, id);
    return c.json({ state: 'done' as const, todo: record });
  });

  // 任务重置（#755）：已开始卡拖回待开始的确认落位——中断在飞构建 + 清空
  // 产物 + 相位回 todo。body 快照（dialog 打开时刻的相位/build）与服务端
  // 现值对不上 = 409 + 现记录（构建在确认前推进了，调用方刷新 dialog 文案
  // 重新确认，不得按旧文案重置）。
  const resetTodoBodySchema = z.object({
    expectedPhase: phaseSchema.optional(),
    expectedBuildId: z.string().nullable().optional(),
  });

  app.post('/api/todos/:id/reset', async (c) => {
    const id = c.req.param('id');
    const body = parseWith(resetTodoBodySchema, await jsonBody(c), 'body');
    const result = resetTodo(
      svc,
      id,
      body.expectedPhase !== undefined || body.expectedBuildId !== undefined
        ? { phase: body.expectedPhase, buildId: body.expectedBuildId }
        : undefined,
    );
    if (!result) throw notFound(`todo ${id}`);
    if (result.stale) {
      return c.json(
        {
          error: '任务在你确认前发生了变化（构建已推进），请按最新状态重新确认。',
          record: result.record,
        },
        409,
      );
    }
    return c.json(result.record);
  });

  app.delete('/api/todos/:id', (c) => {
    const id = c.req.param('id');
    if (!deleteTodo(svc, id)) throw notFound(`todo ${id}`);
    return c.body(null, 204);
  });
}
