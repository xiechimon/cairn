import type { ClaimedStep } from '@cairn/shared';
import {
  ASK_USER_QUESTION_KIND,
  CHIEF_NOTICE_KIND,
  chiefNoticeContentSchema,
  claimedStepSchema,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test, vi } from 'vitest';
import webpush from 'web-push';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  chiefMessage,
  notification as notificationTable,
  step as stepTable,
} from '../src/db/schema.js';
import {
  enqueueChiefStep,
  fireDueChiefWakes,
  setChiefWake,
  turnProvenance,
  wakeProvenance,
  watchProvenance,
} from '../src/services/chief.js';
import { bootServer, issueApiKey, machineIdByName, seedRoute, type TestServer } from './helpers.js';
import { seedOwnerMessage } from './owner-message.js';

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
  claim(): Promise<ClaimedStep>;
  done(stepId: string, text: string): Promise<void>;
  tool(stepId: string, name: string, params: Record<string, unknown>): Promise<Response>;
  ask(stepId: string, body: Record<string, unknown>): Promise<Response>;
  wake(provenance: string): void;
  userTurn(prompt: string): void;
}

async function setup(): Promise<World> {
  const s = bootServer({ claimHoldMs: 200 });
  disposables.push(() => s.dispose());
  const teamId = s.team.id;
  const key = await issueApiKey(s);
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: readyMachine({ teamId, name: 'quiet-mbp', cliVersion: '0.1.0' }),
  });
  const { token } = (await enrollRes.json()) as { token: string };
  seedRoute(s, 'coordinator', {
    provider: 'stub-gw',
    modelId: 'stub-model',
    machineId: machineIdByName(s, 'quiet-mbp'),
  });
  const msgRes = await call(s.app, 'POST', `/api/teams/${teamId}/chief/threads`, {
    body: { content: '帮我看看' },
  });
  const { thread } = (await msgRes.json()) as { thread: { id: string } };
  const world: World = {
    s,
    teamId,
    threadId: thread.id,
    async claim() {
      const res = await call(s.app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
      const body = (await res.json()) as { step: ClaimedStep | null };
      if (!body.step) throw new Error('no chief step claimed');
      return claimedStepSchema.parse(body.step);
    },
    async done(stepId, text) {
      const urlsRes = await call(s.app, 'POST', `/api/machine/upload-urls/${stepId}`, {
        cred: token,
        body: { files: [{ name: 'transcript.json' }] },
      });
      const { uploads } = (await urlsRes.json()) as { uploads: { name: string; url: string }[] };
      const uploadId = uploads
        .find((u) => u.name === 'transcript.json')
        ?.url.split('/')
        .pop();
      await call(s.app, 'PUT', `/api/machine/upload/${uploadId}`, {
        cred: token,
        body: {
          stepId,
          messages: [
            { id: `asst-${stepId}`, role: 'assistant', content: text, createdAt: Date.now() },
          ],
        },
      });
      const doneRes = await call(s.app, 'POST', `/api/machine/done/${stepId}`, {
        cred: token,
        body: { status: 'success', sessionId: `sess-${stepId}` },
      });
      expect(doneRes.status).toBe(200);
    },
    tool(stepId, name, params) {
      return call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
        cred: token,
        body: { name, params },
      });
    },
    ask(stepId, body) {
      return call(s.app, 'POST', `/api/machine/ask/${stepId}?holdMs=0`, { cred: token, body });
    },
    userTurn(prompt) {
      const ownerMessageId = seedOwnerMessage(s.db, thread.id, prompt);
      const id = enqueueChiefStep(
        { db: s.db, hub: s.hub, machineHub: s.machineHub, user: s.user },
        thread.id,
        { prompt, trigger: 'user', ownerMessageIds: [ownerMessageId] },
      );
      expect(
        s.db.select().from(stepTable).where(eq(stepTable.id, id)).get()?.ownerMessageIds,
      ).toEqual([ownerMessageId]);
    },
    wake(provenance) {
      enqueueChiefStep(
        { db: s.db, hub: s.hub, machineHub: s.machineHub, user: s.user },
        thread.id,
        { prompt: '任务 #1 运行失败。', trigger: 'failed', provenance, ownerMessageIds: [] },
      );
    },
  };
  const first = await world.claim();
  await world.done(first.step.id, '好的。');
  s.db.delete(notificationTable).run();
  return world;
}

