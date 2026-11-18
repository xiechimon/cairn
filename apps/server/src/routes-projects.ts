import {
  createProjectBodySchema,
  type FsListResult,
  type FsPickResult,
  importGithubIssueBodySchema,
  patchAutonomyBodySchema,
  patchProjectBodySchema,
} from '@cairn/shared';
import { eq, inArray } from 'drizzle-orm';
import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { build, project, todo } from './db/schema.js';
import { HttpError, notFound, parseWith } from './lib/errors.js';
import { nowMs } from './lib/ids.js';
import {
  githubAppOf,
  githubIssueDepsOf,
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
import { readBranches, readFiles, toProjectRecord } from './services/git.js';
import { importGithubIssue } from './services/github-issues.js';
import { listedProjects } from './services/personal-space.js';
import { createProject, updateProject } from './services/projects.js';
import { latestScheduleReport } from './services/scheduling/store.js';
import { listTodos } from './services/todos.js';

export function registerProjectRoutes(app: Hono, ctx: AppContext): void {
  const svc = svcOf(ctx);

  app.get('/api/projects', (c) => {
    const teamId = c.req.query('teamId') ?? ctx.team.id;
    const origin = requestOrigin(c);
    const rows = ctx.db.select().from(project).where(listedProjects(teamId)).all();
    return c.json(rows.map((r) => toProjectRecord(r, origin)));
  });

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
    const row = await createProject(ctx, { ...body, teamId });
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
        { db: ctx.db, reposDir: ctx.reposDir, hub: ctx.hub, user: ctx.user },
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
