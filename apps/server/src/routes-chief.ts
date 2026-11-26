import {
  buildSteerBodySchema,
  type ChiefSendMessageBody,
  chiefRewindBodySchema,
  chiefSendMessageBodySchema,
  chiefStopBodySchema,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from './context.js';
import { chiefMessage, chiefThread, machine, step } from './db/schema.js';
import { conditionalGet } from './lib/conditional-get.js';
import { HttpError, notFound, parseWith } from './lib/errors.js';
import { nowMs } from './lib/ids.js';
import { pairedDeviceIdOf, sameOriginPageWrite } from './lib/token-auth.js';
import { jsonBody, requireTeam, svcOf } from './routes-helpers.js';
import {
  ALWAYS_CHOICE,
  APPROVE_CHOICE,
  answerProposal,
  type Decision,
  dispatchActionWakes,
  proposalCardId,
  SEND_CHOICE,
} from './services/action-proposals.js';
import { sendBuildSteer } from './services/builds.js';
import {
  answerChiefQuestion,
  getChiefEnvelope,
  getChiefThread,
  listChiefThreads,
  openProjectChannel,
  retryProjectGreeting,
  rewindChiefThread,
  sendChiefMessageFromComposer,
} from './services/chief.js';
import {
  askQuestionContentOf,
  cancelQuestion,
  proposalIdOfCard,
  publishQuestion,
} from './services/chief-question-store.js';
import { parseAnswerBody } from './services/chief-questions.js';
import { steerChiefMessage, stopChiefTurn, withdrawChiefMessage } from './services/chief-turns.js';
import { latestChiefMemoryUsage } from './services/coordinator-steps.js';
import { sendDesignComments } from './services/design-comments.js';
import { isOwner } from './services/instance-owner.js';
import { chiefIneligibility } from './services/machine-routing.js';
import { isChiefConversation } from './services/machines.js';
import { listMemoryCorrections } from './services/memory-corrections.js';
import { effectiveModel } from './services/model-fallback.js';
import { coordinatorProfile } from './services/routing-rules.js';
import {
  cancelQueuedMessage,
  deliverQueuedMessage,
  editQueuedMessage,
  queueTaskMessage,
} from './services/task-message-queue.js';

function sendFromComposer(
  deps: Parameters<typeof sendDesignComments>[0],
  teamId: string,
  body: ChiefSendMessageBody,
): ReturnType<typeof sendDesignComments> {
  const { designCommentIds, ...rest } = body;
  if (designCommentIds === undefined)
    return Promise.resolve(sendChiefMessageFromComposer(deps, teamId, rest));
  return sendDesignComments(deps, teamId, { ...rest, designCommentIds });
}

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
    const interactive = sameOriginPageWrite(c, ctx.webOrigin, ctx.trustedProxies)
      ? ('page' as const)
      : undefined;
    ctx.logger?.info(
      {
        proposalId,
        decision,
        deviceId,
        interactive: interactive ?? null,
        secFetchSite: c.req.header('sec-fetch-site') ?? null,
        origin: c.req.header('origin') ?? null,
        userAgent: c.req.header('user-agent') ?? null,
      },
      'approval card answered',
    );
    try {
      return answerProposal(svc, {
        proposalId,
        teamId,
        decision,
        decidedBy: deviceId === null ? ctx.user.id : `device:${deviceId}`,
        viaCard: true,
        interactive,
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

  app.get('/api/teams/:id/chief/threads', conditionalGet(), (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(listChiefThreads(svc, teamId));
  });

  app.get('/api/teams/:id/chief/memory-usage', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json({ usage: latestChiefMemoryUsage(ctx.db, teamId) });
  });

  app.get('/api/teams/:id/chief/memory-corrections', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(listMemoryCorrections(ctx.db, teamId));
  });

  app.post('/api/teams/:id/chief/threads', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const raw = (await jsonBody(c)) as {
      content?: unknown;
      projectId?: unknown;
      clientMessageId?: unknown;
      designCommentIds?: unknown;
    };
    const body = parseWith(
      chiefSendMessageBodySchema,
      {
        threadId: null,
        content: raw?.content,
        projectId: raw?.projectId,
        clientMessageId: raw?.clientMessageId,
        designCommentIds: raw?.designCommentIds,
      },
      'body',
    );
    const { result, replayed } = await sendFromComposer(svc, teamId, body);
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

  app.post('/api/teams/:id/chief/threads/:tid/messages/:mid/steer', (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    return c.json(steerChiefMessage(svc, teamId, c.req.param('tid'), c.req.param('mid')));
  });

  app.post('/api/teams/:id/chief/threads/:tid/stop', async (c) => {
    const teamId = c.req.param('id');
    requireTeam(ctx, teamId);
    const body = parseWith(chiefStopBodySchema, (await jsonBody(c)) ?? {}, 'body');
    return c.json(stopChiefTurn(svc, teamId, c.req.param('tid'), body.messageId));
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
      const decision: Decision =
        choice === APPROVE_CHOICE || choice === SEND_CHOICE
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
      designCommentIds?: unknown;
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
        designCommentIds: raw?.designCommentIds,
      },
      'body',
    );
    const { result, replayed } = await sendFromComposer(svc, thread.teamId, body);
    if (!replayed)
      ctx.convHub?.publishMessage(
        conversationId,
        { ...result.message },
        undefined,
        body.clientMessageId,
      );
    return c.json(result, 201);
  });

  const switchChiefMachineBodySchema = z.object({
    machineId: z.string().min(1),
  });

  app.post('/api/chief/steps/:stepId/switch-machine', async (c) => {
    const isOwnerSession =
      (ctx.authToken === null || c.get('ownerIdentity') !== undefined) &&
      isOwner(ctx.db, ctx.user.id);
    if (!isOwnerSession) {
      throw new HttpError(403, 'owner session required');
    }
    const stepId = c.req.param('stepId');
    const stepRow = ctx.db.select().from(step).where(eq(step.id, stepId)).get();
    if (stepRow?.kind !== 'chief') {
      throw notFound(`chief step ${stepId}`);
    }
    const threadRow = ctx.db
      .select()
      .from(chiefThread)
      .where(eq(chiefThread.id, stepRow.buildId))
      .get();
    if (!threadRow) throw notFound(`chief thread ${stepRow.buildId}`);
    requireTeam(ctx, threadRow.teamId);
    if (stepRow.status !== 'pending') {
      throw new HttpError(409, 'step is no longer pending');
    }
    const body = parseWith(switchChiefMachineBodySchema, await jsonBody(c), 'body');
    const target = ctx.db
      .select()
      .from(machine)
      .where(and(eq(machine.id, body.machineId), eq(machine.teamId, threadRow.teamId)))
      .get();
    if (!target || target.retiredAt !== null) {
      throw notFound(`machine ${body.machineId}`);
    }
    if (!target.online) {
      throw new HttpError(409, 'target machine is offline');
    }
    const agentRow = coordinatorProfile(ctx.db, threadRow.teamId, threadRow.projectId);
    if (agentRow !== null && agentRow.modelId != null) {
      const model = effectiveModel(agentRow, stepRow);
      if (chiefIneligibility(ctx.db, target, agentRow, model.provider, nowMs()) !== null) {
        throw new HttpError(409, 'target machine cannot run this step');
      }
    }
    ctx.db
      .update(step)
      .set({
        targetMachineId: target.id,
        routedFromMachineId: stepRow.targetMachineId ?? agentRow?.machineId ?? null,
        routedReason: 'manual-switch',
      })
      .where(and(eq(step.id, stepId), eq(step.status, 'pending')))
      .run();
    ctx.machineHub.wake(threadRow.teamId);
    return c.json({ ok: true as const, machineId: target.id, name: target.name });
  });
}
