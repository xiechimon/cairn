import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { AGENTS_REMOVED_MESSAGE } from './lib/agents-removed.js';
import { HttpError, notFound } from './lib/errors.js';
import { requireTeam, toMemoryRecord } from './routes-helpers.js';
import { deleteMemoryEntry, listMemoryEntries, promoteMemoryEntry } from './services/memory.js';

export function registerAgentRoutes(app: Hono, ctx: AppContext): void {
  app.get('/api/teams/:id/memories', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const rows = listMemoryEntries(
      ctx.db,
      { agentId: teamId, teamId },
      c.req.query('includeInvalid') === 'true',
    );
    return c.json(rows.map(toMemoryRecord));
  });

  app.post('/api/teams/:id/memories/:mid/promote', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const row = promoteMemoryEntry(ctx.db, {
      memoryId: c.req.param('mid'),
      agentId: teamId,
      teamId,
    });
    if (row === null) throw notFound(`memory ${c.req.param('mid')}`);
    return c.json(toMemoryRecord(row));
  });

  app.delete('/api/teams/:id/memories/:mid', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const removed = deleteMemoryEntry(ctx.db, {
      memoryId: c.req.param('mid'),
      agentId: teamId,
      teamId,
    });
    if (removed === 0) throw notFound(`memory ${c.req.param('mid')}`);
    return c.body(null, 204);
  });

  app.all('/api/teams/:id/agents', (c) => {
    requireTeam(ctx, c.req.param('id'));
    throw new HttpError(410, AGENTS_REMOVED_MESSAGE);
  });

  app.all('/api/teams/:id/agents/*', (c) => {
    requireTeam(ctx, c.req.param('id'));
    throw new HttpError(410, AGENTS_REMOVED_MESSAGE);
  });
}
