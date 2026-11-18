import { and, eq, isNull, like, not } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  chiefMessage,
  chiefThread,
  project as projectTable,
  schedule as scheduleTable,
  step as stepTable,
  team as teamTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { newUuidv7 } from '../src/lib/ids.js';
import { enqueueChiefStep, triggerChiefWakes, upsertChiefMessage } from '../src/services/chief.js';
import { dueSchedules } from '../src/services/schedules.js';
import { getTodo } from '../src/services/todos.js';
import { H, ownerTodo, registerChiefHarness, relay } from './chief-harness.js';
import { postProject, req } from './helpers.js';

registerChiefHarness();

interface CoordinatorRow {
  id: string;
  role: string;
  content: unknown;
  createdAt: number;
  projectId: string | null;
}
interface CoordinatorPage {
  messages: CoordinatorRow[];
  nextCursor: string | null;
}
interface SendReply {
  thread: { id: string };
  message: { id: string; content: string };
}

const base = () => `/api/teams/${H.teamId}/chief/threads`;

async function readCoordinator(query = ''): Promise<CoordinatorPage> {
  const res = await req(H.s.app, 'GET', `/api/conversations/${H.threadId}/messages${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as CoordinatorPage;
}

async function threadList(): Promise<{ id: string }[]> {
  const res = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/chief/threads`);
  expect(res.status).toBe(200);
  return (await res.json()) as { id: string }[];
}

function sendToCoordinator(content: string, projectId?: string) {
  return req(H.s.app, 'POST', base(), {
    content,
    ...(projectId !== undefined ? { projectId } : {}),
  });
}

function activeThreads() {
  return H.s.db
    .select()
    .from(chiefThread)
    .where(
      and(
        eq(chiefThread.chiefId, H.chiefId),
        isNull(chiefThread.archivedAt),
        not(like(chiefThread.id, 'chief-digest-%')),
      ),
    )
    .all();
}

function seedMessage(
  id: string,
  createdAt: number,
  projectId: string | null,
  threadId = H.threadId,
) {
  H.s.db
    .insert(chiefMessage)
    .values({ id, threadId, role: 'user', content: id, projectId, createdAt })
    .run();
}

function seedThread(id: string, over: { archivedAt?: number; projectId?: string } = {}) {
  H.s.db
    .insert(chiefThread)
    .values({
      id,
      chiefId: H.chiefId,
      userId: H.userId,
      teamId: H.teamId,
      title: 'old',
      createdAt: 1,
      updatedAt: 1,
      sessionRuntime: 'pi',
      sessionId: '',
      sessionOpenedAt: 1,
      toolDefHashes: {},
      toolResultHashes: {},
      archivedAt: over.archivedAt ?? null,
      projectId: over.projectId ?? null,
    })
    .run();
}

function chiefPrompts(threadId: string): string[] {
  return H.s.db
    .select()
    .from(stepTable)
    .where(eq(stepTable.buildId, threadId))
    .all()
    .filter((s) => s.kind === 'chief')
    .map((s) => s.prompt ?? '');
}

async function archive(projectId: string) {
  expect((await req(H.s.app, 'POST', `/api/projects/${projectId}/archive`)).status).toBe(200);
}

function seedOtherTeamProject() {
  H.s.db.insert(teamTable).values({ id: 'team-other', name: 'other', createdAt: 0 }).run();
  H.s.db
    .insert(projectTable)
    .values({ id: 'proj-other', name: 'secret', teamId: 'team-other', repoKind: 'hosted' })
    .run();
}

