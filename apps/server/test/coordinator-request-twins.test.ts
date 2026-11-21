import { CHIEF_NOTICE_KIND } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  build as buildTable,
  chiefMessage,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { newRecordId, newUuidv7, nowMs } from '../src/lib/ids.js';
import { applyStepFailure, type BuildDeps } from '../src/services/builds.js';
import { createRequestTodo } from '../src/services/coordinator-request.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { sweepFailedRetries } from '../src/services/needs-you.js';
import { ownershipOf } from '../src/services/owner.js';
import { createTaskIssueSync } from '../src/services/task-issue-sync.js';
import { flushSelfIssueWrites } from '../src/services/todos.js';
import { ctx, H, registerChiefHarness, relay, toolDeps } from './chief-harness.js';
import { req } from './helpers.js';
import { seedOwnerMessage } from './owner-message.js';

registerChiefHarness();

const LONG_WORDS = '当我进入设置页后然后退出，它应该记住我上次的状态';
const message = (text: string) => seedOwnerMessage(H.s.db, H.threadId, text);
const row = (id: string) => H.s.db.select().from(todoTable).where(eq(todoTable.id, id)).get()!;

function unstarted(params: Parameters<typeof createRequestTodo>[2]) {
  return createRequestTodo(toolDeps(), ctx(), params, {
    createdBy: H.userId,
    ownerId: H.userId,
  });
}

const TOKEN = 'ghp_twins_token';
const REPO = 'octo/alpha';
const ISSUES_PATH = `/repos/${REPO}/issues`;
const issuePath = (n: number) => `${ISSUES_PATH}/${n}`;

interface GhCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function ghMock(initial: Record<string, { status?: number; body: unknown }> = {}) {
  const routes = new Map(Object.entries(initial));
  const calls: GhCall[] = [];
  const impl: FetchLike = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, headers: { ...(init?.headers ?? {}) }, body: init?.body });
    const route = routes.get(`${method} ${new URL(url).pathname}`) as
      | { status?: number; body: unknown }
      | undefined;
    const res = route ?? { status: 404, body: { message: `no mock for ${method} ${url}` } };
    return {
      ok: (res.status ?? 200) >= 200 && (res.status ?? 200) < 300,
      status: res.status ?? 200,
      headers: { get: () => null },
      json: async () => res.body,
      text: async () => JSON.stringify(res.body),
    };
  };
  return {
    impl,
    calls,
    callsTo: (method: string, path: string) =>
      calls.filter((c) => c.method === method && new URL(c.url).pathname === path),
  };
}

