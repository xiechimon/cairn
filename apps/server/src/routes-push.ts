import {
  pushSubscriptionBodySchemaForHosts,
  pushSubscriptionDeleteBodySchema,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from './context.js';
import { pushDelivery, pushSubscription } from './db/schema.js';
import { parseWith } from './lib/errors.js';
import { newRecordId, nowMs } from './lib/ids.js';
import { jsonBody, requireTeam } from './routes-helpers.js';
import { sendMustReachAlert } from './services/push-alerts.js';

const requestWindows = new WeakMap<AppContext, Map<string, number[]>>();

function allowRequest(ctx: AppContext, key: string): boolean {
  const now = Date.now();
  const windows = requestWindows.get(ctx) ?? new Map<string, number[]>();
  const recent = (windows.get(key) ?? []).filter((timestamp) => now - timestamp < 60_000);
  if (recent.length >= 30) return false;
  recent.push(now);
  windows.set(key, recent);
  requestWindows.set(ctx, windows);
  return true;
}

export function registerPushRoutes(app: Hono, ctx: AppContext): void {
  app.post('/api/teams/:id/push/receipts', async (c) => {
    requireTeam(ctx, c.req.param('id'));
    const body = parseWith(
      z.object({ id: z.string().min(1).max(128) }).strict(),
      await jsonBody(c),
      'body',
    );
    const row = ctx.db
      .select()
      .from(pushDelivery)
      .where(
        and(
          eq(pushDelivery.id, body.id),
          eq(pushDelivery.userId, ctx.user.id),
          eq(pushDelivery.teamId, ctx.team.id),
        ),
      )
      .get();
    if (row === undefined) return c.json({ error: 'push delivery not found' }, 404);
    if (row.receivedAt === null)
      ctx.db
        .update(pushDelivery)
        .set({ receivedAt: nowMs() })
        .where(eq(pushDelivery.id, row.id))
        .run();
    return c.json({ ok: true });
  });

  app.post('/api/teams/:id/push/test', async (c) => {
    requireTeam(ctx, c.req.param('id'));
    const body = parseWith(z.object({ userId: z.string() }).strict(), await jsonBody(c), 'body');
    if (body.userId !== ctx.user.id) return c.json({ error: 'push user not found' }, 404);
    if (!allowRequest(ctx, `${ctx.user.id}:test`))
      return c.json({ error: 'too many push test requests' }, 429);
    const id = newRecordId();
    void sendMustReachAlert(
      ctx.db,
      ctx.vapidKeys ?? null,
      ctx.user.id,
      ctx.team.id,
      {
        title: 'test: batch paused',
        body: 'Push delivery test',
        href: '/app',
        tag: 'push-test',
      },
      undefined,
      id,
    ).catch(() => {
      process.stderr.write(`ALERT DISPATCH FAILED ${id}\n`);
    });
    return c.json({ id }, 202);
  });

  app.get('/api/teams/:id/push/test/:deliveryId', (c) => {
    requireTeam(ctx, c.req.param('id'));
    const row = ctx.db
      .select()
      .from(pushDelivery)
      .where(
        and(
          eq(pushDelivery.id, c.req.param('deliveryId')),
          eq(pushDelivery.userId, ctx.user.id),
          eq(pushDelivery.teamId, ctx.team.id),
        ),
      )
      .get();
    if (!row) return c.json({ error: 'push delivery not found' }, 404);
    return c.json({
      id: row.id,
      push: { status: row.pushStatus },
      alertStatus: row.alertStatus,
      receivedAt: row.receivedAt,
    });
  });

  app.get('/api/teams/:id/push/key', (c) => {
    requireTeam(ctx, c.req.param('id'));
    if (ctx.vapidKeys == null) {
      return c.json({ error: 'web push not configured' }, 404);
    }
    return c.json({ publicKey: ctx.vapidKeys.publicKey });
  });

  app.post('/api/teams/:id/push/subscriptions', async (c) => {
    requireTeam(ctx, c.req.param('id'));
    if (!allowRequest(ctx, `${ctx.user.id}:subscribe`)) {
      return c.json({ error: 'too many push subscription requests' }, 429);
    }
    const body = parseWith(
      pushSubscriptionBodySchemaForHosts(ctx.pushEndpointHosts),
      await jsonBody(c),
      'body',
    );
    const existing = ctx.db
      .select({ userId: pushSubscription.userId, teamId: pushSubscription.teamId })
      .from(pushSubscription)
      .where(eq(pushSubscription.endpoint, body.endpoint))
      .get();
    if (
      existing !== undefined &&
      (existing.userId !== ctx.user.id || existing.teamId !== ctx.team.id)
    ) {
      return c.json({ error: 'push endpoint already belongs to another account' }, 409);
    }
    const createdAt = nowMs();
    ctx.db
      .insert(pushSubscription)
      .values({
        id: newRecordId(),
        userId: ctx.user.id,
        teamId: ctx.team.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        createdAt,
      })
      .onConflictDoUpdate({
        target: pushSubscription.endpoint,
        set: {
          userId: ctx.user.id,
          teamId: ctx.team.id,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          createdAt,
        },
      })
      .run();
    const oldest = ctx.db
      .select({ id: pushSubscription.id })
      .from(pushSubscription)
      .where(
        and(eq(pushSubscription.userId, ctx.user.id), eq(pushSubscription.teamId, ctx.team.id)),
      )
      .orderBy(pushSubscription.createdAt)
      .all()
      .slice(0, -20);
    for (const row of oldest) {
      ctx.db.delete(pushSubscription).where(eq(pushSubscription.id, row.id)).run();
    }
    return c.json({ ok: true }, 201);
  });

  app.delete('/api/teams/:id/push/subscriptions', async (c) => {
    requireTeam(ctx, c.req.param('id'));
    if (!allowRequest(ctx, `${ctx.user.id}:unsubscribe`)) {
      return c.json({ error: 'too many push subscription requests' }, 429);
    }
    const body = parseWith(pushSubscriptionDeleteBodySchema, await jsonBody(c), 'body');
    ctx.db
      .delete(pushSubscription)
      .where(
        and(
          eq(pushSubscription.endpoint, body.endpoint),
          eq(pushSubscription.userId, ctx.user.id),
          eq(pushSubscription.teamId, ctx.team.id),
        ),
      )
      .run();
    return c.body(null, 204);
  });
}
