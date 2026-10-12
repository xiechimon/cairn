// 任务域：todo CRUD + orchestrate 单出口（#640）+ 来源 issue 回显/重试
// （ADR 0006）+ 重置（#755）。
// #1125 拆域：本模块是 routes.ts 的一个资源域切片（词表单源与
// 对拍契约不变——shared WEB_REST_ENDPOINTS + test/wire.test.ts 拍的是组合
// 后的 app，不是文件布局）。编排位 = routes.ts 的 registerRoutes。

import {
  buildOrchestratePrompt,
  createTodoBodySchema,
  githubIssueEchoSchema,
  phaseSchema,
  type TodoRecord,
} from '@pacman/shared';
import { eq } from 'drizzle-orm';
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
import { advanceSplitWaves } from './services/builds.js';
import { sendChiefMessage } from './services/chief.js';
import { readSourceIssueEcho } from './services/github-issues.js';
import { PhaseTransitionError } from './services/phase.js';
import {
  createTodo,
  deleteTodo,
  getTodo,
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
  // 新 chief 线程 + 编排请求首条用户消息（任务原文逐字 = 稳定锚点，
  // r14 §5.2）+ chief 步入队；总管裁定单任务直派或拆子卡（纪律在其 system
  // prompt 工作约定）。相位闸：todo（开始）/ failed（重跑），其余 409。
  // wire 未采 → INFERRED_ROUTES 登记（todos/{id}/… REST 同族规则）。
  app.post('/api/todos/:id/orchestrate', (c) => {
    const id = c.req.param('id');
    const record = getTodo(svc, id);
    if (!record) throw notFound(`todo ${id}`);
    if (record.phase !== 'todo' && record.phase !== 'failed') {
      throw conflict(`orchestrate 仅适用于 待开始/失败 相位（当前 ${record.phase}）`);
    }
    const content = buildOrchestratePrompt({
      id: record.id,
      seqNum: record.seqNum,
      spec: record.spec,
      failed: record.phase === 'failed',
    });
    const result = sendChiefMessage(svc, record.teamId, {
      threadId: null,
      content,
    });
    // 会话流即时推送（chief 会话 = chief-<threadId> 键，POST threads 同形）。
    ctx.convHub?.publishMessage(result.thread.id, { ...result.message });
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
      createdBy: ctx.user.id, // 人工建 = seed 用户（createdBy 取值 [推断]，records/todo.ts）
      ownerId: ctx.user.id,
    });
    return c.json(record, 201); // 响应封套 [推断]：全记录（安全超集）
  });

  app.patch('/api/todos/:id', async (c) => {
    const id = c.req.param('id');
    const body = parseWith(patchTodoBodySchema, await jsonBody(c), 'body');
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
    if (body.phase === 'done') advanceSplitWaves(svc, id);
    return c.json(record);
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
