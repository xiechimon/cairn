import { webhookReceiverResponseSchema } from '@cairn/shared';
import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { svcOf } from './routes-helpers.js';
import { receiveGithubWebhook } from './services/github-webhook.js';

export function registerGithubWebhookRoutes(app: Hono, ctx: AppContext): void {
  app.post('/api/webhook/github/:token', (c) => {
    const deps = {
      ...svcOf(ctx),
      ...(ctx.logger !== undefined ? { logger: ctx.logger } : {}),
    };
    const response = receiveGithubWebhook(deps, {
      token: c.req.param('token'),
      event: c.req.header('x-github-event'),
      deliveryId: c.req.header('x-github-delivery') ?? c.req.header('x-cairn-delivery'),
    });
    return c.json(webhookReceiverResponseSchema.parse(response), 202);
  });
}
