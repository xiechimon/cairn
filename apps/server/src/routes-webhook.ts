// Webhook 域（#1137）：GitHub receiver（自有路径 token 闸）+ webhook token
// mgmt 三端点（requireTeam 闸，api-keys 同族；不豁免 PACMAN_TOKEN——管理面
// 在 /api/teams/ 下，走既有 Bearer）。
// #1125 拆域：routes.ts 的一个资源域切片；词表单源与对拍契约不变（wire.test
// INFERRED_ROUTES 登记四个端点）。

import { webhookReceiverResponseSchema } from '@pacman/shared';
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

/** POST body（token 创建）：name 可选（api-key 弹窗同形）。 */
const createWebhookTokenBodySchema = z.object({ name: z.string().nullish() });

export function registerWebhookRoutes(app: Hono, ctx: AppContext): void {
  // —— receiver（GitHub webhook payload URL 的落点；token-auth 豁免条 6：
  // GitHub 无法自定义 Authorization 头，本路由自带路径 token 闸）——————
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
    // 一切收敛结果 = 202（重试风暴防御，服务面分诊语义）；HttpError（401
    // token 错 / 上游瞬时 502/429）经 app.onError 出各自状态码。
    return c.json(webhookReceiverResponseSchema.parse(response), 202);
  });

  // —— token mgmt（api-keys 三端点同族；管理面不豁免 PACMAN_TOKEN）————————
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
    // 创建响应含明文一次（api-key 同律：此后任何视图不再出现）。
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
