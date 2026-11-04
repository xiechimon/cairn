import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { project } from './db/schema.js';
import { notFound } from './lib/errors.js';
import { systemGitOps } from './lib/git.js';
import { GIT_AUTH_REALM, verifyGitBasicAuth } from './routes-helpers.js';

export function registerGitHostingRoutes(app: Hono, ctx: AppContext): void {
  app.all('/git/*', async (c) => {
    const url = new URL(c.req.url);
    const segments = url.pathname.slice('/git/'.length).split('/');
    const teamId = segments[0] ?? '';
    const repoName = segments[1] ?? '';
    const rest = segments.slice(2).join('/');
    if (teamId !== ctx.team.id || repoName === '' || rest === '') {
      throw notFound('git endpoint');
    }
    const row = ctx.db
      .select()
      .from(project)
      .where(
        and(
          eq(project.teamId, teamId),
          eq(project.repoKind, 'hosted'),
          eq(project.repoName, repoName),
        ),
      )
      .get();
    if (!row?.repoName) throw notFound(`repo ${teamId}/${repoName}`);

    const method = c.req.method;
    if (method !== 'GET' && method !== 'POST') return c.body(null, 405);

    const authorization = c.req.header('authorization');
    const remoteUser =
      authorization === undefined ? undefined : verifyGitBasicAuth(ctx, authorization);
    if (remoteUser === undefined) {
      c.header('WWW-Authenticate', `Basic realm="${GIT_AUTH_REALM}"`);
      return c.json({ error: 'git authentication required' }, 401);
    }

    const body = method === 'POST' ? new Uint8Array(await c.req.arrayBuffer()) : new Uint8Array(0);
    const contentType = c.req.header('content-type');
    const cgi = await systemGitOps.httpBackend({
      projectRoot: join(ctx.reposDir, teamId),
      pathInfo: `/${row.repoName}.git/${rest}`,
      queryString: url.search.replace(/^\?/, ''),
      method,
      ...(contentType !== undefined ? { contentType } : {}),
      remoteUser,
      body,
    });
    return c.body(new Uint8Array(cgi.body), cgi.status as 200, Object.fromEntries(cgi.headers));
  });
}
