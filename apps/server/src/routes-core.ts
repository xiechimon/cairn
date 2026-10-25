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
  app.use('/api/*', async (c, next) => {
    if (!getCookie(c, SESSION_COOKIE)) {
      setCookie(c, SESSION_COOKIE, ctx.user.id, { httpOnly: true, path: '/' });
    }
    await next();
  });

  app.get('/api/auth/session', (c) => c.json(ctx.user));
  app.get('/api/user/me', (c) => c.json(ctx.user));

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
    const rows: TeamMember[] = [
      {
        id: `member-${ctx.user.id}`,
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
    const unread = ctx.db
      .selectDistinct({ entityId: notification.entityId })
      .from(notification)
      .where(isNull(notification.readAt))
      .all()
      .map((r) => r.entityId);
    return c.json({ unreadThreadIds: unread });
  });

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
      await conn.send({ type: 'ping', seq: conn.nextSeq() });
      await held;
    });
  });
}
