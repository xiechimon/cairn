import { engineTakeoverLeaseSchema, openEngineScreenSchema } from '@cairn/shared';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppContext } from './context.js';
import { HttpError, parseWith } from './lib/errors.js';
import { pairedDeviceIdOf } from './lib/token-auth.js';
import { jsonBody } from './routes-helpers.js';
import { engineScreensOf } from './services/engine-screen.js';
import { isOwner } from './services/instance-owner.js';

export function registerEngineScreenRoutes(app: Hono, ctx: AppContext): void {
  const boundedBody = bodyLimit({
    maxSize: 4096,
    onError: (c) => c.json({ error: 'engine run body too large' }, 413),
  });
  app.use('/api/teams/:teamId/engine-runs/:stepId/*', async (c, next) => {
    if (!['POST', 'PATCH', 'DELETE'].includes(c.req.method)) return next();
    if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('content-type') ?? '')) {
      throw new HttpError(415, 'engine run control requires an application/json request');
    }
    return boundedBody(c, next);
  });
  const checkedTeam = (c: Context): string => {
    if (c.req.param('teamId') !== ctx.team.id) throw new HttpError(404, 'team not found');
    c.header('cache-control', 'no-store');
    c.header('referrer-policy', 'no-referrer');
    return ctx.team.id;
  };
  const requireOwnerSession = (c: Context): void => {
    const ownerSession =
      pairedDeviceIdOf(c) === null &&
      (ctx.authToken === null || c.get('ownerIdentity') !== undefined) &&
      isOwner(ctx.db, ctx.user.id);
    if (!ownerSession) {
      throw new HttpError(403, 'only the instance owner can take over an engine run');
    }
  };
  app.post('/api/teams/:teamId/engine-runs/:stepId/takeover', (c) => {
    const teamId = checkedTeam(c);
    requireOwnerSession(c);
    return c.json(
      engineScreensOf(ctx).acquireTakeover(teamId, ctx.user.id, c.req.param('stepId')),
      201,
    );
  });
  app.patch('/api/teams/:teamId/engine-runs/:stepId/takeover', async (c) => {
    const teamId = checkedTeam(c);
    requireOwnerSession(c);
    const { leaseId } = parseWith(
      engineTakeoverLeaseSchema.pick({ leaseId: true }).strict(),
      await jsonBody(c),
      'takeover lease',
    );
    return c.json(
      engineScreensOf(ctx).renewTakeover(teamId, ctx.user.id, c.req.param('stepId'), leaseId),
    );
  });
  app.delete('/api/teams/:teamId/engine-runs/:stepId/takeover', async (c) => {
    const teamId = checkedTeam(c);
    requireOwnerSession(c);
    const { leaseId } = parseWith(
      engineTakeoverLeaseSchema.pick({ leaseId: true }).strict(),
      await jsonBody(c),
      'takeover lease',
    );
    engineScreensOf(ctx).releaseTakeover(teamId, ctx.user.id, c.req.param('stepId'), leaseId);
    return c.json({ released: true });
  });
  app.post('/api/teams/:teamId/engine-runs/:stepId/screen', async (c) => {
    const teamId = checkedTeam(c);
    requireOwnerSession(c);
    const body = parseWith(openEngineScreenSchema, await jsonBody(c), 'screen request');
    return c.json(
      engineScreensOf(ctx).open(
        teamId,
        ctx.user.id,
        c.req.param('stepId'),
        body,
        pairedDeviceIdOf(c),
      ),
      201,
    );
  });
  app.get('/api/teams/:teamId/engine-runs/:stepId/pty-log', (c) => {
    const teamId = checkedTeam(c);
    requireOwnerSession(c);
    const log = engineScreensOf(ctx).ptyLog(teamId, ctx.user.id, c.req.param('stepId'));
    c.header('content-type', 'application/octet-stream');
    return c.body(new Uint8Array(log));
  });
}
