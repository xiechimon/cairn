import {
  buildSteerBodySchema,
  chiefMessageEditBodySchema,
  chiefRewindBodySchema,
  chiefSendMessageBodySchema,
  OWN_COMPUTER_ACTIONS,
  patchChiefBodySchema,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { chiefMessage } from './db/schema.js';
import { notFound, parseWith } from './lib/errors.js';
import { pairedDeviceIdOf } from './lib/token-auth.js';
import { jsonBody, requireTeam, svcOf } from './routes-helpers.js';
import {
  ALWAYS_CHOICE,
  APPROVE_CHOICE,
  answerProposal,
  type Decision,
  dispatchActionWakes,
  proposalById,
  proposalCardId,
} from './services/action-proposals.js';
import { sendBuildSteer } from './services/builds.js';
import {
  answerChiefQuestion,
  editChiefMessage,
  getChiefEnvelope,
  getChiefThread,
  listChiefThreads,
  openProjectChannel,
  patchChief,
  retryProjectGreeting,
  rewindChiefThread,
  sendChiefMessageFromComposer,
} from './services/chief.js';
import {
  askQuestionContentOf,
  cancelQuestion,
  parseAnswerBody,
  proposalIdOfCard,
  publishQuestion,
} from './services/chief-questions.js';
import { steerChiefMessage, stopChiefTurn, withdrawChiefMessage } from './services/chief-turns.js';
import { latestChiefMemoryUsage } from './services/coordinator-steps.js';
import { isChiefConversation } from './services/machines.js';
import { ownComputerDecisionOf } from './services/own-computer.js';
import {
  cancelQueuedMessage,
  deliverQueuedMessage,
  editQueuedMessage,
  queueTaskMessage,
} from './services/task-message-queue.js';

export function registerChiefRoutes(app: Hono, ctx: AppContext): void {
  const svc = svcOf(ctx);

  const answerCard = (
    teamId: string,
    threadId: string,
    requestId: string,
    proposalId: string,
    decision: Decision,
    c: Parameters<typeof pairedDeviceIdOf>[0],
  ) => {
    if (requestId !== proposalCardId(proposalId)) throw notFound(`question ${requestId}`);
    const deviceId = pairedDeviceIdOf(c);
    try {
      return answerProposal(svc, {
        proposalId,
        teamId,
        decision,
        decidedBy: deviceId === null ? ctx.user.id : `device:${deviceId}`,
        viaCard: true,
      });
    } finally {
      publishQuestion(svc, threadId, requestId);
      dispatchActionWakes(svc);
    }
  };

  app.get('/api/teams/:id/chief', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const threadId = c.req.query('threadId');
    return c.json(getChiefEnvelope(svc, teamId, threadId));
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

  app.get('/api/teams/:id/chief/memory-usage', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json({ usage: latestChiefMemoryUsage(ctx.db, teamId) });
  });

  app.post('/api/teams/:id/chief/threads', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const raw = (await jsonBody(c)) as {
      content?: unknown;
      projectId?: unknown;
      clientMessageId?: unknown;
      mode?: unknown;
    };
    const body = parseWith(
      chiefSendMessageBodySchema,
      {
        threadId: null,
        content: raw?.content,
        projectId: raw?.projectId,
        clientMessageId: raw?.clientMessageId,
        mode: raw?.mode,
      },
      'body',
    );
    const { result, replayed } = sendChiefMessageFromComposer(svc, teamId, body);
    if (!replayed)
      ctx.convHub?.publishMessage(
        result.thread.id,
        { ...result.message },
        undefined,
        body.clientMessageId,
      );
    return c.json(result, 201);
  });

  app.post('/api/teams/:id/chief/channels/:projectId', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const { thread, created } = openProjectChannel(svc, teamId, c.req.param('projectId'));
    return c.json(thread, created ? 201 : 200);
  });

  app.post('/api/teams/:id/chief/threads/:tid/retry-greeting/:stepId', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(
      retryProjectGreeting(svc, teamId, c.req.param('tid'), c.req.param('stepId')),
      201,
    );
  });

  app.post('/api/teams/:id/chief/threads/:tid/rewind', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(chiefRewindBodySchema, await jsonBody(c), 'body');
    return c.json(rewindChiefThread(svc, teamId, c.req.param('tid'), body));
  });

  app.delete('/api/teams/:id/chief/threads/:tid/messages/:mid', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(await withdrawChiefMessage(svc, teamId, c.req.param('tid'), c.req.param('mid')));
  });

  app.patch('/api/teams/:id/chief/threads/:tid/messages/:mid', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(chiefMessageEditBodySchema, await jsonBody(c), 'body');
    return c.json(editChiefMessage(svc, teamId, c.req.param('tid'), c.req.param('mid'), body));
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
    const requestId = c.req.param('requestId');
    const waiting = ctx.db
      .select()
      .from(chiefMessage)
      .where(and(eq(chiefMessage.id, requestId), eq(chiefMessage.threadId, threadId)))
      .get();
    const card = askQuestionContentOf(waiting?.content);
    const proposalId = card === null ? null : proposalIdOfCard(card);
    if (card !== null && proposalId !== null) {
      const choices = answers.length === 1 ? answers[0]?.choices : undefined;
      const choice = choices?.length === 1 ? choices[0] : undefined;
      const ownComputer = OWN_COMPUTER_ACTIONS.includes(
        proposalById(ctx.db, proposalId)?.actionId ?? '',
      );
      const decision: Decision = ownComputer
        ? ownComputerDecisionOf(choice)
        : choice === APPROVE_CHOICE
          ? 'allow-once'
          : choice === ALWAYS_CHOICE
            ? 'always'
            : 'refuse';
      answerCard(teamId, threadId, requestId, proposalId, decision, c);
      const settled = ctx.db
        .select()
        .from(chiefMessage)
        .where(eq(chiefMessage.id, requestId))
        .get();
      return c.json(askQuestionContentOf(settled?.content));
    }
    return c.json(
      answerChiefQuestion(svc, teamId, {
        threadId,
        requestId,
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
    const requestId = c.req.param('requestId');
    const waiting = ctx.db
      .select()
      .from(chiefMessage)
      .where(and(eq(chiefMessage.id, requestId), eq(chiefMessage.threadId, threadId)))
      .get();
    const card = askQuestionContentOf(waiting?.content);
    const proposalId = card === null ? null : proposalIdOfCard(card);
    if (card !== null && proposalId !== null) {
      answerCard(teamId, threadId, requestId, proposalId, 'refuse', c);
      return c.json({ ok: true as const });
    }
    cancelQuestion(svc, { threadId, requestId, reason: '用户取消了本次提问' });
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
            : body.editQueued
              ? editQueuedMessage(svc, conversationId, body.queuedMessageId, body.content)
              : await deliverQueuedMessage(humanSvc, conversationId, body.queuedMessageId, true)
          : body.mode === 'queue'
            ? await queueTaskMessage(
                humanSvc,
                conversationId,
                body.content,
                body.deliverAfterStop,
                body.clientMessageId,
              )
            : await sendBuildSteer(svc, conversationId, body, { human: true });
      return c.json(result, 201);
    }
    const raw = (await jsonBody(c)) as {
      content?: unknown;
      projectId?: unknown;
      clientMessageId?: unknown;
      mode?: unknown;
    };
    const thread = getChiefThread(svc, conversationId);
    if (!thread) throw notFound(`conversation ${conversationId}`);
    const body = parseWith(
      chiefSendMessageBodySchema,
      {
        threadId: conversationId,
        content: raw?.content,
        projectId: raw?.projectId,
        clientMessageId: raw?.clientMessageId,
        mode: raw?.mode,
      },
      'body',
    );
    const { result, replayed } = sendChiefMessageFromComposer(svc, thread.teamId, body);
    if (!replayed)
      ctx.convHub?.publishMessage(
        conversationId,
        { ...result.message },
        undefined,
        body.clientMessageId,
      );
    return c.json(result, 201);
  });
}
