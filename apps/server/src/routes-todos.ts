import {
  createTodoBodySchema,
  githubIssueEchoSchema,
  IN_PROGRESS_PHASES,
  isStartedTodo,
  needsYouQuerySchema,
  phaseSchema,
  type TodoRecord,
} from '@cairn/shared';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from './context.js';
import { conflict, notFound, parseWith } from './lib/errors.js';
import {
  githubIssueDepsOf,
  jsonBody,
  patchTodoBodySchema,
  requireProject,
  svcOf,
} from './routes-helpers.js';
import { attachmentIdsInUserText } from './services/attachment-authorization.js';
import {
  advanceSplitWaves,
  prepareStopForDone,
  stopActiveStepsAfterExit,
} from './services/builds.js';
import { readSourceIssueEcho } from './services/github-issues.js';
import { listNeedsYou } from './services/needs-you.js';
import { orchestrateTodo } from './services/orchestrate.js';
import { PhaseTransitionError } from './services/phase.js';
import {
  createTodo,
  deleteTodo,
  getTodo,
  listTodos,
  resetTodo,
  retrySelfIssueCreate,
  updateTodo,
} from './services/todos.js';

export function registerTodoRoutes(app: Hono, ctx: AppContext): void {
  const svc = svcOf(ctx);

  app.get('/api/todos/:id/github-issue', async (c) => {
    const echo = await readSourceIssueEcho(githubIssueDepsOf(ctx), c.req.param('id'));
    return c.json(githubIssueEchoSchema.parse(echo));
  });

  app.post('/api/todos/:id/github-issue/retry', async (c) => {
    const record = await retrySelfIssueCreate(svc, c.req.param('id'));
    return c.json(record);
  });

  app.get('/api/todos', (c) => {
    const teamId = c.req.query('teamId') ?? ctx.team.id;
    return c.json(listTodos(svc, { teamId }));
  });

  app.get('/api/needs-you', (c) => {
    const teamId = c.req.query('teamId') ?? ctx.team.id;
    return c.json(needsYouQuerySchema.parse(listNeedsYou(svc, teamId)));
  });

  app.get('/api/todos/:id', (c) => {
    const id = c.req.param('id');
    const record = getTodo(svc, id);
    if (!record) throw notFound(`todo ${id}`);
    return c.json(record);
  });

  app.post('/api/todos/:id/orchestrate', (c) => {
    const result = orchestrateTodo(svc, c.req.param('id'));
    return c.json(result, 201);
  });

  app.post('/api/projects/:id/todos', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    const body = parseWith(createTodoBodySchema, await jsonBody(c), 'body');
    const record = createTodo(svc, {
      teamId: row.teamId,
      projectId: row.id,
      title: body.title,
      spec: body.spec,
      ...(body.tagIds !== undefined ? { tagIds: body.tagIds } : {}),
      ...(body.output !== undefined ? { output: body.output } : {}),
      createdBy: ctx.user.id,
      ownerId: ctx.user.id,
      userSpecAttachmentIds: attachmentIdsInUserText(body.spec, row.teamId),
    });
    return c.json(record, 201);
  });

  app.patch('/api/todos/:id', async (c) => {
    const id = c.req.param('id');
    const body = parseWith(patchTodoBodySchema, await jsonBody(c), 'body');
    const prior = getTodo(svc, id);
    if (
      body.phase === 'todo' &&
      prior != null &&
      prior.phase !== 'todo' &&
      prior.phase !== 'closed' &&
      isStartedTodo(prior)
    ) {
      throw conflict(
        `这张卡已经开始过，挪回待开始要重置（清空构建历史）：POST /api/todos/${id}/reset`,
      );
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
    if (body.phase === 'done' && prior?.phase !== 'failed') advanceSplitWaves(svc, id);
    const closing = record.phase === 'closed' && prior?.phase !== 'closed';
    const exited =
      prior != null &&
      (IN_PROGRESS_PHASES as readonly string[]).includes(prior.phase) &&
      record.phase === 'done';
    if (closing || exited) stopActiveStepsAfterExit(svc, id);
    return c.json(record);
  });

  app.post('/api/todos/:id/stop-and-done', async (c) => {
    const id = c.req.param('id');
    const prior = getTodo(svc, id);
    if (!prior) throw notFound(`todo ${id}`);
    let prep: ReturnType<typeof prepareStopForDone>;
    try {
      prep = prepareStopForDone(svc, id);
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
    if (prior.phase !== 'failed') advanceSplitWaves(svc, id);
    return c.json({ state: 'done' as const, todo: record });
  });

  const resetTodoBodySchema = z.object({
    expectedPhase: phaseSchema.optional(),
    expectedBuildId: z.string().nullable().optional(),
  });

  app.post('/api/todos/:id/reset', async (c) => {
    const id = c.req.param('id');
    const body = parseWith(resetTodoBodySchema, await jsonBody(c), 'body');
    const result = resetTodo(
      svc,
      id,
      body.expectedPhase !== undefined || body.expectedBuildId !== undefined
        ? { phase: body.expectedPhase, buildId: body.expectedBuildId }
        : undefined,
    );
    if (!result) throw notFound(`todo ${id}`);
    if (result.stale) {
      return c.json(
        {
          error: '任务在你确认前发生了变化（构建已推进），请按最新状态重新确认。',
          record: result.record,
        },
        409,
      );
    }
    return c.json(result.record);
  });

  app.delete('/api/todos/:id', (c) => {
    const id = c.req.param('id');
    if (!deleteTodo(svc, id)) throw notFound(`todo ${id}`);
    return c.body(null, 204);
  });
}
