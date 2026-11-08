import { and, eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { build, message, steerPending, step, todo } from '../src/db/schema.js';
import { applyStepFailure, completeStep, startBuilds } from '../src/services/builds.js';
import { claimStep } from '../src/services/machines.js';
import { messageThreadAsUser } from '../src/services/thread-message.js';
import { getTodo } from '../src/services/todos.js';
import { askWorkerQuestion } from '../src/services/worker-questions.js';
import { H, registerChiefHarness, relay } from './chief-harness.js';
import { insertMachine } from './helpers.js';

registerChiefHarness();

const REQUEST_A = 'ask-aaaaaaaa-1111-2222-3333-444444444444';
const REQUEST_B = 'ask-bbbbbbbb-1111-2222-3333-444444444444';
const COPY_QUESTION = [
  {
    header: 'Conflict',
    question: 'The brief says copy byte-for-byte, the repo bans that string. Which wins?',
    options: [{ label: 'Repo rule' }, { label: 'Brief' }],
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

function seedTodo(over: Partial<typeof todo.$inferInsert> = {}) {
  const id = over.id ?? `todo-${Math.random().toString(36).slice(2, 8)}`;
  H.s.db
    .insert(todo)
    .values({
      id,
      teamId: H.teamId,
      projectId: H.projectId,
      title: 'Port the onboarding copy',
      spec: 'Copy the onboarding text byte-for-byte.',
      phase: 'todo',
      phaseAt: 1,
      seqNum: 133,
      ...over,
    })
    .run();
  return id;
}

function startSession() {
  const todoId = seedTodo();
  const [started] = startBuilds(deps(), { projectId: H.projectId, todoIds: [todoId] });
  const buildId = started!.id;
  const stepRow = H.s.db.select().from(step).where(eq(step.buildId, buildId)).get()!;
  H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
  H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepRow.id)).run();
  return {
    todoId,
    buildId,
    stepRow: H.s.db.select().from(step).where(eq(step.id, stepRow.id)).get()!,
  };
}

async function askAndPark(requestId = REQUEST_A) {
  const world = startSession();
  await askWorkerQuestion(
    deps(),
    world.stepRow,
    { requestId, questions: COPY_QUESTION },
    { holdMs: 0 },
  );
  return world;
}

function endStep(stepId: string, outcome: { hasChanges?: boolean } = { hasChanges: true }) {
  completeStep(deps(), stepId, outcome);
}

function phaseOf(todoId: string) {
  return H.s.db.select().from(todo).where(eq(todo.id, todoId)).get()?.phase;
}

function questionStatus(buildId: string, requestId: string) {
  const row = H.s.db
    .select()
    .from(message)
    .where(and(eq(message.id, requestId), eq(message.conversationId, buildId)))
    .get();
  return (row?.content as { status?: string } | undefined)?.status;
}

function coordinatorSteps() {
  return H.s.db
    .select()
    .from(step)
    .all()
    .filter((row) => row.kind === 'chief');
}

function sessionSteps(buildId: string) {
  return H.s.db.select().from(step).where(eq(step.buildId, buildId)).all();
}

describe('a parked question is its own state and wakes the Coordinator (task stall S1)', () => {
  test('a worker asks, the step ends: the todo is needs_input, and an unwatched todo gets a question wake carrying the request id', async () => {
    const { todoId, stepRow } = await askAndPark();
    endStep(stepRow.id);
    expect(phaseOf(todoId)).toBe('needs_input');
    const wakes = coordinatorSteps().filter((row) => row.prompt?.includes(REQUEST_A));
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.prompt).toContain('Which wins?');
  });

  test('a code step that ends with zero changes asks the Coordinator instead of failing, with the agent last message attached', async () => {
    const { todoId, buildId, stepRow } = startSession();
    H.s.db
      .insert(message)
      .values({
        id: 'agent-last',
        conversationId: buildId,
        role: 'assistant',
        content: [
          { type: 'text', text: 'Before I change the copy: should the banned string stay?' },
        ],
        createdAt: Date.now(),
        actor: null,
      })
      .run();
    endStep(stepRow.id, { hasChanges: false });
    expect(phaseOf(todoId)).toBe('needs_input');
    expect(H.s.db.select().from(build).where(eq(build.id, buildId)).get()?.errorMessage).toBeNull();
    const wake = coordinatorSteps().at(-1);
    expect(wake?.prompt).toContain('should the banned string stay?');
  });

  test('once the zero-change question is answered, a second zero-change step ends the loop instead of asking again', async () => {
    const { todoId, buildId, stepRow } = startSession();
    endStep(stepRow.id, { hasChanges: false });
    expect(phaseOf(todoId)).toBe('needs_input');
    await relay('answer_question', {
      todoId,
      requestId: `no-change-${stepRow.id}`,
      answer: 'The task needs no code change.',
    });
    const resumed = sessionSteps(buildId).find((row) => row.status === 'pending');
    if (resumed === undefined) throw new Error('no resumed session step');
    H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, resumed.id)).run();
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    endStep(resumed.id, { hasChanges: false });

    expect(questionStatus(buildId, `no-change-${resumed.id}`)).toBeUndefined();
    expect(phaseOf(todoId)).toBe('review');
  });
});

