import {
  type BuildRecord,
  buildStepActionBodySchema,
  buildStopBodySchema,
  createBranchSyncBodySchema,
  planRowSchema,
  startBuildsBodySchema,
  tokenUsageSchema,
} from '@cairn/shared';
import { asc, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AppContext } from './context.js';
import { message, plan as planTable, todo, tokenUsage } from './db/schema.js';
import { conflict, HttpError, notFound, parseWith } from './lib/errors.js';
import { jsonBody, requestOrigin, requireProject, svcOf } from './routes-helpers.js';
import {
  createBranchSync,
  latestBranchSyncForBuild,
  type MachineSyncHub,
} from './services/branch-sync.js';
import {
  applyBuildStepAction,
  getBuild,
  listSteps,
  readSteerPending,
  requestMerge,
  requestStop,
  startBuilds,
} from './services/builds.js';
import { chiefThreadMessages, getChiefThread } from './services/chief.js';
import { createSerialConnection } from './services/events.js';
import {
  projectOfTodo,
  projectRepoRef,
  readBuildChangeFile,
  readBuildChanges,
} from './services/git.js';
import { readProductGateState } from './services/machine-gate-port.js';
import { isChiefConversation } from './services/machines.js';
import { PhaseTransitionError } from './services/phase.js';

export function registerBuildRoutes(app: Hono, ctx: AppContext): void {
  const svc = svcOf(ctx);

  app.get('/api/builds/:id', (c) => {
    const id = c.req.param('id');
    const record = getBuild(svc, id);
    if (!record) throw notFound(`build ${id}`);
    return c.json(record);
  });

  app.get('/api/builds/:id/gate', (c) => {
    const id = c.req.param('id');
    if (!getBuild(svc, id)) throw notFound(`build ${id}`);
    return c.json({ state: readProductGateState(svc, id) });
  });

  app.get('/api/builds/:id/steps', (c) => {
    const id = c.req.param('id');
    if (!getBuild(svc, id)) throw notFound(`build ${id}`);
    return c.json(listSteps(svc, id));
  });

  app.get('/api/conversations/:id/messages', (c) => {
    const conversationId = c.req.param('id');
    if (isChiefConversation(conversationId)) {
      const thread = getChiefThread(svc, conversationId);
      if (!thread) throw notFound(`conversation ${conversationId}`);
      const rows = chiefThreadMessages(ctx.db, conversationId);
      return c.json({
        messages: rows.map((r) => ({
          id: r.id,
          role: r.role,
          content: r.content,
          createdAt: r.createdAt,
        })),
        chips: [],
        historyEpoch: 0,
        steerPending: [],
        activeRun: thread.activeRun,
        nextCursor: null,
      });
    }
    const rows = ctx.db
      .select()
      .from(message)
      .where(eq(message.conversationId, conversationId))
      .all();
    return c.json({
      messages: rows.map((r) => ({
        id: r.id,
        role: r.role,
        content: r.content,
        createdAt: r.createdAt,
        actor: r.actor,
      })),
      chips: [],
      historyEpoch: 0,
      steerPending: readSteerPending(ctx.db, conversationId),
      activeRun: null,
      nextCursor: null,
    });
  });

  app.get('/api/conversations/:id/stream', (c) => {
    const conversationId = c.req.param('id');
    return streamSSE(c, async (stream) => {
      const conn = createSerialConnection((payload) =>
        stream.writeSSE({ data: JSON.stringify(payload) }),
      );
      const unsubscribe = ctx.convHub?.subscribe(conversationId, conn) ?? (() => {});
      const timer = setInterval(() => {
        void conn.send({ type: 'ping', seq: conn.nextSeq() });
      }, ctx.pingIntervalMs);
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      stream.onAbort(() => {
        clearInterval(timer);
        unsubscribe();
        release();
      });
      await conn.send({ type: 'ping', seq: conn.nextSeq() });
      await held;
    });
  });

  app.post('/api/projects/:id/builds', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    const body = parseWith(startBuildsBodySchema, await jsonBody(c), 'body');
    let builds: BuildRecord[];
    try {
      builds = startBuilds(svc, {
        projectId: row.id,
        todoIds: body.todoIds,
        assignment: body.assignment,
        withPlan: body.withPlan,
      });
    } catch (err) {
      if (err instanceof PhaseTransitionError) throw conflict(err.message);
      throw err;
    }
    return c.json({ builds }, 201);
  });

  app.post('/api/builds/:id/merge', async (c) => {
    try {
      const result = await requestMerge(svc, c.req.param('id'));
      return c.json(result, 202);
    } catch (err) {
      if (err instanceof PhaseTransitionError) throw conflict(err.message);
      throw err;
    }
  });

  app.post('/api/builds/:id/branch-sync', async (c) => {
    const buildId = c.req.param('id');
    const buildRow = getBuild(svc, buildId);
    if (!buildRow) throw notFound(`build ${buildId}`);
    const todoRow = ctx.db
      .select({ teamId: todo.teamId, projectId: todo.projectId })
      .from(todo)
      .where(eq(todo.id, buildRow.todoId))
      .get();
    if (!todoRow) throw notFound(`todo ${buildRow.todoId}`);
    let cloneUrl: string | null = null;
    let projectId: string | null = null;
    if (todoRow.projectId !== null) {
      const projRow = projectOfTodo(ctx.db, todoRow);
      if (projRow) {
        projectId = projRow.id;
        const ref = projectRepoRef(projRow, requestOrigin(c));
        if (ref !== null && ref.kind !== 'local') cloneUrl = ref.cloneUrl;
      }
    }
    const body = parseWith(createBranchSyncBodySchema, await jsonBody(c), 'body');
    const record = createBranchSync(
      {
        db: ctx.db,
        hub: ctx.hub,
        machineHub: ctx.machineHub as unknown as MachineSyncHub,
      },
      {
        buildId,
        machineId: body.machineId,
        teamId: todoRow.teamId,
        projectId,
        cloneUrl,
        directory: body.directory,
        ref: body.ref,
        commit: body.commit,
        force: body.force,
      },
    );
    return c.json(record, 201);
  });

  app.get('/api/builds/:id/branch-sync', (c) => {
    const buildId = c.req.param('id');
    if (!getBuild(svc, buildId)) throw notFound(`build ${buildId}`);
    return c.json(latestBranchSyncForBuild({ db: ctx.db }, buildId));
  });

  app.post('/api/builds/:id/steps', async (c) => {
    const body = parseWith(buildStepActionBodySchema, await jsonBody(c), 'body');
    try {
      await applyBuildStepAction(svc, c.req.param('id'), body);
    } catch (err) {
      if (err instanceof PhaseTransitionError) throw conflict(err.message);
      throw err;
    }
    return c.json({ delegated: true }, 202);
  });

  app.post('/api/builds/:id/stop', async (c) => {
    const body = parseWith(buildStopBodySchema, await jsonBody(c), 'body');
    const result = requestStop(svc, c.req.param('id'), body);
    return c.json(result, result.delegated ? 202 : 200);
  });

  app.get('/api/builds/:id/plans', (c) => {
    const id = c.req.param('id');
    if (!getBuild(svc, id)) throw notFound(`build ${id}`);
    const rows = ctx.db
      .select()
      .from(planTable)
      .where(eq(planTable.buildId, id))
      .orderBy(asc(planTable.version))
      .all();
    return c.json(
      rows.map((r) =>
        planRowSchema.parse({
          id: r.id,
          buildId: r.buildId,
          version: r.version,
          createdAt: r.createdAt,
          content: r.content,
        }),
      ),
    );
  });

  app.get('/api/builds/:id/changes', async (c) =>
    c.json(await readBuildChanges({ db: ctx.db, reposDir: ctx.reposDir }, c.req.param('id'))),
  );

  app.get('/api/builds/:id/changes/file', async (c) => {
    const path = c.req.query('path');
    if (path === undefined || path === '') {
      throw new HttpError(400, 'invalid query path: required');
    }
    return c.json(
      await readBuildChangeFile({ db: ctx.db, reposDir: ctx.reposDir }, c.req.param('id'), path),
    );
  });

  app.get('/api/builds/:id/usage', (c) => {
    const id = c.req.param('id');
    if (!getBuild(svc, id)) throw notFound(`build ${id}`);
    const rows = ctx.db.select().from(tokenUsage).where(eq(tokenUsage.buildId, id)).all();
    return c.json(rows.map((r) => tokenUsageSchema.parse(r)));
  });
}
