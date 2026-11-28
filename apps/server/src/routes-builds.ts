import {
  type BuildRecord,
  buildMergePermissionSchema,
  buildStepActionBodySchema,
  buildStopBodySchema,
  conversationMessagesQuerySchema,
  planResponseSchema,
  prPanelListSchema,
  prPanelQuerySchema,
  startBuildsBodySchema,
  tokenUsageSchema,
} from '@cairn/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from './context.js';
import { chiefMessage, message, plan as planTable, todo, tokenUsage } from './db/schema.js';
import { AGENTS_REMOVED_MESSAGE } from './lib/agents-removed.js';
import { conditionalGet } from './lib/conditional-get.js';
import { conflict, HttpError, notFound, parseWith } from './lib/errors.js';
import { openSseStream } from './lib/sse-headers.js';
import { pairedDeviceIdOf } from './lib/token-auth.js';
import { jsonBody, requireProject, svcOf } from './routes-helpers.js';
import { enqueueLocalFolderAction } from './services/build-merge-request.js';
import { retryBuildNow } from './services/build-retry-now.js';
import {
  applyBuildStepAction,
  buildMergePermission,
  getBuild,
  listSteps,
  planAutoApproveAt,
  readSteerPending,
  requestBackgroundTaskStop,
  requestMerge,
  requestStop,
  startBuilds,
} from './services/builds.js';
import { getChiefThread } from './services/chief.js';
import { ClientMessageConflict, findClientMessage } from './services/client-message.js';
import { createSerialConnection } from './services/events.js';
import { workspaceFileLinksOf } from './services/file-source.js';
import { readBuildChangeFile, readBuildChanges } from './services/git.js';
import { isChiefConversation } from './services/machines.js';
import { latestAgentTodo, newestMessagePage } from './services/message-page.js';
import { deviceStreamsOf, pairedDeviceExists } from './services/paired-devices.js';
import { PhaseTransitionError } from './services/phase.js';
import { drainTaskMessageQueue, readQueuedMessages } from './services/task-message-queue.js';
import { listThreadPrs } from './services/thread-pr.js';
import { requireTeamBuild, requireTeamConversation } from './services/tool-guards.js';

const buildRetryNowBodySchema = z.object({
  clientMessageId: z.string().min(1).max(128).optional(),
});

function retryNowReplayResponse(stored: unknown): {
  delegated: true;
  mode: 'quota_resumed' | 'restarted';
} {
  const mode =
    typeof stored === 'object' &&
    stored !== null &&
    (stored as { mode?: unknown }).mode === 'quota_resumed'
      ? 'quota_resumed'
      : 'restarted';
  return { delegated: true, mode };
}

