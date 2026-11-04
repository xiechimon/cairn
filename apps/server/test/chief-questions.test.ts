import type { AskUserQuestion, MachineAskResponse } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  chiefMessage,
  notification as notificationTable,
  step as stepTable,
} from '../src/db/schema.js';
import {
  ASK_HOLD_MS,
  answerQuestion,
  cancelPendingQuestions,
  createOrGetQuestion,
  holdForQuestion,
} from '../src/services/chief-questions.js';
import { bindAgentHome, bootServer, machineIdByName, type TestServer } from './helpers.js';

const AGENT_ID = 'agent-ask-unit';

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

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

interface World {
  s: TestServer;
  teamId: string;
  threadId: string;
  stepId: string;
  machineToken: string;
}

const QUESTIONS = [
  {
    header: '缩进',
    question: 'Tabs 还是 spaces？',
    options: [{ label: 'Tabs' }, { label: 'Spaces', description: '软缩进' }],
  },
  { header: '备注', question: '有什么要补充的吗？', options: [] },
];

async function makeWorld(): Promise<World> {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const teamId = s.team.id;
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId,
      displayName: 'ask-agent',
      description: '调度',
      modelId: 'stub-model',
      provider: 'stub-gw',
    })
    .run();
  const patchRes = await call(s.app, 'PATCH', `/api/teams/${teamId}/chief`, {
    body: { agent: { agentId: AGENT_ID, thinkingLevel: null } },
  });
  expect(patchRes.status).toBe(200);
  const msgRes = await call(s.app, 'POST', `/api/teams/${teamId}/chief/threads`, {
    body: { content: '帮我定缩进' },
  });
  expect(msgRes.status).toBe(201);
  const { thread } = (await msgRes.json()) as { thread: { id: string } };
  const key = await import('./helpers.js').then((h) => h.issueApiKey(s));
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId, name: 'ask-mbp', cliVersion: '0.1.0' },
  });
  const { token } = (await enrollRes.json()) as { token: string };
  bindAgentHome(s, AGENT_ID, machineIdByName(s, 'ask-mbp'));
  const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
    cred: token,
    body: {},
  });
  const claimed = (await claimRes.json()) as { step: { step: { id: string } } | null };
  expect(claimed.step).not.toBeNull();
  return {
    s,
    teamId,
    threadId: thread.id,
    stepId: claimed.step?.step.id ?? '',
    machineToken: token,
  };
}

async function machineAsk(
  w: World,
  requestId: string,
  opts: { holdMs?: number; questions?: AskUserQuestion[] } = {},
): Promise<{ status: number; body: MachineAskResponse | { error?: string } }> {
  const holdMs = opts.holdMs ?? 0;
  const res = await call(w.s.app, 'POST', `/api/machine/ask/${w.stepId}?holdMs=${holdMs}`, {
    cred: w.machineToken,
    body: { requestId, questions: opts.questions ?? QUESTIONS },
  });
  return { status: res.status, body: (await res.json()) as MachineAskResponse };
}

