import { computerControlLeaseSchema, openComputerScreenSchema } from '@cairn/shared';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppContext } from './context.js';
import { HttpError, parseWith } from './lib/errors.js';
import { computerScreensOf } from './services/computer-screen.js';

export function registerComputerScreenRoutes(app: Hono, ctx: AppContext): void {
  const boundedBody = bodyLimit({
    maxSize: 4096,
    onError: (c) => c.json({ error: 'computer control body too large' }, 413),
  });
  app.use('/api/teams/:teamId/computers/:computerId/*', async (c, next) => {
    if (!['POST', 'PATCH', 'DELETE'].includes(c.req.method)) return next();
    if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('content-type') ?? '')) {
      throw new HttpError(415, 'computer control requires an application/json request');
    }
    return boundedBody(c, next);
  });
  const checkedTeam = (c: Context): string => {
    if (c.req.param('teamId') !== ctx.team.id) throw new HttpError(404, 'team not found');
    c.header('cache-control', 'no-store');
    c.header('referrer-policy', 'no-referrer');
    return ctx.team.id;
  };
  app.post('/api/teams/:teamId/computers/:computerId/screen', async (c) => {
    const teamId = checkedTeam(c);
    const body = parseWith(
      openComputerScreenSchema,
      await c.req.json().catch(() => null),
      'screen request',
    );
    return c.json(
      computerScreensOf(ctx).open(teamId, ctx.user.id, c.req.param('computerId'), body),
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
      await c.req.json().catch(() => null),
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
      await c.req.json().catch(() => null),
      'control lease',
    );
    computerScreensOf(ctx).releaseControl(teamId, ctx.user.id, c.req.param('computerId'), leaseId);
    return c.json({ released: true });
  });
}
