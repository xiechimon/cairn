import { type ClaimedStep, todoRecordSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { step as stepTable, todo as todoTable, todoTag } from '../src/db/schema.js';
import { bootServer, issueApiKey, postProject, seedSessionRoute } from './helpers.js';
import { insertLegacyCategory, insertLegacyMembership } from './legacy-category-fixtures.js';

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

describe('placeholder title derivation (ADR 0002 D2: blank title -> the first non-empty body line, <=50 characters)', () => {
  test('title empty string -> the first non-empty line; of several lines only the first', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    const res = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      body: { title: '', spec: '\n  修支付回调掉单  \n\n现在的情况：每晚批处理偶发' },
    });
    expect(res.status).toBe(201);
    const record = todoRecordSchema.parse(await res.json());
    expect(record.title).toBe('修支付回调掉单');
    s.dispose();
  });

  test('the first line >50 characters -> truncated at 50 + an ellipsis', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    const res = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      body: { title: '', spec: '一'.repeat(60) },
    });
    const record = todoRecordSchema.parse(await res.json());
    expect(record.title).toBe(`${'一'.repeat(50)}…`);
    s.dispose();
  });

  test('an explicit title is kept verbatim (the chief/mcp surfaces unchanged)', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    const res = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      body: { title: '  显式标题  ', spec: '正文首行不该赢' },
    });
    const record = todoRecordSchema.parse(await res.json());
    expect(record.title).toBe('显式标题');
    s.dispose();
  });
});