describe('one global Coordinator thread per team (D58)', () => {
  test('reading returns the existing global thread with the thread-list fields', async () => {
    const list = await threadList();
    expect(list.map((t) => t.id)).toEqual([H.threadId]);
    const page = await readCoordinator();
    expect(page.messages).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  test('parallel sends create the thread once when none exists', async () => {
    H.s.db.delete(chiefThread).where(eq(chiefThread.id, H.threadId)).run();
    const [a, b] = await Promise.all([sendToCoordinator('first'), sendToCoordinator('second')]);
    const aThread = ((await a.json()) as SendReply).thread.id;
    const bThread = ((await b.json()) as SendReply).thread.id;
    expect(aThread).toBe(bThread);
    expect(activeThreads().map((t) => t.id)).toEqual([aThread]);
  });

  test('the database refuses a second active Coordinator thread', () => {
    expect(() => seedThread(`chief-${newUuidv7()}`)).toThrow();
    seedThread(`chief-${newUuidv7()}`, { archivedAt: 5 });
    expect(activeThreads()).toHaveLength(1);
  });

  test('a send tags the message with the project and stays on the one thread', async () => {
    const other = await postProject(H.s.app, 'cairn-site');
    const first = await sendToCoordinator('plan the next batch', H.projectId);
    expect(first.status).toBe(201);
    const sent = (await first.json()) as SendReply;
    expect(sent.thread.id).toBe(H.threadId);
    const second = (await (await sendToCoordinator('and the site', other)).json()) as SendReply;
    expect(second.thread.id).toBe(H.threadId);
    const untagged = (await (await sendToCoordinator('anything else')).json()) as SendReply;
    expect(untagged.thread.id).toBe(H.threadId);

    const page = await readCoordinator();
    expect(page.messages.map((m) => [m.content, m.projectId])).toEqual([
      ['plan the next batch', H.projectId],
      ['and the site', other],
      ['anything else', null],
    ]);
    expect(chiefPrompts(H.threadId)[0]).toContain(`demo（id: ${H.projectId}）`);
    expect(activeThreads()).toHaveLength(1);
  });

  test('the team thread routes reuse the one thread', async () => {
    const res = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/chief/threads`, {
      content: 'new topic',
      projectId: H.projectId,
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as SendReply).thread.id).toBe(H.threadId);
    const list = (await (
      await req(H.s.app, 'GET', `/api/teams/${H.teamId}/chief/threads`)
    ).json()) as { id: string }[];
    expect(list.map((t) => t.id)).toEqual([H.threadId]);
  });

  test('the team thread route opens the thread when none exists', async () => {
    H.s.db.delete(chiefThread).where(eq(chiefThread.id, H.threadId)).run();
    const res = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/chief/threads`, {
      content: 'first',
    });
    expect(res.status).toBe(201);
    const created = ((await res.json()) as SendReply).thread.id;
    expect(activeThreads().map((t) => t.id)).toEqual([created]);
    expect((await threadList()).map((t) => t.id)).toEqual([created]);
  });

  test('archived threads stay out of the list and are not chosen', async () => {
    const old = `chief-${newUuidv7()}`;
    seedThread(old, { archivedAt: 5, projectId: H.projectId });
    expect((await threadList()).map((t) => t.id)).toEqual([H.threadId]);
    const sent = (await (await sendToCoordinator('hi')).json()) as SendReply;
    expect(sent.thread.id).toBe(H.threadId);
  });

  test('a blank send is rejected and stores nothing', async () => {
    expect((await sendToCoordinator('')).status).toBe(400);
    expect((await readCoordinator()).messages).toEqual([]);
  });

  test('a project of another team is refused and stores nothing', async () => {
    seedOtherTeamProject();
    expect((await sendToCoordinator('hi', 'proj-other')).status).toBe(400);
    expect((await readCoordinator()).messages).toEqual([]);
  });

  test('the per-project Coordinator routes are gone', async () => {
    expect((await req(H.s.app, 'GET', `/api/projects/${H.projectId}/coordinator`)).status).toBe(
      404,
    );
    expect(
      (
        await req(H.s.app, 'POST', `/api/projects/${H.projectId}/coordinator/messages`, {
          content: 'hi',
        })
      ).status,
    ).toBe(404);
  });

  test('another team id is not found', async () => {
    seedOtherTeamProject();
    expect((await req(H.s.app, 'GET', '/api/teams/team-other/chief')).status).toBe(404);
    expect(
      (await req(H.s.app, 'POST', '/api/teams/team-other/chief/threads', { content: 'hi' })).status,
    ).toBe(404);
  });
});

describe('Coordinator page cursor and project tags', () => {
  test('messages keep their project tags in the page', async () => {
    const other = await postProject(H.s.app, 'cairn-site');
    seedMessage('m1', 10, H.projectId);
    seedMessage('m2', 20, other);
    seedMessage('m3', 30, null);
    seedMessage('m4', 40, H.projectId);
    const page = await readCoordinator();
    expect(page.messages.map((m) => [m.id, m.projectId])).toEqual([
      ['m1', H.projectId],
      ['m2', other],
      ['m3', null],
      ['m4', H.projectId],
    ]);
  });

  test('?before walks back page by page, oldest first, ties broken by insertion order', async () => {
    for (const [id, at] of [
      ['a', 10],
      ['b', 20],
      ['c', 20],
      ['d', 20],
      ['e', 30],
    ] as const)
      seedMessage(id, at, null);
    const newest = await readCoordinator('?limit=2');
    expect(newest.messages.map((m) => m.id)).toEqual(['d', 'e']);
    expect(newest.nextCursor).toBe('d');
    const middle = await readCoordinator('?limit=2&before=d');
    expect(middle.messages.map((m) => m.id)).toEqual(['b', 'c']);
    expect(middle.nextCursor).toBe('b');
    const oldest = await readCoordinator('?limit=2&before=b');
    expect(oldest.messages.map((m) => m.id)).toEqual(['a']);
    expect(oldest.nextCursor).toBeNull();
    const past = await readCoordinator('?limit=2&before=a');
    expect(past.messages).toEqual([]);
    expect(past.nextCursor).toBeNull();
  });

  test('rows written during a turn carry that turn project, even with another turn queued', async () => {
    const site = await postProject(H.s.app, 'cairn-site');
    const a = ((await (await sendToCoordinator('plan demo', H.projectId)).json()) as SendReply)
      .message.id;
    const b = ((await (await sendToCoordinator('plan the site', site)).json()) as SendReply).message
      .id;
    const status = (id: string, value: 'claimed' | 'done') =>
      H.s.db
        .update(stepTable)
        .set({ status: value, claimedAt: Date.now() })
        .where(eq(stepTable.id, id))
        .run();
    status(a, 'claimed');
    upsertChiefMessage(H.s.db, {
      id: `user-${a}`,
      threadId: H.threadId,
      role: 'user',
      content: 'p',
      createdAt: Date.now() + 10,
    });
    upsertChiefMessage(H.s.db, {
      id: 'reply-a',
      threadId: H.threadId,
      role: 'assistant',
      content: 'r',
      createdAt: Date.now() + 11,
    });
    status(a, 'done');
    await new Promise((resolve) => setTimeout(resolve, 2));
    status(b, 'claimed');
    upsertChiefMessage(H.s.db, {
      id: 'reply-b',
      threadId: H.threadId,
      role: 'assistant',
      content: 'r',
      createdAt: Date.now() + 12,
    });
    const page = await readCoordinator();
    const tags = new Map(page.messages.map((m) => [m.id, m.projectId]));
    expect(tags.get(a)).toBe(H.projectId);
    expect(tags.get(`user-${a}`)).toBe(H.projectId);
    expect(tags.get('reply-a')).toBe(H.projectId);
    expect(tags.get(b)).toBe(site);
    expect(tags.get('reply-b')).toBe(site);
  });

  test('rows of a wake turn stay untagged even after a later tagged user message', async () => {
    const wake = enqueueChiefStep(H.s.svc, H.threadId, {
      prompt: 'gate facts',
      trigger: 'gate',
      provenance: 'watch:test',
      ownerMessageIds: [],
    });
    H.s.db
      .update(stepTable)
      .set({ status: 'claimed', claimedAt: Date.now() })
      .where(eq(stepTable.id, wake))
      .run();
    await sendToCoordinator('meanwhile, demo', H.projectId);
    upsertChiefMessage(H.s.db, {
      id: 'wake-reply',
      threadId: H.threadId,
      role: 'assistant',
      content: 'r',
      createdAt: Date.now() + 5,
    });
    upsertChiefMessage(H.s.db, {
      id: `user-${wake}`,
      threadId: H.threadId,
      role: 'user',
      content: 'p',
      createdAt: Date.now() + 6,
    });
    const rows = H.s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, H.threadId))
      .all();
    expect(rows.find((r) => r.id === 'wake-reply')?.projectId).toBeNull();
    expect(rows.find((r) => r.id === `user-${wake}`)?.projectId).toBeNull();
  });

  test('rows written between turns are not attributed to the finished turn, and explicit null stays null', async () => {
    const a = ((await (await sendToCoordinator('plan demo', H.projectId)).json()) as SendReply)
      .message.id;
    H.s.db
      .update(stepTable)
      .set({ status: 'done', claimedAt: Date.now(), finishedAt: Date.now() })
      .where(eq(stepTable.id, a))
      .run();
    upsertChiefMessage(H.s.db, {
      id: 'wake-report',
      threadId: H.threadId,
      role: 'system',
      content: 's',
      createdAt: Date.now() + 1,
      projectId: null,
    });
    upsertChiefMessage(H.s.db, {
      id: 'between-turns',
      threadId: H.threadId,
      role: 'system',
      content: 's',
      createdAt: Date.now() + 2,
    });
    const rows = H.s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, H.threadId))
      .all();
    expect(rows.find((r) => r.id === 'wake-report')?.projectId).toBeNull();
    expect(rows.find((r) => r.id === 'between-turns')?.projectId).toBeNull();
  });

  test('a worker report carries its task project', async () => {
    const created = (await relay('create_todo', ownerTodo('watched'))) as { id: string };
    await relay('watch_todos', { todoIds: [created.id] });
    H.s.db.update(todoTable).set({ phase: 'review' }).where(eq(todoTable.id, created.id)).run();
    const deps = { db: H.s.db, hub: H.s.hub, user: H.s.user };
    triggerChiefWakes(deps, getTodo(deps, created.id)!, 'done');
    const report = H.s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, H.threadId))
      .all()
      .find((r) => r.role === 'system');
    expect(report?.projectId).toBe(H.projectId);
  });

  test('the default page is the newest 100', async () => {
    for (let i = 0; i < 105; i += 1) seedMessage(`n${String(i).padStart(3, '0')}`, i, null);
    const page = await readCoordinator();
    expect(page.messages).toHaveLength(100);
    expect(page.messages[0]?.id).toBe('n005');
    expect(page.nextCursor).toBe('n005');
  });

  test('a cursor outside the thread or a bad limit is rejected', async () => {
    const old = `chief-${newUuidv7()}`;
    seedThread(old, { archivedAt: 5 });
    seedMessage('elsewhere', 10, null, old);
    const conv = () => `/api/conversations/${H.threadId}/messages`;
    expect((await req(H.s.app, 'GET', `${conv()}?before=elsewhere`)).status).toBe(404);
    expect((await req(H.s.app, 'GET', `${conv()}?before=missing`)).status).toBe(404);
    expect((await req(H.s.app, 'GET', `${conv()}?limit=0`)).status).toBe(400);
    expect((await req(H.s.app, 'GET', `${conv()}?limit=abc`)).status).toBe(400);
  });

  test('messages tagged with a deleted project stay readable', async () => {
    const other = await postProject(H.s.app, 'cairn-site');
    seedMessage('gone', 10, other);
    expect((await req(H.s.app, 'DELETE', `/api/projects/${other}`)).status).toBe(204);
    const page = await readCoordinator();
    expect(page.messages.map((m) => [m.id, m.projectId])).toEqual([['gone', other]]);
    expect((await sendToCoordinator('hi', other)).status).toBe(400);
  });
});

