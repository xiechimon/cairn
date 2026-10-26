import { buildReviewRejectPrompt } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, test } from 'vitest';
import {
  buildFeedback,
  build as buildTable,
  message as messageTable,
  project as projectTable,
  secret as secretTable,
  step as stepTable,
  team as teamTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { newUuidv7, nowMs } from '../src/lib/ids.js';
import type { BuildDeps } from '../src/services/builds.js';
import {
  applyFeishuCardAction,
  deliverFeishuReviewCard,
  FEISHU_APP_ID_SECRET,
  FEISHU_APP_SECRET_NAME,
  FEISHU_EMPTY_REJECT_FEEDBACK,
  feishuApprovalCard,
  parseFeishuCardAction,
  readFeishuBotStatus,
  saveFeishuBot,
  setFeishuSender,
} from '../src/services/feishu.js';
import { openSecretValues } from '../src/services/secrets.js';
import { setTodoPhase } from '../src/services/todos.js';
import { bootServer, req, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const dispose of disposables) dispose();
});
afterEach(() => {
  setFeishuSender(null);
});

interface World {
  s: TestServer;
  deps: BuildDeps;
  todoId: string;
  buildId: string;
}

function makeWorld(phase: 'review' | 'building' = 'review', prNumber: number | null = 12): World {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const suffix = Math.random().toString(36).slice(2);
  const projectId = `proj-${suffix}`;
  const todoId = `todo-${suffix}`;
  const buildId = newUuidv7();
  s.db
    .insert(projectTable)
    .values({ id: projectId, name: `feishu-${suffix}`, teamId: s.team.id })
    .run();
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId,
      title: 'Export CSV',
      spec: 'Add a CSV export.',
      phase,
      phaseAt: nowMs(),
      seqNum: 12,
      latestBuildId: buildId,
      createdBy: s.user.id,
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: true,
      prevPhase: 'building',
      triggerSource: 'user',
      prNumber,
      prUrl: prNumber === null ? null : `https://github.com/acme/app/pull/${prNumber}`,
      changes: [{ path: 'src/export.ts', additions: 3, deletions: 1, hunks: [] }],
      createdAt: nowMs(),
    })
    .run();
  const deps: BuildDeps = { ...s.svc, reposDir: s.reposDir, box: s.secretBox };
  return { s, deps, todoId, buildId };
}

function bind(w: World, openId = 'ou_bound') {
  saveFeishuBot(
    { db: w.s.db, box: w.s.secretBox },
    {
      teamId: w.s.team.id,
      userId: w.s.user.id,
      appId: 'cli_app',
      appSecret: 'secret-value',
      openId,
      cairnOrigin: 'https://cairn.example',
    },
  );
}

function phaseOf(w: World): string | undefined {
  return w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()?.phase;
}

function userMessages(w: World): unknown[] {
  return w.s.db
    .select()
    .from(messageTable)
    .where(eq(messageTable.conversationId, w.buildId))
    .all()
    .filter((row) => row.role === 'user')
    .map((row) => row.content);
}

function planPrompt(w: World): string | null {
  return (
    w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, w.buildId))
      .all()
      .find((row) => row.kind === 'plan')?.prompt ?? null
  );
}

