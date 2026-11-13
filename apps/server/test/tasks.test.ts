import type { Phase, TasksQuery, TodoOwner } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { chiefMessage, chiefThread, project, team, todo } from '../src/db/schema.js';
import {
  answerQuestion,
  cancelQuestion,
  createOrGetQuestion,
} from '../src/services/chief-questions.js';
import * as ownership from '../src/services/owner.js';
import { createTodo, getTodo } from '../src/services/todos.js';
import { bootServer, postProject, req, seedRoute } from './helpers.js';

const WEEK = 7 * 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

describe('sectionOf first-match table', () => {
  const cases: {
    phase: Phase;
    owner: TodoOwner;
    reason?: 'question' | 'confirm' | 'review' | 'failed';
    section: string;
  }[] = [
    { phase: 'todo', owner: null, section: 'up_next' },
    { phase: 'queued', owner: null, section: 'working' },
    { phase: 'planning', owner: null, section: 'working' },
    { phase: 'building', owner: null, section: 'working' },
    { phase: 'needs_input', owner: 'coordinator', reason: 'question', section: 'working' },
    { phase: 'failed', owner: 'coordinator', reason: 'failed', section: 'working' },
    { phase: 'review', owner: 'coordinator', reason: 'review', section: 'working' },
    { phase: 'review', owner: null, section: 'working' },
    { phase: 'confirm', owner: 'owner', reason: 'confirm', section: 'needs_input' },
    { phase: 'building', owner: 'owner', reason: 'question', section: 'needs_input' },
    { phase: 'todo', owner: 'owner', reason: 'question', section: 'needs_input' },
    { phase: 'review', owner: 'owner', reason: 'review', section: 'ready_for_review' },
    { phase: 'done', owner: null, section: 'resolved' },
    { phase: 'closed', owner: null, section: 'resolved' },
  ];
  for (const entry of cases) {
    for (const archived of [false, true]) {
      for (const age of [0, WEEK, WEEK + 1]) {
        test(`${entry.phase}/${entry.owner}/${entry.reason} archived=${archived} age=${age}`, () => {
          const terminal = entry.phase === 'done' || entry.phase === 'closed';
          const expected = terminal
            ? age > WEEK
              ? null
              : 'resolved'
            : archived
              ? null
              : entry.section;
          const owner =
            entry.owner === null
              ? null
              : ({
                  owner: entry.owner,
                  reason: entry.reason,
                  workKey: 'test',
                } as ownership.Ownership);
          expect(
            ownership.sectionOf(
              { phase: entry.phase, phaseAt: NOW - age, archivedAt: archived ? NOW : null },
              owner,
              NOW,
            ),
          ).toBe(expected);
        });
      }
    }
  }
});

test('every todo read derives section from current ownership, without reconciliation or notification', async () => {
  const s = bootServer();
  const projectId = await postProject(s.app);
  const record = createTodo(s.svc, {
    teamId: s.team.id,
    projectId,
    title: 'Task',
    spec: '',
    createdBy: s.user.id,
    ownerId: s.user.id,
  });
  const checkpoint = s.db
    .select()
    .from(todo)
    .where(eq(todo.id, record.id))
    .get()?.lastNotifiedOwner;
  const publish = vi.spyOn(s.hub, 'publishNotification');
  expect(getTodo(s.svc, record.id)).toMatchObject({ owner: null, section: 'up_next' });
  for (const [phase, section] of [
    ['confirm', 'needs_input'],
    ['review', 'ready_for_review'],
  ] as const) {
    s.db.update(todo).set({ phase }).where(eq(todo.id, record.id)).run();
    expect(getTodo(s.svc, record.id)).toMatchObject({ owner: 'owner', section });
    const response = await req(s.app, 'GET', `/api/todos/${record.id}`);
    expect(await response.json()).toMatchObject({ section });
  }
  expect(publish).not.toHaveBeenCalled();
  expect(s.db.select().from(todo).where(eq(todo.id, record.id)).get()?.lastNotifiedOwner).toBe(
    checkpoint,
  );
});

