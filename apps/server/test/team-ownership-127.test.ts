import { streamHelloEventSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import {
  build as buildTable,
  chiefMessage,
  chiefThread,
  message as messageTable,
  plan as planTable,
  project as projectTable,
  team as teamTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { nowMs } from '../src/lib/ids.js';
import { bootServer, openConvStream, openStream, req, type TestServer } from './helpers.js';

const TEAM_B = 'team-b-127';
const PROJ_A = 'proj-a-127';
const PROJ_B = 'proj-b-127';
const TODO_A = 'todo-a-127';
const TODO_B = 'todo-b-127';
const BUILD_A = 'build-a-127';
const BUILD_B = 'build-b-127';
const THREAD_A = 'chief-a-127';
const THREAD_B = 'chief-b-127';
const PLAN_B = 'plan-b-127';

const servers: TestServer[] = [];
afterEach(() => {
  while (servers.length > 0) servers.pop()?.dispose();
});

async function world() {
  const s = bootServer();
  servers.push(s);
  const now = nowMs();
  s.db.insert(teamTable).values({ id: TEAM_B, name: 'B', createdAt: now }).run();
  s.db
    .insert(projectTable)
    .values({
      id: PROJ_A,
      name: 'alpha',
      teamId: s.team.id,
      repoKind: 'github',
      githubRepo: 'a/alpha',
    })
    .run();
  s.db
    .insert(projectTable)
    .values({ id: PROJ_B, name: 'beta', teamId: TEAM_B, repoKind: 'github', githubRepo: 'b/beta' })
    .run();
  for (const [id, teamId, projectId, seqNum] of [
    [TODO_A, s.team.id, PROJ_A, 1],
    [TODO_B, TEAM_B, PROJ_B, 2],
  ] as const) {
    s.db
      .insert(todoTable)
      .values({ id, teamId, projectId, title: id, spec: '', phase: 'todo', phaseAt: now, seqNum })
      .run();
  }
  for (const [id, todoId] of [
    [BUILD_A, TODO_A],
    [BUILD_B, TODO_B],
  ] as const) {
    s.db
      .insert(buildTable)
      .values({ id, todoId, withPlan: false, triggerSource: 'user', createdAt: now })
      .run();
  }
  s.db
    .insert(messageTable)
    .values({
      id: 'msg-a',
      conversationId: BUILD_A,
      role: 'user',
      content: '本队对话',
      createdAt: now,
    })
    .run();
  s.db
    .insert(messageTable)
    .values({
      id: 'msg-b',
      conversationId: BUILD_B,
      role: 'user',
      content: '他队对话',
      createdAt: now,
    })
    .run();
  for (const [id, teamId] of [
    [THREAD_A, s.team.id],
    [THREAD_B, TEAM_B],
  ] as const) {
    s.db
      .insert(chiefThread)
      .values({
        id,
        chiefId: `chief-${s.user.id}-${teamId}`,
        userId: s.user.id,
        teamId,
        title: id,
        createdAt: now,
        updatedAt: now,
        sessionId: '',
        sessionOpenedAt: now,
      })
      .run();
  }
  s.db
    .insert(chiefMessage)
    .values({
      id: 'cmsg-a',
      threadId: THREAD_A,
      role: 'user',
      content: '本队 chief',
      createdAt: now,
    })
    .run();
  s.db
    .insert(chiefMessage)
    .values({
      id: 'cmsg-b',
      threadId: THREAD_B,
      role: 'user',
      content: '他队 chief',
      createdAt: now,
    })
    .run();
  s.db
    .insert(planTable)
    .values({ id: PLAN_B, buildId: BUILD_B, version: 1, content: 'p', createdAt: now })
    .run();
  return s;
}

async function errorOf(res: Response): Promise<string> {
  return ((await res.json()) as { error?: string }).error ?? '';
}

describe('#127 conversation messages: a foreign team conversation is 404', () => {
  test('a build conversation of another team -> 404, its messages never returned', async () => {
    const s = await world();
    const res = await req(s.app, 'GET', `/api/conversations/${BUILD_B}/messages`);
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toBe(`build ${BUILD_B}`);
  });

  test('a chief thread of another team -> 404, its messages never returned', async () => {
    const s = await world();
    const res = await req(s.app, 'GET', `/api/conversations/${THREAD_B}/messages`);
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toBe(`conversation ${THREAD_B}`);
  });

  test('own-team build and chief conversations read as usual', async () => {
    const s = await world();
    const build = await req(s.app, 'GET', `/api/conversations/${BUILD_A}/messages`);
    expect(build.status).toBe(200);
    expect(
      ((await build.json()) as { messages: { content: string }[] }).messages.map((m) => m.content),
    ).toEqual(['本队对话']);
    const chief = await req(s.app, 'GET', `/api/conversations/${THREAD_A}/messages`);
    expect(chief.status).toBe(200);
    expect(
      ((await chief.json()) as { messages: { content: string }[] }).messages.map((m) => m.content),
    ).toEqual(['本队 chief']);
  });

  test('posting to a foreign build conversation -> 404, no message stored', async () => {
    const s = await world();
    const res = await req(s.app, 'POST', `/api/conversations/${BUILD_B}/messages`, {
      content: 'intrude',
      mode: 'steer',
    });
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toBe(`build ${BUILD_B}`);
    expect(
      s.db.select().from(messageTable).where(eq(messageTable.conversationId, BUILD_B)).all(),
    ).toHaveLength(1);
  });

  test('posting to a foreign chief thread -> 404, no message stored', async () => {
    const s = await world();
    const res = await req(s.app, 'POST', `/api/conversations/${THREAD_B}/messages`, {
      content: 'intrude',
    });
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toBe(`conversation ${THREAD_B}`);
    expect(
      s.db.select().from(chiefMessage).where(eq(chiefMessage.threadId, THREAD_B)).all(),
    ).toHaveLength(1);
  });

  test('the direct conversation stream of another team -> 404', async () => {
    const s = await world();
    for (const id of [BUILD_B, THREAD_B]) {
      const res = await req(s.app, 'GET', `/api/conversations/${id}/stream`);
      expect(res.status).toBe(404);
      await res.body?.cancel();
    }
    const own = await openConvStream(s.app, BUILD_A);
    own.close();
  });
});

describe('#127 the team stream follow set drops foreign conversations', () => {
  test('foreign build and chief ids are not subscribed, own and unknown ids still are', async () => {
    const s = await world();
    const stream = await openStream(s.app, s.team.id);
    const hello = streamHelloEventSchema.parse(await stream.next((ev) => ev.type === 'hello'));
    const path = `/api/streams/${hello.connectionId}/conversations`;
    const res = await req(s.app, 'PUT', path, {
      conversationIds: [BUILD_B, THREAD_B, BUILD_A, 'conv-missing'],
      revision: 1,
    });
    expect(res.status).toBe(200);
    expect(s.convHub.subscriberCount(BUILD_B)).toBe(0);
    expect(s.convHub.subscriberCount(THREAD_B)).toBe(0);
    expect(s.convHub.subscriberCount(BUILD_A)).toBe(1);
    expect(s.convHub.subscriberCount('conv-missing')).toBe(1);
    s.convHub.publishTextDelta(BUILD_B, 'secret');
    s.convHub.publishTextDelta(BUILD_A, 'hello');
    const frame = (await stream.next((ev) => ev.type === 'conversation')) as {
      conversationId: string;
    };
    expect(frame.conversationId).toBe(BUILD_A);
    stream.close();
  });
});

describe('#127 build routes: a foreign build is 404 and untouched', () => {
  test('read surfaces -> 404', async () => {
    const s = await world();
    for (const path of [
      `/api/builds/${BUILD_B}`,
      `/api/builds/${BUILD_B}/steps`,
      `/api/builds/${BUILD_B}/usage`,
      `/api/builds/${BUILD_B}/plans`,
      `/api/builds/${BUILD_B}/merge-permission`,
      `/api/builds/${BUILD_B}/changes`,
    ]) {
      const res = await req(s.app, 'GET', path);
      expect(res.status, path).toBe(404);
      expect(await errorOf(res), path).toBe(`build ${BUILD_B}`);
    }
    const own = await req(s.app, 'GET', `/api/builds/${BUILD_A}`);
    expect(own.status).toBe(200);
  });

  test('changes/file -> 404', async () => {
    const s = await world();
    const res = await req(s.app, 'GET', `/api/builds/${BUILD_B}/changes/file?path=README.md`);
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toBe(`build ${BUILD_B}`);
  });

  test('write surfaces -> 404 with no state change', async () => {
    const s = await world();
    const writes: [string, unknown][] = [
      [`/api/builds/${BUILD_B}/stop`, { discard: false }],
      [`/api/builds/${BUILD_B}/merge`, {}],
      [`/api/builds/${BUILD_B}/undo`, {}],
      [`/api/builds/${BUILD_B}/retry-now`, {}],
      [`/api/builds/${BUILD_B}/steps`, {}],
      [`/api/builds/${BUILD_B}/tasks/task-1/stop`, {}],
      [`/api/builds/${BUILD_B}/plans/${PLAN_B}/pause-auto-approve`, {}],
    ];
    for (const [path, body] of writes) {
      const res = await req(s.app, 'POST', path, body);
      expect(res.status, path).toBe(404);
      expect(await errorOf(res), path).toBe(`build ${BUILD_B}`);
    }
    expect(
      s.db.select().from(planTable).where(eq(planTable.id, PLAN_B)).get()?.autoApprovePausedAt,
    ).toBeNull();
    expect(s.db.select().from(todoTable).where(eq(todoTable.id, TODO_B)).get()?.phase).toBe('todo');
  });
});

describe('#127 task routes: a foreign task is 404 and untouched', () => {
  test('read surfaces -> 404', async () => {
    const s = await world();
    const detail = await req(s.app, 'GET', `/api/todos/${TODO_B}`);
    expect(detail.status).toBe(404);
    expect(await errorOf(detail)).toBe(`todo ${TODO_B}`);
    const own = await req(s.app, 'GET', `/api/todos/${TODO_A}`);
    expect(own.status).toBe(200);
  });

  test('write surfaces -> 404 with no state change', async () => {
    const s = await world();
    const patch = await req(s.app, 'PATCH', `/api/todos/${TODO_B}`, { title: 'hijacked' });
    expect(patch.status).toBe(404);
    const orchestrate = await req(s.app, 'POST', `/api/todos/${TODO_B}/orchestrate`);
    expect(orchestrate.status).toBe(404);
    const archive = await req(s.app, 'POST', `/api/todos/${TODO_B}/archive`);
    expect(archive.status).toBe(404);
    const unarchive = await req(s.app, 'POST', `/api/todos/${TODO_B}/unarchive`);
    expect(unarchive.status).toBe(404);
    const stopDone = await req(s.app, 'POST', `/api/todos/${TODO_B}/stop-and-done`);
    expect(stopDone.status).toBe(404);
    const del = await req(s.app, 'DELETE', `/api/todos/${TODO_B}`);
    expect(del.status).toBe(404);
    const row = s.db.select().from(todoTable).where(eq(todoTable.id, TODO_B)).get();
    expect(row?.title).toBe(TODO_B);
    expect(row?.phase).toBe('todo');
    expect(row?.archivedAt).toBeNull();
  });

  test('own-team task patch and delete still work', async () => {
    const s = await world();
    const patch = await req(s.app, 'PATCH', `/api/todos/${TODO_A}`, { title: 'renamed' });
    expect(patch.status).toBe(200);
    expect(s.db.select().from(todoTable).where(eq(todoTable.id, TODO_A)).get()?.title).toBe(
      'renamed',
    );
    const del = await req(s.app, 'DELETE', `/api/todos/${TODO_A}`);
    expect(del.status).toBe(204);
    expect(s.db.select().from(todoTable).where(eq(todoTable.id, TODO_A)).get()).toBeUndefined();
  });
});