describe('Feishu card actions', () => {
  test('an unbound Feishu user is refused and the build is left alone', async () => {
    const w = makeWorld();
    const rejected = await applyFeishuCardAction(w.deps, {
      openId: 'ou_stranger',
      action: 'reject',
      buildId: w.buildId,
      feedback: 'change the copy',
    });
    const approved = await applyFeishuCardAction(w.deps, {
      openId: 'ou_stranger',
      action: 'approve',
      buildId: w.buildId,
    });
    expect(rejected).toEqual({ accepted: false, reason: 'unbound' });
    expect(approved).toEqual({ accepted: false, reason: 'unbound' });
    expect(phaseOf(w)).toBe('review');
    expect(userMessages(w)).toEqual([]);
    expect(w.s.db.select().from(stepTable).where(eq(stepTable.buildId, w.buildId)).all()).toEqual(
      [],
    );
    expect(w.s.db.select().from(buildFeedback).all()).toEqual([]);
  });

  test('a bound reject sends the typed note through the web revision path', async () => {
    const w = makeWorld();
    bind(w);
    const result = await applyFeishuCardAction(w.deps, {
      openId: 'ou_bound',
      action: 'reject',
      buildId: w.buildId,
      feedback: '  change the copy  ',
    });
    expect(result).toEqual({ accepted: true });
    expect(phaseOf(w)).toBe('planning');
    expect(userMessages(w)).toEqual(['change the copy']);
    expect(planPrompt(w)).toBe(buildReviewRejectPrompt('change the copy'));
    const feedback = w.s.db.select().from(buildFeedback).all();
    expect(feedback).toHaveLength(1);
    expect(feedback[0]).toMatchObject({
      kind: 'revision',
      side: 'build',
      feedback: 'change the copy',
      actor: 'Owner',
    });
  });

  test('an empty reject note becomes Rejected in Feishu', async () => {
    const w = makeWorld();
    bind(w);
    const result = await applyFeishuCardAction(w.deps, {
      openId: 'ou_bound',
      action: 'reject',
      buildId: w.buildId,
      feedback: '   ',
    });
    expect(result).toEqual({ accepted: true });
    expect(userMessages(w)).toEqual([FEISHU_EMPTY_REJECT_FEEDBACK]);
    expect(planPrompt(w)).toBe(buildReviewRejectPrompt(FEISHU_EMPTY_REJECT_FEEDBACK));
    expect(FEISHU_EMPTY_REJECT_FEEDBACK).toBe('Rejected in Feishu');
  });

  test('a bound user cannot act on a build that belongs to another team', async () => {
    const w = makeWorld();
    bind(w);
    const otherTeam = `team-${Math.random().toString(36).slice(2)}`;
    w.s.db.insert(teamTable).values({ id: otherTeam, name: 'Other', createdAt: nowMs() }).run();
    w.s.db.update(todoTable).set({ teamId: otherTeam }).where(eq(todoTable.id, w.todoId)).run();
    const result = await applyFeishuCardAction(w.deps, {
      openId: 'ou_bound',
      action: 'reject',
      buildId: w.buildId,
      feedback: 'change the copy',
    });
    expect(result).toEqual({ accepted: false, reason: 'unbound' });
    expect(phaseOf(w)).toBe('review');
    expect(userMessages(w)).toEqual([]);
  });

  test('a bound approve takes the same merge path as the web button', async () => {
    const w = makeWorld();
    bind(w);
    const result = await applyFeishuCardAction(w.deps, {
      openId: 'ou_bound',
      action: 'approve',
      buildId: w.buildId,
    });
    expect(result).toEqual({ accepted: true });
    expect(phaseOf(w)).toBe('review');
    const steps = w.s.db.select().from(stepTable).where(eq(stepTable.buildId, w.buildId)).all();
    expect(steps.map((row) => row.kind)).toEqual(['merge']);
    expect(steps[0]?.status).toBe('pending');
  });
});

describe('Feishu approval card', () => {
  test('the card asks about the PR, lists the diff summary, and carries both buttons plus a Cairn link', () => {
    const card = feishuApprovalCard({
      prNumber: 12,
      summary: 'src/export.ts (+3 -1)',
      cairnUrl: 'https://cairn.example/app/todo/todo-1',
      buildId: 'build-1',
    });
    const encoded = JSON.stringify(card);
    expect(encoded).toContain('PR #12 要合并吗？');
    expect(encoded).toContain('src/export.ts (+3 -1)');
    expect(encoded).toContain('https://cairn.example/app/todo/todo-1');
    expect(encoded).toContain('批准');
    expect(encoded).toContain('驳回');
    expect(encoded).toContain('"name":"feedback"');
    expect(encoded).toContain('"buildId":"build-1"');
    const parsed = parseFeishuCardAction({
      operator: { open_id: 'ou_bound' },
      action: {
        value: { action: 'reject', buildId: 'build-1' },
        tag: 'button',
        name: 'reject',
        form_value: { feedback: 'narrow the export' },
      },
    });
    expect(parsed).toEqual({
      openId: 'ou_bound',
      action: 'reject',
      buildId: 'build-1',
      feedback: 'narrow the export',
    });
  });

  test('a reject click with no note parses as empty feedback', () => {
    expect(
      parseFeishuCardAction({
        operator: { open_id: 'ou_bound' },
        action: { value: { action: 'reject', buildId: 'build-1' }, name: 'reject' },
      }),
    ).toEqual({
      openId: 'ou_bound',
      action: 'reject',
      buildId: 'build-1',
      feedback: '',
    });
    expect(parseFeishuCardAction({ operator: {}, action: { value: { action: 'approve' } } })).toBe(
      null,
    );
  });
});