test('one Tasks read includes open rows and recently archived rows; section uses phaseAt, not archive time', async () => {
  const s = bootServer();
  const projectId = await postProject(s.app);
  const now = Date.now();
  for (const [id, phase, archivedAt, phaseAt] of [
    ['open', 'todo', null, now - 10 * WEEK],
    ['recent', 'done', now, now],
    ['old-resolution', 'closed', now, now - WEEK - 1000],
    ['old-archive', 'done', now - WEEK - 1000, now],
    ['abandoned', 'building', now, now],
    ['unarchived-old', 'done', null, now - WEEK - 1000],
  ] as const) {
    s.db
      .insert(todo)
      .values({
        id,
        teamId: s.team.id,
        projectId,
        title: id,
        spec: '',
        phase,
        archivedAt,
        phaseAt,
        seqNum: 1,
      })
      .run();
  }
  const response = await req(s.app, 'GET', `/api/tasks?teamId=${s.team.id}`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as TasksQuery;
  expect(body).not.toHaveProperty('todos');
  expect(body).not.toHaveProperty('questions');
  expect(
    body.entries
      .map((entry) => [entry.kind === 'todo' ? entry.id : entry.requestId, entry.section])
      .sort(),
  ).toEqual([
    ['abandoned', null],
    ['old-resolution', null],
    ['open', 'up_next'],
    ['recent', 'resolved'],
    ['unarchived-old', null],
  ]);
  const sectioned = (await (
    await req(s.app, 'GET', `/api/tasks?teamId=${s.team.id}&sectioned=1`)
  ).json()) as TasksQuery;
  expect(
    sectioned.entries
      .map((entry) => [entry.kind === 'todo' ? entry.id : entry.requestId, entry.section])
      .sort(),
  ).toEqual([
    ['open', 'up_next'],
    ['recent', 'resolved'],
  ]);
  expect((await req(s.app, 'GET', '/api/todos?archived=1')).status).toBe(200);
});

test('Tasks scopes both sources to the team and lists parked pending standalone questions until answered or cancelled', async () => {
  const s = bootServer();
  seedRoute(s, 'coordinator', { provider: 'stub-gw', modelId: 'stub-model' });
  const start = await req(s.app, 'POST', `/api/teams/${s.team.id}/chief/threads`, {
    content: 'Help choose',
  });
  expect(start.status).toBe(201);
  const { thread } = (await start.json()) as { thread: { id: string } };
  const questions = [{ header: 'Scope', question: 'Which scope?', options: [] }];
  for (const requestId of ['pending', 'answered', 'cancelled']) {
    createOrGetQuestion({ db: s.db }, { threadId: thread.id, requestId, questions, askedFor: [] });
  }
  answerQuestion(
    { db: s.db },
    { threadId: thread.id, requestId: 'answered', answers: [{ header: 'Scope', text: 'small' }] },
  );
  cancelQuestion({ db: s.db }, { threadId: thread.id, requestId: 'cancelled', reason: 'Stopped' });
  const saved = s.db.select().from(chiefMessage).where(eq(chiefMessage.id, 'pending')).get()!;
  s.db
    .update(chiefMessage)
    .set({
      content: JSON.stringify({ ...JSON.parse(saved.content as string), parkedAt: Date.now() }),
    })
    .where(eq(chiefMessage.id, 'pending'))
    .run();
  const read = async (teamId: string) => {
    const response = await req(s.app, 'GET', `/api/tasks?teamId=${teamId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as TasksQuery;
    expect(Array.isArray(body.entries)).toBe(true);
    return {
      todos: body.entries.filter((entry) => entry.kind === 'todo'),
      questions: body.entries.filter((entry) => entry.kind === 'question'),
    };
  };
  expect(await read(s.team.id)).toMatchObject({
    todos: [],
    questions: [
      { requestId: 'pending', threadId: thread.id, title: 'Scope', section: 'needs_input' },
    ],
  });
  s.db.insert(team).values({ id: 'other-team', name: 'Other', createdAt: Date.now() }).run();
  s.db.insert(project).values({ id: 'other-project', teamId: 'other-team', name: 'Other' }).run();
  s.db
    .insert(todo)
    .values({
      id: 'other-todo',
      teamId: 'other-team',
      projectId: 'other-project',
      title: 'Other',
      spec: '',
      phase: 'todo',
      phaseAt: Date.now(),
      seqNum: 1,
    })
    .run();
  expect(await read(s.team.id)).toMatchObject({ todos: [] });
  expect(await read('other-team')).toMatchObject({ questions: [] });
  answerQuestion(
    { db: s.db },
    { threadId: thread.id, requestId: 'pending', answers: [{ header: 'Scope', text: 'small' }] },
  );
  expect(await read(s.team.id)).toMatchObject({ questions: [] });
  createOrGetQuestion(
    { db: s.db },
    { threadId: thread.id, requestId: 'archived', questions, askedFor: [] },
  );
  expect(await read(s.team.id)).toMatchObject({ questions: [{ requestId: 'archived' }] });
  s.db
    .update(chiefThread)
    .set({ archivedAt: Date.now() })
    .where(eq(chiefThread.id, thread.id))
    .run();
  expect(await read(s.team.id)).toMatchObject({ questions: [] });
});
