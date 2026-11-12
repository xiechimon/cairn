import {
  createProjectBodySchema,
  type FsListResult,
  type FsPickResult,
  githubIssuesResponseSchema,
  importGithubIssueBodySchema,
  type NamedPromptId,
  namedPromptIdSchema,
  patchAutonomyBodySchema,
  patchProjectBodySchema,
  patchProjectMergeConfigSchema,
  putNamedPromptBodySchema,
  putShipRouteBodySchema,
} from '@cairn/shared';
import { eq, inArray } from 'drizzle-orm';
import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { build, project, todo } from './db/schema.js';
import { HttpError, notFound, parseWith } from './lib/errors.js';
import { newRecordId, nowMs } from './lib/ids.js';
import {
  githubAppOf,
  githubIssueDepsOf,
  githubIssuesQuerySchema,
  jsonBody,
  requestOrigin,
  requireProject,
  requireTeam,
  svcOf,
} from './routes-helpers.js';
import { answerProposal } from './services/action-proposals.js';
import { executeAction } from './services/action-registry.js';
import { patchAutonomy, readAutonomy } from './services/autonomy-gates.js';
import { toBuildRecord } from './services/builds.js';
import { listDir } from './services/fs-list.js';
import { pickFolder } from './services/fs-pick.js';
import {
  isGithubRepoRef,
  provisionHostedRepo,
  readBranches,
  readFiles,
  slugifyRepoName,
  toProjectRecord,
  uniqueRepoName,
  validateGithubLocalSlotPath,
  validateLocalRepoPath,
} from './services/git.js';
import { importGithubIssue, listProjectGithubIssues } from './services/github-issues.js';
import { listNamedPrompts, putNamedPrompt, resetNamedPrompt } from './services/named-prompts.js';
import {
  projectMergeConfigOf,
  projectShipRouteOf,
  updateProject,
  updateProjectMergeConfig,
  updateProjectShipRoute,
} from './services/projects.js';
import { latestScheduleReport } from './services/scheduling/store.js';
import { listTodos } from './services/todos.js';

function parseNamedPromptId(raw: string): NamedPromptId {
  const parsed = namedPromptIdSchema.safeParse(raw);
  if (!parsed.success) throw notFound(`prompt ${raw}`);
  return parsed.data;
}

