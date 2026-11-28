import {
  createTodoBodySchema,
  githubIssueEchoSchema,
  IN_PROGRESS_PHASES,
  isStartedTodo,
  needsYouQuerySchema,
  runTodoOnBodySchema,
  type TodoRecord,
  tasksQuerySchema,
  threadMessageBodySchema,
} from '@cairn/shared';
import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { AGENTS_REMOVED_MESSAGE } from './lib/agents-removed.js';
import { conditionalGet } from './lib/conditional-get.js';
import { conflict, HttpError, notFound, parseWith } from './lib/errors.js';
import {
  githubIssueDepsOf,
  jsonBody,
  patchTodoBodySchema,
  requireProject,
  requireTeam,
  svcOf,
} from './routes-helpers.js';
import { attachmentIdsInUserText } from './services/attachment-authorization.js';
import {
  prepareStopForDone,
  stopActiveStepsAfterExit,
  stopActiveStepsForArchive,
} from './services/builds.js';
import { readSourceIssueEcho } from './services/github-issues.js';
import { listNeedsYou } from './services/needs-you.js';
import { orchestrateTodo } from './services/orchestrate.js';
import { PhaseTransitionError } from './services/phase.js';
import { assertProjectWritable } from './services/project-writable.js';
import { assertPlatformUnlocked } from './services/routing-rules.js';
import { runnerOverrideFor } from './services/runner-offline.js';
import { listTasks } from './services/tasks.js';
import { messageThreadAsUser } from './services/thread-message.js';
import {
  createTodo,
  deleteTodo,
  getTodo,
  listTodos,
  retrySelfIssueCreate,
  setTodoArchived,
  updateTodo,
} from './services/todos.js';
import { requireTeamTodo } from './services/tool-guards.js';

