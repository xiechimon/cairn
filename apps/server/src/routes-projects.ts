import {
  createProjectBodySchema,
  createTagBodySchema,
  type FsListResult,
  type FsPickResult,
  githubIssuesResponseSchema,
  importGithubIssueBodySchema,
  patchAutonomyBodySchema,
  patchProjectBodySchema,
} from '@cairn/shared';
import { eq, inArray } from 'drizzle-orm';
import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { build, project, tag, todo } from './db/schema.js';
import { HttpError, notFound, parseWith } from './lib/errors.js';
import { newRecordId, nowMs } from './lib/ids.js';
import {
  githubIssueDepsOf,
  githubIssuesQuerySchema,
  jsonBody,
  requestOrigin,
  requireProject,
  requireTeam,
  svcOf,
  toTagRecord,
} from './routes-helpers.js';
import { patchAutonomy, readAutonomy } from './services/autonomy-gates.js';
import { toBuildRecord } from './services/builds.js';
import { listDir } from './services/fs-list.js';
import { pickFolder } from './services/fs-pick.js';
import {
  isGithubRepoRef,
  provisionHostedRepo,
  readBranches,
  readCommitDetail,
  readCommitHistory,
  readFile,
  readFiles,
  readTree,
  slugifyRepoName,
  toProjectRecord,
  uniqueRepoName,
  validateGithubLocalSlotPath,
  validateLocalRepoPath,
} from './services/git.js';
import { importGithubIssue, listProjectGithubIssues } from './services/github-issues.js';
import { deleteProject, updateProject } from './services/projects.js';
import { seedFixedTags } from './services/tags.js';
import { listTodos } from './services/todos.js';

export function registerProjectRoutes(app: Hono, ctx: AppContext): void {
  const svc = svcOf(ctx);

  app.get('/api/projects', (c) => {
    const teamId = c.req.query('teamId') ?? ctx.team.id;
    const origin = requestOrigin(c);
    const rows = ctx.db.select().from(project).where(eq(project.teamId, teamId)).all();
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

  app.get('/api/projects/:id/tags', (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    const tags = ctx.db.select().from(tag).where(eq(tag.projectId, row.id)).all();
    return c.json(tags.map(toTagRecord));
  });

  app.post('/api/projects/:id/tags', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    const body = parseWith(createTagBodySchema, await jsonBody(c), 'body');
    const id = newRecordId();
    ctx.db
      .insert(tag)
      .values({
        id,
        projectId: row.id,
        name: body.name,
        color: body.color,
        createdAt: nowMs(),
        v: 1,
      })
      .run();
    const created = ctx.db.select().from(tag).where(eq(tag.id, id)).get();
    if (!created) throw new Error(`tag ${id} missing after insert`);
    return c.json(toTagRecord(created), 201);
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

  app.get('/api/projects/:id/tree', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    return c.json(await readTree(ctx, row.id, c.req.query('ref'), c.req.query('path')));
  });

  app.get('/api/projects/:id/file', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    const path = c.req.query('path');
    if (path === undefined || path === '') {
      throw new HttpError(400, 'invalid query path: required');
    }
    return c.json(await readFile(ctx, row.id, path, c.req.query('ref')));
  });

  app.get('/api/projects/:id/files', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    return c.json(await readFiles(ctx, row.id, c.req.query('ref'), c.req.query('limit')));
  });

  app.get('/api/projects/:id/branches', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    return c.json(await readBranches(ctx, row.id));
  });

  app.get('/api/projects/:id/commits', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    return c.json(await readCommitHistory(ctx, row.id, c.req.query('ref')));
  });

  app.get('/api/projects/:id/commits/:sha', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    return c.json(await readCommitDetail(ctx, row.id, c.req.param('sha')));
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
    if (kind !== 'github') seedFixedTags(ctx.db, id);
    const row = requireProject(ctx, id);
    return c.json(toProjectRecord(row, requestOrigin(c)), 201);
  });

  app.patch('/api/projects/:id', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    const body = parseWith(patchProjectBodySchema, await jsonBody(c), 'body');
    const updated = await updateProject(
      {
        db: ctx.db,
        box: ctx.secretBox,
        ...(ctx.githubFetch !== undefined ? { githubFetch: ctx.githubFetch } : {}),
        ...(ctx.convHub !== undefined ? { convHub: ctx.convHub } : {}),
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

  app.delete('/api/projects/:id', (c) => {
    const id = c.req.param('id');
    if (!deleteProject({ db: ctx.db, reposDir: ctx.reposDir }, id)) {
      throw notFound(`project ${id}`);
    }
    return c.body(null, 204);
  });
}
