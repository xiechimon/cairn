// 构建域：build/steps 读面 + 会话消息与 SSE 流 + 分支同步（M7 #319）+
// 步动作/停止 + plans/changes/usage 详情读面。
// #1125 拆域：本模块是 routes.ts 的一个资源域切片（词表单源与
// 对拍契约不变——shared WEB_REST_ENDPOINTS + test/wire.test.ts 拍的是组合
// 后的 app，不是文件布局）。编排位 = routes.ts 的 registerRoutes。

import {
  type BuildRecord,
  buildStepActionBodySchema,
  buildStopBodySchema,
  createBranchSyncBodySchema,
  planRowSchema,
  startBuildsBodySchema,
  tokenUsageSchema,
} from '@pacman/shared';
import { asc, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AppContext } from './context.js';
import { message, plan as planTable, project, todo, tokenUsage } from './db/schema.js';
import { conflict, HttpError, notFound, parseWith } from './lib/errors.js';
import { jsonBody, requestOrigin, requireProject, svcOf } from './routes-helpers.js';
import {
  createBranchSync,
  latestBranchSyncForBuild,
  type MachineSyncHub,
} from './services/branch-sync.js';
import {
  applyBuildStepAction,
  getBuild,
  listSteps,
  readSteerPending,
  requestMerge,
  requestStop,
  startBuilds,
} from './services/builds.js';
import { chiefThreadMessages, getChiefThread } from './services/chief.js';
import { createSerialConnection } from './services/events.js';
import { readBuildChangeFile, readBuildChanges } from './services/git.js';
import { isChiefConversation } from './services/machines.js';
import { PhaseTransitionError } from './services/phase.js';

