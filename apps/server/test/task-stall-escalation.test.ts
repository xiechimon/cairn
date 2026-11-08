import { randomUUID } from 'node:crypto';
import {
  ASK_USER_QUESTION_KIND,
  DEFAULT_AUTONOMY_SETTINGS,
  QUESTION_DEADLINE_MS,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { chiefMessage, message, notification, project, step, todo } from '../src/db/schema.js';
import { applyStepFailure, completeStep, startBuilds } from '../src/services/builds.js';
import { buildChiefSystemPrompt, triggerChiefWakes } from '../src/services/chief.js';
import { answerQuestion } from '../src/services/chief-questions.js';
import { listNeedsYou } from '../src/services/needs-you.js';
import { sweepQuestionDeadlines } from '../src/services/question-deadlines.js';
import { getTodo } from '../src/services/todos.js';
import { askWorkerQuestion } from '../src/services/worker-questions.js';
import { H, registerChiefHarness, relay, toolDeps } from './chief-harness.js';
import { req } from './helpers.js';

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

function ownerSays(content: string, createdAt: number, role: 'user' | 'assistant' = 'user') {
  const id = `owner-${Math.random().toString(36).slice(2, 10)}`;
  H.s.db
    .insert(chiefMessage)
    .values({ id, threadId: H.threadId, role, content, projectId: null, createdAt })
    .run();
  return id;
}

function askCard() {
  const requestId = `ask-${randomUUID()}`;
  H.s.db
    .insert(chiefMessage)
    .values({
      id: requestId,
      threadId: H.threadId,
      role: 'assistant',
      content: JSON.stringify({
        kind: ASK_USER_QUESTION_KIND,
        requestId,
        status: 'pending',
        questions: [
          {
            header: 'Copy',
            question: 'Which wins for the onboarding copy?',
            options: [{ label: 'Repo rule' }, { label: 'Brief' }],
          },
        ],
        answers: null,
      }),
      projectId: null,
      createdAt: Date.now(),
    })
    .run();
  return requestId;
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

describe('a research report the owner no longer accepts goes to the Coordinator (task stall S11)', () => {
  test('an unwatched info thread reaching review in a human-policy project wakes the Coordinator to accept it', () => {
    H.s.db
      .update(project)
      .set({ autonomy: { ...DEFAULT_AUTONOMY_SETTINGS, mergePolicy: 'human' } })
      .where(eq(project.id, H.projectId))
      .run();
    const todoId = `todo-${Math.random().toString(36).slice(2, 8)}`;
    H.s.db
      .insert(todo)
      .values({
        id: todoId,
        teamId: H.teamId,
        projectId: H.projectId,
        title: 'Survey the queue libraries',
        spec: 'Compare three.',
        phase: 'review',
        phaseAt: 1,
        seqNum: 141,
        output: 'info',
      })
      .run();
    const record = getTodo(deps(), todoId);
    if (record === null) throw new Error('todo missing');
    triggerChiefWakes(toolDeps(), record, 'review');
    const wakes = H.s.db
      .select()
      .from(step)
      .all()
      .filter((row) => row.kind === 'chief' && row.prompt?.includes('#141') === true);
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.prompt).toContain('complete_todos');
    expect(wakes[0]?.prompt).toMatch(/\nGate todo=\S+ build=\S* phase=review attempt=0$/);
    expect(ownerNeedsYou()).not.toContain(todoId);
  });
});

describe('an escalation keeps the default answer exactly as proposed', () => {
  test('a multiline default is stored with its newlines and indentation', async () => {
    const { todoId, buildId } = await parkedQuestion();
    const defaultAnswer = 'Use this config:\n  retries: 3\n  backoff: exponential';
    await relay('escalate_question', { todoId, requestId: REQUEST, class: 'other', defaultAnswer });
    const stored = H.s.db
      .select()
      .from(message)
      .where(and(eq(message.id, REQUEST), eq(message.conversationId, buildId)))
      .get()?.content as { escalation?: { defaultAnswer: string | null } } | undefined;
    expect(stored?.escalation?.defaultAnswer).toBe(defaultAnswer);
  });

  test('an oversized default is refused instead of truncated', async () => {
    const { todoId, buildId } = await parkedQuestion();
    await expect(
      relay('escalate_question', {
        todoId,
        requestId: REQUEST,
        class: 'other',
        defaultAnswer: 'x'.repeat(20_001),
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(questionStatus(buildId)).toBe('pending');
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

  test('an escalated question on a failed thread marks the thread as waiting on the owner', async () => {
    const { todoId } = await parkedQuestion();
    H.s.db.update(todo).set({ phase: 'failed' }).where(eq(todo.id, todoId)).run();
    expect(getTodo(deps(), todoId)?.waitingOn).toBeUndefined();
    await relay('escalate_question', {
      todoId,
      requestId: REQUEST,
      class: 'payment',
      defaultAnswer: 'Stay on the free plan.',
    });
    expect(getTodo(deps(), todoId)?.waitingOn).toEqual({ on: 'owner', retryAt: null });
    expect(ownerNeedsYou()).toContain(todoId);
  });

  test('a long question never pushes the proposed default out of the owner notice', async () => {
    const { todoId, buildId } = await parkedQuestion();
    const stored = H.s.db.select().from(message).where(eq(message.id, REQUEST)).get();
    const content = stored?.content as { questions: { question: string }[] };
    H.s.db
      .update(message)
      .set({
        content: {
          ...content,
          questions: [{ ...content.questions[0], question: `${'Which wins? '.repeat(20)}` }],
        },
      })
      .where(and(eq(message.id, REQUEST), eq(message.conversationId, buildId)))
      .run();
    await relay('escalate_question', {
      todoId,
      requestId: REQUEST,
      class: 'other',
      defaultAnswer: 'Repo rule wins.',
    });
    expect(ownerNotifications(todoId)[0]?.snippet).toContain('Default: Repo rule wins.');
  });

  test('the owner answering an owner-class question in the Coordinator chat resumes the thread as the owner decision', async () => {
    const { todoId, buildId } = await parkedQuestion();
    await relay('escalate_question', {
      todoId,
      requestId: REQUEST,
      class: 'design',
      defaultAnswer: 'Repo rule wins.',
    });
    const ownerMessageId = ownerSays('Go with the brief this time.', Date.now() + 1);
    await relay('answer_question', {
      todoId,
      requestId: REQUEST,
      answer: 'Brief wins.',
      ownerMessageId,
    });
    expect(questionStatus(buildId)).toBe('answered');
    expect(getTodo(deps(), todoId)?.decisions).toEqual([
      expect.objectContaining({ requestId: REQUEST, answer: 'Brief wins.', by: 'person' }),
    ]);
    const resumed = H.s.db
      .select()
      .from(step)
      .where(and(eq(step.buildId, buildId), eq(step.status, 'pending')))
      .all();
    expect(resumed).toHaveLength(1);
  });

  test('an owner message from before the escalation does not authorize an owner-class answer', async () => {
    const { todoId, buildId } = await parkedQuestion();
    const early = ownerSays('Brief wins.', Date.now() - 60_000);
    await relay('escalate_question', {
      todoId,
      requestId: REQUEST,
      class: 'payment',
      defaultAnswer: 'Stay on the free plan.',
    });
    await expect(
      relay('answer_question', {
        todoId,
        requestId: REQUEST,
        answer: 'Brief wins.',
        ownerMessageId: early,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(questionStatus(buildId)).toBe('pending');
  });

  test('an owner-answered Coordinator question card relays an owner-class answer and resumes the worker', async () => {
    const { todoId, buildId } = await parkedQuestion();
    await relay('escalate_question', {
      todoId,
      requestId: REQUEST,
      class: 'design',
      defaultAnswer: 'Repo rule wins.',
    });
    const card = askCard();
    const res = await req(
      H.s.app,
      'POST',
      `/api/teams/${H.teamId}/chief/threads/${H.threadId}/questions/${card}/answer`,
      { answers: [{ header: 'Copy', choices: ['Brief'] }] },
    );
    expect(res.status).toBeLessThan(300);
    await relay('answer_question', {
      todoId,
      requestId: REQUEST,
      answer: 'Brief wins.',
      ownerMessageId: card,
    });
    expect(questionStatus(buildId)).toBe('answered');
    expect(getTodo(deps(), todoId)?.decisions).toEqual([
      expect.objectContaining({ requestId: REQUEST, by: 'person' }),
    ]);
  });

  test('a question card the Coordinator answered itself does not authorize an owner-class answer', async () => {
    const { todoId, buildId } = await parkedQuestion();
    await relay('escalate_question', {
      todoId,
      requestId: REQUEST,
      class: 'payment',
      defaultAnswer: 'Stay on the free plan.',
    });
    const card = askCard();
    answerQuestion(
      { db: H.s.db },
      { threadId: H.threadId, requestId: card, answers: [{ header: 'Copy', choices: ['Brief'] }] },
      'agent',
    );
    await expect(
      relay('answer_question', {
        todoId,
        requestId: REQUEST,
        answer: 'Brief wins.',
        ownerMessageId: card,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(questionStatus(buildId)).toBe('pending');
  });

  test('a question card the owner answered before the escalation does not authorize it', async () => {
    const { todoId, buildId } = await parkedQuestion();
    const card = askCard();
    const res = await req(
      H.s.app,
      'POST',
      `/api/teams/${H.teamId}/chief/threads/${H.threadId}/questions/${card}/answer`,
      { answers: [{ header: 'Copy', choices: ['Brief'] }] },
    );
    expect(res.status).toBeLessThan(300);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await relay('escalate_question', {
      todoId,
      requestId: REQUEST,
      class: 'credential',
      defaultAnswer: 'Use the team key.',
    });
    await expect(
      relay('answer_question', {
        todoId,
        requestId: REQUEST,
        answer: 'Brief wins.',
        ownerMessageId: card,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(questionStatus(buildId)).toBe('pending');
  });

  test('an assistant message cannot stand in for the owner', async () => {
    const { todoId, buildId } = await parkedQuestion();
    await relay('escalate_question', {
      todoId,
      requestId: REQUEST,
      class: 'credential',
      defaultAnswer: 'Use the team key.',
    });
    const fake = ownerSays('Use the team key.', Date.now() + 1, 'assistant');
    await expect(
      relay('answer_question', {
        todoId,
        requestId: REQUEST,
        answer: 'Use the team key.',
        ownerMessageId: fake,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(questionStatus(buildId)).toBe('pending');
  });

  test('an escalated owner-class question leaves the Coordinator queue and refuses a Coordinator answer', async () => {
    const { todoId, buildId } = await parkedQuestion();
    await relay('escalate_question', {
      todoId,
      requestId: REQUEST,
      class: 'design',
      defaultAnswer: 'Repo rule wins; rewrite the string.',
    });
    const view = (await relay('needs_you', {})) as {
      questions?: { todoId: string }[];
      others?: { todoId: string }[];
    };
    expect(JSON.stringify(view)).not.toContain(REQUEST);
    await expect(
      relay('answer_question', { todoId, requestId: REQUEST, answer: 'Brief wins.' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(questionStatus(buildId)).toBe('pending');
    expect(getTodo(deps(), todoId)?.phase).toBe('needs_input');
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