describe('the set_task_meta narrow worker tool (ADR 0002 D3: stepId pins the todoId)', () => {
  async function world() {
    const s = bootServer({ claimHoldMs: 250 });
    const plain = await issueApiKey(s);
    const enroll = await call(s.app, 'POST', '/api/machine/enroll', {
      cred: plain,
      body: { teamId: s.team.id, name: 'task-meta', cliVersion: '0.1.0' },
    });
    const { token } = (await enroll.json()) as { token: string };
    seedSessionRoute(s, { provider: 'p', modelId: 'm' });

    const projectId = await postProject(s.app);
    const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      body: { title: '', spec: '给登录页加图形验证码\n\n现在的情况：暴力破解无成本' },
    });
    const { id: todoId } = (await todoRes.json()) as { id: string };
    await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      body: { todoIds: [todoId] },
    });
    const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: token,
      body: {},
    });
    const { step } = (await claimRes.json()) as { step: ClaimedStep | null };
    if (!step) throw new Error('no step claimed');
    return { s, token, step, projectId, todoId };
  }

  const relay = (app: Hono, token: string, stepId: string, params: Record<string, unknown>) =>
    call(app, 'POST', `/api/machine/tool/${stepId}`, {
      cred: token,
      body: { name: 'set_task_meta', params },
    });

  test('the claim payload contains set_task_meta', async () => {
    const { s, step } = await world();
    const tool = step.remoteTools?.find((t) => t.name === 'set_task_meta');
    if (!tool) throw new Error('metadata tool missing');
    expect(tool.parameters).toMatchObject({ required: ['title'], properties: { title: {} } });
    expect(Object.keys((tool.parameters as { properties: object }).properties)).toEqual(['title']);
    s.dispose();
  });

  test('backfilling only the title: the todo updates and v increments', async () => {
    const { s, token, step, todoId } = await world();
    const res = await relay(s.app, token, step.step.id, {
      title: '登录页加图形验证码',
    });
    expect(res.status).toBe(200);
    const one = todoRecordSchema.parse(
      await (await call(s.app, 'GET', `/api/todos/${todoId}`)).json(),
    );
    expect(one.title).toBe('登录页加图形验证码');
    expect(one.tagIds).toEqual([]);
    expect(one.v).toBeGreaterThan(1);
    s.dispose();
  });

  test('title backfill works; a stale category and a blank title fail', async () => {
    const { s, token, step, todoId } = await world();
    const ok = await relay(s.app, token, step.step.id, { title: '只回填标题' });
    expect(ok.status).toBe(200);
    const one = todoRecordSchema.parse(
      await (await call(s.app, 'GET', `/api/todos/${todoId}`)).json(),
    );
    expect(one.title).toBe('只回填标题');
    expect(one.tagIds).toEqual([]);
    const bad = await relay(s.app, token, step.step.id, { title: 'x', tag: 'urgent' });
    expect(bad.status).toBe(400);
    const empty = await relay(s.app, token, step.step.id, { title: '   ' });
    expect(empty.status).toBe(400);
    s.dispose();
  });

  test.each([false, true])(
    'sealed owner request = %s: stale categories fail atomically',
    async (sealed) => {
      const { s, token, step, todoId, projectId } = await world();
      try {
        const { id } = insertLegacyCategory(s.db, projectId, 'correction');
        insertLegacyMembership(s.db, todoId, [id], true);
        const taskText = s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()?.spec;
        if (taskText === undefined) throw new Error('task missing');
        if (sealed) {
          s.db
            .update(todoTable)
            .set({
              request: {
                segments: [
                  {
                    source: { kind: 'edit', userId: s.user.id, at: 0, span: 'whole' },
                    author: 'owner',
                    sourceRef: null,
                    text: taskText,
                  },
                ],
                siblings: [],
                difficulty: null,
                titleSource: 'owner',
                titleSourceRef: null,
              },
            })
            .where(eq(todoTable.id, todoId))
            .run();
        }
        const before = s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get();
        const links = s.db.select().from(todoTag).where(eq(todoTag.todoId, todoId)).all();
        expect(before?.correctionRequired).toBe(true);
        for (const key of ['tag', 'tags', 'tagIds']) {
          for (const value of [null, [], 'bug', ['bug']]) {
            expect(
              (await relay(s.app, token, step.step.id, { title: 'Must not land', [key]: value }))
                .status,
              `${key}=${JSON.stringify(value)}`,
            ).toBe(400);
            expect(s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()).toEqual(
              before,
            );
            expect(s.db.select().from(todoTag).where(eq(todoTag.todoId, todoId)).all()).toEqual(
              links,
            );
          }
        }
        const ok = await relay(s.app, token, step.step.id, { title: 'Title only' });
        expect(ok.status).toBe(200);
        const after = s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get();
        expect(after?.title).toBe(sealed ? before?.title : 'Title only');
        expect(after?.spec).toBe(before?.spec);
        expect(after?.request).toEqual(before?.request);
        expect(after?.correctionRequired).toBe(true);
        expect(s.db.select().from(todoTag).where(eq(todoTag.todoId, todoId)).all()).toEqual(links);
      } finally {
        s.dispose();
      }
    },
  );

  function finishFirstStep(s: ReturnType<typeof bootServer>, stepId: string) {
    s.db
      .update(stepTable)
      .set({ status: 'done', finishedAt: Date.now() })
      .where(eq(stepTable.id, stepId))
      .run();
    const first = s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get();
    if (!first) throw new Error('first step missing');
    return first;
  }

  test.each(['session', 'review', 'verify'] as const)(
    'a %s step after the first implementation step cannot rename the task',
    async (kind) => {
      const { s, token, step, todoId } = await world();
      const first = finishFirstStep(s, step.step.id);
      const before = s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()?.title;
      s.db
        .insert(stepTable)
        .values({
          id: `later-${kind}`,
          buildId: first.buildId,
          kind,
          machineId: first.machineId,
          status: 'claimed',
          claimedAt: Date.now(),
          lastHeartbeatAt: Date.now(),
          createdAt: Date.now(),
        })
        .run();
      const res = await relay(s.app, token, `later-${kind}`, { title: '只读审核本轮变更' });
      expect(res.status).toBe(409);
      expect(s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()?.title).toBe(
        before,
      );
      s.dispose();
    },
  );

  test('a later implementation step is claimed without set_task_meta or the naming instruction', async () => {
    const { s, token, step } = await world();
    const first = finishFirstStep(s, step.step.id);
    s.db
      .insert(stepTable)
      .values({
        id: 'later-session',
        buildId: first.buildId,
        kind: 'session',
        status: 'pending',
        createdAt: Date.now(),
      })
      .run();
    const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: token,
      body: {},
    });
    const { step: later } = (await claimRes.json()) as { step: ClaimedStep | null };
    expect(later?.step.id).toBe('later-session');
    expect(later?.remoteTools?.map((t) => t.name)).not.toContain('set_task_meta');
    expect(later?.todo?.meta).toBeUndefined();
    s.dispose();
  });
});
