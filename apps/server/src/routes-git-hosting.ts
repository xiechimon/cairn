import { join } from 'node:path';
import { conversationBranch } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { project } from './db/schema.js';
import { forbidden, notFound } from './lib/errors.js';
import { systemGitOps } from './lib/git.js';
import { parseReceivePackCommands, stepPushRefAllowed } from './lib/receive-pack-commands.js';
import { GIT_AUTH_REALM, verifyGitBasicAuth } from './routes-helpers.js';
import { isPersonalSpace } from './services/personal-space.js';

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
    const unauthorized = () => {
      c.header('WWW-Authenticate', `Basic realm="${GIT_AUTH_REALM}"`);
      return c.json({ error: 'git authentication required' }, 401);
    };
    const resolveAccess = () => {
      const auth = authorization === undefined ? null : verifyGitBasicAuth(ctx, authorization);
      if (auth === null) return null;
      const { stepScope } = auth;
      if (stepScope !== null && stepScope.projectId !== row.id)
        throw notFound(`repo ${teamId}/${repoName}`);
      if (isPersonalSpace(row) && stepScope === null) throw notFound(`repo ${teamId}/${repoName}`);
      return { remoteUser: auth.keyId, stepScope };
    };
    const access = resolveAccess();
    if (access === null) return unauthorized();

    const body = method === 'POST' ? new Uint8Array(await c.req.arrayBuffer()) : new Uint8Array(0);
    const live = method === 'POST' ? resolveAccess() : access;
    if (live === null || live.remoteUser !== access.remoteUser) return unauthorized();
    const { remoteUser, stepScope } = live;
    if (stepScope !== null && !isPersonalSpace(row) && rest === 'git-receive-pack') {
      const commands =
        c.req.header('content-encoding') === undefined ? parseReceivePackCommands(body) : null;
      const workBranch = conversationBranch(stepScope.buildId);
      if (commands === null || !commands.every((cmd) => stepPushRefAllowed(cmd, workBranch))) {
        throw forbidden(`a step may only push ${workBranch}`);
      }
    }
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
