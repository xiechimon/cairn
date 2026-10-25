import { webhookReceiverResponseSchema } from '@cairn/shared';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from './context.js';
import { notFound, parseWith } from './lib/errors.js';
import { jsonBody, requireTeam, svcOf } from './routes-helpers.js';
import { receiveGithubWebhook } from './services/webhook.js';
import {
  createWebhookToken,
  deleteWebhookToken,
  listWebhookTokens,
} from './services/webhook-tokens.js';

const createWebhookTokenBodySchema = z.object({ name: z.string().nullish() });

export function registerWebhookRoutes(app: Hono, ctx: AppContext): void {
  app.post('/api/webhook/github/:token', async (c) => {
    const svc = svcOf(ctx);
    const response = await receiveGithubWebhook(
      {
        ...svc,
        ...(ctx.githubFetch !== undefined ? { githubFetch: ctx.githubFetch } : {}),
        ...(ctx.logger !== undefined ? { logger: ctx.logger } : {}),
      },
      {
        token: c.req.param('token'),
        event: c.req.header('x-github-event'),
        deliveryId: c.req.header('x-github-delivery') ?? '',
        body: await jsonBody(c),
      },
    );
    return c.json(webhookReceiverResponseSchema.parse(response), 202);
  });

  app.get('/api/teams/:id/webhook-tokens', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(listWebhookTokens({ db: ctx.db }, teamId));
  });

  app.post('/api/teams/:id/webhook-tokens', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(createWebhookTokenBodySchema, await jsonBody(c), 'body');
    const created = createWebhookToken(
      { db: ctx.db },
      {
        teamId,
        ...(body.name !== undefined && body.name !== null ? { name: body.name } : {}),
      },
    );
    return c.json(created, 201);
  });

  app.delete('/api/teams/:id/webhook-tokens/:tid', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    if (!deleteWebhookToken({ db: ctx.db }, teamId, c.req.param('tid'))) {
      throw notFound(`webhook token ${c.req.param('tid')}`);
    }
    return c.body(null, 204);
  });
}
