import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { notFound } from './lib/errors.js';
import {
  clampCommandsLimit,
  computerInTeam,
  listComputers,
  recentComputerCommands,
} from './services/computer-feed.js';

export function registerComputerRoutes(app: Hono, ctx: AppContext): void {
  app.get('/api/computers', (c) => c.json({ computers: listComputers(ctx.db, ctx.team.id) }));

  app.get('/api/computers/:id/commands', (c) => {
    const id = c.req.param('id');
    if (!computerInTeam(ctx.db, ctx.team.id, id)) throw notFound(`computer ${id}`);
    const limit = clampCommandsLimit(c.req.query('limit'));
    return c.json({ commands: recentComputerCommands(ctx.db, ctx.team.id, id, limit) });
  });
}
