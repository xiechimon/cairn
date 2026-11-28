import { runListQuerySchema } from '@cairn/shared';
import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { attachmentDownloadDisposition } from './lib/attachment-disposition.js';
import { parseWith } from './lib/errors.js';
import { requireTeam } from './routes-helpers.js';
import { listRuns, readRunTrace } from './services/run-trace.js';

const NO_STORE = { 'cache-control': 'no-store' };

export function registerRunRoutes(app: Hono, ctx: AppContext): void {
  app.get('/api/teams/:id/runs/:runId', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const download = c.req.query('download') === '1';
    const trace = readRunTrace(ctx.db, teamId, c.req.param('runId'), download);
    if (!download) return c.json(trace, 200, NO_STORE);
    return new Response(`${JSON.stringify(trace, null, 2)}\n`, {
      headers: {
        ...NO_STORE,
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': attachmentDownloadDisposition(`cairn-run-${trace.id}.json`),
      },
    });
  });

  app.get('/api/teams/:id/runs', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const query = parseWith(runListQuerySchema, c.req.query(), 'runs query');
    return c.json(
      listRuns(ctx.db, teamId, {
        thread: query.thread,
        limit: query.limit,
        before: query.before,
        problems: query.problems === '1',
      }),
      200,
      NO_STORE,
    );
  });
}