describe('archived projects stay read-only for the Coordinator', () => {
  test('archive stamps archivedAt, unarchive clears it, and the project list shows both', async () => {
    const archived = await req(H.s.app, 'POST', `/api/projects/${H.projectId}/archive`);
    expect(archived.status).toBe(200);
    const record = (await archived.json()) as { archivedAt?: number | null };
    expect(typeof record.archivedAt).toBe('number');
    const list = (await (await req(H.s.app, 'GET', '/api/projects')).json()) as {
      id: string;
      archivedAt?: number | null;
    }[];
    expect(list.find((p) => p.id === H.projectId)?.archivedAt).toBe(record.archivedAt);
    const restored = await req(H.s.app, 'POST', `/api/projects/${H.projectId}/unarchive`);
    expect(restored.status).toBe(200);
    expect(((await restored.json()) as { archivedAt?: number | null }).archivedAt).toBeNull();
  });

  test('archiving twice keeps the first archivedAt', async () => {
    const first = (await (
      await req(H.s.app, 'POST', `/api/projects/${H.projectId}/archive`)
    ).json()) as { archivedAt: number };
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = (await (
      await req(H.s.app, 'POST', `/api/projects/${H.projectId}/archive`)
    ).json()) as { archivedAt: number };
    expect(second.archivedAt).toBe(first.archivedAt);
  });

  test('a send naming an archived project is refused on every send route', async () => {
    await archive(H.projectId);
    expect((await sendToCoordinator('hi', H.projectId)).status).toBe(409);
    const conv = await req(H.s.app, 'POST', `/api/conversations/${H.threadId}/messages`, {
      content: 'hi',
      projectId: H.projectId,
    });
    expect(conv.status).toBe(409);
    expect((await readCoordinator()).messages).toEqual([]);
    expect(chiefPrompts(H.threadId)).toEqual([]);
    expect((await sendToCoordinator('untagged still works')).status).toBe(201);
  });

  test('an archived project accepts sends again once unarchived', async () => {
    await archive(H.projectId);
    expect((await sendToCoordinator('hi', H.projectId)).status).toBe(409);
    await req(H.s.app, 'POST', `/api/projects/${H.projectId}/unarchive`);
    expect((await sendToCoordinator('hi', H.projectId)).status).toBe(201);
  });

  test('a rewind replaying a turn of an archived project is refused', async () => {
    const sent = (await (await sendToCoordinator('hi', H.projectId)).json()) as SendReply;
    H.s.db.update(chiefThread).set({ activeRun: null }).where(eq(chiefThread.id, H.threadId)).run();
    await archive(H.projectId);
    const res = await req(
      H.s.app,
      'POST',
      `/api/teams/${H.teamId}/chief/threads/${H.threadId}/rewind`,
      { messageId: sent.message.id },
    );
    expect(res.status).toBe(409);
    expect(chiefPrompts(H.threadId)).toHaveLength(1);
  });

  test('an archived Coordinator thread refuses sends and rewinds', async () => {
    const old = `chief-${newUuidv7()}`;
    seedThread(old, { archivedAt: 5 });
    seedMessage('old-msg', 10, null, old);
    const send = await req(H.s.app, 'POST', `/api/conversations/${old}/messages`, {
      content: 'still there?',
    });
    expect(send.status).toBe(409);
    const rewind = await req(
      H.s.app,
      'POST',
      `/api/teams/${H.teamId}/chief/threads/${old}/rewind`,
      {
        messageId: 'old-msg',
      },
    );
    expect(rewind.status).toBe(409);
    expect(chiefPrompts(old)).toEqual([]);
  });

  test('archive_todos ends an unfinished task as archived, unarchive_todos reopens it, unknown ids are skipped', async () => {
    const created = (await relay('create_todo', ownerTodo('put away'))) as { id: string };
    const out = (await relay('archive_todos', { todoIds: [created.id, 'nope'] })) as {
      archived: string[];
      skipped: string[];
    };
    expect(out.archived).toEqual([created.id]);
    expect(out.skipped).toEqual(['nope']);
    const archived = getTodo({ db: H.s.db }, created.id);
    expect(archived?.archivedAt).toBeTypeOf('number');
    expect(archived?.phase).toBe('closed');
    const back = (await relay('unarchive_todos', { todoIds: [created.id] })) as {
      unarchived: string[];
      started: string[];
    };
    expect(back.unarchived).toEqual([created.id]);
    expect(back.started).toEqual([created.id]);
    const reopened = getTodo({ db: H.s.db }, created.id);
    expect(reopened?.archivedAt).toBeNull();
    expect(reopened?.phase).toBe('queued');
  });

  test('Coordinator tool writes targeting an archived project are refused; reads still work', async () => {
    const created = (await relay('create_todo', ownerTodo('kept'))) as { id: string };
    await archive(H.projectId);
    await expect(relay('create_todo', ownerTodo('new'))).rejects.toThrow(/archived/);
    await expect(relay('archive_todos', { todoIds: [created.id] })).rejects.toThrow(/archived/);
    await expect(relay('update_todo', { todoId: created.id, title: 'x' })).rejects.toThrow(
      /archived/,
    );
    await expect(
      relay('update_project', { projectId: H.projectId, name: 'renamed' }),
    ).rejects.toThrow(/archived/);
    await expect(relay('open_thread', { todoId: created.id })).rejects.toThrow(/archived/);
    await expect(
      relay('save_memory', { scope: H.projectId, file: 't', content: 'c' }),
    ).rejects.toThrow(/archived/);
    const other = await postProject(H.s.app, 'cairn-site');
    const otherTodo = (await relay('create_todo', ownerTodo('other', other))) as { id: string };
    await expect(
      relay('update_todo', { todoId: otherTodo.id, projectId: H.projectId }),
    ).rejects.toThrow(/archived/);
    const row = H.s.db.select().from(todoTable).where(eq(todoTable.id, created.id)).get();
    expect([row?.title, row?.phase]).toEqual(['kept', 'queued']);
    const listed = (await relay('todos', { projectId: H.projectId })) as unknown;
    expect(JSON.stringify(listed)).toContain(created.id);
  });

  test('scheduled tasks of an archived project do not come due until it is unarchived', async () => {
    const res = await req(H.s.app, 'POST', `/api/projects/${H.projectId}/todos`, {
      title: 'nightly check',
      spec: '> run it',
    });
    const todoId = ((await res.json()) as { id: string }).id;
    H.s.db
      .insert(scheduleTable)
      .values({
        id: 'due-1',
        teamId: H.teamId,
        projectId: H.projectId,
        todoId,
        kind: 'daily',
        tz: 'UTC',
        createdBy: H.userId,
        nextRunAt: 1,
      })
      .run();
    const deps = { db: H.s.db, hub: H.s.hub };
    expect(dueSchedules(deps, 10).map((r) => r.id)).toEqual(['due-1']);
    await archive(H.projectId);
    expect(dueSchedules(deps, 10)).toEqual([]);
    await req(H.s.app, 'POST', `/api/projects/${H.projectId}/unarchive`);
    expect(dueSchedules(deps, 10).map((r) => r.id)).toEqual(['due-1']);
  });

  test('archiving a project of another team is not found', async () => {
    seedOtherTeamProject();
    expect((await req(H.s.app, 'POST', '/api/projects/proj-other/archive')).status).toBe(404);
  });
});
