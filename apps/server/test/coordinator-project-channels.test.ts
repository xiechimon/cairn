import { threadReportContentSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { chiefMessage, chiefThread, project, routingRule, step } from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import { newUuidv7, nowMs } from '../src/lib/ids.js';
import {
  addChiefWatch,
  composeChiefSystemPrompt,
  enqueueChiefStep,
  postThreadReport,
  sendChiefMessage,
} from '../src/services/chief.js';
import { getTodo } from '../src/services/todos.js';
import { H, registerChiefHarness, relay, toolDeps } from './chief-harness.js';
import { postProject, req } from './helpers.js';

registerChiefHarness();

function deps() {
  return {
    db: H.s.db,
    hub: H.s.hub,
    convHub: H.s.convHub,
    machineHub: H.s.machineHub,
    user: H.s.user,
  };
}

async function openChannel(projectId: string = H.projectId) {
  const res = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/chief/channels/${projectId}`);
  return { status: res.status, body: (await res.json()) as { id: string; projectId: string } };
}

function stepsOf(threadId: string) {
  return H.s.db.select().from(step).where(eq(step.buildId, threadId)).all();
}

function rowsOf(threadId: string) {
  return H.s.db.select().from(chiefMessage).where(eq(chiefMessage.threadId, threadId)).all();
}

describe('Coordinator project channels (docs/design/coordinator-project-channels.md)', () => {
  test('opening a project channel creates its own thread once and queues one greeting turn', async () => {
    const first = await openChannel();
    expect(first.status).toBe(201);
    expect(first.body.projectId).toBe(H.projectId);
    expect(first.body.id).not.toBe(H.threadId);
    const greetings = stepsOf(first.body.id);
    expect(greetings).toHaveLength(1);
    expect(greetings[0]!.scopeProjectId).toBe(H.projectId);
    expect(greetings[0]!.prompt).toContain('【新频道】');
    expect(greetings[0]!.prompt).toContain(`以「${H.s.user.displayName}」称呼用户`);
    expect(rowsOf(first.body.id)).toEqual([]);

    const again = await openChannel();
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    expect(stepsOf(first.body.id)).toHaveLength(1);
  });

  test('the thread list puts the main thread first, then project channels', async () => {
    const channel = await openChannel();
    const res = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/chief/threads`);
    const threads = (await res.json()) as { id: string; projectId: string | null }[];
    expect(threads.map((t) => [t.id, t.projectId])).toEqual([
      [H.threadId, null],
      [channel.body.id, H.projectId],
    ]);
  });

  test('the index allows one active thread per Coordinator and scope', async () => {
    const channel = await openChannel();
    const now = nowMs();
    const duplicate = (projectId: string | null) =>
      H.s.db
        .insert(chiefThread)
        .values({
          id: `chief-${newUuidv7()}`,
          chiefId: H.chiefId,
          userId: H.userId,
          teamId: H.teamId,
          projectId,
          title: 'x',
          createdAt: now,
          updatedAt: now,
          sessionRuntime: 'pi',
          sessionId: '',
          sessionOpenedAt: now,
        })
        .run();
    expect(() => duplicate(H.projectId)).toThrow(/UNIQUE/);
    expect(() => duplicate(null)).toThrow(/UNIQUE/);
    H.s.db
      .update(chiefThread)
      .set({ archivedAt: now })
      .where(eq(chiefThread.id, channel.body.id))
      .run();
    expect(() => duplicate(H.projectId)).not.toThrow();
  });

  test('without a Coordinator model the channel opens with no greeting turn', async () => {
    H.s.db.delete(routingRule).where(eq(routingRule.use, 'coordinator')).run();
    const channel = await openChannel();
    expect(channel.status).toBe(201);
    expect(stepsOf(channel.body.id)).toEqual([]);
  });

  test('an archived project or one outside the team cannot open a channel', async () => {
    H.s.db.update(project).set({ archivedAt: nowMs() }).where(eq(project.id, H.projectId)).run();
    expect((await openChannel()).status).toBe(409);
    expect((await openChannel('missing-project')).status).toBe(404);
  });

  test('the owner sending first drops the unstarted greeting and the message lands in the channel', async () => {
    const channel = await openChannel();
    const sent = sendChiefMessage(deps(), H.teamId, {
      threadId: channel.body.id,
      content: '先看看 README',
    });
    expect(sent.thread.id).toBe(channel.body.id);
    const steps = stepsOf(channel.body.id);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.prompt).toContain('先看看 README');
    expect(steps[0]!.prompt).not.toContain('【新频道】');
    expect(steps[0]!.scopeProjectId).toBe(H.projectId);
    expect(rowsOf(channel.body.id).map((r) => [r.role, r.projectId])).toEqual([
      ['user', H.projectId],
    ]);
    expect(rowsOf(H.threadId)).toEqual([]);
  });

  test('a send naming another project on a channel thread is refused', async () => {
    const channel = await openChannel();
    const other = await postProject(H.s.app, 'other');
    const res = await req(H.s.app, 'POST', `/api/conversations/${channel.body.id}/messages`, {
      content: 'x',
      projectId: other,
    });
    expect(res.status).toBe(400);
  });

  test('a main-channel send tagged with a project still lands in the main thread', () => {
    const sent = sendChiefMessage(deps(), H.teamId, {
      threadId: H.threadId,
      content: 'main',
      projectId: H.projectId,
    });
    expect(sent.thread.id).toBe(H.threadId);
    expect(rowsOf(H.threadId).map((r) => r.projectId)).toEqual([H.projectId]);
  });

  test('every turn on a channel thread is scoped to its project', async () => {
    const channel = await openChannel();
    const other = await postProject(H.s.app, 'other');
    const id = enqueueChiefStep(deps(), channel.body.id, {
      prompt: 'wake',
      trigger: 'settle',
      provenance: 'watch:x',
      ownerMessageIds: [],
      scopeProjectId: other,
    });
    expect(H.s.db.select().from(step).where(eq(step.id, id)).get()!.scopeProjectId).toBe(
      H.projectId,
    );
  });

  test('the channel system prompt names its project and the team-scope memory rule', async () => {
    const channel = await openChannel();
    const channelPrompt = composeChiefSystemPrompt(toolDeps(), H.teamId, channel.body.id);
    expect(channelPrompt).toContain('## 频道');
    expect(channelPrompt).toContain(`（id: ${H.projectId}）的频道`);
    expect(channelPrompt).toContain('存进团队 scope 的记忆');
    expect(composeChiefSystemPrompt(toolDeps(), H.teamId, H.threadId)).not.toContain('## 频道');
  });

  test('a report for a channel task lands in the channel and mirrors one line to the main channel', async () => {
    const channel = await openChannel();
    const created = await req(H.s.app, 'POST', `/api/projects/${H.projectId}/todos`, {
      title: 'Export the board',
      spec: 'Add an export.',
    });
    const todoId = ((await created.json()) as { id: string }).id;
    const record = getTodo(deps(), todoId)!;
    addChiefWatch(deps(), {
      teamId: H.teamId,
      todo: record,
      projectName: 'demo',
      threadId: channel.body.id,
    });
    postThreadReport(deps(), record, 'needs-you', 'Which format?');
    const reportOf = (threadId: string) =>
      rowsOf(threadId).map((r) => threadReportContentSchema.parse(JSON.parse(String(r.content))));
    expect(reportOf(channel.body.id).map((r) => [r.todoId, r.phase, r.line])).toEqual([
      [todoId, 'needs-you', 'Which format?'],
    ]);
    expect(reportOf(H.threadId).map((r) => [r.todoId, r.phase, r.line])).toEqual([
      [todoId, 'needs-you', 'Which format?'],
    ]);
  });

  test('a report for a main-channel task is not mirrored', async () => {
    const created = await req(H.s.app, 'POST', `/api/projects/${H.projectId}/todos`, {
      title: 'Export the board',
      spec: 'Add an export.',
    });
    const record = getTodo(deps(), ((await created.json()) as { id: string }).id)!;
    addChiefWatch(deps(), {
      teamId: H.teamId,
      todo: record,
      projectName: 'demo',
      threadId: H.threadId,
    });
    postThreadReport(deps(), record, 'needs-you', 'Which format?');
    expect(rowsOf(H.threadId)).toHaveLength(1);
  });

  test('deleting a project archives its channel thread and keeps the main thread', async () => {
    const channel = await openChannel();
    H.s.db.delete(step).where(eq(step.buildId, channel.body.id)).run();
    H.s.db
      .update(chiefThread)
      .set({ activeRun: null })
      .where(eq(chiefThread.id, channel.body.id))
      .run();
    const res = await req(H.s.app, 'DELETE', `/api/projects/${H.projectId}`);
    expect(res.status).toBeLessThan(300);
    const archived = H.s.db
      .select()
      .from(chiefThread)
      .where(eq(chiefThread.id, channel.body.id))
      .get()!;
    expect(archived.archivedAt).not.toBeNull();
    const main = H.s.db.select().from(chiefThread).where(eq(chiefThread.id, H.threadId)).get()!;
    expect(main.archivedAt).toBeNull();
  });

  test('channel_messages reads and searches another channel and refuses its own', async () => {
    const channel = await openChannel();
    const at = nowMs();
    const seed = (
      threadId: string,
      id: string,
      content: string,
      offset: number,
      projectId?: string,
    ) =>
      H.s.db
        .insert(chiefMessage)
        .values({
          id,
          threadId,
          role: 'user',
          content,
          projectId: projectId ?? null,
          createdAt: at + offset,
        })
        .run();
    seed(H.threadId, 'main-old', 'Export the board as CSV', 1, H.projectId);
    seed(H.threadId, 'main-new', 'Pause all merges tonight', 2);
    seed(channel.body.id, 'chan-1', 'Ship the CSV export first', 3);
    const fromChannel = { threadId: channel.body.id, conversationId: channel.body.id };
    const list = (await relay('channel_messages', { channel: 'main' }, fromChannel)) as {
      trust: string;
      opened: boolean;
      messages: { id: string }[];
    };
    expect(list.trust).toBe('untrusted-history');
    expect(list.opened).toBe(true);
    expect(list.messages.slice(0, 2).map((m) => m.id)).toEqual(['main-new', 'main-old']);
    expect(list.messages.map((m) => m.id)).not.toContain('chan-1');
    const found = (await relay(
      'channel_messages',
      { channel: 'main', query: 'csv' },
      fromChannel,
    )) as {
      hits: { id: string; projectId: string | null }[];
    };
    expect(found.hits.map((h) => [h.id, h.projectId])).toEqual([['main-old', H.projectId]]);
    const back = (await relay('channel_messages', { channel: H.projectId, query: 'csv' })) as {
      hits: { id: string }[];
    };
    expect(back.hits.map((h) => h.id)).toEqual(['chan-1']);
    expect(await relay('channel_messages', { channel: 'no-such-project' })).toMatchObject({
      opened: false,
      messages: [],
    });
    const refused = await relay('channel_messages', { channel: H.projectId }, fromChannel).then(
      () => 0,
      (err: unknown) => (err instanceof HttpError ? err.status : -1),
    );
    expect(refused).toBe(400);
  });
});
