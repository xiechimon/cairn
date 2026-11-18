import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { fireScheduleWebhook } from './services/schedule-webhook.js';

export function registerScheduleWebhookRoutes(
  app: Hono,
  ctx: Pick<AppContext, 'db' | 'hub'>,
): void {
  app.post('/api/webhook/schedule/:token', (c) => {
    const result = fireScheduleWebhook(
      { db: ctx.db, hub: ctx.hub },
      c.req.param('token'),
      c.req.header('x-cairn-delivery') ?? c.req.header('x-github-delivery'),
    );
    if (result.result === 'unknown') {
      return c.json({ error: 'unknown webhook token' }, 401);
    }
    return c.json(result, 202);
  });
}
