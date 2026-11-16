import { ASK_USER_QUESTION_KIND, encodeReplyQuote, type TaskRequest } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { chiefMessage, todo as todoTable } from '../src/db/schema.js';
import { newRecordId, nowMs } from '../src/lib/ids.js';
import { H, registerChiefHarness, relay } from './chief-harness.js';
import { postProject, req } from './helpers.js';
import { seedOwnerMessage } from './owner-message.js';

registerChiefHarness();

async function openChannel(projectId: string = H.projectId): Promise<string> {
  const res = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/chief/channels/${projectId}`);
  return ((await res.json()) as { id: string }).id;
}

function requestOf(todoId: string): TaskRequest | null {
  return H.s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!.request;
}

function todoCount(): number {
  return H.s.db.select().from(todoTable).all().length;
}

async function quick(
  threadId: string,
  projectId: string,
  messageId: string,
  over: { turnMessageIds?: string[]; turnPrompt?: string; params?: Record<string, unknown> } = {},
): Promise<{ id: string }> {
  return (await relay(
    'create_todo',
    { projectId, messageIds: [messageId], lane: 'quick', ...over.params },
    {
      threadId,
      conversationId: threadId,
      turnMessageIds: over.turnMessageIds ?? [messageId],
      turnPrompt: over.turnPrompt ?? 'add it',
    },
  )) as { id: string };
}

function statusOf(error: unknown): number {
  return (error as { status?: number }).status ?? -1;
}

function answeredQuestion(threadId: string, choice: string): string {
  const id = `ask-${newRecordId()
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '0')
    .padEnd(12, '0')}`;
  H.s.db
    .insert(chiefMessage)
    .values({
      id,
      threadId,
      role: 'assistant',
      content: JSON.stringify({
        kind: ASK_USER_QUESTION_KIND,
        requestId: id,
        status: 'answered',
        questions: [{ header: 'project', question: 'Which project?', options: [] }],
        answers: [{ header: 'project', choices: [choice] }],
        answeredAt: nowMs(),
        answeredBy: 'person',
      }),
      createdAt: nowMs(),
    })
    .run();
  return id;
}

describe('quick lane on create_todo (docs/design/quick-lane.md L1 to L3)', () => {
  test('L1: an owner turn in the project channel records the lane and the channel basis', async () => {
    const channel = await openChannel();
    const words = seedOwnerMessage(H.s.db, channel, 'add a node.txt that says hello');
    const created = await quick(channel, H.projectId, words);
    expect(requestOf(created.id)).toMatchObject({
      lane: 'quick',
      projectBasis: { kind: 'channel', threadId: channel },
    });
  });

  test('L1: a wake turn cannot create a quick task, and nothing is written', async () => {
    const channel = await openChannel();
    const words = seedOwnerMessage(H.s.db, channel, 'add a node.txt that says hello');
    const before = todoCount();
    const error = await quick(channel, H.projectId, words, {
      turnPrompt: '[wake:settle] task finished',
    }).catch((e: unknown) => e);
    expect(statusOf(error)).toBe(400);
    expect(todoCount()).toBe(before);
  });

  test('L1: a cited message outside the turn owner messages is refused', async () => {
    const channel = await openChannel();
    const earlier = seedOwnerMessage(H.s.db, channel, 'add a node.txt that says hello');
    const now = seedOwnerMessage(H.s.db, channel, 'go');
    const error = await quick(channel, H.projectId, earlier, { turnMessageIds: [now] }).catch(
      (e: unknown) => e,
    );
    expect(statusOf(error)).toBe(400);
    expect(todoCount()).toBe(0);
  });

  test('L1: a channel basis does not reach another project unless the owner names it', async () => {
    const other = await postProject(H.s.app, 'site');
    const channel = await openChannel();
    const plain = seedOwnerMessage(H.s.db, channel, 'add a node.txt that says hello');
    expect(statusOf(await quick(channel, other, plain).catch((e: unknown) => e))).toBe(400);
    const named = seedOwnerMessage(H.s.db, channel, 'add a node.txt to Site that says hello');
    const created = await quick(channel, other, named);
    expect(requestOf(created.id)).toMatchObject({
      lane: 'quick',
      projectBasis: { kind: 'owner-named', segment: 0, name: 'site' },
    });
  });

  test('L1: in the main channel the owner must name the project, the composer pick it or an answer choose it', async () => {
    const other = await postProject(H.s.app, 'site');
    const unnamed = seedOwnerMessage(H.s.db, H.threadId, 'add a node.txt that says hello');
    expect(statusOf(await quick(H.threadId, other, unnamed).catch((e: unknown) => e))).toBe(400);

    const picked = seedOwnerMessage(H.s.db, H.threadId, 'add a node.txt that says hello');
    H.s.db.update(chiefMessage).set({ projectId: other }).where(eq(chiefMessage.id, picked)).run();
    expect(requestOf((await quick(H.threadId, other, picked)).id)?.projectBasis).toEqual({
      kind: 'composer',
      messageId: picked,
    });

    const answer = answeredQuestion(H.threadId, 'site');
    expect(requestOf((await quick(H.threadId, other, answer)).id)?.projectBasis).toEqual({
      kind: 'owner-answer',
      segment: 0,
    });
  });

  test('L1: a one-character project name is never an owner-named basis', async () => {
    const short = await postProject(H.s.app, 'x');
    const words = seedOwnerMessage(H.s.db, H.threadId, 'add x to the readme');
    expect(statusOf(await quick(H.threadId, short, words).catch((e: unknown) => e))).toBe(400);
  });

  test('L1: a name only inside a quoted Coordinator message is not the owner naming it', async () => {
    const other = await postProject(H.s.app, 'site');
    const words = seedOwnerMessage(
      H.s.db,
      H.threadId,
      encodeReplyQuote({ sourceMessageId: 'm-1', quote: 'Should I add it to site?' }, 'yes'),
    );
    expect(statusOf(await quick(H.threadId, other, words).catch((e: unknown) => e))).toBe(400);
  });

  test('L1: a quick task cannot split a source todo', async () => {
    const channel = await openChannel();
    const words = seedOwnerMessage(H.s.db, channel, 'add a node.txt that says hello');
    const first = await quick(channel, H.projectId, words);
    const error = await relay(
      'create_todo',
      { projectId: H.projectId, sourceTodoId: first.id, lane: 'quick' },
      { threadId: channel, conversationId: channel, turnMessageIds: [words] },
    ).catch((e: unknown) => e);
    expect(statusOf(error)).toBe(400);
  });

  test('L2: moving a quick task to another project drops the lane and its basis', async () => {
    const other = await postProject(H.s.app, 'site');
    const channel = await openChannel();
    const words = seedOwnerMessage(H.s.db, channel, 'add a node.txt that says hello');
    const created = await quick(channel, H.projectId, words);
    H.s.db
      .update(todoTable)
      .set({ phase: 'todo', latestBuildId: null, lastRunAt: null })
      .where(eq(todoTable.id, created.id))
      .run();
    await relay(
      'update_todo',
      { todoId: created.id, projectId: other },
      { threadId: channel, conversationId: channel },
    );
    const request = requestOf(created.id)!;
    expect(request.lane).toBeUndefined();
    expect(request.projectBasis).toBeUndefined();
    expect(request.segments).toHaveLength(1);
  });

  test('L3: a task created without the lane carries no lane fields', async () => {
    const channel = await openChannel();
    const words = seedOwnerMessage(H.s.db, channel, 'add a node.txt that says hello');
    const created = (await relay(
      'create_todo',
      { projectId: H.projectId, messageIds: [words] },
      { threadId: channel, conversationId: channel, turnMessageIds: [words] },
    )) as { id: string };
    const request = requestOf(created.id)!;
    expect(request.lane).toBeUndefined();
    expect(request.projectBasis).toBeUndefined();
  });
});
