import { computerEnsureBodySchema, computerPatchBodySchema } from '@cairn/shared';
import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { conflict, HttpError, notFound, parseWith } from './lib/errors.js';
import { ownedPrivateComputer } from './services/computer-access.js';
import {
  clampCommandsLimit,
  ensureComputerBrowserEnabled,
  listComputers,
  recentComputerCommands,
  setComputerBrowserEnabled,
} from './services/computer-feed.js';

export function registerComputerRoutes(app: Hono, ctx: AppContext): void {
  app.get('/api/computers', (c) =>
    c.json({ computers: listComputers(ctx.db, ctx.team.id, ctx.user.id) }),
  );

  app.post('/api/computers', async (c) => {
    if (!c.get('ownerIdentity')) throw new HttpError(403, 'owner session required');
    const body = parseWith(computerEnsureBodySchema, await c.req.json(), 'body');
    const result = ensureComputerBrowserEnabled(
      ctx.db,
      ctx.team.id,
      ctx.user.id,
      body.machineId,
      body.browserEnabled,
    );
    if (!result.ok) {
      if (result.reason === 'machine_mismatch') {
        throw conflict('browser preference belongs to another machine for this Coordinator');
      }
      throw notFound(`machine ${body.machineId}`);
    }
    return c.json({ computer: result.computer });
  });

  app.patch('/api/computers/:id', async (c) => {
    if (!c.get('ownerIdentity')) throw new HttpError(403, 'owner session required');
    const id = c.req.param('id');
    const body = parseWith(computerPatchBodySchema, await c.req.json(), 'body');
    const computer = setComputerBrowserEnabled(
      ctx.db,
      ctx.team.id,
      ctx.user.id,
      id,
      body.browserEnabled,
    );
    if (!computer) throw notFound(`computer ${id}`);
    return c.json({ computer });
  });

  app.get('/api/computers/:id/commands', (c) => {
    const id = c.req.param('id');
    if (!ownedPrivateComputer(ctx.db, ctx.team.id, ctx.user.id, id))
      throw notFound(`computer ${id}`);
    const limit = clampCommandsLimit(c.req.query('limit'));
    return c.json({
      commands: recentComputerCommands(ctx.db, ctx.team.id, ctx.user.id, id, limit),
    });
  });
}
