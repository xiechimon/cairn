import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  chiefThread,
  project as projectTable,
  schedule as scheduleTable,
  step as stepTable,
  team as teamTable,
} from '../src/db/schema.js';
import { dueSchedules } from '../src/services/schedules.js';
import { H, registerChiefHarness } from './chief-harness.js';
import { postProject, req } from './helpers.js';

registerChiefHarness();

interface CoordinatorSend {
  thread: { id: string; projectId: string | null };
  message: { content: string };
}

async function sendToCoordinator(projectId: string, content: string) {
  return req(H.s.app, 'POST', `/api/projects/${projectId}/coordinator/messages`, { content });
}

async function coordinatorOf(projectId: string) {
  const res = await req(H.s.app, 'GET', `/api/projects/${projectId}/coordinator`);
  expect(res.status).toBe(200);
  return (await res.json()) as { thread: { id: string; projectId: string | null } | null };
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

async function postTodo(projectId: string) {
  const res = await req(H.s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: 'nightly check',
    spec: '> run it',
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

function seedDueSchedule(projectId: string, todoId: string) {
  H.s.db
    .insert(scheduleTable)
    .values({
      id: `due-${projectId}`,
      teamId: H.teamId,
      projectId,
      todoId,
      kind: 'daily',
      tz: 'UTC',
      createdBy: H.userId,
      nextRunAt: 1,
    })
    .run();
}

describe('project Coordinator conversation (D37)', () => {
  test('a project without a conversation reports no thread', async () => {
    expect(await coordinatorOf(H.projectId)).toEqual({ thread: null });
  });

  test('the first message opens a thread bound to the project and later messages reuse it', async () => {
    const first = await sendToCoordinator(H.projectId, 'plan the next batch');
    expect(first.status).toBe(201);
    const opened = (await first.json()) as CoordinatorSend;
    expect(opened.thread.projectId).toBe(H.projectId);
    expect(opened.message.content).toBe('plan the next batch');

    const second = await sendToCoordinator(H.projectId, 'and review what merged');
    expect(second.status).toBe(201);
    expect(((await second.json()) as CoordinatorSend).thread.id).toBe(opened.thread.id);

    expect((await coordinatorOf(H.projectId)).thread?.id).toBe(opened.thread.id);
    const prompts = chiefPrompts(opened.thread.id);
    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) expect(prompt).toContain(`demo（id: ${H.projectId}）`);
  });

  test('each project keeps its own conversation', async () => {
    const other = await postProject(H.s.app, 'cairn-site');
    const a = (await (await sendToCoordinator(H.projectId, 'one')).json()) as CoordinatorSend;
    const b = (await (await sendToCoordinator(other, 'two')).json()) as CoordinatorSend;
    expect(a.thread.id).not.toBe(b.thread.id);
    expect(b.thread.projectId).toBe(other);
  });

  test('the team thread list leaves project conversations out', async () => {
    const sent = (await (await sendToCoordinator(H.projectId, 'hi')).json()) as CoordinatorSend;
    const res = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/chief/threads`);
    const threads = (await res.json()) as { id: string; projectId?: string | null }[];
    expect(threads.map((t) => t.id)).not.toContain(sent.thread.id);
    expect(threads.find((t) => t.id === H.threadId)?.projectId).toBeNull();
  });

  test('a follow-up through the conversation route stays on the bound project', async () => {
    const other = await postProject(H.s.app, 'cairn-site');
    const sent = (await (await sendToCoordinator(H.projectId, 'hi')).json()) as CoordinatorSend;
    const res = await req(H.s.app, 'POST', `/api/conversations/${sent.thread.id}/messages`, {
      content: 'again',
      projectId: other,
    });
    expect(res.status).toBe(201);
    expect(chiefPrompts(sent.thread.id).at(-1)).toContain(`demo（id: ${H.projectId}）`);
  });

  test('a blank message is rejected and opens nothing', async () => {
    expect((await sendToCoordinator(H.projectId, '   ')).status).toBe(400);
    expect((await coordinatorOf(H.projectId)).thread).toBeNull();
  });

  test('a project of another team is not found', async () => {
    H.s.db.insert(teamTable).values({ id: 'team-other', name: 'other', createdAt: 0 }).run();
    H.s.db
      .insert(projectTable)
      .values({ id: 'proj-other', name: 'secret', teamId: 'team-other', repoKind: 'hosted' })
      .run();
    expect((await sendToCoordinator('proj-other', 'hi')).status).toBe(404);
    expect((await req(H.s.app, 'GET', '/api/projects/proj-other/coordinator')).status).toBe(404);
  });

  test('deleting the project unbinds its conversation instead of failing', async () => {
    const sent = (await (await sendToCoordinator(H.projectId, 'hi')).json()) as CoordinatorSend;
    expect((await req(H.s.app, 'DELETE', `/api/projects/${H.projectId}`)).status).toBe(204);
    const row = H.s.db.select().from(chiefThread).where(eq(chiefThread.id, sent.thread.id)).get();
    expect(row?.projectId).toBeNull();
  });
});

describe('project archive', () => {
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

  test('an archived project refuses follow-ups through the conversation route', async () => {
    const sent = (await (await sendToCoordinator(H.projectId, 'hi')).json()) as CoordinatorSend;
    await req(H.s.app, 'POST', `/api/projects/${H.projectId}/archive`);
    const res = await req(H.s.app, 'POST', `/api/conversations/${sent.thread.id}/messages`, {
      content: 'still there?',
    });
    expect(res.status).toBe(409);
    expect(chiefPrompts(sent.thread.id)).toHaveLength(1);
  });

  test('an archived project refuses a rewind of its Coordinator conversation', async () => {
    const sent = (await (await sendToCoordinator(H.projectId, 'hi')).json()) as {
      thread: { id: string };
      message: { id: string };
    };
    H.s.db
      .update(chiefThread)
      .set({ activeRun: null })
      .where(eq(chiefThread.id, sent.thread.id))
      .run();
    await req(H.s.app, 'POST', `/api/projects/${H.projectId}/archive`);
    const res = await req(
      H.s.app,
      'POST',
      `/api/teams/${H.teamId}/chief/threads/${sent.thread.id}/rewind`,
      { messageId: sent.message.id },
    );
    expect(res.status).toBe(409);
    expect(chiefPrompts(sent.thread.id)).toHaveLength(1);
  });

  test('an archived project refuses Coordinator messages until unarchived', async () => {
    await req(H.s.app, 'POST', `/api/projects/${H.projectId}/archive`);
    expect((await sendToCoordinator(H.projectId, 'hi')).status).toBe(409);
    expect((await coordinatorOf(H.projectId)).thread).toBeNull();
    await req(H.s.app, 'POST', `/api/projects/${H.projectId}/unarchive`);
    expect((await sendToCoordinator(H.projectId, 'hi')).status).toBe(201);
  });

  test('scheduled tasks of an archived project do not come due until it is unarchived', async () => {
    const todoId = await postTodo(H.projectId);
    seedDueSchedule(H.projectId, todoId);
    const deps = { db: H.s.db, hub: H.s.hub };
    expect(dueSchedules(deps, 10).map((r) => r.id)).toEqual([`due-${H.projectId}`]);
    await req(H.s.app, 'POST', `/api/projects/${H.projectId}/archive`);
    expect(dueSchedules(deps, 10)).toEqual([]);
    await req(H.s.app, 'POST', `/api/projects/${H.projectId}/unarchive`);
    expect(dueSchedules(deps, 10).map((r) => r.id)).toEqual([`due-${H.projectId}`]);
  });

  test('archiving a project of another team is not found', async () => {
    H.s.db.insert(teamTable).values({ id: 'team-other', name: 'other', createdAt: 0 }).run();
    H.s.db
      .insert(projectTable)
      .values({ id: 'proj-other', name: 'secret', teamId: 'team-other', repoKind: 'hosted' })
      .run();
    expect((await req(H.s.app, 'POST', '/api/projects/proj-other/archive')).status).toBe(404);
  });
});
