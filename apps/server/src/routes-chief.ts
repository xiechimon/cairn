import {
  buildSteerBodySchema,
  chiefRewindBodySchema,
  chiefSendMessageBodySchema,
  patchChiefBodySchema,
} from '@cairn/shared';
import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { notFound, parseWith } from './lib/errors.js';
import { jsonBody, requireTeam, svcOf } from './routes-helpers.js';
import { sendBuildSteer } from './services/builds.js';
import {
  getChiefEnvelope,
  getChiefThread,
  listChiefThreads,
  patchChief,
  rewindChiefThread,
  sendChiefMessage,
} from './services/chief.js';
import { answerQuestion, cancelQuestion, parseAnswerBody } from './services/chief-questions.js';
import { isChiefConversation } from './services/machines.js';

export function registerChiefRoutes(app: Hono, ctx: AppContext): void {
  const svc = svcOf(ctx);

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

  app.post('/api/teams/:id/chief/threads/:tid/questions/:requestId/answer', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const threadId = c.req.param('tid');
    const thread = getChiefThread(svc, threadId);
    if (!thread || thread.teamId !== teamId) throw notFound(`chief thread ${threadId}`);
    const answers = parseAnswerBody(await jsonBody(c));
    return c.json(
      answerQuestion(svc, {
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
      const result = sendBuildSteer(svc, conversationId, body);
      ctx.convHub?.publishMessage(conversationId, { ...result.message });
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
