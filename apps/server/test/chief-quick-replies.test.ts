import type { ClaimedStep, QuickRepliesRow } from '@cairn/shared';
import {
  claimedStepSchema,
  liveQuickReplies,
  QUICK_REPLIES_KIND,
  quickRepliesContentSchema,
  quickRepliesRowId,
  SUGGEST_REPLIES_TOOL_NAME,
  transcriptPromptRowId,
} from '@cairn/shared';
import { and, eq, like } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';
import { chiefMessage } from '../src/db/schema.js';
import { buildChiefSystemPrompt, enqueueChiefStep } from '../src/services/chief.js';
import { chiefRemoteTools } from '../src/services/routing-rules.js';
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
  threadId: string;
  claim(): Promise<ClaimedStep>;
  done(stepId: string, text: string, prompt?: string): Promise<void>;
  tool(stepId: string, params: Record<string, unknown>, name?: string): Promise<Response>;
  userTurn(prompt: string): void;
  wake(): void;
  page(): Promise<{ messages: QuickRepliesRow[]; activeRun: unknown }>;
  streamed: object[];
}

async function setup(): Promise<World> {
  const s = bootServer({ claimHoldMs: 200 });
  disposables.push(() => s.dispose());
  const teamId = s.team.id;
  const key = await issueApiKey(s);
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId, name: 'quick-mbp', cliVersion: '0.1.0' },
  });
  const { token } = (await enrollRes.json()) as { token: string };
  seedRoute(s, 'coordinator', {
    provider: 'stub-gw',
    modelId: 'stub-model',
    machineId: machineIdByName(s, 'quick-mbp'),
  });
  const msgRes = await call(s.app, 'POST', `/api/teams/${teamId}/chief/threads`, {
    body: { content: '帮我看看' },
  });
  const { thread } = (await msgRes.json()) as { thread: { id: string } };
  const streamed: object[] = [];
  s.convHub.subscribe(thread.id, {
    nextSeq: () => 1,
    send: (payload: object) => {
      streamed.push(payload);
      return Promise.resolve();
    },
  });
  const deps = { db: s.db, hub: s.hub, machineHub: s.machineHub, user: s.user };
  const world: World = {
    s,
    threadId: thread.id,
    streamed,
    async claim() {
      const res = await call(s.app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
      const body = (await res.json()) as { step: ClaimedStep | null };
      if (!body.step) throw new Error('no chief step claimed');
      return claimedStepSchema.parse(body.step);
    },
    async done(stepId, text, prompt) {
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
            ...(prompt === undefined
              ? []
              : [
                  {
                    id: transcriptPromptRowId(stepId),
                    role: 'user',
                    content: prompt,
                    createdAt: Date.now(),
                  },
                ]),
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
    tool(stepId, params, name = SUGGEST_REPLIES_TOOL_NAME) {
      return call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
        cred: token,
        body: { name, params },
      });
    },
    userTurn(prompt) {
      const ownerMessageId = seedOwnerMessage(s.db, thread.id, prompt);
      enqueueChiefStep(deps, thread.id, {
        prompt,
        trigger: 'user',
        ownerMessageIds: [ownerMessageId],
      });
    },
    wake() {
      enqueueChiefStep(deps, thread.id, {
        prompt: '任务 #1 运行失败。',
        trigger: 'failed',
        provenance: 'watch:todo-a',
        ownerMessageIds: [],
      });
    },
    async page() {
      const res = await call(s.app, 'GET', `/api/conversations/${thread.id}/messages`);
      expect(res.status).toBe(200);
      return (await res.json()) as { messages: QuickRepliesRow[]; activeRun: unknown };
    },
  };
  const first = await world.claim();
  await world.done(first.step.id, '好的。');
  return world;
}

function quickRows(w: World) {
  return w.s.db
    .select()
    .from(chiefMessage)
    .where(and(eq(chiefMessage.threadId, w.threadId), like(chiefMessage.id, 'quick-replies-%')))
    .all();
}

async function visible(w: World): Promise<string[]> {
  const page = await w.page();
  return liveQuickReplies(page.messages, { running: page.activeRun != null });
}

