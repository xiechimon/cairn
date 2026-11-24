import { askUserQuestionContentSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { createCoordinatorServerApi } from '../src/coordinator/server-api.js';
import {
  chiefMessage,
  machine as machineTable,
  routingRule,
  step as stepTable,
  stopPending,
} from '../src/db/schema.js';
import { sweepAbandonedChiefSteps } from '../src/services/chief.js';
import { createOrGetQuestion } from '../src/services/chief-questions.js';
import {
  CHIEF_TURN_MAX_MS,
  CHIEF_TURN_STOP_GRACE_MS,
  sweepOverlongChiefTurns,
} from '../src/services/chief-turns.js';
import { claimPendingChiefStep } from '../src/services/coordinator-steps.js';
import { CHIEF_ABANDONED_STEP_MS } from '../src/services/turn-provenance.js';
import { AGENT_ID, H, registerChiefHarness } from './chief-harness.js';
import { claimedGeneration, issueApiKey, req } from './helpers.js';

registerChiefHarness();

function stepRow(id: string) {
  return H.s.db.select().from(stepTable).where(eq(stepTable.id, id)).get()!;
}

function setStep(id: string, set: Partial<typeof stepTable.$inferInsert>) {
  H.s.db.update(stepTable).set(set).where(eq(stepTable.id, id)).run();
}

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

async function send(content: string): Promise<string> {
  const res = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/chief/threads`, { content });
  expect(res.status).toBe(201);
  return ((await res.json()) as { message: { id: string } }).message.id;
}

async function enrollDaemon(): Promise<{ machineId: string; token: string }> {
  const key = await issueApiKey(H.s);
  const res = await call(H.s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: readyMachine({ teamId: H.teamId, name: 'stubborn-mbp', cliVersion: '0.9.9' }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { machineId: string; token: string };
  H.s.db
    .update(machineTable)
    .set({ online: true })
    .where(eq(machineTable.id, body.machineId))
    .run();
  H.s.db
    .update(routingRule)
    .set({ machineId: body.machineId })
    .where(eq(routingRule.id, AGENT_ID))
    .run();
  return body;
}

async function claimOnDaemon(token: string): Promise<string> {
  const res = await call(H.s.app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
  expect(res.status).toBe(200);
  const claimed = ((await res.json()) as { step: { step: { id: string } } | null }).step;
  expect(claimed).not.toBeNull();
  return claimed!.step.id;
}

function seedPendingQuestion(requestId: string): void {
  const { created } = createOrGetQuestion(
    { db: H.s.db, hub: H.s.hub, convHub: H.s.convHub, user: H.s.user },
    {
      threadId: H.threadId,
      requestId,
      questions: [{ header: 'pick', question: 'which?', options: [] }],
      askedFor: [],
    },
  );
  expect(created).toBe(true);
}

function questionStatus(requestId: string): string | undefined {
  const row = H.s.db.select().from(chiefMessage).where(eq(chiefMessage.id, requestId)).get();
  return askUserQuestionContentSchema.safeParse(JSON.parse(row?.content as string)).data?.status;
}

describe('a pending ask_user card closes when its chief turn ends (#5400)', () => {
  test('in-server finish cancels the card', async () => {
    const stepId = await send('ask me something');
    expect(claimPendingChiefStep(H.s.db, stepRow(stepId), { machineId: null })?.status).toBe(
      'claimed',
    );
    seedPendingQuestion('ask-inserver01');
    const api = createCoordinatorServerApi({
      db: H.s.db,
      hub: H.s.hub,
      machineHub: H.s.machineHub,
      box: H.s.secretBox,
      user: H.s.user,
      reposDir: H.s.reposDir,
      attachmentsDir: H.s.attachmentsDir,
      skillsDir: H.s.skillsDir,
      convHub: H.s.convHub,
    });
    await api.done(stepId, { status: 'success' });
    expect(stepRow(stepId).status).toBe('done');
    expect(questionStatus('ask-inserver01')).toBe('cancelled');
  });

  test('daemon finish cancels the card', async () => {
    const { token } = await enrollDaemon();
    const stepId = await send('ask me something');
    expect(await claimOnDaemon(token)).toBe(stepId);
    seedPendingQuestion('ask-daemonfin1');
    const done = await call(H.s.app, 'POST', `/api/machine/done/${stepId}`, {
      cred: token,
      body: { status: 'success', generation: claimedGeneration(H.s.db, stepId) },
    });
    expect(done.status).toBe(200);
    expect(stepRow(stepId).status).toBe('done');
    expect(questionStatus('ask-daemonfin1')).toBe('cancelled');
  });

  test('force-stop of a lost turn cancels the card', async () => {
    const { token } = await enrollDaemon();
    const stepId = await send('ask me something');
    expect(await claimOnDaemon(token)).toBe(stepId);
    seedPendingQuestion('ask-forcestop1');
    setStep(stepId, { lastHeartbeatAt: Date.now() - CHIEF_ABANDONED_STEP_MS - 1 });
    const res = await req(
      H.s.app,
      'POST',
      `/api/teams/${H.teamId}/chief/threads/${H.threadId}/stop`,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { delegated: boolean }).delegated).toBe(false);
    expect(stepRow(stepId).status).toBe('stopped');
    expect(questionStatus('ask-forcestop1')).toBe('cancelled');
  });

  test('the stop bound cancels the card when the executor ignores the stop', async () => {
    const { token } = await enrollDaemon();
    const stepId = await send('ask me something');
    expect(await claimOnDaemon(token)).toBe(stepId);
    seedPendingQuestion('ask-stopbound1');
    const t0 = Date.now();
    setStep(stepId, { claimedAt: t0 - CHIEF_TURN_MAX_MS - 1, lastHeartbeatAt: t0 });
    sweepOverlongChiefTurns(H.s.svc, t0);
    expect(
      H.s.db
        .select()
        .from(stopPending)
        .all()
        .map((r) => r.stepId),
    ).toEqual([stepId]);
    expect(stepRow(stepId).status).toBe('claimed');
    setStep(stepId, { lastHeartbeatAt: t0 + CHIEF_TURN_STOP_GRACE_MS });
    sweepOverlongChiefTurns(H.s.svc, t0 + CHIEF_TURN_STOP_GRACE_MS + 1);
    expect(stepRow(stepId).status).toBe('stopped');
    expect(questionStatus('ask-stopbound1')).toBe('cancelled');
  });

  test('a superseded attempt cancels the card when the claim is released', async () => {
    const { machineId, token } = await enrollDaemon();
    const stepId = await send('ask me something');
    expect(await claimOnDaemon(token)).toBe(stepId);
    seedPendingQuestion('ask-supersede1');
    const now = Date.now();
    setStep(stepId, { lastHeartbeatAt: now - CHIEF_ABANDONED_STEP_MS - 1 });
    H.s.db.update(machineTable).set({ online: false }).where(eq(machineTable.id, machineId)).run();
    sweepAbandonedChiefSteps(H.s.svc, now);
    expect(stepRow(stepId).status).toBe('pending');
    expect(stepRow(stepId).machineId).toBeNull();
    expect(questionStatus('ask-supersede1')).toBe('cancelled');
  });
});