export function registerBuildRoutes(app: Hono, ctx: AppContext): void {
  const svc = svcOf(ctx);

  app.get('/api/builds/:id', (c) => {
    const id = c.req.param('id');
    requireTeamBuild(ctx.db, id, ctx.team.id);
    const record = getBuild(svc, id);
    if (!record) throw notFound(`build ${id}`);
    return c.json(record);
  });

  app.get('/api/prs', conditionalGet(), (c) => {
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

  app.get('/api/builds/:id/steps', (c) => {
    const id = c.req.param('id');
    requireTeamBuild(ctx.db, id, ctx.team.id);
    return c.json(listSteps(svc, id));
  });

  app.get('/api/conversations/:id/messages', (c) => {
    const conversationId = c.req.param('id');
    requireTeamConversation(ctx.db, conversationId, ctx.team.id);
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
          projectId: r.projectId,
          origin: r.origin,
          ...(r.clientMessageId != null ? { clientMessageId: r.clientMessageId } : {}),
          ...workspaceFileLinksOf(r.fileSource, r.content, r.role),
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
        origin: r.origin,
        ...(r.clientMessageId != null ? { clientMessageId: r.clientMessageId } : {}),
        ...workspaceFileLinksOf(r.fileSource, r.content, r.role),
      })),
      chips: [],
      historyEpoch: 0,
      steerPending: readSteerPending(ctx.db, conversationId),
      queuedMessages: readQueuedMessages(ctx.db, conversationId).map((r) => ({
        id: r.id,
        conversationId: r.conversationId,
        content: r.content,
        deliverAfterStop: r.deliverAfterStop,
        error: r.error,
        createdAt: r.createdAt,
        ...(r.clientMessageId != null ? { clientMessageId: r.clientMessageId } : {}),
      })),
      agentTodo: query.before === undefined ? latestAgentTodo(ctx.db, conversationId) : null,
      activeRun: null,
      nextCursor: page.hasEarlier ? (page.messages[0]?.id ?? null) : null,
    });
  });

  app.get('/api/conversations/:id/stream', (c) => {
    const conversationId = c.req.param('id');
    requireTeamConversation(ctx.db, conversationId, ctx.team.id);
    return openSseStream(c, async (stream) => {
      const conn = createSerialConnection(
        (payload) => stream.writeSSE({ data: JSON.stringify(payload) }),
        { onOverflow: () => stream.abort() },
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
      const unbindDevice = deviceStreamsOf(ctx.db).bind(deviceId, () => stream.abort());
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

  app.get('/api/builds/:id/merge-permission', (c) => {
    const id = c.req.param('id');
    requireTeamBuild(ctx.db, id, ctx.team.id);
    return c.json(buildMergePermissionSchema.parse(buildMergePermission(svc, id)));
  });

  app.post('/api/builds/:id/merge', async (c) => {
    const id = c.req.param('id');
    requireTeamBuild(ctx.db, id, ctx.team.id);
    try {
      await requestMerge(svc, id);
      return c.json({ delegated: true }, 202);
    } catch (err) {
      if (err instanceof PhaseTransitionError) throw conflict(err.message);
      throw err;
    }
  });

  app.post('/api/builds/:id/undo', (c) => {
    const id = c.req.param('id');
    requireTeamBuild(ctx.db, id, ctx.team.id);
    enqueueLocalFolderAction(svc, id, 'undo');
    return c.json({ delegated: true }, 202);
  });

  app.post('/api/builds/:id/steps', async (c) => {
    const buildId = c.req.param('id');
    requireTeamBuild(ctx.db, buildId, ctx.team.id);
    const body = parseWith(buildStepActionBodySchema, await jsonBody(c), 'body');
    if ('clientMessageId' in body) {
      const stored = findClientMessage(svc.db, buildId, body.clientMessageId);
      if (stored !== undefined) return c.json({ delegated: true }, 202);
    }
    try {
      await applyBuildStepAction(svc, buildId, body);
    } catch (err) {
      if (err instanceof ClientMessageConflict && 'clientMessageId' in body) {
        const raced = findClientMessage(svc.db, buildId, body.clientMessageId);
        if (raced !== undefined) return c.json({ delegated: true }, 202);
      }
      if (err instanceof PhaseTransitionError) throw conflict(err.message);
      throw err;
    }
    return c.json({ delegated: true }, 202);
  });

  app.post('/api/builds/:id/retry-now', async (c) => {
    const buildId = c.req.param('id');
    requireTeamBuild(ctx.db, buildId, ctx.team.id);
    const raw = await jsonBody(c);
    const body = parseWith(buildRetryNowBodySchema, raw ?? {}, 'body');
    if (body.clientMessageId !== undefined) {
      const stored = findClientMessage(svc.db, buildId, body.clientMessageId);
      if (stored !== undefined) return c.json(retryNowReplayResponse(stored), 202);
    }
    try {
      const result = await retryBuildNow(svc, buildId, body.clientMessageId);
      return c.json({ delegated: true, ...result }, 202);
    } catch (err) {
      if (err instanceof ClientMessageConflict && body.clientMessageId !== undefined) {
        const raced = findClientMessage(svc.db, buildId, body.clientMessageId);
        if (raced !== undefined) return c.json(retryNowReplayResponse(raced), 202);
      }
      if (err instanceof PhaseTransitionError) throw new HttpError(409, err.message, 'conflict');
      throw err;
    }
  });

  app.post('/api/builds/:id/stop', async (c) => {
    const id = c.req.param('id');
    requireTeamBuild(ctx.db, id, ctx.team.id);
    const body = parseWith(buildStopBodySchema, await jsonBody(c), 'body');
    const result = requestStop(svc, id, body, {
      actor: 'person',
      reason: `stopped from the task page by ${svc.user.displayName}`,
    });
    if (!result.delegated) await drainTaskMessageQueue(svc, id);
    return c.json(result, result.delegated ? 202 : 200);
  });

  app.post('/api/builds/:id/tasks/:taskId/stop', (c) => {
    const id = c.req.param('id');
    requireTeamBuild(ctx.db, id, ctx.team.id);
    requestBackgroundTaskStop(svc, id, c.req.param('taskId'));
    return c.json({ ok: true as const }, 202);
  });

  app.get('/api/builds/:id/plans', (c) => {
    const id = c.req.param('id');
    requireTeamBuild(ctx.db, id, ctx.team.id);
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
    requireTeamBuild(ctx.db, buildId, ctx.team.id);
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

  app.get('/api/builds/:id/changes', async (c) => {
    const id = c.req.param('id');
    requireTeamBuild(ctx.db, id, ctx.team.id);
    return c.json(await readBuildChanges({ db: ctx.db, reposDir: ctx.reposDir }, id));
  });

  app.get('/api/builds/:id/changes/file', async (c) => {
    const id = c.req.param('id');
    requireTeamBuild(ctx.db, id, ctx.team.id);
    const path = c.req.query('path');
    if (path === undefined || path === '') {
      throw new HttpError(400, 'invalid query path: required');
    }
    return c.json(await readBuildChangeFile({ db: ctx.db, reposDir: ctx.reposDir }, id, path));
  });

  app.get('/api/builds/:id/usage', (c) => {
    const id = c.req.param('id');
    requireTeamBuild(ctx.db, id, ctx.team.id);
    const rows = ctx.db.select().from(tokenUsage).where(eq(tokenUsage.buildId, id)).all();
    return c.json(rows.map((r) => tokenUsageSchema.parse(r)));
  });
}