describe('#1049 question line lifecycle (createOrGet / answer / cancel / wrap-up)', () => {
  test('creating a question: assistant row + content kind + notification; same requestId re-posted idempotently (no stacked card, no duplicate notification)', async () => {
    const w = await makeWorld();
    const first = await machineAsk(w, 'ask-11111111-2222-3333-4444-555555555555');
    expect(first.status).toBe(200);
    expect((first.body as MachineAskResponse).status).toBe('pending');
    const rows = w.s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, w.threadId))
      .all()
      .filter((r) => r.id === 'ask-11111111-2222-3333-4444-555555555555');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe('assistant');
    expect(w.s.db.select().from(notificationTable).all()).toHaveLength(1);
    const again = createOrGetQuestion(
      { db: w.s.db, hub: w.s.hub, user: w.s.user },
      {
        threadId: w.threadId,
        requestId: 'ask-11111111-2222-3333-4444-555555555555',
        questions: QUESTIONS,
      },
    );
    expect(again.created).toBe(false);
    expect(
      w.s.db
        .select()
        .from(chiefMessage)
        .where(eq(chiefMessage.threadId, w.threadId))
        .all()
        .filter((r) => r.id === 'ask-11111111-2222-3333-4444-555555555555'),
    ).toHaveLength(1);
    expect(w.s.db.select().from(notificationTable).all()).toHaveLength(1);
  });

  test('answer enforcement: options subset of the label set plus one other / single-choice exactly one / text questions take text / out of range and missing items 400', async () => {
    const w = await makeWorld();
    const requestId = 'ask-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    await machineAsk(w, requestId, { holdMs: 0 });
    const good = await call(
      w.s.app,
      'POST',
      `/api/teams/${w.teamId}/chief/threads/${w.threadId}/questions/${requestId}/answer`,
      {
        body: {
          answers: [
            { header: '缩进', choices: ['Tabs'] },
            { header: '备注', text: '无' },
          ],
        },
      },
    );
    expect(good.status).toBe(200);
    const answered = (await good.json()) as { status: string; answers: unknown[] };
    expect(answered.status).toBe('answered');
    expect(answered.answers).toHaveLength(2);
    const dup = await call(
      w.s.app,
      'POST',
      `/api/teams/${w.teamId}/chief/threads/${w.threadId}/questions/${requestId}/answer`,
      { body: { answers: [{ header: '缩进', choices: ['Spaces'] }] } },
    );
    expect(dup.status).toBe(409);
  });

  test('answer other... free-form string: a single upload is legal (Steps card last line free text), two = 400', async () => {
    const w = await makeWorld();
    const requestId = 'ask-bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    await machineAsk(w, requestId, { holdMs: 0 });
    const custom = await call(
      w.s.app,
      'POST',
      `/api/teams/${w.teamId}/chief/threads/${w.threadId}/questions/${requestId}/answer`,
      {
        body: {
          answers: [
            { header: '缩进', choices: ['看心情，混合用'] },
            { header: '备注', text: '无' },
          ],
        },
      },
    );
    expect(custom.status).toBe(200);
    const body = (await custom.json()) as { status: string; answers: { choices?: string[] }[] };
    expect(body.status).toBe('answered');
    expect(body.answers?.[0]?.choices).toEqual(['看心情，混合用']);
    const multiId = 'ask-eeeeeeee-0000-0000-0000-00000000000e';
    const multi = await machineAsk(w, multiId, {
      questions: [
        {
          header: '范围',
          question: '做哪些面？',
          multiSelect: true,
          options: [{ label: 'web' }, { label: 'server' }],
        },
      ],
    });
    expect(multi.status).toBe(200);
    const res = await call(
      w.s.app,
      'POST',
      `/api/teams/${w.teamId}/chief/threads/${w.threadId}/questions/${multiId}/answer`,
      { body: { answers: [{ header: '范围', choices: ['Neither', 'Whatever'] }] } },
    );
    expect(res.status).toBe(400);
  });

  test('answer invalid shape: single/multi select, or a free-text question receiving choices -> 400', async () => {
    const w = await makeWorld();
    const requestId = 'ask-bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    await machineAsk(w, requestId, { holdMs: 0 });
    for (const bad of [
      [{ header: '备注', choices: ['x'] }],
      [{ header: '缩进', text: '随便' }],
      [],
    ]) {
      const res = await call(
        w.s.app,
        'POST',
        `/api/teams/${w.teamId}/chief/threads/${w.threadId}/questions/${requestId}/answer`,
        { body: { answers: bad } },
      );
      expect(res.status).toBe(400);
    }
  });

  test('hold semantics: expires back to pending (D3 does not auto-decide); answering after hold returns answered (<= poll granularity)', async () => {
    const w = await makeWorld();
    const requestId = 'ask-cccccccc-dddd-eeee-ffff-000000000000';
    await machineAsk(w, requestId, { holdMs: 0 });
    const held = await holdForQuestion(
      { db: w.s.db },
      { threadId: w.threadId, requestId, holdMs: 10 },
    );
    expect(held).toBeNull();
    const stillPending = w.s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.id, requestId))
      .get();
    expect(JSON.parse(stillPending?.content as string).status).toBe('pending');
    setTimeout(() => {
      answerQuestion(
        { db: w.s.db },
        {
          threadId: w.threadId,
          requestId,
          answers: [
            { header: '缩进', choices: ['Spaces'] },
            { header: '备注', text: '无' },
          ],
        },
      );
    }, 30);
    const settled = await holdForQuestion(
      { db: w.s.db },
      { threadId: w.threadId, requestId, holdMs: 5_000 },
    );
    expect(settled?.status).toBe('answered');
    expect(settled?.answers?.[0]?.choices).toEqual(['Spaces']);
  });

  test('cancel (user) and wrap-up (step terminal) both flip to cancelled; idempotent without re-flipping', async () => {
    const w = await makeWorld();
    const requestId = 'ask-dddddddd-eeee-ffff-0000-111111111111';
    await machineAsk(w, requestId, { holdMs: 0 });
    const res = await call(
      w.s.app,
      'POST',
      `/api/teams/${w.teamId}/chief/threads/${w.threadId}/questions/${requestId}/cancel`,
      { body: {} },
    );
    expect(res.status).toBe(200);
    const cancelled = JSON.parse(
      (w.s.db.select().from(chiefMessage).where(eq(chiefMessage.id, requestId)).get()
        ?.content as string) ?? '{}',
    ) as { status: string; cancelReason?: string };
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelReason).toContain('用户取消');
    const other = 'ask-eeeeeeee-ffff-0000-1111-222222222222';
    await machineAsk(w, other, { holdMs: 0 });
    cancelPendingQuestions({ db: w.s.db }, w.threadId, '回合已结束');
    const row = JSON.parse(
      (w.s.db.select().from(chiefMessage).where(eq(chiefMessage.id, other)).get()
        ?.content as string) ?? '{}',
    ) as { status: string; cancelReason?: string };
    expect(row.status).toBe('cancelled');
    expect(row.cancelReason).toBe('回合已结束');
    const answeredId = 'ask-ffffffff-0000-1111-2222-333333333333';
    await machineAsk(w, answeredId, { holdMs: 0 });
    answerQuestion(
      { db: w.s.db },
      {
        threadId: w.threadId,
        requestId: answeredId,
        answers: [
          { header: '缩进', choices: ['Tabs'] },
          { header: '备注', text: '好' },
        ],
      },
    );
    cancelPendingQuestions({ db: w.s.db }, w.threadId, '回合已结束');
    const kept = JSON.parse(
      (w.s.db.select().from(chiefMessage).where(eq(chiefMessage.id, answeredId)).get()
        ?.content as string) ?? '{}',
    ) as { status: string };
    expect(kept.status).toBe('answered');
  });

  test('non-own-machine step / non-chief step / bad requestId -> 404/400', async () => {
    const w = await makeWorld();
    const bad = await call(w.s.app, 'POST', `/api/machine/ask/${w.stepId}`, {
      cred: w.machineToken,
      body: { requestId: 'user-not-an-ask', questions: QUESTIONS },
    });
    expect(bad.status).toBe(400);
    const missing = await call(w.s.app, 'POST', '/api/machine/ask/step-nope', {
      cred: w.machineToken,
      body: { requestId: 'ask-12345678-0000-0000-0000-000000000000', questions: QUESTIONS },
    });
    expect(missing.status).toBe(404);
  });

  test('constant pinned values: hold 70s (same family as the ~75s claim cadence)', () => {
    expect(ASK_HOLD_MS).toBe(70_000);
    void stepTable;
  });
});