export function registerTodoRoutes(app: Hono, ctx: AppContext): void {
  const svc = svcOf(ctx);

  app.get('/api/todos/:id/github-issue', async (c) => {
    const id = c.req.param('id');
    requireTeamTodo(ctx.db, id, ctx.team.id);
    const echo = await readSourceIssueEcho(githubIssueDepsOf(ctx), id);
    return c.json(githubIssueEchoSchema.parse(echo));
  });

  app.post('/api/todos/:id/github-issue/retry', async (c) => {
    const id = c.req.param('id');
    requireTeamTodo(ctx.db, id, ctx.team.id);
    const record = await retrySelfIssueCreate(svc, id);
    return c.json(record);
  });

  app.get('/api/todos', conditionalGet(), (c) => {
    const teamId = c.req.query('teamId') ?? ctx.team.id;
    requireTeam(ctx, teamId);
    return c.json(listTodos(svc, { teamId, archived: c.req.query('archived') === '1' }));
  });

  app.get('/api/tasks', conditionalGet(), (c) => {
    const teamId = c.req.query('teamId') ?? ctx.team.id;
    requireTeam(ctx, teamId);
    const sectionedOnly = c.req.query('sectioned') === '1';
    return c.json(tasksQuerySchema.parse(listTasks(svc, teamId, { sectionedOnly })));
  });

  app.get('/api/needs-you', (c) => {
    const teamId = c.req.query('teamId') ?? ctx.team.id;
    requireTeam(ctx, teamId);
    return c.json(needsYouQuerySchema.parse(listNeedsYou(svc, teamId)));
  });

  app.get('/api/todos/:id', (c) => {
    const id = c.req.param('id');
    requireTeamTodo(ctx.db, id, ctx.team.id);
    const record = getTodo(svc, id);
    if (!record) throw notFound(`todo ${id}`);
    return c.json(record);
  });

  app.post('/api/todos/:id/orchestrate', (c) => {
    const id = c.req.param('id');
    requireTeamTodo(ctx.db, id, ctx.team.id);
    const result = orchestrateTodo(svc, id);
    return c.json(result, 201);
  });

  app.post('/api/todos/:id/messages', async (c) => {
    const body = parseWith(threadMessageBodySchema, await jsonBody(c), 'body');
    return c.json(await messageThreadAsUser(svc, ctx.team.id, c.req.param('id'), body), 201);
  });

  app.post('/api/projects/:id/todos', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    assertProjectWritable(ctx.db, row.teamId, row.id);
    const body = parseWith(createTodoBodySchema, await jsonBody(c), 'body');
    const record = createTodo(svc, {
      teamId: row.teamId,
      projectId: row.id,
      title: body.title,
      spec: body.spec,
      ...(body.output !== undefined ? { output: body.output } : {}),
      ...(body.machineId !== undefined ? { routeOverride: { machineId: body.machineId } } : {}),
      createdBy: ctx.user.id,
      ownerId: ctx.user.id,
      userSpecAttachmentIds: attachmentIdsInUserText(body.spec, row.teamId),
    });
    return c.json(record, 201);
  });

  app.patch('/api/todos/:id', async (c) => {
    const id = c.req.param('id');
    requireTeamTodo(ctx.db, id, ctx.team.id);
    const body = parseWith(patchTodoBodySchema, await jsonBody(c), 'body');
    if (body.assignment != null) throw new HttpError(410, AGENTS_REMOVED_MESSAGE);
    const prior = getTodo(svc, id);
    if (prior !== null) assertProjectWritable(svc.db, prior.teamId, prior.projectId);
    if (
      prior !== null &&
      body.routeOverride !== undefined &&
      (body.routeOverride?.requiredCapabilities?.os ?? null) !==
        (prior.routeOverride?.requiredCapabilities?.os ?? null)
    ) {
      assertPlatformUnlocked(svc.db, id);
    }
    if (body.projectId !== undefined && body.projectId !== prior?.projectId) {
      assertProjectWritable(svc.db, ctx.team.id, body.projectId);
    }
    if (
      body.phase === 'todo' &&
      prior != null &&
      prior.phase !== 'todo' &&
      prior.phase !== 'closed' &&
      isStartedTodo(prior)
    ) {
      throw new HttpError(409, 'started task cannot be moved back to todo', 'already-started');
    }
    let record: TodoRecord | null;
    try {
      record = updateTodo(svc, id, body, {
        manualPhase: true,
        ...(body.spec !== undefined && prior !== null
          ? { userSpecAttachmentIds: attachmentIdsInUserText(body.spec, prior.teamId) }
          : {}),
      });
    } catch (err) {
      if (err instanceof PhaseTransitionError) throw conflict(err.message);
      throw err;
    }
    if (!record) throw notFound(`todo ${id}`);
    const closing = record.phase === 'closed' && prior?.phase !== 'closed';
    const exited =
      prior != null &&
      (IN_PROGRESS_PHASES as readonly string[]).includes(prior.phase) &&
      record.phase === 'done';
    if (closing || exited) {
      stopActiveStepsAfterExit(svc, id, {
        actor: 'person',
        reason: `${closing ? 'closed' : 'marked done'} by ${svc.user.displayName}`,
      });
    }
    return c.json(record);
  });

  app.post('/api/todos/:id/runner', async (c) => {
    const id = c.req.param('id');
    const body = parseWith(runTodoOnBodySchema, await jsonBody(c), 'body');
    const prior = getTodo(svc, id);
    if (prior === null || prior.teamId !== ctx.team.id) throw notFound(`todo ${id}`);
    assertProjectWritable(svc.db, prior.teamId, prior.projectId);
    const routeOverride = runnerOverrideFor(svc.db, prior, body.machineId);
    const record = updateTodo(svc, id, { routeOverride });
    if (!record) throw notFound(`todo ${id}`);
    svc.machineHub?.wake(prior.teamId);
    return c.json(record);
  });

  app.post('/api/todos/:id/archive', (c) => {
    const id = c.req.param('id');
    requireTeamTodo(ctx.db, id, ctx.team.id);
    const record = setTodoArchived(svc, id, true);
    if (!record) throw notFound(`todo ${id}`);
    stopActiveStepsForArchive(svc, id, {
      actor: 'person',
      reason: `archived by ${svc.user.displayName}`,
    });
    return c.json(getTodo(svc, id) ?? record);
  });

  app.post('/api/todos/:id/unarchive', (c) => {
    const id = c.req.param('id');
    requireTeamTodo(ctx.db, id, ctx.team.id);
    const record = setTodoArchived(svc, id, false);
    if (!record) throw notFound(`todo ${id}`);
    return c.json(record);
  });

  app.post('/api/todos/:id/stop-and-done', async (c) => {
    const id = c.req.param('id');
    requireTeamTodo(ctx.db, id, ctx.team.id);
    const prior = getTodo(svc, id);
    if (!prior) throw notFound(`todo ${id}`);
    let prep: ReturnType<typeof prepareStopForDone>;
    try {
      prep = prepareStopForDone(svc, id, {
        actor: 'person',
        reason: `stop and mark done by ${svc.user.displayName}`,
      });
    } catch (err) {
      if (err instanceof PhaseTransitionError) throw conflict(err.message);
      throw err;
    }
    if (prep.state === 'stopping') {
      const record = getTodo(svc, id);
      if (!record) throw notFound(`todo ${id}`);
      return c.json({ state: 'stopping' as const, todo: record });
    }
    let record: TodoRecord | null;
    try {
      record = updateTodo(svc, id, { phase: 'done' }, { manualPhase: true });
    } catch (err) {
      if (err instanceof PhaseTransitionError) throw conflict(err.message);
      throw err;
    }
    if (!record) throw notFound(`todo ${id}`);
    return c.json({ state: 'done' as const, todo: record });
  });

  app.delete('/api/todos/:id', (c) => {
    const id = c.req.param('id');
    requireTeamTodo(ctx.db, id, ctx.team.id);
    if (!deleteTodo(svc, id)) throw notFound(`todo ${id}`);
    return c.body(null, 204);
  });
}
