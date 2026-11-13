import { ANSWERS_CONTINUE_PROMPT } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { build, machine, message, project, steerPending, step, todo } from '../src/db/schema.js';
import { applyStepFailure, completeStep, startBuilds } from '../src/services/builds.js';
import { transitionTodos } from '../src/services/chief-tools.js';
import { ackSteer, claimStep, fetchSteer } from '../src/services/machines.js';
import { listNeedsYou, sweepFailedRetries } from '../src/services/needs-you.js';
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

function githubProject(): string {
  const id = `proj-gh-${Math.random().toString(36).slice(2, 8)}`;
  H.s.db
    .insert(project)
    .values({
      id,
      name: id,
      teamId: H.teamId,
      repoKind: 'github',
      githubRepo: 'acme/app',
    })
    .run();
  return id;
}

function seedTodo(projectId = H.projectId) {
  const id = `todo-${Math.random().toString(36).slice(2, 8)}`;
  H.s.db
    .insert(todo)
    .values({
      id,
      teamId: H.teamId,
      projectId,
      title: 'Port the onboarding copy',
      spec: 'Copy the onboarding text byte-for-byte.',
      phase: 'todo',
      phaseAt: 1,
      seqNum: 133,
    })
    .run();
  return id;
}

function startSession(projectId = H.projectId) {
  const machineId =
    H.s.db.select({ id: machine.id }).from(machine).where(eq(machine.teamId, H.s.team.id)).get()
      ?.id ?? insertMachine(H.s);
  const todoId = seedTodo(projectId);
  const [started] = startBuilds(deps(), { projectId, todoIds: [todoId] });
  const buildId = started!.id;
  const first = H.s.db.select().from(step).where(eq(step.buildId, buildId)).get()!;
  H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
  H.s.db.update(step).set({ status: 'claimed', machineId }).where(eq(step.id, first.id)).run();
  return {
    todoId,
    buildId,
    stepRow: H.s.db.select().from(step).where(eq(step.id, first.id)).get()!,
  };
}

async function ask(stepRow: typeof step.$inferSelect, requestId: string) {
  await askWorkerQuestion(deps(), stepRow, { requestId, questions: COPY_QUESTION }, { holdMs: 0 });
}

async function askAndPark(requestId = REQUEST_A) {
  const world = startSession();
  await ask(world.stepRow, requestId);
  const stored = H.s.db.select().from(message).where(eq(message.id, requestId)).get();
  H.s.db
    .update(message)
    .set({ content: { ...(stored?.content as object), parkedAt: Date.now() } })
    .where(eq(message.id, requestId))
    .run();
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

function pendingWork(buildId: string) {
  return H.s.db
    .select()
    .from(step)
    .where(and(eq(step.buildId, buildId), eq(step.status, 'pending')))
    .all();
}

function zeroChangeId(buildId: string) {
  return `no-deliverable-${buildId}`;
}

describe('a parked question is its own phase and wakes the Coordinator', () => {
  test('a worker asks and the step ends: the task is needs_input and an unwatched task gets one wake naming the request id', async () => {
    const { todoId, stepRow } = await askAndPark();
    endStep(stepRow.id);
    expect(phaseOf(todoId)).toBe('needs_input');
    const wakes = coordinatorSteps().filter((row) => row.prompt?.includes(REQUEST_A));
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.prompt).toContain('Which wins?');
    expect(wakes[0]?.prompt).toContain('answer_question');
  });

  test('a code step that ends with zero changes asks instead of failing, quoting the agent last text block', async () => {
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
    expect(questionStatus(buildId, zeroChangeId(buildId))).toBe('pending');
    expect(coordinatorSteps().at(-1)?.prompt).toContain('should the banned string stay?');
  });

  test('a zero-change step that ends with its own pending question asks nothing more, and its answer resumes the build', async () => {
    const { todoId, buildId, stepRow } = await askAndPark();
    endStep(stepRow.id, { hasChanges: false });
    expect(phaseOf(todoId)).toBe('needs_input');
    expect(questionStatus(buildId, zeroChangeId(buildId))).toBeUndefined();
    const out = (await relay('answer_question', {
      todoId,
      requestId: REQUEST_A,
      answer: 'Repo rule wins.',
    })) as { delivered: string };
    expect(out.delivered).toBe('new-turn');
  });

  test('a build asks the zero-change question once: a second zero-change step after the answer goes to review', async () => {
    const { todoId, buildId, stepRow } = startSession();
    endStep(stepRow.id, { hasChanges: false });
    await relay('answer_question', {
      todoId,
      requestId: zeroChangeId(buildId),
      answer: 'The task needs no code change.',
    });
    const [resumed] = pendingWork(buildId);
    if (resumed === undefined) throw new Error('no resumed step');
    H.s.db
      .update(step)
      .set({ status: 'claimed', machineId: stepRow.machineId })
      .where(eq(step.id, resumed.id))
      .run();
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    ackSteer(deps(), { id: stepRow.machineId, teamId: H.teamId }, resumed.id, {
      answerIds: [zeroChangeId(buildId)],
      via: 'session-start',
    });
    endStep(resumed.id, { hasChanges: false });
    expect(phaseOf(todoId)).toBe('review');
    const asked = H.s.db
      .select()
      .from(message)
      .where(eq(message.conversationId, buildId))
      .all()
      .filter((row) => row.id.startsWith('no-deliverable-'));
    expect(asked).toHaveLength(1);
  });
});

