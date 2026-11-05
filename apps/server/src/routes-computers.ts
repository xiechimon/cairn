import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { notFound } from './lib/errors.js';
import { ownedPrivateComputer } from './services/computer-access.js';
import {
  clampCommandsLimit,
  listComputers,
  recentComputerCommands,
} from './services/computer-feed.js';

export function registerComputerRoutes(app: Hono, ctx: AppContext): void {
  app.get('/api/computers', (c) =>
    c.json({ computers: listComputers(ctx.db, ctx.team.id, ctx.user.id) }),
  );

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
