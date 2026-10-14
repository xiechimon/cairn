// #1303 chief 未读徽标。
// 失败方式：
// - wake/watch 步（prompt 以 [wake: 开头）收尾仍把 chief_message 通知 readAt 重置为空，
//   未读集因此计入机器回头。
// - 已经置读的线程，再来一轮 wake，readAt 被重置为空。
// - scheduler.tick(now) 不把最后活动早于 7 天的 chief 线程置读。
// 用户回合仍是未读。正好 7 天、更新的 lastTurnAt、非 chief 通知不被 tick 改掉。

import type { ClaimedStep } from '@pacman/shared';
import { chiefIdFormat, claimedStepSchema } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  chief as chiefTable,
  chiefThread,
  notification as notificationTable,
  step as stepTable,
} from '../src/db/schema.js';
import { enqueueChiefStep } from '../src/services/chief.js';
import { notifyChiefMessage } from '../src/services/notifications.js';
import { createScheduler } from '../src/services/scheduler.js';
import { bootServer, issueApiKey, machineIdByName, type TestServer } from './helpers.js';

const IDLE_MS = 7 * 24 * 60 * 60 * 1000;

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

interface TurnWorld {
  s: TestServer;
  token: string;
  teamId: string;
  threadId: string;
  claim(): Promise<ClaimedStep>;
  done(stepId: string, text: string): Promise<void>;
}

async function setupTurn(content: string): Promise<TurnWorld> {
  const s = bootServer({ claimHoldMs: 200 });
  disposables.push(() => s.dispose());
  const teamId = s.team.id;
  const key = await issueApiKey(s);
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId, name: 'unread-mbp', cliVersion: '0.1.0' },
  });
  const { token } = (await enrollRes.json()) as { token: string };
  const machineId = machineIdByName(s, 'unread-mbp');
  s.db
    .insert(agentTable)
    .values({
      id: 'agent-unread',
      teamId,
      displayName: 'unread-agent',
      description: '调度',
      modelId: 'stub-model',
      provider: 'stub-gw',
      machineId,
    })
    .run();
  const patchRes = await call(s.app, 'PATCH', `/api/teams/${teamId}/chief`, {
    body: { agent: { agentId: 'agent-unread' } },
  });
  expect(patchRes.status).toBe(200);
  const msgRes = await call(s.app, 'POST', `/api/teams/${teamId}/chief/threads`, {
    body: { content },
  });
  expect(msgRes.status).toBe(201);
  const { thread } = (await msgRes.json()) as { thread: { id: string } };
  return {
    s,
    token,
    teamId,
    threadId: thread.id,
    async claim() {
      const res = await call(s.app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
      const body = (await res.json()) as { step: ClaimedStep | null };
      if (!body.step) throw new Error('no chief step claimed');
      return claimedStepSchema.parse(body.step);
    },
    async done(stepId: string, text: string) {
      const urlsRes = await call(s.app, 'POST', `/api/machine/upload-urls/${stepId}`, {
        cred: token,
        body: { files: [{ name: 'transcript.json' }] },
      });
      const { uploads } = (await urlsRes.json()) as { uploads: { name: string; url: string }[] };
      const upload = uploads.find((u) => u.name === 'transcript.json');
      if (!upload) throw new Error('no transcript upload');
      const uploadId = upload.url.split('/').pop();
      const putRes = await call(s.app, 'PUT', `/api/machine/upload/${uploadId}`, {
        cred: token,
        body: {
          stepId,
          messages: [
            { id: `asst-${stepId}`, role: 'assistant', content: text, createdAt: Date.now() },
          ],
        },
      });
      expect(putRes.status).toBe(200);
      const doneRes = await call(s.app, 'POST', `/api/machine/done/${stepId}`, {
        cred: token,
        body: { status: 'success', sessionId: `sess-${stepId}` },
      });
      expect(doneRes.status).toBe(200);
    },
  };
}

function chiefNotif(s: TestServer, threadId: string) {
  return s.db
    .select()
    .from(notificationTable)
    .where(eq(notificationTable.entityId, threadId))
    .get();
}

async function unreadChief(s: TestServer, teamId: string): Promise<string[]> {
  const res = await call(s.app, 'GET', `/api/teams/${teamId}/notifications`);
  const body = (await res.json()) as { unreadThreadIds: string[] };
  return body.unreadThreadIds.filter((id) => id.startsWith('chief-'));
}

