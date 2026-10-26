import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from './context.js';
import { parseWith } from './lib/errors.js';
import { jsonBody, requireTeam } from './routes-helpers.js';
import { readFeishuBotStatus, saveFeishuBot, unbindFeishuBot } from './services/feishu.js';

const feishuBotBodySchema = z.object({
  appId: z.string().trim().min(1).max(64),
  appSecret: z.string().max(256),
  openId: z.string().trim().min(1).max(128).regex(/^\S+$/),
  cairnOrigin: z.string().trim().min(1).max(300),
});

export function registerFeishuRoutes(app: Hono, ctx: AppContext): void {
  const deps = { db: ctx.db, box: ctx.secretBox };

  app.get('/api/teams/:id/feishu', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(readFeishuBotStatus(deps, teamId));
  });

  app.put('/api/teams/:id/feishu', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(feishuBotBodySchema, await jsonBody(c), 'body');
    saveFeishuBot(deps, { teamId, userId: ctx.user.id, ...body });
    ctx.feishu?.reload();
    return c.json(readFeishuBotStatus(deps, teamId));
  });

  app.delete('/api/teams/:id/feishu', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    unbindFeishuBot(deps, teamId);
    ctx.feishu?.reload();
    return c.body(null, 204);
  });
}