describe('suggest_replies (Coordinator quick replies)', () => {
  test('is offered to the Coordinator and named in its working rules', async () => {
    const w = await setup();
    expect(chiefRemoteTools().map((t) => t.name)).toContain(SUGGEST_REPLIES_TOOL_NAME);
    w.userTurn('再看一下');
    const turn = await w.claim();
    expect(JSON.stringify(turn)).toContain(SUGGEST_REPLIES_TOOL_NAME);
    const prompt = buildChiefSystemPrompt(
      { db: w.s.db, hub: w.s.hub, user: w.s.user, skillsDir: w.s.skillsDir },
      w.s.team.id,
      w.threadId,
    );
    expect(prompt.text).toContain('suggest_replies');
  });

  test('stores the sanitised set on one row for the turn, streams it and delivers it in the page', async () => {
    const w = await setup();
    w.userTurn('帮我看一遍这个仓库');
    const turn = await w.claim();
    const res = await w.tool(turn.step.id, {
      replies: [' 好，等你汇报\n', '**先只看**\n`README`', '好，等你汇报'],
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(((await res.json()) as { text: string }).text)).toEqual({
      shown: ['好，等你汇报', '先只看 README'],
    });
    const rows = quickRows(w);
    expect(rows.map((r) => r.id)).toEqual([quickRepliesRowId(turn.step.id)]);
    expect(rows[0]?.role).toBe('system');
    expect(quickRepliesContentSchema.parse(JSON.parse(String(rows[0]?.content)))).toEqual({
      kind: QUICK_REPLIES_KIND,
      stepId: turn.step.id,
      replies: ['好，等你汇报', '先只看 README'],
    });
    expect(JSON.stringify(w.streamed)).toContain(quickRepliesRowId(turn.step.id));
    const page = await w.page();
    expect(page.messages.map((m) => m.id)).toContain(quickRepliesRowId(turn.step.id));
  });

  test('a second call in the same turn replaces the first set', async () => {
    const w = await setup();
    w.userTurn('下一步？');
    const turn = await w.claim();
    expect((await w.tool(turn.step.id, { replies: ['甲'] })).status).toBe(200);
    expect((await w.tool(turn.step.id, { replies: ['乙', '丙'] })).status).toBe(200);
    const rows = quickRows(w);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(String(rows[0]?.content)).replies).toEqual(['乙', '丙']);
  });

  test('rejects over-cap, non-string and empty sets and writes nothing', async () => {
    const w = await setup();
    w.userTurn('下一步？');
    const turn = await w.claim();
    for (const replies of [
      ['a', 'b', 'c', 'd'],
      ['字'.repeat(41)],
      ['ok', 1],
      ['  ', '**'],
      'yes',
    ]) {
      const res = await w.tool(turn.step.id, { replies });
      expect(res.status, JSON.stringify(replies)).toBe(400);
      expect(await res.text()).toContain(SUGGEST_REPLIES_TOOL_NAME);
    }
    expect(quickRows(w)).toEqual([]);
  });

  test('is refused in event turns', async () => {
    const w = await setup();
    w.wake();
    const turn = await w.claim();
    const res = await w.tool(turn.step.id, { replies: ['重试'] });
    expect(res.status).toBe(400);
    expect(quickRows(w)).toEqual([]);
  });

  test('lifecycle: hidden while running, shown on the idle latest reply, hidden after the owner sends', async () => {
    const w = await setup();
    w.userTurn('帮我看一遍这个仓库');
    const turn = await w.claim();
    expect((await w.tool(turn.step.id, { replies: ['好，等你汇报'] })).status).toBe(200);
    expect(await visible(w)).toEqual([]);
    await w.done(turn.step.id, '读完后我会汇报，要先只看 README 吗？');
    expect(await visible(w)).toEqual(['好，等你汇报']);
    const send = await call(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
      body: { content: '好，等你汇报', clientMessageId: 'chip-1' },
    });
    expect(send.status).toBeLessThan(300);
    expect(await visible(w)).toEqual([]);
  });

  test('lifecycle: hidden when a new event turn starts after it', async () => {
    const w = await setup();
    w.userTurn('看一下');
    const turn = await w.claim();
    expect((await w.tool(turn.step.id, { replies: ['继续'] })).status).toBe(200);
    await w.done(turn.step.id, '要继续吗？');
    expect(await visible(w)).toEqual(['继续']);
    w.wake();
    const wake = await w.claim();
    expect(await visible(w)).toEqual([]);
    await w.done(
      wake.step.id,
      '核实过了。',
      '[wake:failed] provenance=watch:todo-a\n任务 #1 运行失败。',
    );
    expect(await visible(w)).toEqual([]);
  });

  test('lifecycle: a pending question hides the chips', async () => {
    const w = await setup();
    w.userTurn('看一下');
    const turn = await w.claim();
    expect((await w.tool(turn.step.id, { replies: ['继续'] })).status).toBe(200);
    const ask = await w.tool(
      turn.step.id,
      { questions: [{ header: '下一步', question: '先做哪个？', options: [{ label: '甲' }] }] },
      'ask_user',
    );
    expect(ask.status).toBe(200);
    const page = await w.page();
    expect(liveQuickReplies(page.messages, { running: false })).toEqual([]);
    const withoutQuestion = page.messages.filter(
      (m) => !String(JSON.stringify(m.content)).includes('ask_user_question'),
    );
    const answered = [
      ...withoutQuestion,
      { id: 'a-late', role: 'assistant', content: [{ type: 'text', text: '先做哪个？' }] },
    ];
    expect(liveQuickReplies(answered, { running: false })).toEqual(['继续']);
  });

  test('old conversations without the row keep their shape and show no chips', async () => {
    const w = await setup();
    const page = await w.page();
    expect(page.messages.length).toBeGreaterThan(0);
    expect(liveQuickReplies(page.messages, { running: false })).toEqual([]);
  });
});