async function githubProject(): Promise<string> {
  upsertGithubConnection(
    { db: H.s.db, box: H.s.secretBox },
    { teamId: H.teamId, login: 'octo', accessToken: TOKEN, scope: 'repo' },
  );
  const res = await req(H.s.app, 'POST', '/api/projects', {
    name: 'alpha',
    kind: 'github',
    githubRepo: REPO,
  });
  if (res.status !== 201) throw new Error(`github project: ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

function notices(): { message: string }[] {
  return H.s.db
    .select()
    .from(chiefMessage)
    .where(eq(chiefMessage.threadId, H.threadId))
    .all()
    .flatMap((r) => {
      if (typeof r.content !== 'string') return [];
      try {
        const c = JSON.parse(r.content) as { kind?: unknown; message?: unknown };
        return c.kind === CHIEF_NOTICE_KIND && typeof c.message === 'string'
          ? [{ message: c.message }]
          : [];
      } catch {
        return [];
      }
    });
}

describe('one live card per covered request (#5386)', () => {
  test('re-quoting words a live sibling already covers is refused, nothing created', async () => {
    const id = message(`${LONG_WORDS}。再调暗托盘图标。`);
    await relay('create_todo', {
      projectId: H.projectId,
      messageIds: [id],
      quotes: [`${LONG_WORDS}。`],
    });
    await relay('create_todo', {
      projectId: H.projectId,
      messageIds: [id],
      quotes: ['再调暗托盘图标。'],
    });
    await expect(
      relay('create_todo', {
        projectId: H.projectId,
        messageIds: [id],
        quotes: [`${LONG_WORDS}。`],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(H.s.db.select().from(todoTable).all()).toHaveLength(2);
  });

  test('a second verbatim derive of a request the first copy still covers is refused', () => {
    const a = unstarted({ projectId: H.projectId, messageIds: [message(LONG_WORDS)] });
    unstarted({ projectId: H.projectId, sourceTodoId: a.id });
    expect(() => unstarted({ projectId: H.projectId, sourceTodoId: a.id })).toThrow(
      expect.objectContaining({ status: 409 }),
    );
    expect(H.s.db.select().from(todoTable).all()).toHaveLength(2);
  });

  test('a failed card continued by the same words is marked superseded, noticed, and blocks a third card', async () => {
    const id = message(`${LONG_WORDS}。`);
    const first = (await relay('create_todo', {
      projectId: H.projectId,
      messageIds: [id],
      quotes: [`${LONG_WORDS}。`],
    })) as { id: string };
    H.s.db.update(todoTable).set({ phase: 'failed' }).where(eq(todoTable.id, first.id)).run();
    const continued = (await relay('create_todo', {
      projectId: H.projectId,
      messageIds: [id],
      quotes: [`${LONG_WORDS}。`],
    })) as { id: string; continued?: { predecessors: { id: string }[] } };
    expect(row(first.id).supersededBy).toBe(continued.id);
    expect(continued.continued?.predecessors.map((p) => p.id)).toEqual([first.id]);
    expect(
      notices().some((n) => n.message.includes(first.id) && n.message.includes(continued.id)),
    ).toBe(true);
    await expect(
      relay('create_todo', {
        projectId: H.projectId,
        messageIds: [id],
        quotes: [`${LONG_WORDS}。`],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(H.s.db.select().from(todoTable).all()).toHaveLength(2);
  });

  test('a verbatim re-issue of a failed card links old to new the same way', () => {
    const first = unstarted({ projectId: H.projectId, messageIds: [message(LONG_WORDS)] });
    H.s.db.update(todoTable).set({ phase: 'failed' }).where(eq(todoTable.id, first.id)).run();
    const continued = unstarted({ projectId: H.projectId, sourceTodoId: first.id });
    expect(row(first.id).supersededBy).toBe(continued.id);
    expect(
      notices().some((n) => n.message.includes(first.id) && n.message.includes(continued.id)),
    ).toBe(true);
  });
});

describe('a continued task inherits the request issue instead of opening another (#5387)', () => {
  test('a failed card continued verbatim hands its issue to the successor', async () => {
    const mock = ghMock({ [`POST ${ISSUES_PATH}`]: { status: 201, body: { number: 101 } } });
    const projectId = await githubProject();
    const deps = { ...toolDeps(), githubFetch: mock.impl };
    const first = createRequestTodo(
      deps,
      ctx(),
      { projectId, messageIds: [message(LONG_WORDS)] },
      { createdBy: H.userId, ownerId: H.userId },
    );
    await flushSelfIssueWrites();
    expect(row(first.id).sourceRef).toBe(`github:${REPO}#101`);
    expect(row(first.id).issueState).toBe('open');
    H.s.db.update(todoTable).set({ phase: 'failed' }).where(eq(todoTable.id, first.id)).run();
    const continued = createRequestTodo(
      deps,
      ctx(),
      { projectId, sourceTodoId: first.id },
      { createdBy: H.userId, ownerId: H.userId },
    );
    await flushSelfIssueWrites();
    expect(row(continued.id).sourceRef).toBe(`github:${REPO}#101`);
    expect(row(continued.id).issueState).toBe('open');
    expect(row(first.id).sourceRef).toBeNull();
    expect(row(first.id).supersededBy).toBe(continued.id);
    expect(mock.callsTo('POST', ISSUES_PATH)).toHaveLength(1);
  });

  test('an archived card re-created by the same words reuses its issue, reopening it', async () => {
    const mock = ghMock({
      [`POST ${ISSUES_PATH}`]: { status: 201, body: { number: 101 } },
      [`POST ${issuePath(101)}/comments`]: { status: 201, body: { id: 1 } },
      [`PATCH ${issuePath(101)}`]: { status: 200, body: { state: 'open' } },
    });
    const projectId = await githubProject();
    const deps = { ...toolDeps(), githubFetch: mock.impl };
    const first = createRequestTodo(
      deps,
      ctx(),
      { projectId, messageIds: [message(LONG_WORDS)] },
      { createdBy: H.userId, ownerId: H.userId },
    );
    await flushSelfIssueWrites();
    H.s.db
      .update(todoTable)
      .set({ archivedAt: nowMs(), issueState: 'closed' })
      .where(eq(todoTable.id, first.id))
      .run();
    const continued = createRequestTodo(
      deps,
      ctx(),
      { projectId, messageIds: [message(LONG_WORDS)] },
      { createdBy: H.userId, ownerId: H.userId },
    );
    await flushSelfIssueWrites();
    expect(row(continued.id).sourceRef).toBe(`github:${REPO}#101`);
    expect(row(first.id).sourceRef).toBeNull();
    expect(mock.callsTo('POST', ISSUES_PATH)).toHaveLength(1);
    await createTaskIssueSync(
      { ...deps, convHub: H.s.convHub },
      { githubFetch: mock.impl },
    ).sweep();
    const reopen = mock.callsTo('PATCH', issuePath(101));
    expect(reopen).toHaveLength(1);
    expect(JSON.parse(reopen[0]!.body!)).toEqual({ state: 'open', state_reason: 'reopened' });
  });

  test('a superseded card whose issue lands late is closed by the sweep naming the successor', async () => {
    const mock = ghMock({
      [`POST ${ISSUES_PATH}`]: { status: 201, body: { number: 101 } },
      [`POST ${issuePath(101)}/comments`]: { status: 201, body: { id: 1 } },
      [`PATCH ${issuePath(101)}`]: { status: 200, body: { state: 'closed' } },
    });
    const projectId = await githubProject();
    const deps = { ...toolDeps(), githubFetch: mock.impl };
    const first = createRequestTodo(
      deps,
      ctx(),
      { projectId, messageIds: [message(LONG_WORDS)] },
      { createdBy: H.userId, ownerId: H.userId },
    );
    await flushSelfIssueWrites();
    H.s.db.update(todoTable).set({ phase: 'failed' }).where(eq(todoTable.id, first.id)).run();
    const continued = createRequestTodo(
      deps,
      ctx(),
      { projectId, messageIds: [message(LONG_WORDS)] },
      { createdBy: H.userId, ownerId: H.userId },
    );
    expect(row(first.id).sourceRef).toBeNull();
    expect(row(continued.id).sourceRef).toBe(`github:${REPO}#101`);
    H.s.db
      .update(todoTable)
      .set({ sourceRef: `github:${REPO}#101`, issueState: 'open' })
      .where(eq(todoTable.id, first.id))
      .run();
    await createTaskIssueSync(
      { ...deps, convHub: H.s.convHub },
      { githubFetch: mock.impl },
    ).sweep();
    const close = mock.callsTo('PATCH', issuePath(101));
    expect(close).toHaveLength(1);
    expect(JSON.parse(close[0]!.body!)).toEqual({ state: 'closed', state_reason: 'not_planned' });
    expect(mock.callsTo('POST', `${issuePath(101)}/comments`)[0]!.body).toContain('#101');
    expect(row(first.id).issueState).toBe('closed');
  });
});