export function registerBuildRoutes(app: Hono, ctx: AppContext): void {
  const svc = svcOf(ctx);

  app.get('/api/builds/:id', (c) => {
    const id = c.req.param('id');
    const record = getBuild(svc, id);
    if (!record) throw notFound(`build ${id}`);
    return c.json(record);
  });

  app.get('/api/builds/:id/steps', (c) => {
    const id = c.req.param('id');
    if (!getBuild(svc, id)) throw notFound(`build ${id}`);
    return c.json(listSteps(svc, id));
  });

  app.get('/api/conversations/:id/messages', (c) => {
    const conversationId = c.req.param('id');
    // 封套 = conversationMessagesResponseSchema（r5 §3.6 原样）；未采字段取
    // 空值 [推断]（chips/steerPending/nextCursor 细形未逐一采集）。
    // chief 会话（conv id = `chief-<threadId>`，r5 §3.6）→ chief_message + 线程
    // activeRun；worker 会话 → message 表。
    if (isChiefConversation(conversationId)) {
      const thread = getChiefThread(svc, conversationId);
      if (!thread) throw notFound(`conversation ${conversationId}`);
      const rows = chiefThreadMessages(ctx.db, conversationId);
      return c.json({
        messages: rows.map((r) => ({
          id: r.id,
          role: r.role,
          content: r.content,
          createdAt: r.createdAt,
        })),
        chips: [],
        historyEpoch: 0,
        steerPending: [],
        activeRun: thread.activeRun,
        nextCursor: null,
      });
    }
    const rows = ctx.db
      .select()
      .from(message)
      .where(eq(message.conversationId, conversationId))
      .all();
    return c.json({
      messages: rows.map((r) => ({
        id: r.id,
        role: r.role,
        content: r.content,
        createdAt: r.createdAt,
        // #902 过闸宣告行的动作主体（存量行/daemon 上传行 = null）。
        actor: r.actor,
      })),
      chips: [],
      historyEpoch: 0,
      // W3 #278：build 会话分支透出单槽 pending 内容（数组形封套观测位）。
      steerPending: readSteerPending(ctx.db, conversationId),
      activeRun: null,
      nextCursor: null,
    });
  });

  // —— SSE conversation stream（02 §1.2 会话流，词表内；r3 §3.5 抓包见请求，
  // 逐事件载荷未枚举 = pi 流词表承载 [推断]，事件面单源 = shared
  // conversationStreamEventSchema 定型四事件 ping/message/text_delta/step）。
  // 订阅不存在的会话合法（空流 + ping；build 首启前详情页即挂流的时序面）。
  app.get('/api/conversations/:id/stream', (c) => {
    const conversationId = c.req.param('id');
    return streamSSE(c, async (stream) => {
      const conn = createSerialConnection((payload) =>
        stream.writeSSE({ data: JSON.stringify(payload) }),
      );
      const unsubscribe = ctx.convHub?.subscribe(conversationId, conn) ?? (() => {});
      const timer = setInterval(() => {
        void conn.send({ type: 'ping', seq: conn.nextSeq() });
      }, ctx.pingIntervalMs);
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      stream.onAbort(() => {
        clearInterval(timer);
        unsubscribe();
        release();
      });
      await conn.send({ type: 'ping', seq: conn.nextSeq() }); // 连接即首帧 ping
      await held;
    });
  });

  app.post('/api/projects/:id/builds', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    const body = parseWith(startBuildsBodySchema, await jsonBody(c), 'body');
    let builds: BuildRecord[];
    try {
      builds = startBuilds(svc, {
        projectId: row.id,
        todoIds: body.todoIds,
        assignment: body.assignment,
        withPlan: body.withPlan,
      });
    } catch (err) {
      if (err instanceof PhaseTransitionError) throw conflict(err.message);
      throw err;
    }
    return c.json({ builds }, 201); // 封套 [推断]（响应 wire 未采）
  });

  app.post('/api/builds/:id/merge', async (c) => {
    try {
      const result = await requestMerge(svc, c.req.param('id'));
      return c.json(result, 202); // 202 {delegated:true}（r3 §3.6 实测）
    } catch (err) {
      if (err instanceof PhaseTransitionError) throw conflict(err.message);
      throw err;
    }
  });

  // —— build 分支对话框「同步到机器」（M7 #319，08 册附录 B）———————————————
  // 创建同步：web → server 写 pending 行 + 推 machine wire sync 事件 +
  // 推 team stream branch_sync 事件；machine wire 派发失败（机器 stream 断连
  // 中间态）= 路由层 409 + 结果卡显示 failed（services/branch-sync.ts 落账）。
  // 响应 = 全 branch_sync 行，载荷形 wire = shared branchSyncRecordSchema 单源。
  // build → teamId 经 todo 行投影（build record 无 teamId 列，02 §6.2
  // 字段表不含——投影必经 todo）；cloneUrl 经 todo → project → repoKind 双形态
  // 分流（hosted = server 端 bare clone URL；github = github.com/<owner>/<repo>.git）。
  app.post('/api/builds/:id/branch-sync', async (c) => {
    const buildId = c.req.param('id');
    const buildRow = getBuild(svc, buildId);
    if (!buildRow) throw notFound(`build ${buildId}`);
    const todoRow = ctx.db
      .select({ teamId: todo.teamId, projectId: todo.projectId })
      .from(todo)
      .where(eq(todo.id, buildRow.todoId))
      .get();
    if (!todoRow) throw notFound(`todo ${buildRow.todoId}`);
    let cloneUrl: string | null = null;
    let projectId: string | null = null;
    if (todoRow.projectId !== null) {
      const projRow = ctx.db.select().from(project).where(eq(project.id, todoRow.projectId)).get();
      if (projRow) {
        projectId = projRow.id;
        const origin = requestOrigin(c);
        if (projRow.repoKind === 'hosted' && projRow.repoName !== null) {
          cloneUrl = `${origin}/git/${todoRow.teamId}/${projRow.repoName}`;
        } else if (projRow.repoKind === 'github' && projRow.githubRepo !== null) {
          cloneUrl = `https://github.com/${projRow.githubRepo}.git`;
        }
      }
    }
    const body = parseWith(createBranchSyncBodySchema, await jsonBody(c), 'body');
    const record = createBranchSync(
      {
        db: ctx.db,
        hub: ctx.hub,
        // MachineWakeHub 实现了 MachineSyncHub 接口（同进程内 cast 安全）。
        machineHub: ctx.machineHub as unknown as MachineSyncHub,
      },
      {
        buildId,
        machineId: body.machineId,
        teamId: todoRow.teamId,
        projectId,
        cloneUrl,
        directory: body.directory,
        ref: body.ref,
        commit: body.commit,
        force: body.force,
      },
    );
    return c.json(record, 201);
  });

  // 查 build 最新一次 sync：web 端结果卡初屏数据源（订阅失败/SSE 错位时兜底
  // 重取，02 §1.2/§1.3 双保险）。无 sync 行 = null（前端不显示结果卡）。
  app.get('/api/builds/:id/branch-sync', (c) => {
    const buildId = c.req.param('id');
    if (!getBuild(svc, buildId)) throw notFound(`build ${buildId}`);
    return c.json(latestBranchSyncForBuild({ db: ctx.db }, buildId));
  });

  app.post('/api/builds/:id/steps', async (c) => {
    const body = parseWith(buildStepActionBodySchema, await jsonBody(c), 'body');
    try {
      // await 必须在位：审核关口的材料组装要读变更面（git 面异步），异常
      // 经 Promise 拒绝上浮——不 await 会让 409/404 变成未处理拒绝。
      await applyBuildStepAction(svc, c.req.param('id'), body);
    } catch (err) {
      if (err instanceof PhaseTransitionError) throw conflict(err.message);
      throw err;
    }
    // 响应封套 [推断]：入队即委派语义（与 merge 同族 202；wire 未采）。
    return c.json({ delegated: true }, 202);
  });

  // 停止钮（M7 #308，r9 §3.3；[设计] builds 族路径——原站 stop wire 未采，
  // r9 §5）：claimed 步 = 委派机器信号 202；pending 步 = server 即时取消 200。
  app.post('/api/builds/:id/stop', async (c) => {
    const body = parseWith(buildStopBodySchema, await jsonBody(c), 'body');
    const result = requestStop(svc, c.req.param('id'), body);
    return c.json(result, result.delegated ? 202 : 200);
  });

  // —— [推断] build 详情读面（M5 详情页 overlay 数据源；wire 未采，路径 =
  // builds/{id}/… REST 同族规则，wire.test INFERRED_ROUTES 登记）：
  // plans = 版本集 + plan.md 内容（版本下拉/文档 pane，r5 §4 触点）；
  // changes = conv 分支 vs 默认分支文件级 diff（变更 pane，r7 27 触点）；
  // usage = build × model 四维记账（Token 用量 dialog，r3 §3.8/r7 30 触点）。
  app.get('/api/builds/:id/plans', (c) => {
    const id = c.req.param('id');
    if (!getBuild(svc, id)) throw notFound(`build ${id}`);
    const rows = ctx.db
      .select()
      .from(planTable)
      .where(eq(planTable.buildId, id))
      .orderBy(asc(planTable.version))
      .all();
    // 行形单源 = shared planRowSchema（record + content 透出 [推断] 封套）。
    return c.json(
      rows.map((r) =>
        planRowSchema.parse({
          id: r.id,
          buildId: r.buildId,
          version: r.version,
          createdAt: r.createdAt,
          content: r.content,
        }),
      ),
    );
  });

  app.get('/api/builds/:id/changes', async (c) =>
    c.json(await readBuildChanges({ db: ctx.db, reposDir: ctx.reposDir }, c.req.param('id'))),
  );

  // changes/file = conv 分支头单文件全文按需取（#224；docpane「显示完整文件」
  // 数据源，web 接线 #225）——独立端点，changes 列表面不被全文撑爆。
  app.get('/api/builds/:id/changes/file', async (c) => {
    const path = c.req.query('path');
    if (path === undefined || path === '') {
      throw new HttpError(400, 'invalid query path: required');
    }
    return c.json(
      await readBuildChangeFile({ db: ctx.db, reposDir: ctx.reposDir }, c.req.param('id'), path),
    );
  });

  app.get('/api/builds/:id/usage', (c) => {
    const id = c.req.param('id');
    if (!getBuild(svc, id)) throw notFound(`build ${id}`);
    const rows = ctx.db.select().from(tokenUsage).where(eq(tokenUsage.buildId, id)).all();
    return c.json(rows.map((r) => tokenUsageSchema.parse(r)));
  });
}
