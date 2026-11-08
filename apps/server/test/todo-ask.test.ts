import { and, eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { build, message, project, step, todo } from '../src/db/schema.js';
import { completeStep, startBuilds } from '../src/services/builds.js';
import { getTodo } from '../src/services/todos.js';
import { askWorkerQuestion } from '../src/services/worker-questions.js';
import { H, registerChiefHarness, relay } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();

const REQUEST = 'ask-dddddddd-1111-2222-3333-444444444444';
const QUESTION = [
  {
    header: 'Retry budget',
    question: 'How many reruns should the relay probe get before it gives up?',
    options: [{ label: 'Three', description: 'Matches the other probes' }, { label: 'Five' }],
  },
];

function deps() {
  return {
    db: H.s.db,
    hub: H.s.hub,
    convHub: H.s.convHub,
    machineHub: H.s.machineHub,
    user: H.s.user,
  };
}

function startedTodo(title: string) {
  const todoId = `todo-${Math.random().toString(36).slice(2, 8)}`;
  H.s.db
    .insert(todo)
    .values({
      id: todoId,
      teamId: H.teamId,
      projectId: H.projectId,
      title,
      spec: title,
      phase: 'todo',
      phaseAt: 1,
      seqNum: Math.floor(Math.random() * 10_000) + 500,
    })
    .run();
  const [started] = startBuilds(deps(), { projectId: H.projectId, todoIds: [todoId] });
  const buildId = started!.id;
  const stepRow = H.s.db.select().from(step).where(eq(step.buildId, buildId)).get()!;
  H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
  H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepRow.id)).run();
  return { todoId, buildId, stepId: stepRow.id };
}

async function escalatedQuestion() {
  const started = startedTodo('Pick the retry budget for the relay probe');
  const claimed = H.s.db.select().from(step).where(eq(step.id, started.stepId)).get()!;
  await askWorkerQuestion(
    deps(),
    claimed,
    { requestId: REQUEST, questions: QUESTION },
    { holdMs: 0 },
  );
  completeStep(deps(), started.stepId, { hasChanges: true });
  await relay('escalate_question', {
    todoId: started.todoId,
    requestId: REQUEST,
    class: 'design',
    defaultAnswer: 'Three',
  });
  return started;
}

describe('a thread waiting on you carries what it asks', () => {
  test('an escalated question puts its own text, options and the proposed default on the todo', async () => {
    const { todoId } = await escalatedQuestion();
    expect(getTodo(deps(), todoId)?.ask).toEqual({
      text: 'How many reruns should the relay probe get before it gives up?',
      requestId: REQUEST,
      options: [{ label: 'Three', description: 'Matches the other probes' }, { label: 'Five' }],
      defaultAnswer: 'Three',
    });
  });

  test('a thread in review with no question carries its one-line report', () => {
    const { todoId, buildId } = startedTodo('Fold finished turns');
    H.s.db
      .update(build)
      .set({ reportLine: 'PR is up; two screenshots attached.' })
      .where(eq(build.id, buildId))
      .run();
    H.s.db.update(todo).set({ phase: 'review' }).where(eq(todo.id, todoId)).run();
    expect(getTodo(deps(), todoId)?.ask).toEqual({
      text: 'PR is up; two screenshots attached.',
      requestId: null,
      options: [],
      defaultAnswer: null,
    });
  });

  test('a running thread carries no ask even when it has a report line', () => {
    const { todoId, buildId } = startedTodo('Serif greeting fix');
    H.s.db.update(build).set({ reportLine: 'Halfway.' }).where(eq(build.id, buildId)).run();
    expect(getTodo(deps(), todoId)?.ask).toBeUndefined();
  });
});

const SECOND = 'ask-eeeeeeee-1111-2222-3333-444444444444';

function statusOf(buildId: string, requestId: string) {
  const row = H.s.db
    .select()
    .from(message)
    .where(and(eq(message.id, requestId), eq(message.conversationId, buildId)))
    .get();
  return row?.content as { status?: string; answers?: unknown } | undefined;
}

describe('answering one shown question from the inbox', () => {
  test('settles only the request it names, with every question in that request, and leaves another pending request alone', async () => {
    const started = startedTodo('Two questions at once');
    const claimed = H.s.db.select().from(step).where(eq(step.id, started.stepId)).get()!;
    await askWorkerQuestion(
      deps(),
      claimed,
      {
        requestId: REQUEST,
        questions: [
          ...QUESTION,
          {
            header: 'Backoff',
            question: 'Linear or exponential?',
            options: [{ label: 'Linear' }, { label: 'Exponential' }],
          },
        ],
      },
      { holdMs: 0 },
    );
    await askWorkerQuestion(
      deps(),
      claimed,
      {
        requestId: SECOND,
        questions: [{ header: 'Name', question: 'Name the probe?', options: [] }],
      },
      { holdMs: 0 },
    );
    completeStep(deps(), started.stepId, { hasChanges: true });
    const res = await req(
      H.s.app,
      'POST',
      `/api/todos/${started.todoId}/questions/${REQUEST}/answer`,
      { answer: 'Three, linear' },
    );
    expect(res.status).toBe(200);
    expect(statusOf(started.buildId, REQUEST)).toMatchObject({
      status: 'answered',
      answers: [
        { header: 'Retry budget', text: 'Three, linear' },
        { header: 'Backoff', text: 'Three, linear' },
      ],
    });
    expect(statusOf(started.buildId, SECOND)?.status).toBe('pending');
  });

  test('a request that is no longer pending is refused, not applied to another one', async () => {
    const { todoId, buildId } = await escalatedQuestion();
    const first = await req(H.s.app, 'POST', `/api/todos/${todoId}/questions/${REQUEST}/answer`, {
      answer: 'Three',
    });
    expect(first.status).toBe(200);
    const again = await req(H.s.app, 'POST', `/api/todos/${todoId}/questions/${REQUEST}/answer`, {
      answer: 'Five',
    });
    expect(again.status).toBe(409);
    expect(statusOf(buildId, REQUEST)).toMatchObject({ answers: [{ text: 'Three' }] });
  });
});

describe('a request with several questions offers no one-click options', () => {
  test('the ask joins every question and drops options that would answer only the first', async () => {
    const started = startedTodo('Several questions');
    const claimed = H.s.db.select().from(step).where(eq(step.id, started.stepId)).get()!;
    await askWorkerQuestion(
      deps(),
      claimed,
      {
        requestId: REQUEST,
        questions: [
          ...QUESTION,
          { header: 'Backoff', question: 'Linear or exponential?', options: [{ label: 'Linear' }] },
        ],
      },
      { holdMs: 0 },
    );
    completeStep(deps(), started.stepId, { hasChanges: true });
    expect(getTodo(deps(), started.todoId)?.ask).toEqual({
      text: 'How many reruns should the relay probe get before it gives up?\nLinear or exponential?',
      requestId: REQUEST,
      options: [],
      defaultAnswer: null,
    });
  });
});

describe('an answer never lands in an archived project', () => {
  test('answering from a stale inbox after the project was archived is refused and the question stays pending', async () => {
    const { todoId, buildId } = await escalatedQuestion();
    H.s.db.update(project).set({ archivedAt: Date.now() }).where(eq(project.id, H.projectId)).run();
    const res = await req(H.s.app, 'POST', `/api/todos/${todoId}/questions/${REQUEST}/answer`, {
      answer: 'Three',
    });
    expect(res.status).toBe(409);
    expect(statusOf(buildId, REQUEST)?.status).toBe('pending');
  });
});
