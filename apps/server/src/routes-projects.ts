import {
  createProjectBodySchema,
  type FsListResult,
  type FsPickResult,
  importGithubIssueBodySchema,
  patchProjectBodySchema,
} from '@cairn/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import type { AppContext } from './context.js';
import { actionJournal, actionProposal, build, project, todo } from './db/schema.js';
import { HttpError, notFound, parseWith } from './lib/errors.js';
import { pairedDeviceIdOf, sameOriginPageWrite } from './lib/token-auth.js';
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
import { executeAction, undoJournalEntry } from './services/action-registry.js';
import { toBuildRecord } from './services/builds.js';
import { releaseParkedCoordinatorSteps } from './services/chief.js';
import { listDir } from './services/fs-list.js';
import { pickFolder } from './services/fs-pick.js';
import { readBranches, readFiles, toProjectRecord } from './services/git.js';
import { importGithubIssue } from './services/github-issues.js';
import { isOwner } from './services/instance-owner.js';
import { listedProjects } from './services/personal-space.js';
import { createProject, updateProject } from './services/projects.js';
import { coordinatorProfile } from './services/routing-rules.js';
import { listTodos } from './services/todos.js';

export function registerProjectRoutes(app: Hono, ctx: AppContext): void {
  const svc = svcOf(ctx);

  const isOwnerSession = (c: Context): boolean =>
    (ctx.authToken === null || c.get('ownerIdentity') !== undefined) &&
    isOwner(ctx.db, ctx.user.id);

  const requireOwnerSession = (c: Context): void => {
    if (!isOwnerSession(c)) throw new HttpError(403, 'owner session required');
  };

  const journalListLimit = (raw: string | undefined): number => {
    const parsed = raw === undefined ? Number.NaN : Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return 100;
    return Math.min(parsed, 500);
  };

  app.get('/api/projects', (c) => {
    const teamId = c.req.query('teamId') ?? ctx.team.id;
    requireTeam(ctx, teamId);
    const origin = requestOrigin(c);
    const includeLocalPath = isOwnerSession(c);
    const rows = ctx.db.select().from(project).where(listedProjects(teamId)).all();
    return c.json(rows.map((r) => toProjectRecord(r, origin, { includeLocalPath })));
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
    return c.json(
      await readFiles(
        {
          ...ctx,
          box: ctx.secretBox,
          githubApp: ctx.mcpGithubApp,
          discloseLocalPath: isOwnerSession(c),
        },
        row.id,
        c.req.query('ref'),
        c.req.query('limit'),
      ),
    );
  });

  app.get('/api/projects/:id/branches', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    return c.json(
      await readBranches(
        {
          ...ctx,
          box: ctx.secretBox,
          githubApp: ctx.mcpGithubApp,
          discloseLocalPath: isOwnerSession(c),
        },
        row.id,
      ),
    );
  });

  app.post('/api/projects', async (c) => {
    const body = parseWith(createProjectBodySchema, await jsonBody(c), 'body');
    const teamId = body.teamId ?? ctx.team.id;
    requireTeam(ctx, teamId);
    const local = (body.kind ?? body.repoKind) === 'local';
    if (local) requireOwnerSession(c);
    const row = await createProject(
      {
        ...svc,
        githubBaseFetch: ctx.githubBaseFetch,
        skillsDir: ctx.skillsDir,
        homeDir: ctx.homeDir,
        dataDir: ctx.dataDir,
        ...(local ? { workspacesDir: ctx.workspacesDir } : {}),
        logger: ctx.logger,
      },
      { ...body, teamId },
      pairedDeviceIdOf(c),
    );
    return c.json(
      toProjectRecord(row, requestOrigin(c), { includeLocalPath: isOwnerSession(c) }),
      201,
    );
  });

  app.patch('/api/projects/:id', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    const body = parseWith(patchProjectBodySchema, await jsonBody(c), 'body');
    const beforeOverride = row.modelOverrides?.coordinator ?? null;
    const beforeCoordinator =
      body.modelOverrides?.coordinator !== undefined
        ? coordinatorProfile(ctx.db, row.teamId, row.id)
        : null;
    const updated = await updateProject(
      {
        ...githubAppOf(ctx),
        db: ctx.db,
        box: ctx.secretBox,
        oauthClient: ctx.oauthClient,
        ...(ctx.githubFetch !== undefined ? { githubFetch: ctx.githubFetch } : {}),
        ...(ctx.githubBaseFetch !== undefined ? { githubBaseFetch: ctx.githubBaseFetch } : {}),
        ...(ctx.convHub !== undefined ? { convHub: ctx.convHub } : {}),
        ...(ctx.logger !== undefined ? { logger: ctx.logger } : {}),
      },
      row.id,
      body,
      pairedDeviceIdOf(c),
    );
    if (updated === null) throw notFound(`project ${row.id}`);
    if (body.modelOverrides?.coordinator !== undefined) {
      const afterOverride = updated.modelOverrides?.coordinator ?? null;
      const afterCoordinator = coordinatorProfile(ctx.db, updated.teamId, updated.id);
      const modelChanged =
        beforeCoordinator !== null || afterCoordinator !== null
          ? beforeCoordinator?.provider !== afterCoordinator?.provider ||
            beforeCoordinator?.modelId !== afterCoordinator?.modelId
          : beforeOverride?.provider !== afterOverride?.provider ||
            beforeOverride?.modelId !== afterOverride?.modelId;
      if (modelChanged) {
        releaseParkedCoordinatorSteps(
          {
            db: ctx.db,
            hub: ctx.hub,
            convHub: ctx.convHub,
            machineHub: ctx.machineHub,
          },
          updated.teamId,
          updated.id,
        );
      }
    }
    return c.json(
      toProjectRecord(updated, requestOrigin(c), {
        includeLocalPath: isOwnerSession(c),
      }),
    );
  });

  app.post('/api/fs/pick', async (c) => {
    requireOwnerSession(c);
    const path = await pickFolder();
    return c.json({ path } satisfies FsPickResult);
  });

  app.get('/api/fs/list', (c) => {
    requireOwnerSession(c);
    const result = listDir(c.req.query('dir'));
    return c.json(result satisfies FsListResult);
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
      return c.json(
        toProjectRecord(updated, requestOrigin(c), {
          includeLocalPath: isOwnerSession(c),
        }),
      );
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
    const deviceId = pairedDeviceIdOf(c);
    return c.json(
      answerProposal(
        { db: ctx.db, reposDir: ctx.reposDir, hub: ctx.hub, user: ctx.user },
        {
          proposalId: c.req.param('id'),
          teamId: ctx.team.id,
          decision,
          decidedBy: deviceId === null ? ctx.user.id : `device:${deviceId}`,
          interactive: sameOriginPageWrite(c, ctx.webOrigin, ctx.trustedProxies)
            ? 'page'
            : undefined,
        },
      ),
    );
  });

  app.get('/api/actions/journal', (c) => {
    requireOwnerSession(c);
    const rows = ctx.db
      .select()
      .from(actionJournal)
      .where(eq(actionJournal.teamId, ctx.team.id))
      .orderBy(desc(actionJournal.createdAt), desc(sql`rowid`))
      .limit(journalListLimit(c.req.query('limit')))
      .all();
    return c.json(rows);
  });

  app.get('/api/actions/proposals', (c) => {
    requireOwnerSession(c);
    const rows = ctx.db
      .select()
      .from(actionProposal)
      .where(and(eq(actionProposal.teamId, ctx.team.id), eq(actionProposal.status, 'pending')))
      .orderBy(desc(actionProposal.createdAt))
      .all();
    return c.json(rows);
  });

  app.post('/api/actions/journal/:id/undo', (c) => {
    requireOwnerSession(c);
    return c.json(
      undoJournalEntry(
        { db: ctx.db },
        {
          journalId: c.req.param('id'),
          teamId: ctx.team.id,
          actor: 'user',
          surface: 'web',
        },
      ),
    );
  });
}