describe('answers route by request id to the same build and session (task stall S1, S2)', () => {
  test('answer_question resumes the same build id on the same session', async () => {
    const { todoId, buildId, stepRow } = await askAndPark();
    endStep(stepRow.id);
    const out = (await relay('answer_question', {
      todoId,
      requestId: REQUEST_A,
      answer: 'Repo rule wins; rewrite the banned string.',
    })) as { buildId: string };
    expect(out.buildId).toBe(buildId);
    expect(getTodo(deps(), todoId)?.latestBuildId).toBe(buildId);
    expect(questionStatus(buildId, REQUEST_A)).toBe('answered');
    const resumed = sessionSteps(buildId).filter((row) => row.status === 'pending');
    expect(resumed).toHaveLength(1);
    expect(resumed[0]?.freshSession).toBe(false);
    expect(resumed[0]?.prompt).toContain('Repo rule wins');
  });

  test('a failed task with a pending question resumes on the same build, never restarts', async () => {
    const { todoId, buildId, stepRow } = await askAndPark();
    applyStepFailure(deps(), stepRow, 'git commit failed (exit 1): lockfile');
    await relay('answer_question', { todoId, requestId: REQUEST_A, answer: 'Repo rule wins.' });
    expect(getTodo(deps(), todoId)?.latestBuildId).toBe(buildId);
    expect(H.s.db.select().from(build).where(eq(build.todoId, todoId)).all()).toHaveLength(1);
  });

  test('a person typing in a failed task thread with a pending question also resumes the same build', async () => {
    const { todoId, buildId, stepRow } = await askAndPark();
    applyStepFailure(deps(), stepRow, 'git commit failed (exit 1): lockfile');
    const out = await messageThreadAsUser(deps(), H.teamId, todoId, {
      content: 'Repo rule wins.',
      clientMessageId: 'c-person',
    });
    expect(out.conversationId).toBe(buildId);
    expect(out.delivered).not.toBe('restart');
  });

  test('a stale request id is rejected, and an answer to request A never resolves request B', async () => {
    const { todoId, buildId, stepRow } = await askAndPark(REQUEST_A);
    await askWorkerQuestion(
      deps(),
      stepRow,
      { requestId: REQUEST_B, questions: COPY_QUESTION },
      { holdMs: 0 },
    );
    endStep(stepRow.id);
    await expect(
      relay('answer_question', { todoId, requestId: 'ask-stale', answer: 'x' }),
    ).rejects.toMatchObject({ status: 409 });
    await relay('answer_question', { todoId, requestId: REQUEST_A, answer: 'Repo rule wins.' });
    expect(questionStatus(buildId, REQUEST_A)).toBe('answered');
    expect(questionStatus(buildId, REQUEST_B)).toBe('pending');
    expect(phaseOf(todoId)).toBe('needs_input');
    await expect(
      relay('answer_question', { todoId, requestId: REQUEST_A, answer: 'again' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  test('an answer whose continuation is refused stays unanswered and leaves no decision, so the same request id can be answered again', async () => {
    const { todoId, buildId, stepRow } = await askAndPark();
    endStep(stepRow.id);
    H.s.db.update(todo).set({ phase: 'closed' }).where(eq(todo.id, todoId)).run();
    await expect(
      relay('answer_question', { todoId, requestId: REQUEST_A, answer: 'Repo rule wins.' }),
    ).rejects.toBeDefined();
    expect(questionStatus(buildId, REQUEST_A)).toBe('pending');
    expect(getTodo(deps(), todoId)?.decisions ?? []).toEqual([]);

    H.s.db.update(todo).set({ phase: 'needs_input' }).where(eq(todo.id, todoId)).run();
    await relay('answer_question', { todoId, requestId: REQUEST_A, answer: 'Repo rule wins.' });
    expect(questionStatus(buildId, REQUEST_A)).toBe('answered');
    expect(getTodo(deps(), todoId)?.decisions).toEqual([
      expect.objectContaining({ requestId: REQUEST_A, answer: 'Repo rule wins.' }),
    ]);
  });

  test('an answer to a parked question while its step is still claimed is steered into that step, not only recorded', async () => {
    const { todoId, buildId, stepRow } = await askAndPark();
    const stored = H.s.db.select().from(message).where(eq(message.id, REQUEST_A)).get();
    H.s.db
      .update(message)
      .set({ content: { ...(stored?.content as object), parkedAt: Date.now() } })
      .where(eq(message.id, REQUEST_A))
      .run();
    const out = (await relay('answer_question', {
      todoId,
      requestId: REQUEST_A,
      answer: 'Repo rule wins.',
    })) as { delivered: string };
    expect(out.delivered).not.toBe('held-step');
    const steer = H.s.db
      .select()
      .from(steerPending)
      .where(eq(steerPending.conversationId, buildId))
      .get();
    expect(steer?.stepId).toBe(stepRow.id);
    expect(steer?.content).toContain('Repo rule wins.');
    expect(questionStatus(buildId, REQUEST_A)).toBe('answered');
  });

  test('the Coordinator cannot answer a parked question by free text: message_thread points it at answer_question', async () => {
    const { todoId, stepRow } = await askAndPark();
    endStep(stepRow.id);
    await expect(
      relay('message_thread', { todoId, content: 'Repo rule wins.' }),
    ).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/answer_question/) });
  });
});

describe('decisions are stored on the task and survive restarts (task stall S2)', () => {
  test('a restart after a ruling carries the ruling in the new build first prompt', async () => {
    const machineId = insertMachine(H.s);
    const { todoId, stepRow } = await askAndPark();
    endStep(stepRow.id);
    await relay('answer_question', {
      todoId,
      requestId: REQUEST_A,
      answer: 'Repo rule wins; rewrite the banned string.',
    });
    expect(getTodo(deps(), todoId)?.decisions).toEqual([
      expect.objectContaining({
        requestId: REQUEST_A,
        answer: 'Repo rule wins; rewrite the banned string.',
      }),
    ]);
    const resumed = H.s.db
      .select()
      .from(step)
      .where(and(eq(step.status, 'pending'), eq(step.kind, 'session')))
      .all();
    for (const row of resumed) {
      H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, row.id)).run();
      applyStepFailure(deps(), { ...row, status: 'claimed' }, 'agent crashed');
    }
    await messageThreadAsUser(deps(), H.teamId, todoId, {
      content: 'Try again from scratch.',
      clientMessageId: 'c-restart',
    });
    const restarted = getTodo(deps(), todoId)!.latestBuildId!;
    H.s.db.delete(step).where(eq(step.kind, 'chief')).run();
    const claimed = await claimStep(deps() as never, machineId, H.teamId, 0, 'http://localhost');
    expect(claimed?.conversationId).toBe(restarted);
    expect(claimed?.todo?.spec).toContain('Repo rule wins; rewrite the banned string.');
  });
});