describe('Feishu bot settings', () => {
  test('credentials are stored encrypted, hidden from the secret list, and unbind drops the mapping', async () => {
    const w = makeWorld();
    const saved = await req(w.s.app, 'PUT', `/api/teams/${w.s.team.id}/feishu`, {
      appId: 'cli_app',
      appSecret: 'secret-value',
      openId: 'ou_bound',
      cairnOrigin: 'https://cairn.example',
    });
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as Record<string, unknown>;
    expect(body).toEqual({
      configured: true,
      appId: 'cli_app',
      openId: 'ou_bound',
      cairnOrigin: 'https://cairn.example',
    });
    expect(JSON.stringify(body)).not.toContain('secret-value');
    const stored = w.s.db.select().from(secretTable).all();
    expect(stored.map((row) => row.name).sort()).toEqual(
      [FEISHU_APP_ID_SECRET, FEISHU_APP_SECRET_NAME].sort(),
    );
    const cipher = stored.find((row) => row.name === FEISHU_APP_SECRET_NAME)?.valueCipher ?? '';
    expect(cipher).not.toContain('secret-value');
    expect(
      openSecretValues(
        { db: w.s.db, box: w.s.secretBox },
        w.s.team.id,
        stored.map((row) => row.id),
      )[FEISHU_APP_SECRET_NAME],
    ).toBe('secret-value');
    const listed = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/secrets`);
    expect(await listed.json()).toEqual([]);
    const kept = await req(w.s.app, 'PUT', `/api/teams/${w.s.team.id}/feishu`, {
      appId: 'cli_app',
      appSecret: '',
      openId: 'ou_bound',
      cairnOrigin: 'https://cairn.example',
    });
    expect(kept.status).toBe(200);
    expect(
      openSecretValues(
        { db: w.s.db, box: w.s.secretBox },
        w.s.team.id,
        w.s.db
          .select()
          .from(secretTable)
          .all()
          .map((row) => row.id),
      )[FEISHU_APP_SECRET_NAME],
    ).toBe('secret-value');
    const removed = await req(w.s.app, 'DELETE', `/api/teams/${w.s.team.id}/feishu`);
    expect(removed.status).toBe(204);
    expect(readFeishuBotStatus({ db: w.s.db, box: w.s.secretBox }, w.s.team.id)).toEqual({
      configured: false,
      appId: null,
      openId: null,
      cairnOrigin: null,
    });
    const after = await applyFeishuCardAction(w.deps, {
      openId: 'ou_bound',
      action: 'approve',
      buildId: w.buildId,
    });
    expect(after).toEqual({ accepted: false, reason: 'unbound' });
  });

  test('a non-http origin is refused', async () => {
    const w = makeWorld();
    const res = await req(w.s.app, 'PUT', `/api/teams/${w.s.team.id}/feishu`, {
      appId: 'cli_app',
      appSecret: 'secret-value',
      openId: 'ou_bound',
      cairnOrigin: 'javascript:alert(1)',
    });
    expect(res.status).toBe(400);
    expect(w.s.db.select().from(secretTable).all()).toEqual([]);
  });
});

describe('Feishu delivery', () => {
  test('entering review sends the card to the bound user and skips when nothing is bound', async () => {
    const sent: { openId: string; card: unknown }[] = [];
    setFeishuSender({
      async sendCard(openId, card) {
        sent.push({ openId, card });
      },
    });
    const silent = makeWorld();
    await deliverFeishuReviewCard(silent.deps, {
      id: silent.todoId,
      teamId: silent.s.team.id,
      title: 'Export CSV',
      seqNum: 12,
    });
    expect(sent).toEqual([]);
    const w = makeWorld('building');
    bind(w);
    setTodoPhase(w.deps, w.todoId, 'review');
    const deadline = Date.now() + 1000;
    while (sent.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(sent).toHaveLength(1);
    expect(sent[0]?.openId).toBe('ou_bound');
    const encoded = JSON.stringify(sent[0]?.card);
    expect(encoded).toContain('PR #12 要合并吗？');
    expect(encoded).toContain('src/export.ts (+3 -1)');
    expect(encoded).toContain(`https://cairn.example/app/todo/${w.todoId}`);
  });
});
