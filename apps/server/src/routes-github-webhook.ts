import { webhookReceiverResponseSchema } from '@cairn/shared';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppContext } from './context.js';
import { svcOf } from './routes-helpers.js';
import { receiveGithubWebhook } from './services/github-webhook.js';

const GITHUB_WEBHOOK_BODY_MAX_BYTES = 256 * 1024;

export function registerGithubWebhookRoutes(app: Hono, ctx: AppContext): void {
  app.post(
    '/api/webhook/github/:token',
    bodyLimit({
      maxSize: GITHUB_WEBHOOK_BODY_MAX_BYTES,
      onError: (c) => c.json({ error: 'github webhook body too large' }, 413),
    }),
    async (c) => {
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
    },
  );
}
