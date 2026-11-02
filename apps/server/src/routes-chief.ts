import {
  buildSteerBodySchema,
  chiefRewindBodySchema,
  chiefSendMessageBodySchema,
  coordinatorPageQuerySchema,
  coordinatorSendBodySchema,
  patchChiefBodySchema,
} from '@cairn/shared';
import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { notFound, parseWith } from './lib/errors.js';
import { jsonBody, requireTeam, svcOf } from './routes-helpers.js';
import { sendBuildSteer } from './services/builds.js';
import {
  answerChiefQuestion,
  getChiefEnvelope,
  getChiefThread,
  listChiefThreads,
  patchChief,
  rewindChiefThread,
  sendChiefMessage,
} from './services/chief.js';
import { cancelQuestion, parseAnswerBody } from './services/chief-questions.js';
import { steerChiefMessage, stopChiefTurn, withdrawChiefMessage } from './services/chief-turns.js';
import {
  compactCoordinator,
  readCoordinatorContext,
  readCoordinatorPage,
} from './services/coordinator.js';
import { isChiefConversation } from './services/machines.js';
import {
  cancelQueuedMessage,
  deliverQueuedMessage,
  queueTaskMessage,
} from './services/task-message-queue.js';

export function registerChiefRoutes(app: Hono, ctx: AppContext): void {
  const svc = svcOf(ctx);

  app.get('/api/teams/:id/coordinator', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const query = parseWith(coordinatorPageQuerySchema, c.req.query(), 'query');
    return c.json(readCoordinatorPage(svc, teamId, query));
  });

  app.post('/api/teams/:id/coordinator/messages', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(coordinatorSendBodySchema, await jsonBody(c), 'body');
    const result = sendChiefMessage(svc, teamId, { threadId: null, ...body });
    ctx.convHub?.publishMessage(result.thread.id, { ...result.message });
    return c.json(result, 201);
  });

  app.get('/api/teams/:id/coordinator/context', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(readCoordinatorContext({ ...svc, skillsDir: ctx.skillsDir }, teamId));
  });

  app.post('/api/teams/:id/coordinator/compact', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(await compactCoordinator(svc, teamId));
  });

  app.get('/api/teams/:id/chief', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(getChiefEnvelope(svc, teamId));
  });

  app.patch('/api/teams/:id/chief', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(patchChiefBodySchema, await jsonBody(c), 'body');
    return c.json(patchChief(svc, teamId, body));
  });

  app.get('/api/teams/:id/chief/threads', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(listChiefThreads(svc, teamId));
  });

  app.post('/api/teams/:id/chief/threads', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const raw = (await jsonBody(c)) as { content?: unknown; projectId?: unknown };
    const body = parseWith(
      chiefSendMessageBodySchema,
      { threadId: null, content: raw?.content, projectId: raw?.projectId },
      'body',
    );
    const result = sendChiefMessage(svc, teamId, body);
    ctx.convHub?.publishMessage(result.thread.id, { ...result.message });
    return c.json(result, 201);
  });

  app.post('/api/teams/:id/chief/threads/:tid/rewind', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(chiefRewindBodySchema, await jsonBody(c), 'body');
    return c.json(rewindChiefThread(svc, teamId, c.req.param('tid'), body));
  });

  app.delete('/api/teams/:id/chief/threads/:tid/messages/:mid', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(withdrawChiefMessage(svc, teamId, c.req.param('tid'), c.req.param('mid')));
  });

  app.post('/api/teams/:id/chief/threads/:tid/messages/:mid/steer', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(steerChiefMessage(svc, teamId, c.req.param('tid'), c.req.param('mid')));
  });

  app.post('/api/teams/:id/chief/threads/:tid/stop', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(stopChiefTurn(svc, teamId, c.req.param('tid')));
  });

  app.post('/api/teams/:id/chief/threads/:tid/questions/:requestId/answer', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const threadId = c.req.param('tid');
    const thread = getChiefThread(svc, threadId);
    if (!thread || thread.teamId !== teamId) throw notFound(`chief thread ${threadId}`);
    const answers = parseAnswerBody(await jsonBody(c));
    return c.json(
      answerChiefQuestion(svc, teamId, {
        threadId,
        requestId: c.req.param('requestId'),
        answers,
      }),
    );
  });

  app.post('/api/teams/:id/chief/threads/:tid/questions/:requestId/cancel', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const threadId = c.req.param('tid');
    const thread = getChiefThread(svc, threadId);
    if (!thread || thread.teamId !== teamId) throw notFound(`chief thread ${threadId}`);
    cancelQuestion(svc, {
      threadId,
      requestId: c.req.param('requestId'),
      reason: '用户取消了本次提问',
    });
    return c.json({ ok: true as const });
  });

  app.post('/api/conversations/:id/messages', async (c) => {
    const conversationId = c.req.param('id');
    if (!isChiefConversation(conversationId)) {
      const body = parseWith(buildSteerBodySchema, await jsonBody(c), 'body');
      const humanSvc = { ...svc, steerOptions: { human: true } };
      const result =
        body.queuedMessageId !== undefined
          ? body.cancelQueued
            ? cancelQueuedMessage(svc, conversationId, body.queuedMessageId)
            : await deliverQueuedMessage(humanSvc, conversationId, body.queuedMessageId, true)
          : body.mode === 'queue'
            ? await queueTaskMessage(humanSvc, conversationId, body.content, body.deliverAfterStop)
            : await sendBuildSteer(svc, conversationId, body, { human: true });
      return c.json(result, 201);
    }
    const raw = (await jsonBody(c)) as { content?: unknown; projectId?: unknown };
    const thread = getChiefThread(svc, conversationId);
    if (!thread) throw notFound(`conversation ${conversationId}`);
    const body = parseWith(
      chiefSendMessageBodySchema,
      { threadId: conversationId, content: raw?.content, projectId: raw?.projectId },
      'body',
    );
    const result = sendChiefMessage(svc, thread.teamId, body);
    ctx.convHub?.publishMessage(conversationId, { ...result.message });
    return c.json(result, 201);
  });
}
