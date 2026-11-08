import { QUESTION_DEADLINE_MS } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { message, notification, step, todo } from '../src/db/schema.js';
import { applyStepFailure, completeStep, startBuilds } from '../src/services/builds.js';
import { buildChiefSystemPrompt } from '../src/services/chief.js';
import { listNeedsYou } from '../src/services/needs-you.js';
import { sweepQuestionDeadlines } from '../src/services/question-deadlines.js';
import { getTodo } from '../src/services/todos.js';
import { askWorkerQuestion } from '../src/services/worker-questions.js';
import { H, registerChiefHarness, relay, toolDeps } from './chief-harness.js';

registerChiefHarness();

const REQUEST = 'ask-cccccccc-1111-2222-3333-444444444444';
const QUESTION = [
  {
    header: 'Conflict',
    question: 'The brief says keep the banned string; the repo bans it. Which wins?',
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

async function parkedQuestion() {
  const todoId = `todo-${Math.random().toString(36).slice(2, 8)}`;
  H.s.db
    .insert(todo)
    .values({
      id: todoId,
      teamId: H.teamId,
      projectId: H.projectId,
      title: 'Port the onboarding copy',
      spec: 'Keep the text unchanged.',
      phase: 'todo',
      phaseAt: 1,
      seqNum: 136,
    })
    .run();
  const [started] = startBuilds(deps(), { projectId: H.projectId, todoIds: [todoId] });
  const buildId = started!.id;
  const stepRow = H.s.db.select().from(step).where(eq(step.buildId, buildId)).get()!;
  H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
  H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepRow.id)).run();
  const claimed = H.s.db.select().from(step).where(eq(step.id, stepRow.id)).get()!;
  await askWorkerQuestion(
    deps(),
    claimed,
    { requestId: REQUEST, questions: QUESTION },
    { holdMs: 0 },
  );
  completeStep(deps(), stepRow.id, { hasChanges: true });
  const stored = H.s.db.select().from(message).where(eq(message.id, REQUEST)).get()!;
  const deadlineAt = (stored.content as { deadlineAt: number }).deadlineAt;
  return { todoId, buildId, askedAt: deadlineAt - QUESTION_DEADLINE_MS };
}

function questionWakes() {
  return H.s.db
    .select()
    .from(step)
    .all()
    .filter((row) => row.kind === 'chief' && row.prompt?.includes(REQUEST) === true);
}

function questionStatus(buildId: string) {
  const row = H.s.db
    .select()
    .from(message)
    .where(and(eq(message.id, REQUEST), eq(message.conversationId, buildId)))
    .get();
  return (row?.content as { status?: string } | undefined)?.status;
}

function ownerNotifications(todoId: string) {
  return H.s.db
    .select()
    .from(notification)
    .all()
    .filter((row) => row.entityId === todoId);
}

function ownerNeedsYou() {
  const query = listNeedsYou({ db: H.s.db }, H.teamId, 'owner');
  return [...query.current, ...query.stale].map((entry) => entry.todo.id);
}

describe('a parked question goes to the Coordinator, not the owner (task stall S11)', () => {
  test('a parked agent question in a non-escalation class never appears in needs-you and pushes nothing to the owner', async () => {
    const { todoId } = await parkedQuestion();
    expect(getTodo(deps(), todoId)?.phase).toBe('needs_input');
    expect(ownerNeedsYou()).not.toContain(todoId);
    expect(ownerNotifications(todoId)).toEqual([]);
    expect(getTodo(deps(), todoId)?.waitingOn).toEqual({ on: 'coordinator', retryAt: null });
  });

  test('a failed task goes to the Coordinator as a wake even when unwatched, and stays out of the owner needs-you', async () => {
    const { todoId, buildId } = await parkedQuestion();
    await relay('answer_question', { todoId, requestId: REQUEST, answer: 'Repo rule wins.' });
    const resumed = H.s.db
      .select()
      .from(step)
      .where(and(eq(step.buildId, buildId), eq(step.status, 'pending')))
      .get()!;
    H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, resumed.id)).run();
    applyStepFailure(
      deps(),
      { ...resumed, status: 'claimed' },
      'api key is missing for provider stub-gw',
    );
    expect(getTodo(deps(), todoId)?.phase).toBe('failed');
    expect(ownerNeedsYou()).not.toContain(todoId);
    const wakes = H.s.db
      .select()
      .from(step)
      .all()
      .filter((row) => row.kind === 'chief' && row.prompt?.includes('api key is missing') === true);
    expect(wakes).toHaveLength(1);
  });
});

