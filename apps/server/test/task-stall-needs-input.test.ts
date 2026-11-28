import { ANSWERS_CONTINUE_PROMPT } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  attachment,
  build,
  machine,
  message,
  project,
  steerPending,
  step,
  todo,
} from '../src/db/schema.js';
import { attachWorkerFile } from '../src/services/agent-attachments.js';
import { blockerHandoffForClaim } from '../src/services/blocker-handoff.js';
import { blockedNow } from '../src/services/blockers.js';
import { applyStepFailure, completeStep, startBuilds } from '../src/services/builds.js';
import { transitionTodos } from '../src/services/chief-tools.js';
import { ackSteer, claimStep, fetchSteer } from '../src/services/machines.js';
import { listNeedsYou, sweepFailedRetries } from '../src/services/needs-you.js';
import { messageThreadAsUser } from '../src/services/thread-message.js';
import { getTodo } from '../src/services/todos.js';
import { askWorkerQuestion } from '../src/services/worker-questions.js';
import { H, ownerTodo, registerChiefHarness, relay, toolDeps } from './chief-harness.js';
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

function seedTodo(projectId = H.projectId, opts: { title?: string; spec?: string } = {}) {
  const id = `todo-${Math.random().toString(36).slice(2, 8)}`;
  H.s.db
    .insert(todo)
    .values({
      id,
      teamId: H.teamId,
      projectId,
      title: opts.title ?? 'Port the onboarding copy',
      spec: opts.spec ?? 'Copy the onboarding text byte-for-byte.',
      phase: 'todo',
      phaseAt: 1,
      seqNum: 133,
    })
    .run();
  return id;
}