describe('a superseded failed card leaves the retry and needs-you paths', () => {
  function seedFailedTodo(supersededBy: string | null): { todoId: string } {
    const projectId = `proj-${newRecordId(8)}`;
    const todoId = `todo-${newRecordId(8)}`;
    const buildId = newUuidv7();
    H.s.db
      .insert(projectTable)
      .values({ id: projectId, name: `twins-${todoId}`, teamId: H.teamId })
      .run();
    H.s.db
      .insert(todoTable)
      .values({
        id: todoId,
        teamId: H.teamId,
        projectId,
        title: 'Retry me',
        spec: 'Do the work.',
        phase: 'building',
        phaseAt: nowMs(),
        seqNum: 90,
        latestBuildId: buildId,
        supersededBy,
      })
      .run();
    H.s.db
      .insert(buildTable)
      .values({
        id: buildId,
        todoId,
        withPlan: false,
        prevPhase: 'todo',
        triggerSource: 'user',
        createdAt: nowMs(),
      })
      .run();
    const stepId = newRecordId();
    H.s.db
      .insert(stepTable)
      .values({ id: stepId, buildId, kind: 'session', status: 'claimed', createdAt: nowMs() })
      .run();
    applyStepFailure(
      { ...H.s.svc, reposDir: H.s.reposDir, box: H.s.secretBox } as BuildDeps,
      H.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!,
      'connection reset by peer',
    );
    return { todoId };
  }

  test('the automatic retry sweep skips a superseded failed task', async () => {
    const { todoId } = seedFailedTodo('todo-successor');
    H.s.db
      .update(todoTable)
      .set({ phaseAt: nowMs() - 120_000 })
      .where(eq(todoTable.id, todoId))
      .run();
    await sweepFailedRetries({
      ...H.s.svc,
      reposDir: H.s.reposDir,
      box: H.s.secretBox,
    } as BuildDeps);
    expect(row(todoId).phase).toBe('failed');
    expect(
      H.s.db.select().from(buildTable).where(eq(buildTable.todoId, todoId)).all(),
    ).toHaveLength(1);
  });

  test('a superseded failed task claims no coordinator ownership', () => {
    const { todoId } = seedFailedTodo('todo-successor');
    expect(ownershipOf(H.s.db, row(todoId))).toBeNull();
  });
});
