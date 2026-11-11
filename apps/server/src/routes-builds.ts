import {
  type BuildRecord,
  buildMergePermissionSchema,
  buildStepActionBodySchema,
  buildStopBodySchema,
  conversationMessagesQuerySchema,
  createBranchSyncBodySchema,
  planResponseSchema,
  prPanelListSchema,
  prPanelQuerySchema,
  startBuildsBodySchema,
  tokenUsageSchema,
} from '@cairn/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AppContext } from './context.js';
import { chiefMessage, message, plan as planTable, todo, tokenUsage } from './db/schema.js';
import { AGENTS_REMOVED_MESSAGE } from './lib/agents-removed.js';
import { conflict, HttpError, notFound, parseWith } from './lib/errors.js';
import { pairedDeviceIdOf } from './lib/token-auth.js';
import { jsonBody, requestOrigin, requireProject, svcOf } from './routes-helpers.js';
import {
  createBranchSync,
  latestBranchSyncForBuild,
  type MachineSyncHub,
} from './services/branch-sync.js';
import {
  applyBuildStepAction,
  buildMergePermission,
  getBuild,
  listSteps,
  planAutoApproveAt,
  readSteerPending,
  requestMerge,
  requestStop,
  startBuilds,
} from './services/builds.js';
import { getChiefThread } from './services/chief.js';
import { ClientMessageConflict, findClientMessage } from './services/client-message.js';
import { createSerialConnection } from './services/events.js';
import {
  projectOfTodo,
  projectRepoRef,
  readBuildChangeFile,
  readBuildChanges,
} from './services/git.js';
import { isChiefConversation } from './services/machines.js';
import { readMergeGateState } from './services/merge-gate-run.js';
import { newestMessagePage } from './services/message-page.js';
import { deviceStreams, pairedDeviceExists } from './services/paired-devices.js';
import { PhaseTransitionError } from './services/phase.js';
import { holdSecondRejectionRework } from './services/research-stuck.js';
import { drainTaskMessageQueue, readQueuedMessages } from './services/task-message-queue.js';
import { listThreadPrs } from './services/thread-pr.js';