function chiefNotif(w: World) {
  return w.s.db
    .select()
    .from(notificationTable)
    .where(eq(notificationTable.entityId, w.threadId))
    .get();
}

function notices(w: World) {
  return w.s.db
    .select()
    .from(chiefMessage)
    .where(and(eq(chiefMessage.threadId, w.threadId), eq(chiefMessage.role, 'system')))
    .all()
    .flatMap((row) => {
      const parsed = chiefNoticeContentSchema.safeParse(
        typeof row.content === 'string' ? JSON.parse(row.content) : row.content,
      );
      return parsed.success ? [parsed.data] : [];
    });
}

const QUESTION = {
  header: '下一步',
  question: '重试还是换 Runner？',
  options: [{ label: '重试' }, { label: '换 Runner' }],
};

describe('quiet by default for event-triggered Coordinator turns (#1784)', () => {
  test('ordinary text of an event turn creates no notification', async () => {
    const w = await setup();
    w.wake(watchProvenance('todo-a'));
    const wake = await w.claim();
    await w.done(wake.step.id, '我核实了一下，环境正常。');
    expect(chiefNotif(w)).toBeUndefined();
  });

  test('a user turn still notifies with its final text', async () => {
    const w = await setup();
    w.userTurn('还有一件事');
    const turn = await w.claim();
    await w.done(turn.step.id, '已处理。');
    expect(chiefNotif(w)?.snippet).toBe('已处理。');
  });

  test('every wake prompt names its provenance on the marker line', async () => {
    const w = await setup();
    const deps = { db: w.s.db, hub: w.s.hub, machineHub: w.s.machineHub, user: w.s.user };
    const wake = setChiefWake(deps, w.teamId, { at: 1, threadId: w.threadId });
    fireDueChiefWakes(deps, 2);
    const prompts = w.s.db
      .select({ prompt: stepTable.prompt })
      .from(stepTable)
      .where(eq(stepTable.buildId, w.threadId))
      .all()
      .map((row) => row.prompt);
    expect(turnProvenance(prompts.at(-1) ?? null)).toBe(wakeProvenance(String(wake.id)));
  });

  test('notify_user in an event turn without provenance is rejected and reaches no one', async () => {
    const w = await setup();
    w.wake(watchProvenance('todo-a'));
    const wake = await w.claim();
    const res = await w.tool(wake.step.id, 'notify_user', { message: '失败了' });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('watch:todo-a');
    expect(chiefNotif(w)).toBeUndefined();
    expect(notices(w)).toEqual([]);
  });

  test('notify_user citing another source is rejected', async () => {
    const w = await setup();
    w.wake(watchProvenance('todo-a'));
    const wake = await w.claim();
    for (const provenance of ['user', watchProvenance('todo-b'), 'watch:todo-a extra']) {
      const res = await w.tool(wake.step.id, 'notify_user', { message: '失败了', provenance });
      expect(res.status).toBe(400);
    }
    expect(chiefNotif(w)).toBeUndefined();
  });

  test('notify_user with the turn provenance notifies and posts a notice into the conversation', async () => {
    const w = await setup();
    w.wake(watchProvenance('todo-a'));
    const wake = await w.claim();
    const res = await w.tool(wake.step.id, 'notify_user', {
      message: '#1 失败两次，需要你给它换台 Runner',
      provenance: watchProvenance('todo-a'),
    });
    expect(res.status).toBe(200);
    expect(chiefNotif(w)?.snippet).toBe('#1 失败两次，需要你给它换台 Runner');
    expect(notices(w)).toEqual([
      {
        kind: CHIEF_NOTICE_KIND,
        message: '#1 失败两次，需要你给它换台 Runner',
        provenance: watchProvenance('todo-a'),
      },
    ]);
  });

  test('notify_user in a user turn needs no provenance and records the user as source', async () => {
    const w = await setup();
    w.userTurn('完成后提醒我');
    const turn = await w.claim();
    const res = await w.tool(turn.step.id, 'notify_user', { message: '记下了' });
    expect(res.status).toBe(200);
    expect(notices(w).map((n) => n.provenance)).toEqual(['user']);
  });

  test('ask_user over the relay and the blocking channel both require the turn provenance', async () => {
    const w = await setup();
    w.wake(watchProvenance('todo-a'));
    const wake = await w.claim();
    const relayRes = await w.tool(wake.step.id, 'ask_user', { questions: [QUESTION] });
    expect(relayRes.status).toBe(400);
    const askRes = await w.ask(wake.step.id, {
      requestId: 'ask-00000000-0001',
      questions: [QUESTION],
    });
    expect(askRes.status).toBe(400);
    const asked = await w.ask(wake.step.id, {
      requestId: 'ask-00000000-0002',
      questions: [QUESTION],
      provenance: watchProvenance('todo-a'),
    });
    expect(asked.status).toBe(200);
    const cards = w.s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, w.threadId))
      .all()
      .map((row) => (typeof row.content === 'string' ? row.content : JSON.stringify(row.content)))
      .filter((text) => text.includes(ASK_USER_QUESTION_KIND))
      .map((text) => JSON.parse(text) as { requestId: string; provenance?: string });
    expect(cards).toEqual([
      expect.objectContaining({
        requestId: 'ask-00000000-0002',
        provenance: watchProvenance('todo-a'),
      }),
    ]);
  });

  test('answering a pending card with its recommended option resumes the thread and fires nothing else', async () => {
    const w = await setup();
    w.wake(watchProvenance('todo-a'));
    const wake = await w.claim();
    const asked = await w.ask(wake.step.id, {
      requestId: 'ask-00000000-0003',
      questions: [
        {
          ...QUESTION,
          options: [{ label: '重试' }, { label: '换 Runner', recommended: true }],
        },
      ],
      provenance: watchProvenance('todo-a'),
    });
    expect(asked.status).toBe(200);
    const card = w.s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.id, 'ask-00000000-0003'))
      .get();
    const parked = { ...JSON.parse(String(card?.content)), parkedAt: Date.now() };
    expect(parked.questions[0].options[1]).toEqual({ label: '换 Runner', recommended: true });
    w.s.db
      .update(chiefMessage)
      .set({ content: JSON.stringify(parked) })
      .where(eq(chiefMessage.id, 'ask-00000000-0003'))
      .run();
    await w.done(wake.step.id, '已经问了用户。');
    const notificationsBefore = w.s.db.select().from(notificationTable).all();
    const send = vi.spyOn(webpush, 'sendNotification');
    const answer = await call(
      w.s.app,
      'POST',
      `/api/teams/${w.teamId}/chief/threads/${w.threadId}/questions/ask-00000000-0003/answer`,
      { body: { answers: [{ header: '下一步', choices: ['换 Runner'] }] } },
    );
    expect(answer.status).toBe(200);
    const resumed = w.s.db
      .select({ prompt: stepTable.prompt })
      .from(stepTable)
      .where(and(eq(stepTable.buildId, w.threadId), eq(stepTable.status, 'pending')))
      .all();
    expect(resumed).toHaveLength(1);
    expect(resumed[0]?.prompt ?? '').not.toMatch(/^\[wake:/);
    expect(resumed[0]?.prompt).toContain('换 Runner');
    expect(send).not.toHaveBeenCalled();
    expect(w.s.db.select().from(notificationTable).all()).toEqual(notificationsBefore);
    send.mockRestore();
  });
});
