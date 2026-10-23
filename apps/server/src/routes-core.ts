// 认证保形（cookie 自设）+ 用户/团队/成员/通知读面 + SSE team stream。
// #1125 拆域：本模块是 routes.ts 的一个资源域切片（词表单源与
// 对拍契约不变——shared WEB_REST_ENDPOINTS + test/wire.test.ts 拍的是组合
// 后的 app，不是文件布局）。编排位 = routes.ts 的 registerRoutes。

import { patchUserBodySchema, type TeamMember } from '@cairn/shared';
import { eq, isNull } from 'drizzle-orm';
import type { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import type { AppContext } from './context.js';
import { agent, notification, user } from './db/schema.js';
import { parseWith } from './lib/errors.js';
import { agentRecordOf, jsonBody, requireTeam, SESSION_COOKIE } from './routes-helpers.js';
import { createSerialConnection } from './services/events.js';

export function registerCoreRoutes(app: Hono, ctx: AppContext): void {
  // —— 认证保形（02 §2.1：自动登录，无登录页）———————————————————————————
  app.use('/api/*', async (c, next) => {
    if (!getCookie(c, SESSION_COOKIE)) {
      setCookie(c, SESSION_COOKIE, ctx.user.id, { httpOnly: true, path: '/' });
    }
    await next();
  });

  // —— GET 面 ————————————————————————————————————————————————————————————————
  app.get('/api/auth/session', (c) => c.json(ctx.user));
  app.get('/api/user/me', (c) => c.json(ctx.user));

  // 改名落盘面（#1031：帐号页名称行内编辑）。GET 同名 PATCH [推断]（02 §6.1
  // REST 同名规则族，wire 未采——wire.test.ts INFERRED_ROUTES 登记）。写两处：
  // DB user 行（重启后仍是新名）+ ctx.user 内存 seed 副本（GET me/session 与
  // members actor 三条读面全吃这个引用，只落库不回填内存 = PATCH 成功后读面
  // 仍报旧名）。displayName 走 patchUserBodySchema 的 trim+min(1)，空白名 400。
  app.patch('/api/user/me', async (c) => {
    const body = parseWith(patchUserBodySchema, await jsonBody(c), 'body');
    ctx.db
      .update(user)
      .set({ displayName: body.displayName })
      .where(eq(user.id, ctx.user.id))
      .run();
    ctx.user.displayName = body.displayName;
    return c.json(ctx.user);
  });

  app.get('/api/teams', (c) => c.json([ctx.team]));

  app.get('/api/teams/:id/members', (c) => {
    const id = c.req.param('id');
    requireTeam(ctx, id);
    // 成员区只渲染自己一行 + Agent 计数（02 §2.3/r3 §4；r5 §1：Agent 列表
    // 实际走 members，memberType:"agent" 行内嵌 actor 全记录）。
    const rows: TeamMember[] = [
      {
        id: `member-${ctx.user.id}`, // 行 id 合成 [推断]（member 无表位，DB_TABLES 单源）
        teamId: id,
        actorId: ctx.user.id,
        memberType: 'user',
        actor: ctx.user,
      },
    ];
    for (const row of ctx.db.select().from(agent).where(eq(agent.teamId, id)).all()) {
      rows.push({
        id: `member-${row.id}`,
        teamId: id,
        actorId: row.id,
        memberType: 'agent',
        actor: agentRecordOf(row),
      });
    }
    return c.json(rows);
  });

  app.get('/api/teams/:id/notifications', (c) => {
    const id = c.req.param('id');
    requireTeam(ctx, id);
    // {unreadThreadIds}（02 §9.1）：未读 entityId 集（todo/chief 线程）；事件面
    // = services/notifications.ts（SSE 三事件，r5 §7.2）。已读写路径无观测端点，
    // 未读集随新事件 upsert 重置（04 附录 A 补采口径）。
    const unread = ctx.db
      .selectDistinct({ entityId: notification.entityId })
      .from(notification)
      .where(isNull(notification.readAt))
      .all()
      .map((r) => r.entityId);
    return c.json({ unreadThreadIds: unread });
  });

  // —— SSE team stream（02 §1.2；事件形状 = shared teamStreamEventSchema）———————
  app.get('/api/teams/:id/stream', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return streamSSE(c, async (stream) => {
      const conn = createSerialConnection((payload) =>
        stream.writeSSE({ data: JSON.stringify(payload) }),
      );
      const unsubscribe = ctx.hub.subscribe(teamId, conn);
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
      // 连接即发首帧 ping（seq 连接内递增，r3 §8.1 样本族）[推断：首帧时机]。
      await conn.send({ type: 'ping', seq: conn.nextSeq() });
      await held;
    });
  });
}