export function registerBuildRoutes(app: Hono, ctx: AppContext): void {
  const svc = svcOf(ctx);

  app.get('/api/builds/:id', (c) => {
    const id = c.req.param('id');
    const record = getBuild(svc, id);
    if (!record) throw notFound(`build ${id}`);
    return c.json(record);
  });

  app.get('/api/prs', (c) => {
    const { threadId } = parseWith(prPanelQuerySchema, c.req.query(), 'query');
    return c.json(
      prPanelListSchema.parse(
        listThreadPrs(ctx.db, {
          teamId: ctx.team.id,
          ...(threadId !== undefined ? { threadId } : {}),
        }),
      ),
    );
  });

  app.get('/api/builds/:id/gate', (c) => {
    const id = c.req.param('id');
    if (!getBuild(svc, id)) throw notFound(`build ${id}`);
    return c.json({ state: readMergeGateState(ctx.db, id) });
  });

  app.get('/api/builds/:id/steps', (c) => {
    const id = c.req.param('id');
    if (!getBuild(svc, id)) throw notFound(`build ${id}`);
    return c.json(listSteps(svc, id));
  });

  app.get('/api/conversations/:id/messages', (c) => {
    const conversationId = c.req.param('id');
    const query = parseWith(conversationMessagesQuerySchema, c.req.query(), 'query');
    if (isChiefConversation(conversationId)) {
      const thread = getChiefThread(svc, conversationId);
      if (!thread) throw notFound(`conversation ${conversationId}`);
      const page = newestMessagePage(ctx.db, chiefMessage, conversationId, query);
      return c.json({
        messages: page.messages.map((r) => ({
          id: r.id,
          role: r.role,
          content: r.content,
          createdAt: r.createdAt,
        })),
        chips: [],
        historyEpoch: 0,
        steerPending: [],
        activeRun: thread.activeRun,
        nextCursor: page.hasEarlier ? (page.messages[0]?.id ?? null) : null,
      });
    }
    const page = newestMessagePage(ctx.db, message, conversationId, query);
    return c.json({
      messages: page.messages.map((r) => ({
        id: r.id,
        role: r.role,
        content: r.content,
        createdAt: r.createdAt,
        actor: r.actor,
      })),
      chips: [],
      historyEpoch: 0,
      steerPending: readSteerPending(ctx.db, conversationId),
      queuedMessages: readQueuedMessages(ctx.db, conversationId),
      activeRun: null,
      nextCursor: page.hasEarlier ? (page.messages[0]?.id ?? null) : null,
    });
  });

  app.get('/api/conversations/:id/stream', (c) => {
    const conversationId = c.req.param('id');
    return streamSSE(c, async (stream) => {
      const conn = createSerialConnection((payload) =>
        stream.writeSSE({ data: JSON.stringify(payload) }),
      );
      const unsubscribe = ctx.convHub?.subscribe(conversationId, conn) ?? (() => {});
      const deviceId = pairedDeviceIdOf(c);
      const timer = setInterval(() => {
        if (deviceId !== null && !pairedDeviceExists(ctx.db, deviceId)) {
          stream.abort();
          return;
        }
        void conn.send({ type: 'ping', seq: conn.nextSeq() });
      }, ctx.pingIntervalMs);
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const unbindDevice = deviceStreams.bind(deviceId, () => stream.abort());
      stream.onAbort(() => {
        clearInterval(timer);
        unsubscribe();
        unbindDevice();
        release();
      });
      await conn.send({ type: 'ping', seq: conn.nextSeq() });
      await held;
    });
  });

  app.post('/api/projects/:id/builds', async (c) => {
    const row = requireProject(ctx, c.req.param('id'));
    const body = parseWith(startBuildsBodySchema, await jsonBody(c), 'body');
    if (body.assignment != null) throw new HttpError(410, AGENTS_REMOVED_MESSAGE);
    let builds: BuildRecord[];
    try {
      builds = startBuilds(svc, {
        projectId: row.id,
        todoIds: body.todoIds,
        ...(body.routeOverride !== undefined ? { routeOverride: body.routeOverride } : {}),
      });
    } catch (err) {
      if (err instanceof PhaseTransitionError) throw conflict(err.message);
      throw err;
    }
    return c.json({ builds }, 201);
  });

  app.get('/api/builds/:id/merge-permission', (c) =>
    c.json(buildMergePermissionSchema.parse(buildMergePermission(svc, c.req.param('id')))),
  );

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
    const buildId = c.req.param('id');
    if ('clientMessageId' in body) {
      const stored = findClientMessage<{ delegated: true }>(svc.db, buildId, body.clientMessageId);
      if (stored !== undefined) return c.json(stored, 202);
    }
    try {
      await applyBuildStepAction(svc, buildId, body);
      if (body.action === 'revision') holdSecondRejectionRework(svc, buildId);
    } catch (err) {
      if (err instanceof ClientMessageConflict && 'clientMessageId' in body) {
        const raced = findClientMessage<{ delegated: true }>(svc.db, buildId, body.clientMessageId);
        if (raced !== undefined) return c.json(raced, 202);
      }
      if (err instanceof PhaseTransitionError) throw conflict(err.message);
      throw err;
    }
    return c.json({ delegated: true }, 202);
  });

  app.post('/api/builds/:id/stop', async (c) => {
    const body = parseWith(buildStopBodySchema, await jsonBody(c), 'body');
    const result = requestStop(svc, c.req.param('id'), body, {
      actor: 'person',
      reason: `stopped from the task page by ${svc.user.displayName}`,
    });
    if (!result.delegated) await drainTaskMessageQueue(svc, c.req.param('id'));
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
        planResponseSchema.parse({
          id: r.id,
          buildId: r.buildId,
          version: r.version,
          createdAt: r.createdAt,
          content: r.content,
          autoApproveAt: planAutoApproveAt(svc, r.id),
          autoApprovePausedAt: r.autoApprovePausedAt,
        }),
      ),
    );
  });

  app.post('/api/builds/:id/plans/:planId/pause-auto-approve', (c) => {
    const buildId = c.req.param('id');
    const buildRow = getBuild(svc, buildId);
    if (!buildRow) throw notFound(`build ${buildId}`);
    const planId = c.req.param('planId');
    const row = ctx.db
      .select()
      .from(planTable)
      .where(and(eq(planTable.id, planId), eq(planTable.buildId, buildId)))
      .get();
    if (!row) throw notFound(`plan ${planId}`);
    const task = ctx.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
    const latest = ctx.db
      .select({ id: planTable.id })
      .from(planTable)
      .where(eq(planTable.buildId, buildId))
      .orderBy(desc(planTable.version))
      .get();
    if (
      task?.phase !== 'confirm' ||
      task.latestBuildId !== buildId ||
      task.archivedAt !== null ||
      latest?.id !== planId
    ) {
      throw conflict('Only the current plan awaiting confirmation can pause auto-approve');
    }
    const autoApprovePausedAt = row.autoApprovePausedAt ?? Date.now();
    ctx.db.update(planTable).set({ autoApprovePausedAt }).where(eq(planTable.id, planId)).run();
    return c.json(planResponseSchema.parse({ ...row, autoApproveAt: null, autoApprovePausedAt }));
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