describe('a step that delivered nothing asks once (task stall class 2)', () => {
  test('a GitHub task whose step committed but opened no PR asks, quoting the report line, instead of going to review', async () => {
    const { todoId, buildId, stepRow } = startSession(githubProject());
    H.s.db
      .update(build)
      .set({ reportLine: 'Pushed the branch; no PR opened, remote CI unverified.' })
      .where(eq(build.id, buildId))
      .run();
    endStep(stepRow.id, { hasChanges: true });
    expect(phaseOf(todoId)).toBe('needs_input');
    expect(questionStatus(buildId, zeroChangeId(buildId))).toBe('pending');
    const wake = coordinatorSteps().find((row) => row.prompt?.includes(zeroChangeId(buildId)));
    expect(wake?.prompt).toContain('no PR opened, remote CI unverified');
  });

  test('a GitHub task whose step opened a PR asks nothing', () => {
    const { todoId, buildId, stepRow } = startSession(githubProject());
    H.s.db.update(build).set({ prNumber: 42 }).where(eq(build.id, buildId)).run();
    endStep(stepRow.id, { hasChanges: true });
    expect(questionStatus(buildId, zeroChangeId(buildId))).toBeUndefined();
    expect(phaseOf(todoId)).not.toBe('needs_input');
  });

  test('a task in a project without GitHub that committed goes to review as before', () => {
    const { todoId, buildId, stepRow } = startSession();
    endStep(stepRow.id, { hasChanges: true });
    expect(questionStatus(buildId, zeroChangeId(buildId))).toBeUndefined();
    expect(phaseOf(todoId)).toBe('review');
  });

  test('a GitHub task that ends without a PR again after the answer goes to review, asked once', async () => {
    const { todoId, buildId, stepRow } = startSession(githubProject());
    endStep(stepRow.id, { hasChanges: true });
    await relay('answer_question', {
      todoId,
      requestId: zeroChangeId(buildId),
      answer: 'A verified branch is enough here.',
    });
    const [resumed] = pendingWork(buildId);
    if (resumed === undefined) throw new Error('no resumed step');
    H.s.db
      .update(step)
      .set({ status: 'claimed', machineId: stepRow.machineId })
      .where(eq(step.id, resumed.id))
      .run();
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    ackSteer(deps(), { id: stepRow.machineId, teamId: H.teamId }, resumed.id, {
      answerIds: [zeroChangeId(buildId)],
      via: 'session-start',
    });
    endStep(resumed.id, { hasChanges: true });
    expect(phaseOf(todoId)).toBe('review');
  });
});

describe('a build answered under the old zero-change id is not asked again', () => {
  test('a continuation that ends without commits after an answered no-change question goes to review', () => {
    const { todoId, buildId, stepRow } = startSession();
    H.s.db
      .insert(message)
      .values({
        id: `no-change-${buildId}`,
        conversationId: buildId,
        role: 'assistant',
        content: {
          kind: 'ask_user_question',
          requestId: `no-change-${buildId}`,
          status: 'answered',
          questions: [{ header: 'No changes', question: 'What next?', options: [] }],
          answers: [{ text: 'No code change is needed.' }],
        },
        createdAt: Date.now(),
        actor: null,
      })
      .run();
    endStep(stepRow.id, { hasChanges: false });
    expect(questionStatus(buildId, zeroChangeId(buildId))).toBeUndefined();
    expect(phaseOf(todoId)).toBe('review');
  });
});