export function registerProjectRoutes(app: Hono, ctx: AppContext): void {
  const svc = svcOf(ctx);

  app.get('/api/projects', (c) => {
    const teamId = c.req.query('teamId') ?? ctx.team.id;
    const origin = requestOrigin(c);
    const rows = ctx.db.select().from(project).where(eq(project.teamId, teamId)).all();
    return c.json(rows.map((r) => toProjectRecord(r, origin)));
  });

  app.get('/api/projects/:id/merge-policy', (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    return c.json(projectMergeConfigOf(row));
  });

  app.patch('/api/projects/:id/merge-policy', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    const body = parseWith(patchProjectMergeConfigSchema, await jsonBody(c), 'body');
    return c.json(updateProjectMergeConfig(ctx.db, row, body));
  });

  app.get('/api/projects/:id/ship-route', (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    return c.json({ shipRoute: projectShipRouteOf(row) });
  });

  app.put('/api/projects/:id/ship-route', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    const body = parseWith(putShipRouteBodySchema, await jsonBody(c), 'body');
    return c.json({ shipRoute: updateProjectShipRoute(ctx.db, row, body.shipRoute) });
  });

  app.get('/api/prompts', (c) => c.json(listNamedPrompts(ctx.db, ctx.team.id)));

  app.put('/api/prompts/:id', async (c) => {
    const id = parseNamedPromptId(c.req.param('id'));
    const body = parseWith(putNamedPromptBodySchema, await jsonBody(c), 'body');
    return c.json(putNamedPrompt(ctx.db, ctx.team.id, id, body.text));
  });

  app.delete('/api/prompts/:id', (c) =>
    c.json(resetNamedPrompt(ctx.db, ctx.team.id, parseNamedPromptId(c.req.param('id')))),
  );

  app.get('/api/projects/:id/todos', (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    return c.json(listTodos(svc, { projectId: row.id }));
  });

  app.get('/api/projects/:id/builds', (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    const todoIds = ctx.db
      .select({ id: todo.id })
      .from(todo)
      .where(eq(todo.projectId, row.id))
      .all()
      .map((r) => r.id);
    if (todoIds.length === 0) return c.json([]);
    const builds = ctx.db.select().from(build).where(inArray(build.todoId, todoIds)).all();
    return c.json(builds.map(toBuildRecord));
  });

  app.get('/api/projects/:id/github/issues', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    const query = parseWith(
      githubIssuesQuerySchema,
      {
        state: c.req.query('state') ?? 'open',
        page: c.req.query('page') ?? '1',
      },
      'query',
    );
    const face = await listProjectGithubIssues(githubIssueDepsOf(ctx), row, {
      state: query.state,
      page: query.page,
    });
    return c.json(githubIssuesResponseSchema.parse(face));
  });

  app.post('/api/projects/:id/github/issues/import', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    const body = parseWith(importGithubIssueBodySchema, await jsonBody(c), 'body');
    const record = await importGithubIssue({ ...svc, ...githubIssueDepsOf(ctx) }, row, body.number);
    return c.json(record, 201);
  });

  app.get('/api/projects/:id/files', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    return c.json(await readFiles(ctx, row.id, c.req.query('ref'), c.req.query('limit')));
  });

  app.get('/api/projects/:id/branches', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    return c.json(await readBranches({ ...ctx, box: ctx.secretBox }, row.id));
  });

  app.post('/api/projects', async (c) => {
    const body = parseWith(createProjectBodySchema, await jsonBody(c), 'body');
    const teamId = body.teamId ?? ctx.team.id;
    requireTeam(ctx, teamId);
    const kind = body.kind ?? body.repoKind;
    let githubRepo: string | null = null;
    if (kind === 'github') {
      const ref =
        typeof body.githubRepo === 'string'
          ? body.githubRepo
          : body.githubRepo
            ? `${body.githubRepo.owner}/${body.githubRepo.repo}`
            : undefined;
      if (ref === undefined || !isGithubRepoRef(ref)) {
        throw new HttpError(400, 'invalid body at githubRepo: expected "owner/repo"');
      }
      githubRepo = ref;
    } else if (kind === 'local' && body.githubRepo !== undefined) {
      throw new HttpError(400, 'invalid body at githubRepo: not allowed for kind "local"');
    }
    const localPath =
      kind === 'local'
        ? await validateLocalRepoPath(body.localPath)
        : kind === 'github'
          ? validateGithubLocalSlotPath(body.localPath)
          : null;
    const id = newRecordId();
    let repoName: string | null = null;
    if (kind === 'hosted') {
      repoName = await uniqueRepoName(ctx, teamId, slugifyRepoName(body.name));
      await provisionHostedRepo(ctx, teamId, repoName);
    }
    ctx.db
      .insert(project)
      .values({
        id,
        name: body.name,
        teamId,
        repoKind: kind ?? null,
        repoName,
        githubRepo,
        localPath,
      })
      .run();
    const row = requireProject(ctx, id);
    return c.json(toProjectRecord(row, requestOrigin(c)), 201);
  });

  app.patch('/api/projects/:id', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    const body = parseWith(patchProjectBodySchema, await jsonBody(c), 'body');
    const updated = await updateProject(
      {
        ...githubAppOf(ctx),
        db: ctx.db,
        box: ctx.secretBox,
        oauthClient: ctx.oauthClient,
        ...(ctx.githubFetch !== undefined ? { githubFetch: ctx.githubFetch } : {}),
        ...(ctx.convHub !== undefined ? { convHub: ctx.convHub } : {}),
        ...(ctx.logger !== undefined ? { logger: ctx.logger } : {}),
      },
      row.id,
      body,
    );
    if (updated === null) throw notFound(`project ${row.id}`);
    return c.json(toProjectRecord(updated, requestOrigin(c)));
  });

  app.post('/api/fs/pick', async (c) => {
    const path = await pickFolder();
    return c.json({ path } satisfies FsPickResult);
  });

  app.get('/api/fs/list', (c) => {
    const result = listDir(c.req.query('dir'));
    return c.json(result satisfies FsListResult);
  });

  app.get('/api/projects/:id/autonomy', (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    return c.json(readAutonomy(ctx.db, row.id, nowMs()));
  });

  app.patch('/api/projects/:id/autonomy', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    const body = parseWith(patchAutonomyBodySchema, await jsonBody(c), 'body');
    return c.json(patchAutonomy(ctx.db, row.id, body, nowMs()));
  });

  app.get('/api/projects/:id/schedule', (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    return c.json({ report: latestScheduleReport(ctx.db, row.id) });
  });

  for (const [action, id] of [
    ['archive', 'project.archive'],
    ['unarchive', 'project.unarchive'],
  ] as const) {
    app.post(`/api/projects/:id/${action}`, (c) => {
      const row = requireProject(ctx, c.req.param('id'));
      if (row.teamId !== ctx.team.id) throw notFound(`project ${row.id}`);
      executeAction(
        { db: ctx.db, reposDir: ctx.reposDir },
        {
          id,
          input: { projectId: row.id },
          actor: 'user',
          surface: 'web',
          teamId: ctx.team.id,
        },
      );
      const updated = ctx.db.select().from(project).where(eq(project.id, row.id)).get();
      if (updated === undefined) throw notFound(`project ${row.id}`);
      return c.json(toProjectRecord(updated, requestOrigin(c)));
    });
  }

  app.delete('/api/projects/:id', (c) => {
    const id = c.req.param('id');
    const row = requireProject(ctx, id);
    if (row.teamId !== ctx.team.id) throw notFound(`project ${id}`);
    executeAction(
      { db: ctx.db, reposDir: ctx.reposDir },
      {
        id: 'project.delete',
        input: { projectId: id },
        actor: 'user',
        surface: 'web',
        teamId: ctx.team.id,
      },
    );
    return c.body(null, 204);
  });

  app.post('/api/actions/proposals/:id/answer', async (c) => {
    const body = await jsonBody(c);
    if (body !== null && typeof body === 'object' && 'input' in body) {
      throw new HttpError(400, 'answer must not include input');
    }
    const decision = (body as { decision?: unknown } | null)?.decision;
    if (decision !== 'refuse' && decision !== 'allow-once' && decision !== 'always') {
      throw new HttpError(400, 'invalid decision');
    }
    return c.json(
      answerProposal(
        { db: ctx.db, reposDir: ctx.reposDir },
        {
          proposalId: c.req.param('id'),
          teamId: ctx.team.id,
          decision,
          decidedBy: ctx.user.id,
        },
      ),
    );
  });
}
