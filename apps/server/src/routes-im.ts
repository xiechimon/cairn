import {
  imImessageConnectBodySchema,
  imSlackConnectBodySchema,
  imTelegramConnectBodySchema,
} from '@cairn/shared';
import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { conditionalGet } from './lib/conditional-get.js';
import { HttpError, parseWith } from './lib/errors.js';
import { jsonBody, requireTeam } from './routes-helpers.js';
import type { ImService } from './services/im/core.js';

function requireIm(ctx: AppContext): ImService {
  if (ctx.im === undefined) throw new HttpError(503, 'im service is not available');
  return ctx.im;
}

export function registerImRoutes(app: Hono, ctx: AppContext): void {
  app.get('/api/teams/:id/im/connections', conditionalGet(), (c) => {
    requireTeam(ctx, c.req.param('id'));
    return c.json({ connections: requireIm(ctx).listConnections(ctx.team.id) });
  });

  app.post('/api/teams/:id/im/telegram', async (c) => {
    requireTeam(ctx, c.req.param('id'));
    const body = parseWith(imTelegramConnectBodySchema, await jsonBody(c), 'body');
    const record = await requireIm(ctx).createConnection(ctx.team.id, 'telegram', {
      botToken: body.botToken,
    });
    return c.json({ connection: record });
  });

  app.post('/api/teams/:id/im/slack', async (c) => {
    requireTeam(ctx, c.req.param('id'));
    const body = parseWith(imSlackConnectBodySchema, await jsonBody(c), 'body');
    const record = await requireIm(ctx).createConnection(ctx.team.id, 'slack', {
      appToken: body.appToken,
      botToken: body.botToken,
    });
    return c.json({ connection: record });
  });

  app.post('/api/teams/:id/im/imessage', async (c) => {
    requireTeam(ctx, c.req.param('id'));
    const body = parseWith(imImessageConnectBodySchema, await jsonBody(c), 'body');
    const record = await requireIm(ctx).createConnection(ctx.team.id, 'imessage', {
      machineId: body.machineId,
    });
    return c.json({ connection: record });
  });

  app.post('/api/teams/:id/im/wechat/login', async (c) => {
    requireTeam(ctx, c.req.param('id'));
    return c.json(await requireIm(ctx).startWechatLogin());
  });

  app.get('/api/teams/:id/im/wechat/login/:loginId', async (c) => {
    requireTeam(ctx, c.req.param('id'));
    const result = await requireIm(ctx).pollWechatLogin(ctx.team.id, c.req.param('loginId'));
    return c.json(result);
  });

  app.delete('/api/teams/:id/im/connections/:connId', async (c) => {
    requireTeam(ctx, c.req.param('id'));
    await requireIm(ctx).deleteConnection(ctx.team.id, c.req.param('connId'));
    return c.json({ ok: true });
  });

  app.post('/api/teams/:id/im/connections/:connId/reconnect', async (c) => {
    requireTeam(ctx, c.req.param('id'));
    const record = await requireIm(ctx).reconnectConnection(ctx.team.id, c.req.param('connId'));
    return c.json({ connection: record });
  });

  app.get('/api/teams/:id/im/pairing-requests', conditionalGet(), (c) => {
    requireTeam(ctx, c.req.param('id'));
    return c.json({ requests: requireIm(ctx).listPairingRequests(ctx.team.id) });
  });

  app.post('/api/teams/:id/im/pairing-requests/:requestId/approve', async (c) => {
    requireTeam(ctx, c.req.param('id'));
    const record = await requireIm(ctx).decidePairingRequest(
      ctx.team.id,
      c.req.param('requestId'),
      'approved',
    );
    return c.json({ request: record });
  });

  app.post('/api/teams/:id/im/pairing-requests/:requestId/reject', async (c) => {
    requireTeam(ctx, c.req.param('id'));
    const record = await requireIm(ctx).decidePairingRequest(
      ctx.team.id,
      c.req.param('requestId'),
      'rejected',
    );
    return c.json({ request: record });
  });
}