describe('answer_question answers one request id on the same build', () => {
  test('the answer resumes the same build on the same session', async () => {
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
    const resumed = pendingWork(buildId).filter((row) => row.kind !== 'chief');
    expect(resumed).toHaveLength(1);
    expect(resumed[0]?.freshSession).toBe(false);
    expect(resumed[0]?.prompt).toBe(ANSWERS_CONTINUE_PROMPT);
  });

  test('a failed task with a pending question resumes on the same build instead of restarting', async () => {
    const { todoId, buildId, stepRow } = await askAndPark();
    applyStepFailure(deps(), stepRow, 'git commit failed (exit 1): lockfile');
    await relay('answer_question', { todoId, requestId: REQUEST_A, answer: 'Repo rule wins.' });
    expect(getTodo(deps(), todoId)?.latestBuildId).toBe(buildId);
    expect(H.s.db.select().from(build).where(eq(build.todoId, todoId)).all()).toHaveLength(1);
  });

  test('the automatic retry sweep leaves a failed task with a pending question on its build', async () => {
    const { todoId, buildId, stepRow } = await askAndPark();
    applyStepFailure(deps(), stepRow, 'agent crashed');
    await sweepFailedRetries(deps() as never);
    expect(getTodo(deps(), todoId)?.latestBuildId).toBe(buildId);
    expect(questionStatus(buildId, REQUEST_A)).toBe('pending');
  });

  test('a person typing in a failed thread with a pending question resumes the same build and records the decision', async () => {
    const { todoId, buildId, stepRow } = await askAndPark();
    applyStepFailure(deps(), stepRow, 'git commit failed (exit 1): lockfile');
    const out = await messageThreadAsUser(deps(), H.teamId, todoId, {
      content: 'Repo rule wins.',
      clientMessageId: 'c-person',
    });
    expect(out.conversationId).toBe(buildId);
    expect(out.delivered).not.toBe('restart');
    expect(getTodo(deps(), todoId)?.decisions).toEqual([
      expect.objectContaining({ requestId: REQUEST_A, answer: 'Repo rule wins.', by: 'person' }),
    ]);
  });

  test('a stale request id is refused, an answer to A leaves B pending, and A cannot be answered twice', async () => {
    const { todoId, buildId, stepRow } = await askAndPark(REQUEST_A);
    await ask(stepRow, REQUEST_B);
    endStep(stepRow.id);
    await expect(
      relay('answer_question', { todoId, requestId: 'ask-stale', answer: 'x' }),
    ).rejects.toMatchObject({ status: 409 });
    const first = (await relay('answer_question', {
      todoId,
      requestId: REQUEST_A,
      answer: 'Repo rule wins.',
    })) as { delivered: string };
    expect(first.delivered).toBe('waiting-other-questions');
    expect(questionStatus(buildId, REQUEST_A)).toBe('answered');
    expect(questionStatus(buildId, REQUEST_B)).toBe('pending');
    expect(phaseOf(todoId)).toBe('needs_input');
    await expect(
      relay('answer_question', { todoId, requestId: REQUEST_A, answer: 'again' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  test('a request id from another task is refused', async () => {
    const other = await askAndPark(REQUEST_B);
    endStep(other.stepRow.id);
    const { todoId, stepRow } = await askAndPark(REQUEST_A);
    endStep(stepRow.id);
    await expect(
      relay('answer_question', { todoId, requestId: REQUEST_B, answer: 'x' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(questionStatus(other.buildId, REQUEST_B)).toBe('pending');
  });

  test('an answer whose continuation is refused stays pending and leaves no decision', async () => {
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

  test.each(['task', 'project'] as const)(
    'an answer on an archived %s is refused and settles nothing',
    async (archived) => {
      const { todoId, buildId, stepRow } = await askAndPark();
      endStep(stepRow.id);
      if (archived === 'task') {
        H.s.db.update(todo).set({ archivedAt: Date.now() }).where(eq(todo.id, todoId)).run();
      } else {
        H.s.db
          .update(project)
          .set({ archivedAt: Date.now() })
          .where(eq(project.id, H.projectId))
          .run();
      }
      await expect(
        relay('answer_question', { todoId, requestId: REQUEST_A, answer: 'Repo rule wins.' }),
      ).rejects.toMatchObject({ status: 409 });
      expect(questionStatus(buildId, REQUEST_A)).toBe('pending');
      expect(getTodo(deps(), todoId)?.decisions ?? []).toEqual([]);
    },
  );

  test('an answer while the worker still holds its ask is returned by that ask, with no new step', async () => {
    const { todoId, buildId, stepRow } = startSession();
    await ask(stepRow, REQUEST_A);
    const out = (await relay('answer_question', {
      todoId,
      requestId: REQUEST_A,
      answer: 'Repo rule wins.',
    })) as { delivered: string };
    expect(out.delivered).toBe('held-step');
    const polled = await askWorkerQuestion(
      deps(),
      stepRow,
      { requestId: REQUEST_A, questions: COPY_QUESTION },
      { holdMs: 0 },
    );
    expect(polled).toMatchObject({ status: 'answered' });
    expect(pendingWork(buildId).filter((row) => row.kind !== 'chief')).toHaveLength(0);
  });

  test('an answer to a parked question while its step is still claimed is steered into that step', async () => {
    const { todoId, buildId, stepRow } = await askAndPark();
    const out = (await relay('answer_question', {
      todoId,
      requestId: REQUEST_A,
      answer: 'Repo rule wins.',
    })) as { delivered: string };
    expect(out.delivered).toBe('steer');
    expect(
      H.s.db.select().from(steerPending).where(eq(steerPending.conversationId, buildId)).get(),
    ).toBeUndefined();
    expect(fetchSteer(deps(), { id: stepRow.machineId }, stepRow.id).answers).toEqual([
      { requestId: REQUEST_A, text: 'Repo rule wins.' },
    ]);
  });

  test('the Coordinator cannot answer a pending question by free text: message_thread points at answer_question', async () => {
    const { todoId, buildId, stepRow } = await askAndPark();
    endStep(stepRow.id);
    await expect(
      relay('message_thread', { todoId, content: 'Repo rule wins.' }),
    ).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/answer_question/) });
    expect(questionStatus(buildId, REQUEST_A)).toBe('pending');
  });
});

describe('decisions are stored on the task and survive restarts', () => {
  test('a restart after a ruling claims the unchanged brief with the ruling as a separate decisions field', async () => {
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
        by: 'coordinator',
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
    const sessionMachineId = stepRow.machineId;
    if (sessionMachineId === null) throw new Error('session machine missing');
    const claimed = await claimStep(
      deps() as never,
      sessionMachineId,
      H.teamId,
      0,
      'http://localhost',
    );
    expect(claimed?.conversationId).toBe(restarted);
    expect(claimed?.todo?.spec).toBe('Copy the onboarding text byte-for-byte.');
    expect(claimed?.todo?.decisions).toEqual([
      expect.objectContaining({ answer: 'Repo rule wins; rewrite the banned string.' }),
    ]);
  });
});

describe('every surface that lists work waiting on a person includes needs_input', () => {
  test('a needs_input question is Coordinator-owned and stays out of the person inbox', async () => {
    const { todoId, stepRow } = await askAndPark();
    endStep(stepRow.id);
    expect(getTodo(deps(), todoId)?.owner).toBe('coordinator');
    const waiting = listNeedsYou({ db: H.s.db }, H.teamId);
    expect(waiting.current.map((entry) => entry.todo.id)).not.toContain(todoId);
  });

  test('an agent cannot complete a task that waits for an answer', async () => {
    const { todoId, buildId, stepRow } = await askAndPark();
    endStep(stepRow.id);
    const out = transitionTodos(deps() as never, H.teamId, [todoId], 'done', {
      kind: 'agent',
      name: 'Coordinator',
      stopActor: 'coordinator',
    } as never);
    expect(out.skipped).toEqual([todoId]);
    expect(phaseOf(todoId)).toBe('needs_input');
    expect(questionStatus(buildId, REQUEST_A)).toBe('pending');
  });
});