function startSession(projectId = H.projectId, opts: { title?: string; spec?: string } = {}) {
  const machineId =
    H.s.db.select({ id: machine.id }).from(machine).where(eq(machine.teamId, H.s.team.id)).get()
      ?.id ?? insertMachine(H.s);
  const todoId = seedTodo(projectId, opts);
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

  test('a build asks the zero-change question once: a second zero-change step after the answer completes the task', async () => {
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
    expect(phaseOf(todoId)).toBe('done');
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
  test('a GitHub task whose step committed without opening a PR completes without asking', () => {
    const { todoId, buildId, stepRow } = startSession(githubProject());
    H.s.db
      .update(build)
      .set({ reportLine: 'Landed directly onto main via push-queue.' })
      .where(eq(build.id, buildId))
      .run();
    endStep(stepRow.id, { hasChanges: true });
    expect(phaseOf(todoId)).toBe('done');
    expect(questionStatus(buildId, zeroChangeId(buildId))).toBeUndefined();
  });

  test('a GitHub task whose step opened a PR asks nothing', () => {
    const { todoId, buildId, stepRow } = startSession(githubProject());
    H.s.db.update(build).set({ prNumber: 42 }).where(eq(build.id, buildId)).run();
    endStep(stepRow.id, { hasChanges: true });
    expect(questionStatus(buildId, zeroChangeId(buildId))).toBeUndefined();
    expect(phaseOf(todoId)).not.toBe('needs_input');
  });

  test('a task in a project without GitHub that committed completes', () => {
    const { todoId, buildId, stepRow } = startSession();
    endStep(stepRow.id, { hasChanges: true });
    expect(questionStatus(buildId, zeroChangeId(buildId))).toBeUndefined();
    expect(phaseOf(todoId)).toBe('done');
  });

  test('a GitHub task whose step produced zero commits asks once, quoting the report line', () => {
    const { todoId, buildId, stepRow } = startSession(githubProject());
    H.s.db
      .update(build)
      .set({ reportLine: 'Blocked on missing credentials; nothing committed.' })
      .where(eq(build.id, buildId))
      .run();
    endStep(stepRow.id, { hasChanges: false });
    expect(phaseOf(todoId)).toBe('needs_input');
    expect(questionStatus(buildId, zeroChangeId(buildId))).toBe('pending');
    const wake = coordinatorSteps().find((row) => row.prompt?.includes(zeroChangeId(buildId)));
    expect(wake?.prompt).toContain('nothing committed');
  });
});

describe('a build answered under the old zero-change id is not asked again', () => {
  test('a continuation that ends without commits after an answered no-change question completes', () => {
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
    expect(phaseOf(todoId)).toBe('done');
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

async function startCoordinatorTask(
  spec: string,
  output: 'info' | 'code' | 'report' = 'info',
  blockedBy?: string[],
) {
  const { id: todoId, buildId } = (await relay('create_todo', {
    ...ownerTodo(spec),
    title: 'Read-only check',
    output,
    difficulty: 'easy',
    blockedBy,
  })) as { id: string; buildId: string };
  const first = H.s.db.select().from(step).where(eq(step.buildId, buildId)).get()!;
  const machineId = H.s.db.select().from(machine).where(eq(machine.teamId, H.teamId)).get()!.id;
  H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
  H.s.db.update(step).set({ status: 'claimed', machineId }).where(eq(step.id, first.id)).run();
  const stepRow = H.s.db.select().from(step).where(eq(step.id, first.id)).get()!;
  return { todoId, buildId, stepRow };
}

function assistantMessage(buildId: string, id: string, content: unknown, createdAt = Date.now()) {
  H.s.db
    .insert(message)
    .values({ id, conversationId: buildId, role: 'assistant', content, createdAt })
    .run();
}

function reply(buildId: string, text: string) {
  const content = [{ type: 'text', text }];
  assistantMessage(buildId, 'answer', content);
  return content;
}

function uploadDeck(stepRow: typeof step.$inferSelect, todoId: string) {
  const todoRow = H.s.db.select().from(todo).where(eq(todo.id, todoId)).get()!;
  return JSON.parse(
    attachWorkerFile({ ...toolDeps(), convHub: H.s.convHub }, stepRow, todoRow, {
      fileName: 'q3-review.html',
      contentBase64: Buffer.from(
        '<!doctype html><title>Q3 review</title><h1>Q3 review</h1>',
      ).toString('base64'),
    }),
  ) as { id: string; token: string };
}

function toolCall(name: string, args: object = {}, isError = false) {
  return { kind: 'toolcall', call: { name, arguments: args, isError } };
}

describe('Coordinator tasks use the requested delivery kind', () => {
  test.each([
    ['运行 hostname 并汇报主机名', '主机名是 test-runner。'],
    ['请用一句中文回答：一加一等于几？', '一加一等于二。'],
  ])('finishes without a commit when it answers: %s', async (spec, answer) => {
    const { todoId, buildId, stepRow } = await startCoordinatorTask(spec);
    const content = reply(buildId, answer);
    if (spec.includes('hostname'))
      assistantMessage(
        buildId,
        'hostname',
        toolCall('bash', { command: 'hostname' }),
        stepRow.createdAt,
      );
    endStep(stepRow.id, { hasChanges: false });
    expect(getTodo(deps(), todoId)).toMatchObject({ phase: 'done', hasChanges: false });
    expect(questionStatus(buildId, zeroChangeId(buildId))).toBeUndefined();
    expect(H.s.db.select().from(message).where(eq(message.id, 'answer')).get()?.content).toEqual(
      content,
    );
  });

  test('a dependent task is released with the original textual answer in its handoff', async () => {
    const parent = await startCoordinatorTask('Tell me the hostname.');
    const child = await startCoordinatorTask('Use the hostname from the previous task.', 'info', [
      parent.todoId,
    ]);
    const childRow = H.s.db.select().from(todo).where(eq(todo.id, child.todoId)).get()!;
    expect(blockedNow(H.s.db, childRow)).toBe(true);
    reply(parent.buildId, 'The hostname is test-runner.');
    endStep(parent.stepRow.id, { hasChanges: false });
    expect(blockedNow(H.s.db, childRow)).toBe(false);
    const handoff = await blockerHandoffForClaim(
      { ...deps(), reposDir: H.s.reposDir, attachmentsDir: H.s.attachmentsDir },
      child.stepRow,
      childRow,
    );
    expect(handoff?.blockers[0]).toMatchObject({
      phase: 'done',
      summary: 'The hostname is test-runner.',
    });
  });

  test('a code request that only reports still needs input', async () => {
    const { todoId, buildId, stepRow } = await startCoordinatorTask(
      'Fix the typo in README.md. Do not edit any files outside the repo. Reply with the result.',
      'code',
    );
    uploadDeck(stepRow, todoId);
    reply(buildId, 'The typo is on line 11. I changed nothing.');
    endStep(stepRow.id, { hasChanges: false });
    expect(phaseOf(todoId)).toBe('needs_input');
    expect(questionStatus(buildId, zeroChangeId(buildId))).toBe('pending');
  });

  test('a worker question still takes precedence over a partial answer', async () => {
    const { todoId, buildId, stepRow } = await startCoordinatorTask('Check the onboarding copy.');
    reply(buildId, 'I can check one copy.');
    await ask(stepRow, REQUEST_A);
    endStep(stepRow.id, { hasChanges: false });
    expect(phaseOf(todoId)).toBe('needs_input');
    expect(questionStatus(buildId, REQUEST_A)).toBe('pending');
  });

  test('a failed answer-only turn does not become done', async () => {
    const { todoId, buildId, stepRow } = await startCoordinatorTask('Run hostname and report.');
    reply(buildId, 'Checking the hostname.');
    applyStepFailure(deps(), stepRow, 'agent crashed');
    expect(phaseOf(todoId)).toBe('failed');
  });

  test('a blank reply does not complete an info task', async () => {
    const { todoId, buildId, stepRow } = await startCoordinatorTask('Run hostname and report.');
    reply(buildId, ' \n ');
    endStep(stepRow.id, { hasChanges: false });
    expect(phaseOf(todoId)).toBe('review');
  });

  test.each(['report', 'info'] as const)(
    'a separate %s artifact still enters review',
    async (kind) => {
      const { todoId, buildId, stepRow } = await startCoordinatorTask(
        'Write a separate report.',
        kind,
      );
      reply(buildId, 'Here is the report.');
      completeStep(deps(), stepRow.id, { hasChanges: false, report: '# Results' });
      expect(phaseOf(todoId)).toBe('review');
    },
  );

  test.each([
    ['narration then a tool-only end', undefined, toolCall('bash', { command: 'hostname' })],
    ['failed command then narration', toolCall('bash', { command: 'hostname' }, true), undefined],
    ['a file is attached', toolCall('attach_file', { path: 'results.txt' }), undefined],
    ['a file was edited', toolCall('edit_file', { path: 'notes.txt' }), undefined],
  ])('info still enters review with %s', async (_label, before, after) => {
    const { todoId, buildId, stepRow } = await startCoordinatorTask('Run hostname and report.');
    const at = Date.now();
    if (before !== undefined) assistantMessage(buildId, 'before', before, at);
    assistantMessage(buildId, 'answer', 'Checking the hostname.', at + 1);
    if (after !== undefined) assistantMessage(buildId, 'after', after, at + 2);
    endStep(stepRow.id, { hasChanges: false });
    expect(phaseOf(todoId)).toBe('review');
  });

  test.each([true, undefined])(
    'info still enters review with hasChanges=%s',
    async (hasChanges) => {
      const { todoId, buildId, stepRow } = await startCoordinatorTask('Run hostname and report.');
      reply(buildId, 'The hostname is test-runner.');
      endStep(stepRow.id, { hasChanges });
      expect(phaseOf(todoId)).toBe('review');
    },
  );

  test('an uploaded non-code HTML deck completes despite legacy read-back checks', async () => {
    const { todoId, buildId, stepRow } = await startCoordinatorTask(
      'Build a four-slide Q3 review deck and attach the HTML.',
      'report',
    );
    assistantMessage(
      buildId,
      'write',
      toolCall('write_file', { path: 'q3-review.html' }),
      stepRow.createdAt,
    );
    const { id, token } = uploadDeck(stepRow, todoId);
    reply(buildId, 'The deck is attached.');
    endStep(stepRow.id, { hasChanges: false });
    expect(getTodo(deps(), todoId)).toMatchObject({ phase: 'done', hasChanges: false });
    expect(H.s.db.select().from(attachment).where(eq(attachment.id, id)).get()).toMatchObject({
      status: 'ready',
      fileName: 'q3-review.html',
    });
    expect(
      H.s.db
        .select()
        .from(message)
        .where(eq(message.id, `attachment-output-${stepRow.id}`))
        .get()?.content,
    ).toBe(token);
  });

  test('an older message attachment cannot deliver the current attempt', async () => {
    const { todoId, buildId, stepRow } = await startCoordinatorTask('Report the results.');
    assistantMessage(
      buildId,
      'attach-call',
      toolCall('attach_file', { path: 'results.txt' }),
      stepRow.createdAt,
    );
    reply(buildId, 'The results are attached.');
    H.s.db
      .insert(attachment)
      .values({
        id: 'attachment',
        todoId,
        teamId: H.teamId,
        createdBy: 'step:previous-attempt',
        fileName: 'results.txt',
        mimeType: 'text/plain',
        sizeBytes: 12,
        storageKey: 'results.txt',
        grantId: 'grant',
        scope: 'message',
        status: 'ready',
        createdAt: Date.now(),
      })
      .run();
    endStep(stepRow.id, { hasChanges: false });
    expect(phaseOf(todoId)).toBe('review');
  });

  test('the info artifact acceptance nudge still takes precedence over a text reply', async () => {
    const { todoId, buildId, stepRow } = await startCoordinatorTask('Write and verify report.md.');
    assistantMessage(
      buildId,
      'write',
      toolCall('write_file', { path: 'report.md' }),
      stepRow.createdAt,
    );
    reply(buildId, 'The report is ready.');
    endStep(stepRow.id, { hasChanges: false });
    expect(phaseOf(todoId)).toBe('building');
    expect(pendingWork(buildId)[0]?.prompt).toContain('[cairn acceptance check]');
  });

  test('text from a prior step is not a new answer', async () => {
    const { todoId, buildId, stepRow } = await startCoordinatorTask('Run hostname and report.');
    assistantMessage(
      buildId,
      'old-reply',
      'The old hostname was previous-runner.',
      stepRow.createdAt - 1,
    );
    endStep(stepRow.id, { hasChanges: false });
    expect(phaseOf(todoId)).toBe('review');
  });
});

describe('read-only and command-only tasks complete without the no-deliverable gate', () => {
  test('explicit English no-edit / read-only request finishes done with its report and no gate question', () => {
    const { todoId, buildId, stepRow } = startSession(githubProject(), {
      title: 'Verify rotated runner token (read-only)',
      spec: 'Read-only verification after runner token rotation: reply with ROTATE_TOKEN_LIVE_OK and make no edits.',
    });
    H.s.db
      .update(build)
      .set({
        reportLine:
          'Read-only verification complete with no edits; returning ROTATE_TOKEN_LIVE_OK.',
      })
      .where(eq(build.id, buildId))
      .run();
    endStep(stepRow.id, { hasChanges: false });
    expect(phaseOf(todoId)).toBe('done');
    expect(questionStatus(buildId, zeroChangeId(buildId))).toBeUndefined();
    expect(H.s.db.select().from(build).where(eq(build.id, buildId)).get()?.reportLine).toBe(
      'Read-only verification complete with no edits; returning ROTATE_TOKEN_LIVE_OK.',
    );
  });

  test('explicit Chinese no-edit request completes even when the title mentions 修复', () => {
    const { todoId, buildId, stepRow } = startSession(H.projectId, {
      title: 'Notify Once 心跳修复复测 2：定时触发后直接回复完成',
      spec: '定时触发后直接回复一句话完成，不要改任何文件。',
    });
    endStep(stepRow.id, { hasChanges: false });
    expect(phaseOf(todoId)).toBe('done');
    expect(questionStatus(buildId, zeroChangeId(buildId))).toBeUndefined();
  });

  test.each([
    {
      name: 'run hostname and report',
      title: 'Run hostname',
      spec: 'run hostname and report',
    },
    {
      name: 'sleep 90 and echo',
      title: 'Sleep check',
      spec: 'sleep 90 and echo',
    },
    {
      name: 'ask_user-only permission verification',
      title: 'Stall-monitor permission wait verification',
      spec: "Immediately call the ask_user tool to ask the user: 'Please confirm whether to continue stall-monitor verification (Yes / No)'. Do not run any other tool or finish before calling ask_user.",
    },
  ])('$name finishes done with hasChanges=false and no gate question', ({ title, spec }) => {
    const { todoId, buildId, stepRow } = startSession(H.projectId, { title, spec });
    endStep(stepRow.id, { hasChanges: false });
    expect(phaseOf(todoId)).toBe('done');
    expect(questionStatus(buildId, zeroChangeId(buildId))).toBeUndefined();
  });

  test.each([
    {
      name: 'forbids modifying other files while still asking to fix foo.ts',
      title: 'Fix foo.ts',
      spec: 'Fix foo.ts. Do not modify any other files.',
    },
    {
      name: 'implements a read-only mode feature',
      title: 'Add read-only mode',
      spec: 'Add a read-only mode to the settings page.',
    },
    {
      name: 'command writes output via shell redirect',
      title: 'Run sleep 90 and write result file',
      spec: 'Run the bash command "sleep 90 && echo ok > dead-turn-verify.txt" and reply ok.',
    },
    {
      name: 'creates a file while forbidding merge',
      title: 'Create dogfood-b7.md',
      spec: '在仓库根目录新建 dogfood-b7.md，写一行「plan approval check」。不要合并。',
    },
  ])('negative control ($name) still triggers the no-deliverable gate', ({ title, spec }) => {
    const { todoId, buildId, stepRow } = startSession(H.projectId, { title, spec });
    endStep(stepRow.id, { hasChanges: false });
    expect(phaseOf(todoId)).toBe('needs_input');
    expect(questionStatus(buildId, zeroChangeId(buildId))).toBe('pending');
  });
});