describe('chief unread badge (#1303)', () => {
  test('a user turn is unread', async () => {
    const w = await setupTurn('帮我看一下');
    const claimed = await w.claim();
    await w.done(claimed.step.id, '看完了，结论在这里。');
    const row = chiefNotif(w.s, w.threadId);
    expect(row?.readAt).toBeNull();
    expect(await unreadChief(w.s, w.teamId)).toContain(w.threadId);
  });

  test('a wake-only turn is stored already read and does not join the unread set', async () => {
    const w = await setupTurn('回头提醒');
    w.s.db
      .update(stepTable)
      .set({ prompt: '[wake:wake] 回头核实任务状态并向用户汇报。' })
      .where(eq(stepTable.buildId, w.threadId))
      .run();
    const claimed = await w.claim();
    await w.done(claimed.step.id, '机器回头：任务仍在跑，无需处理。');
    const row = chiefNotif(w.s, w.threadId);
    expect(row?.snippet).toContain('机器回头');
    expect(row?.readAt).not.toBeNull();
    expect(await unreadChief(w.s, w.teamId)).not.toContain(w.threadId);
  });

  test('a gate wake does not clear an existing user unread', async () => {
    const w = await setupTurn('先回我一句');
    const first = await w.claim();
    await w.done(first.step.id, '这是给你的回复。');
    expect(chiefNotif(w.s, w.threadId)?.readAt).toBeNull();
    enqueueChiefStep(
      { db: w.s.db, hub: w.s.hub, machineHub: w.s.machineHub, user: w.s.user },
      w.threadId,
      { prompt: '任务停在确认关口。', trigger: 'gate' },
    );
    const wake = await w.claim();
    await w.done(wake.step.id, '关口汇报：方案已停住。');
    expect(chiefNotif(w.s, w.threadId)?.readAt).toBeNull();
    expect(await unreadChief(w.s, w.teamId)).toContain(w.threadId);
  });

  test('a wake turn does not mark a read thread unread again', async () => {
    const w = await setupTurn('这轮我已经看过');
    const first = await w.claim();
    await w.done(first.step.id, '已回复。');
    const readAt = Date.now();
    w.s.db
      .update(notificationTable)
      .set({ readAt })
      .where(eq(notificationTable.entityId, w.threadId))
      .run();
    enqueueChiefStep(
      { db: w.s.db, hub: w.s.hub, machineHub: w.s.machineHub, user: w.s.user },
      w.threadId,
      { prompt: '约定时间已到。', trigger: 'wake' },
    );
    const wake = await w.claim();
    await w.done(wake.step.id, '到点回头：没有新情况。');
    expect(chiefNotif(w.s, w.threadId)?.readAt).not.toBeNull();
    expect(await unreadChief(w.s, w.teamId)).not.toContain(w.threadId);
  });
});

describe('idle chief unread sweep (#1303)', () => {
  function seedUnread(s: TestServer, id: string, updatedAt: number, lastTurnAt: number | null) {
    const chiefId = chiefIdFormat(s.user.id, s.team.id);
    const existing = s.db.select().from(chiefTable).where(eq(chiefTable.id, chiefId)).get();
    if (!existing) {
      s.db
        .insert(chiefTable)
        .values({
          id: chiefId,
          userId: s.user.id,
          teamId: s.team.id,
          agentId: null,
          charter: '',
          watches: [],
          wakes: [],
          lastTurnAt: null,
          createdAt: updatedAt,
          tz: null,
        })
        .run();
    }
    s.db
      .insert(chiefThread)
      .values({
        id,
        chiefId,
        userId: s.user.id,
        teamId: s.team.id,
        title: id,
        createdAt: updatedAt,
        updatedAt,
        lastTurnAt,
        sessionRuntime: 'pi',
        sessionId: '',
        sessionOpenedAt: updatedAt,
        toolDefHashes: {},
        toolResultHashes: {},
      })
      .run();
    notifyChiefMessage(
      { db: s.db, hub: s.hub, user: s.user },
      {
        threadId: id,
        message: '旧回复',
        agent: { name: s.user.displayName, avatarUrl: null },
      },
    );
  }

  test('tick marks a chief thread idle more than 7 days read', () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const now = Date.now();
    seedUnread(s, 'chief-idle-old', now - IDLE_MS - 1, now - IDLE_MS - 1);
    const scheduler = createScheduler(s.svc, { tickMs: 60_000 });
    scheduler.tick(now);
    scheduler.stop();
    expect(chiefNotif(s, 'chief-idle-old')?.readAt).toBe(now);
  });

  test('tick leaves a thread at exactly 7 days, a fresh thread, and a recent lastTurnAt unread', () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const now = Date.now();
    seedUnread(s, 'chief-idle-exact', now - IDLE_MS, now - IDLE_MS);
    seedUnread(s, 'chief-idle-fresh', now - 60_000, now - 60_000);
    seedUnread(s, 'chief-idle-turn', now - IDLE_MS - 1, now - 1000);
    const scheduler = createScheduler(s.svc, { tickMs: 60_000 });
    scheduler.tick(now);
    scheduler.stop();
    expect(chiefNotif(s, 'chief-idle-exact')?.readAt).toBeNull();
    expect(chiefNotif(s, 'chief-idle-fresh')?.readAt).toBeNull();
    expect(chiefNotif(s, 'chief-idle-turn')?.readAt).toBeNull();
  });

  test('tick does not mark a todo notification read', () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const now = Date.now();
    s.db
      .insert(notificationTable)
      .values({
        id: `${s.user.id}:todo-keep`,
        teamId: s.team.id,
        userId: s.user.id,
        type: 'plan_ready',
        entityId: 'todo-keep',
        entityRef: { title: '保持未读', projectId: 'p', seqNum: 1 },
        agentName: s.user.displayName,
        agentAvatarUrl: null,
        snippet: null,
        readAt: null,
        createdAt: now - IDLE_MS - 1,
        channels: ['in_app'],
      })
      .run();
    const scheduler = createScheduler(s.svc, { tickMs: 60_000 });
    scheduler.tick(now);
    scheduler.stop();
    expect(chiefNotif(s, 'todo-keep')?.readAt).toBeNull();
  });
});
