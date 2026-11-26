import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { chiefMessage, chiefThread, step as stepTable } from '../src/db/schema.js';
import { ASK_PARKED_REASON, cancelPendingQuestions } from '../src/services/chief-question-store.js';
import {
  ASK_PARK_MS,
  createOrGetQuestion,
  holdForQuestion,
} from '../src/services/chief-questions.js';
import { hasEarlierLiveChiefStep } from '../src/services/chief-turns.js';
import { H, registerChiefHarness } from './chief-harness.js';
import { postProject, req } from './helpers.js';

registerChiefHarness();

type AskedQuestion = { header: string; question: string; options: { label: string }[] };

const QUESTIONS: AskedQuestion[] = [{ header: 'scope', question: 'Which pages?', options: [] }];
const CHOICE: AskedQuestion[] = [
  {
    header: 'scope',
    question: 'Which pages?',
    options: [{ label: 'the board' }, { label: 'settings' }],
  },
];

async function askFromProjectTurn(projectId: string, ageMs: number, questions = QUESTIONS) {
  const res = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/chief/threads`, {
    content: 'plan it',
    projectId,
  });
  expect(res.status).toBe(201);
  const stepId = ((await res.json()) as { message: { id: string } }).message.id;
  H.s.db
    .update(stepTable)
    .set({ status: 'claimed', claimedAt: Date.now() })
    .where(eq(stepTable.id, stepId))
    .run();
  createOrGetQuestion(
    { db: H.s.db },
    { threadId: H.threadId, requestId: 'ask-q', questions, askedFor: [stepId] },
  );
  H.s.db
    .update(chiefMessage)
    .set({ createdAt: Date.now() - ageMs })
    .where(eq(chiefMessage.id, 'ask-q'))
    .run();
  H.s.db
    .update(chiefMessage)
    .set({ createdAt: Date.now() - ageMs - 1000 })
    .where(eq(chiefMessage.id, stepId))
    .run();
  return stepId;
}

function finishTurn(stepId: string) {
  H.s.db
    .update(stepTable)
    .set({ status: 'done', finishedAt: Date.now() })
    .where(eq(stepTable.id, stepId))
    .run();
  cancelPendingQuestions({ db: H.s.db }, H.threadId, 'the turn ended');
  H.s.db.update(chiefThread).set({ activeRun: null }).where(eq(chiefThread.id, H.threadId)).run();
}

function questionRow() {
  const row = H.s.db.select().from(chiefMessage).where(eq(chiefMessage.id, 'ask-q')).get();
  return {
    projectId: row?.projectId ?? null,
    content: JSON.parse(row?.content as string) as {
      status: string;
      parkedAt?: number;
      cancelReason?: string;
      answers?: { header: string; text?: string; choices?: string[] }[] | null;
    },
  };
}

function chiefSteps() {
  return H.s.db
    .select()
    .from(stepTable)
    .where(eq(stepTable.buildId, H.threadId))
    .all()
    .filter((s) => s.kind === 'chief');
}

async function answer() {
  return req(
    H.s.app,
    'POST',
    `/api/teams/${H.teamId}/chief/threads/${H.threadId}/questions/ask-q/answer`,
    { answers: [{ header: 'scope', text: 'only the board' }] },
  );
}

describe('ask_user parks instead of holding the one Coordinator thread', () => {
  test('a question answered quickly stays in the turn and is not parked', async () => {
    await askFromProjectTurn(H.projectId, 0);
    const held = await holdForQuestion(
      { db: H.s.db },
      { threadId: H.threadId, requestId: 'ask-q', holdMs: 0 },
    );
    expect(held).toBeNull();
    expect(questionRow().content.parkedAt).toBeUndefined();
  });

  test('past the park window the turn is told to end, and the question stays pending and tagged', async () => {
    await askFromProjectTurn(H.projectId, ASK_PARK_MS + 1);
    const held = await holdForQuestion(
      { db: H.s.db },
      { threadId: H.threadId, requestId: 'ask-q', holdMs: 0 },
    );
    expect(held?.status).toBe('cancelled');
    expect(held?.cancelReason).toBe(ASK_PARKED_REASON);
    const stored = questionRow();
    expect(stored.content.status).toBe('pending');
    expect(typeof stored.content.parkedAt).toBe('number');
    expect(stored.projectId).toBe(H.projectId);
  });

  test('an answer given while the asking turn runs is cited by that turn', async () => {
    const asker = await askFromProjectTurn(H.projectId, 0);
    const res = await answer();
    expect(res.status).toBe(200);
    const running = chiefSteps().find((s) => s.id === asker)!;
    expect(running.ownerMessageIds).toEqual([asker, 'ask-q']);
  });

  test('a parked question survives the end of its turn and answers hours later start a new turn', async () => {
    const asker = await askFromProjectTurn(H.projectId, 31 * 60_000);
    await holdForQuestion({ db: H.s.db }, { threadId: H.threadId, requestId: 'ask-q', holdMs: 0 });
    finishTurn(asker);
    expect(questionRow().content.status).toBe('pending');
    const res = await answer();
    expect(res.status).toBe(200);
    expect(questionRow().content.status).toBe('answered');
    const resumed = chiefSteps().filter((s) => s.id !== asker);
    expect(resumed).toHaveLength(1);
    expect(resumed[0]?.status).toBe('pending');
    expect(resumed[0]?.prompt).toContain(`demo（id: ${H.projectId}）`);
    expect(resumed[0]?.prompt).toContain('Which pages?');
    expect(resumed[0]?.prompt).toContain('only the board');
    expect(resumed[0]?.ownerMessageIds).toEqual([asker, 'ask-q']);
  });

  test('while a question is parked another project turn runs and finishes', async () => {
    const asker = await askFromProjectTurn(H.projectId, ASK_PARK_MS + 1);
    await holdForQuestion({ db: H.s.db }, { threadId: H.threadId, requestId: 'ask-q', holdMs: 0 });
    finishTurn(asker);
    const site = await postProject(H.s.app, 'cairn-site');
    const res = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/chief/threads`, {
      content: 'site intake',
      projectId: site,
    });
    const next = ((await res.json()) as { message: { id: string } }).message.id;
    const row = H.s.db.select().from(stepTable).where(eq(stepTable.id, next)).get();
    if (!row) throw new Error('turn missing');
    expect(hasEarlierLiveChiefStep(H.s.db, row)).toBe(false);
    finishTurn(next);
    expect(H.s.db.select().from(stepTable).where(eq(stepTable.id, next)).get()?.status).toBe(
      'done',
    );
    expect(questionRow().content.status).toBe('pending');
  });

  test('an answer to a parked question of an archived project is refused and stays answerable', async () => {
    const asker = await askFromProjectTurn(H.projectId, ASK_PARK_MS + 1);
    await holdForQuestion({ db: H.s.db }, { threadId: H.threadId, requestId: 'ask-q', holdMs: 0 });
    finishTurn(asker);
    await req(H.s.app, 'POST', `/api/projects/${H.projectId}/archive`);
    expect((await answer()).status).toBe(409);
    expect(questionRow().content.status).toBe('pending');
    expect(chiefSteps().map((s) => s.id)).toEqual([asker]);
    await req(H.s.app, 'POST', `/api/projects/${H.projectId}/unarchive`);
    expect((await answer()).status).toBe(200);
  });

  test('cancel removes a parked question and starts no turn', async () => {
    const asker = await askFromProjectTurn(H.projectId, ASK_PARK_MS + 1);
    await holdForQuestion({ db: H.s.db }, { threadId: H.threadId, requestId: 'ask-q', holdMs: 0 });
    finishTurn(asker);
    const res = await req(
      H.s.app,
      'POST',
      `/api/teams/${H.teamId}/chief/threads/${H.threadId}/questions/ask-q/cancel`,
      {},
    );
    expect(res.status).toBe(200);
    expect(questionRow().content.status).toBe('cancelled');
    expect(chiefSteps().map((s) => s.id)).toEqual([asker]);
    expect((await answer()).status).toBe(409);
  });

  test('an owner message sent while a choice question waits parks it at once, so the turn ends and the message is answered', async () => {
    await askFromProjectTurn(H.projectId, 0, CHOICE);
    const sent = await req(H.s.app, 'POST', `/api/conversations/${H.threadId}/messages`, {
      content: 'meanwhile, check the deploy',
    });
    expect(sent.status).toBeLessThan(300);
    const held = await holdForQuestion(
      { db: H.s.db },
      { threadId: H.threadId, requestId: 'ask-q', holdMs: 0 },
    );
    expect(held?.status).toBe('cancelled');
    expect(held?.cancelReason).toBe(ASK_PARKED_REASON);
    expect(questionRow().content.status).toBe('pending');
    expect(typeof questionRow().content.parkedAt).toBe('number');
    const answered = await req(
      H.s.app,
      'POST',
      `/api/teams/${H.teamId}/chief/threads/${H.threadId}/questions/ask-q/answer`,
      { answers: [{ header: 'scope', choices: ['the board'] }] },
    );
    expect(answered.status).toBe(200);
  });

  for (const [when, ageMs] of [
    ['while its turn waits', 0],
    ['after it was parked', ASK_PARK_MS + 1],
  ] as const) {
    test(`the owner's next message answers a plain question ${when}`, async () => {
      await askFromProjectTurn(H.projectId, ageMs);
      if (ageMs > 0)
        await holdForQuestion(
          { db: H.s.db },
          { threadId: H.threadId, requestId: 'ask-q', holdMs: 0 },
        );
      const sent = await req(H.s.app, 'POST', `/api/conversations/${H.threadId}/messages`, {
        content: '  only the board  ',
      });
      expect(sent.status).toBeLessThan(300);
      expect(questionRow().content.status).toBe('answered');
      expect(questionRow().content.answers).toEqual([{ header: 'scope', text: 'only the board' }]);
    });
  }

  test('a rewind past a parked question is refused until it is answered or cancelled', async () => {
    const asker = await askFromProjectTurn(H.projectId, ASK_PARK_MS + 1);
    await holdForQuestion({ db: H.s.db }, { threadId: H.threadId, requestId: 'ask-q', holdMs: 0 });
    finishTurn(asker);
    const rewind = await req(
      H.s.app,
      'POST',
      `/api/teams/${H.teamId}/chief/threads/${H.threadId}/rewind`,
      { messageId: asker },
    );
    expect(rewind.status).toBe(409);
    expect(((await rewind.json()) as { error: string }).error).toContain('waiting for an answer');
    expect(questionRow().content.status).toBe('pending');
  });
});
