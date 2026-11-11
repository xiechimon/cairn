import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ANSWERS_CONTINUE_PROMPT, type AnswerDeliveryVia } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { machine, message, steerPending, step, todo } from '../src/db/schema.js';
import { completeStep, sendBuildSteer, startBuilds } from '../src/services/builds.js';
import { ackSteer, claimStep, fetchSteer } from '../src/services/machines.js';
import { askWorkerQuestion } from '../src/services/worker-questions.js';
import { H, registerChiefHarness, relay } from './chief-harness.js';
import { insertMachine } from './helpers.js';

registerChiefHarness();

const REQUEST_A = 'ask-aaaaaaaa-1111-2222-3333-555555555555';
const REQUEST_B = 'ask-bbbbbbbb-1111-2222-3333-555555555555';
const QUESTION = [
  {
    header: 'Conflict',
    question: 'The brief and the repo rule disagree. Which wins?',
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

function startSession() {
  const machineId =
    H.s.db.select({ id: machine.id }).from(machine).where(eq(machine.teamId, H.teamId)).get()?.id ??
    insertMachine(H.s);
  const todoId = `todo-${Math.random().toString(36).slice(2, 8)}`;
  H.s.db
    .insert(todo)
    .values({
      id: todoId,
      teamId: H.teamId,
      projectId: H.projectId,
      title: 'Port the onboarding copy',
      spec: 'Copy the onboarding text.',
      phase: 'todo',
      phaseAt: 1,
      seqNum: 211,
    })
    .run();
  const [started] = startBuilds(deps(), { projectId: H.projectId, todoIds: [todoId] });
  const buildId = started!.id;
  const first = H.s.db.select().from(step).where(eq(step.buildId, buildId)).get()!;
  H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
  H.s.db.update(step).set({ status: 'claimed', machineId }).where(eq(step.id, first.id)).run();
  const stepRow = H.s.db.select().from(step).where(eq(step.id, first.id)).get()!;
  return { todoId, buildId, machineId, stepRow };
}

type World = ReturnType<typeof startSession>;

async function ask(world: World, requestId: string, park: boolean) {
  await askWorkerQuestion(deps(), world.stepRow, { requestId, questions: QUESTION }, { holdMs: 0 });
  if (!park) return;
  const stored = H.s.db.select().from(message).where(eq(message.id, requestId)).get();
  H.s.db
    .update(message)
    .set({ content: { ...(stored?.content as object), parkedAt: Date.now() } })
    .where(eq(message.id, requestId))
    .run();
}

function answer(world: World, requestId: string, text: string) {
  return relay('answer_question', { todoId: world.todoId, requestId, answer: text }) as Promise<{
    delivered: string;
  }>;
}

function pickup(world: World, stepId = world.stepRow.id) {
  return fetchSteer(deps(), { id: world.machineId }, stepId);
}

function ack(world: World, stepId: string, answerIds: string[], via: AnswerDeliveryVia) {
  return ackSteer(deps(), { id: world.machineId, teamId: H.teamId }, stepId, { answerIds, via });
}

async function claimContinuation(world: World) {
  H.s.db.delete(step).where(eq(step.kind, 'chief')).run();
  const claimed = await claimStep(
    deps() as never,
    world.machineId,
    H.teamId,
    0,
    'http://localhost',
  );
  expect(claimed?.conversationId).toBe(world.buildId);
  return claimed!;
}

function finish(stepId: string) {
  completeStep(deps(), stepId, { hasChanges: true });
}

function phaseOf(world: World) {
  return H.s.db.select().from(todo).where(eq(todo.id, world.todoId)).get()?.phase;
}

function recordOf(world: World, requestId: string) {
  return H.s.db
    .select()
    .from(message)
    .where(and(eq(message.id, requestId), eq(message.conversationId, world.buildId)))
    .get()?.content as Record<string, unknown> | undefined;
}

describe('an answer is delivered only when the daemon acks it', () => {
  test('a held poll that is acked is delivered once: no later pickup or continuation repeats it', async () => {
    const world = startSession();
    await ask(world, REQUEST_A, false);
    expect((await answer(world, REQUEST_A, 'Repo rule wins.')).delivered).toBe('held-step');
    const polled = await askWorkerQuestion(
      deps(),
      world.stepRow,
      { requestId: REQUEST_A, questions: QUESTION },
      { holdMs: 0 },
    );
    expect(polled.status).toBe('answered');
    ack(world, world.stepRow.id, [REQUEST_A], 'poll');
    expect(pickup(world).answers).toBeUndefined();
    finish(world.stepRow.id);
    await sendBuildSteer(
      deps(),
      world.buildId,
      { content: 'Carry on.' },
      { human: true, afterTurn: true },
    );
    expect((await claimContinuation(world)).answerIds).toBeUndefined();
    expect(recordOf(world, REQUEST_A)).toMatchObject({
      deliveredVia: 'poll',
      deliveredStepId: world.stepRow.id,
    });
  });

  test('an interrupted poll: the poll returned the answer but no ack came, so the next pickup and the continuation enqueued at step end re-send it', async () => {
    const world = startSession();
    await ask(world, REQUEST_A, false);
    await answer(world, REQUEST_A, 'Repo rule wins.');
    const polled = await askWorkerQuestion(
      deps(),
      world.stepRow,
      { requestId: REQUEST_A, questions: QUESTION },
      { holdMs: 0 },
    );
    expect(polled.status).toBe('answered');
    expect(pickup(world).answers).toEqual([{ requestId: REQUEST_A, text: 'Repo rule wins.' }]);
    finish(world.stepRow.id);
    expect((await claimContinuation(world)).answerIds).toEqual([REQUEST_A]);
  });

  test('A then B while idle: the resumed claim carries both, neither is spliced into the prompt, and one session-start ack marks both', async () => {
    const world = startSession();
    await ask(world, REQUEST_A, true);
    await ask(world, REQUEST_B, true);
    finish(world.stepRow.id);
    expect((await answer(world, REQUEST_A, 'Answer for A.')).delivered).toBe(
      'waiting-other-questions',
    );
    await answer(world, REQUEST_B, 'Answer for B.');
    const claimed = await claimContinuation(world);
    expect(claimed.answerIds).toEqual([REQUEST_A, REQUEST_B]);
    expect(claimed.todo?.decisions?.map((d) => [d.requestId, d.answer])).toEqual([
      [REQUEST_A, 'Answer for A.'],
      [REQUEST_B, 'Answer for B.'],
    ]);
    expect(claimed.instruction ?? '').not.toContain('Answer for');
    ack(world, claimed.step.id, [REQUEST_A, REQUEST_B], 'session-start');
    finish(claimed.step.id);
    await sendBuildSteer(
      deps(),
      world.buildId,
      { content: 'Carry on.' },
      { human: true, afterTurn: true },
    );
    expect((await claimContinuation(world)).answerIds).toBeUndefined();
  });

  test('two answers into a running step before pickup: the slot carries neither, one pickup carries both, one ack marks both', async () => {
    const world = startSession();
    await ask(world, REQUEST_A, true);
    await ask(world, REQUEST_B, true);
    expect((await answer(world, REQUEST_A, 'Answer for A.')).delivered).toBe('steer');
    expect((await answer(world, REQUEST_B, 'Answer for B.')).delivered).toBe('steer');
    expect(
      H.s.db
        .select()
        .from(steerPending)
        .where(eq(steerPending.conversationId, world.buildId))
        .get(),
    ).toBeUndefined();
    expect(pickup(world)).toEqual({
      content: null,
      answers: [
        { requestId: REQUEST_A, text: 'Answer for A.' },
        { requestId: REQUEST_B, text: 'Answer for B.' },
      ],
    });
    ack(world, world.stepRow.id, [REQUEST_A, REQUEST_B], 'steer');
    expect(pickup(world)).toEqual({ content: null });
  });

  test('a pickup the daemon never acks, as when live.steer fails, is handed out again on the next pickup', async () => {
    const world = startSession();
    await ask(world, REQUEST_A, true);
    await answer(world, REQUEST_A, 'Repo rule wins.');
    const expected = [{ requestId: REQUEST_A, text: 'Repo rule wins.' }];
    expect(pickup(world).answers).toEqual(expected);
    expect(pickup(world).answers).toEqual(expected);
  });

  test('the session is gone before the ack: the continuation enqueued at step end carries the answer and its session-start ack marks it', async () => {
    const world = startSession();
    await ask(world, REQUEST_A, true);
    await answer(world, REQUEST_A, 'Repo rule wins.');
    expect(pickup(world).answers).toHaveLength(1);
    finish(world.stepRow.id);
    const claimed = await claimContinuation(world);
    expect(claimed.answerIds).toEqual([REQUEST_A]);
    ack(world, claimed.step.id, [REQUEST_A], 'session-start');
    expect(recordOf(world, REQUEST_A)).toMatchObject({
      deliveredVia: 'session-start',
      deliveredStepId: claimed.step.id,
    });
  });

  test('an ack that arrives after its step finished still marks the answer; an ack from another machine marks nothing', async () => {
    const world = startSession();
    await ask(world, REQUEST_A, true);
    await answer(world, REQUEST_A, 'Repo rule wins.');
    finish(world.stepRow.id);
    const stranger = insertMachine(H.s);
    ackSteer(deps(), { id: stranger, teamId: H.teamId }, world.stepRow.id, {
      answerIds: [REQUEST_A],
      via: 'steer',
    });
    expect(recordOf(world, REQUEST_A)?.deliveredAt).toBeNull();
    ack(world, world.stepRow.id, [REQUEST_A], 'steer');
    expect(recordOf(world, REQUEST_A)).toMatchObject({
      deliveredVia: 'steer',
      deliveredStepId: world.stepRow.id,
    });
  });

  test('a step that ends with an undelivered answer and no pending question does not go to review: the continuation that delivers it is enqueued', async () => {
    const world = startSession();
    await ask(world, REQUEST_A, true);
    await answer(world, REQUEST_A, 'Repo rule wins.');
    finish(world.stepRow.id);
    expect(phaseOf(world)).not.toBe('review');
    const queued = H.s.db
      .select()
      .from(step)
      .where(and(eq(step.buildId, world.buildId), eq(step.status, 'pending')))
      .all()
      .filter((row) => row.kind !== 'chief');
    expect(queued.map((row) => [row.kind, row.prompt])).toEqual([
      [world.stepRow.kind, ANSWERS_CONTINUE_PROMPT],
    ]);
    expect((await claimContinuation(world)).answerIds).toEqual([REQUEST_A]);
  });

  test('a step that ends with a pending question still goes to needs_input, with no continuation', async () => {
    const world = startSession();
    await ask(world, REQUEST_A, true);
    await ask(world, REQUEST_B, true);
    finish(world.stepRow.id);
    expect(phaseOf(world)).toBe('needs_input');
    expect(
      H.s.db
        .select()
        .from(step)
        .where(and(eq(step.buildId, world.buildId), eq(step.status, 'pending')))
        .all()
        .filter((row) => row.kind !== 'chief'),
    ).toEqual([]);
  });

  test('a double ack and an ack for an unknown id change nothing', async () => {
    const world = startSession();
    await ask(world, REQUEST_A, true);
    await answer(world, REQUEST_A, 'Repo rule wins.');
    ack(world, world.stepRow.id, [REQUEST_A], 'steer');
    const first = recordOf(world, REQUEST_A);
    expect(first).toMatchObject({ deliveredVia: 'steer', deliveredStepId: world.stepRow.id });
    expect(typeof first?.deliveredAt).toBe('number');
    ack(world, world.stepRow.id, [REQUEST_A], 'session-start');
    expect(ack(world, world.stepRow.id, ['ask-unknown-0000'], 'steer')).toEqual({ ok: true });
    expect(recordOf(world, REQUEST_A)).toEqual(first);
  });
});

const ROOT = join(import.meta.dirname, '..', '..', '..');
const RECORD_MODULE = 'apps/server/src/services/answer-delivery.ts';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

test('no file other than the record module writes deliveredAt', () => {
  const writers = ['apps/server/src', 'apps/daemon/src', 'apps/web/src']
    .flatMap((dir) => sourceFiles(join(ROOT, dir)))
    .filter((path) => /delivered(At|Via|StepId)\s*(:|=[^=])/.test(readFileSync(path, 'utf8')))
    .map((path) => relative(ROOT, path));
  expect(writers).toEqual([RECORD_MODULE]);
});
