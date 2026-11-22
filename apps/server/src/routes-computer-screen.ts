import { computerControlLeaseSchema, openComputerScreenSchema } from '@cairn/shared';
import type { Context, Hono } from 'hono';
import type { AppContext } from './context.js';
import { HttpError, parseWith } from './lib/errors.js';
import { pairedDeviceIdOf } from './lib/token-auth.js';
import { jsonBody } from './routes-helpers.js';
import { computerScreensOf } from './services/computer-screen.js';

export function registerComputerScreenRoutes(app: Hono, ctx: AppContext): void {
  app.use('/api/teams/:teamId/computers/:computerId/*', async (c, next) => {
    if (!['POST', 'PATCH', 'DELETE'].includes(c.req.method)) return next();
    if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('content-type') ?? '')) {
      throw new HttpError(415, 'computer control requires an application/json request');
    }
    return next();
  });
  const checkedTeam = (c: Context): string => {
    if (c.req.param('teamId') !== ctx.team.id) throw new HttpError(404, 'team not found');
    c.header('cache-control', 'no-store');
    c.header('referrer-policy', 'no-referrer');
    return ctx.team.id;
  };
  app.post('/api/teams/:teamId/computers/:computerId/screen', async (c) => {
    const teamId = checkedTeam(c);
    const body = parseWith(openComputerScreenSchema, await jsonBody(c), 'screen request');
    return c.json(
      computerScreensOf(ctx).open(
        teamId,
        ctx.user.id,
        c.req.param('computerId'),
        body,
        pairedDeviceIdOf(c),
      ),
      201,
    );
  });
  app.post('/api/teams/:teamId/computers/:computerId/control', (c) => {
    const teamId = checkedTeam(c);
    return c.json(
      computerScreensOf(ctx).acquireControl(teamId, ctx.user.id, c.req.param('computerId')),
      201,
    );
  });
  app.patch('/api/teams/:teamId/computers/:computerId/control', async (c) => {
    const teamId = checkedTeam(c);
    const { leaseId } = parseWith(
      computerControlLeaseSchema.pick({ leaseId: true }).strict(),
      await jsonBody(c),
      'control lease',
    );
    return c.json(
      computerScreensOf(ctx).renewControl(teamId, ctx.user.id, c.req.param('computerId'), leaseId),
    );
  });
  app.delete('/api/teams/:teamId/computers/:computerId/control', async (c) => {
    const teamId = checkedTeam(c);
    const { leaseId } = parseWith(
      computerControlLeaseSchema.pick({ leaseId: true }).strict(),
      await jsonBody(c),
      'control lease',
    );
    computerScreensOf(ctx).releaseControl(teamId, ctx.user.id, c.req.param('computerId'), leaseId);
    return c.json({ released: true });
  });
}