describe('repo rules beat the brief; only owner classes escalate (task stall S3)', () => {
  test('the Coordinator prompt resolves conflicts by repo rule and names the four owner classes', () => {
    const text = buildChiefSystemPrompt(toolDeps(), H.teamId, H.threadId).text;
    expect(text).toContain('repo rules > the brief > the thread default');
    for (const owner of ['design', 'payment', 'credential', 'intended-behavior']) {
      expect(text).toContain(owner);
    }
    expect(text).toContain('escalate_question');
    expect(text).not.toContain('不替它做决定');
  });

  test('an escalated design question reaches the owner needs-you with the default the Coordinator proposes', async () => {
    const { todoId } = await parkedQuestion();
    await relay('escalate_question', {
      todoId,
      requestId: REQUEST,
      class: 'design',
      defaultAnswer: 'Repo rule wins; rewrite the string.',
    });
    expect(ownerNeedsYou()).toContain(todoId);
    expect(getTodo(deps(), todoId)?.waitingOn).toEqual({ on: 'owner', retryAt: null });
    const notices = ownerNotifications(todoId);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.snippet).toContain('Repo rule wins; rewrite the string.');
  });
});

describe('a timeout wakes the Coordinator, then reaches the owner with a default (task stall S1)', () => {
  test('the first deadline re-wakes the Coordinator; the second escalates to the owner instead of parking silently', async () => {
    const { todoId, buildId, askedAt } = await parkedQuestion();
    expect(questionWakes()).toHaveLength(1);
    await sweepQuestionDeadlines(deps(), askedAt + QUESTION_DEADLINE_MS - 1);
    expect(questionWakes()).toHaveLength(1);
    await sweepQuestionDeadlines(deps(), askedAt + QUESTION_DEADLINE_MS + 1);
    expect(questionWakes()).toHaveLength(2);
    expect(questionWakes()[1]?.prompt).toContain('deadline');
    expect(ownerNeedsYou()).not.toContain(todoId);
    await sweepQuestionDeadlines(deps(), askedAt + 2 * QUESTION_DEADLINE_MS + 2);
    expect(ownerNeedsYou()).toContain(todoId);
    expect(questionStatus(buildId)).toBe('pending');
  });

  test('an owner-class default is never applied by the clock', async () => {
    const { todoId, buildId, askedAt } = await parkedQuestion();
    await relay('escalate_question', {
      todoId,
      requestId: REQUEST,
      class: 'payment',
      defaultAnswer: 'Buy the larger plan.',
    });
    await sweepQuestionDeadlines(deps(), askedAt + 10 * QUESTION_DEADLINE_MS);
    expect(questionStatus(buildId)).toBe('pending');
    expect(getTodo(deps(), todoId)?.phase).toBe('needs_input');
  });

  test('an escalation outside the owner classes applies its default after the deadline and resumes the same build', async () => {
    const { todoId, buildId } = await parkedQuestion();
    const at = Date.now();
    await relay('escalate_question', {
      todoId,
      requestId: REQUEST,
      class: 'other',
      defaultAnswer: 'Use the repo rule.',
    });
    expect(ownerNotifications(todoId)[0]?.snippet).toContain('Use the repo rule.');
    await sweepQuestionDeadlines(deps(), at + QUESTION_DEADLINE_MS - 1_000);
    expect(questionStatus(buildId)).toBe('pending');
    await sweepQuestionDeadlines(deps(), at + QUESTION_DEADLINE_MS + 1_000);
    expect(questionStatus(buildId)).toBe('answered');
    expect(getTodo(deps(), todoId)?.latestBuildId).toBe(buildId);
    expect(getTodo(deps(), todoId)?.decisions?.[0]).toMatchObject({
      answer: 'Use the repo rule.',
      by: 'coordinator',
    });
  });
});
