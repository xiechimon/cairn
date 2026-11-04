import { feishuBotBodySchema } from '@cairn/shared';
import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { parseWith } from './lib/errors.js';
import { jsonBody, requireTeam } from './routes-helpers.js';
import { readFeishuBotStatus, saveFeishuBot, unbindFeishuBot } from './services/feishu.js';

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
    return c.json(saveFeishuBot(deps, { teamId, userId: ctx.user.id, body }));
  });
  app.delete('/api/teams/:id/feishu', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    unbindFeishuBot(deps, teamId);
    return c.body(null, 204);
  });
}
