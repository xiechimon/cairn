import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  chiefMessage,
  chiefThread,
  coordinatorConversation,
  step as stepTable,
} from '../src/db/schema.js';
import {
  answerChiefQuestion,
  rewindChiefThread,
  sendChiefMessage,
  sendChiefMessageFromComposer,
} from '../src/services/chief.js';
import {
  ASK_PARK_MS,
  createOrGetQuestion,
  holdForQuestion,
} from '../src/services/chief-questions.js';
import { takeChiefSteer } from '../src/services/chief-turns.js';
import {
  consumeCoordinatorInput,
  pullCoordinatorInput,
} from '../src/services/coordinator-inputs.js';
import { createTodo } from '../src/services/todos.js';
import { H, registerChiefHarness } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();

const deps = () => ({ db: H.s.db, hub: H.s.hub, user: H.s.user, machineHub: H.s.machineHub });
const steps = () => H.s.db.select().from(stepTable).where(eq(stepTable.buildId, H.threadId)).all();
const stepOf = (id: string) => H.s.db.select().from(stepTable).where(eq(stepTable.id, id)).get()!;
const owners = (id: string) =>
  (stepOf(id) as { ownerMessageIds?: string[] | null }).ownerMessageIds;

function send(content: string) {
  return sendChiefMessage(deps(), H.teamId, { threadId: H.threadId, content }).message.id;
}

function claim(id: string) {
  H.s.db
    .update(stepTable)
    .set({ status: 'claimed', claimedAt: Date.now() })
    .where(eq(stepTable.id, id))
    .run();
}

function finish(id: string) {
  H.s.db
    .update(stepTable)
    .set({ status: 'done', finishedAt: Date.now() })
    .where(eq(stepTable.id, id))
    .run();
  H.s.db.update(chiefThread).set({ activeRun: null }).where(eq(chiefThread.id, H.threadId)).run();
}

const QUESTIONS = [{ header: 'scope', question: 'Which pages?', options: [] }];

function ageQuestion(requestId: string) {
  H.s.db
    .update(chiefMessage)
    .set({ createdAt: Date.now() - ASK_PARK_MS - 1 })
    .where(eq(chiefMessage.id, requestId))
    .run();
}

describe('step.ownerMessageIds is written by every turn kind', () => {
  test('T1 an owner message starts a turn citing that message', () => {
    const id = send('修登录页');
    expect(owners(id)).toEqual([id]);
  });

  test('T2 native steering attributes the owner only after its exact durable receipt', () => {
    const first = send('修登录页');
    claim(first);
    const second = sendChiefMessageFromComposer(deps(), H.teamId, {
      threadId: H.threadId,
      content: '只改 Safari',
    }).result.message.id;
    takeChiefSteer(H.s.db, H.threadId);
    expect(owners(first)).toEqual([first]);
    H.s.db
      .insert(coordinatorConversation)
      .values({
        threadId: H.threadId,
        storeId: 'test',
        conversationId: '2',
        piVersion: '1.5.0',
        updatedAt: 1,
      })
      .run();
    expect(pullCoordinatorInput(H.s.db, first, 'test:2')?.id).toBe(second);
    consumeCoordinatorInput(H.s.db, second, 'test:2', '4');
    expect(owners(first)).toEqual([first, second]);
  });

  test('T3 a queued owner message becomes its own turn citing itself', () => {
    const first = send('修登录页');
    const second = send('再改 README');
    expect(owners(first)).toEqual([first]);
    expect(owners(second)).toEqual([second]);
  });

  test('T4 a rewind re-runs the anchor message and cites it', () => {
    const anchor = send('修登录页');
    finish(anchor);
    rewindChiefThread(deps(), H.teamId, H.threadId, { messageId: anchor });
    const rerun = steps().find((row) => row.id !== anchor)!;
    expect(owners(rerun.id)).toEqual([anchor]);
  });

  test('T5 an owner answer given while the asking turn runs is added to that turn', () => {
    const asker = send('修计数');
    claim(asker);
    createOrGetQuestion(
      { db: H.s.db },
      { threadId: H.threadId, requestId: 'ask-t5', questions: QUESTIONS, askedFor: [asker] },
    );
    answerChiefQuestion(deps(), H.teamId, {
      threadId: H.threadId,
      requestId: 'ask-t5',
      answers: [{ header: 'scope', text: '只改看板页' }],
    });
    expect(owners(asker)).toEqual([asker, 'ask-t5']);
  });

  test('T6 a parked answer resumes a new turn citing askedFor and the answer, after the asking step finished', async () => {
    const asker = send('修计数');
    claim(asker);
    createOrGetQuestion(
      { db: H.s.db },
      { threadId: H.threadId, requestId: 'ask-t6', questions: QUESTIONS, askedFor: [asker] },
    );
    ageQuestion('ask-t6');
    await holdForQuestion({ db: H.s.db }, { threadId: H.threadId, requestId: 'ask-t6', holdMs: 0 });
    finish(asker);
    answerChiefQuestion(deps(), H.teamId, {
      threadId: H.threadId,
      requestId: 'ask-t6',
      answers: [{ header: 'scope', text: '只改看板页' }],
    });
    const resumed = steps().find((row) => row.id !== asker)!;
    expect(owners(resumed.id)).toEqual([asker, 'ask-t6']);
  });

  test('T6 a question parked before askedFor existed resumes citing only the answer', async () => {
    const asker = send('修计数');
    claim(asker);
    createOrGetQuestion(
      { db: H.s.db },
      { threadId: H.threadId, requestId: 'ask-old', questions: QUESTIONS, askedFor: [asker] },
    );
    const row = H.s.db.select().from(chiefMessage).where(eq(chiefMessage.id, 'ask-old')).get()!;
    const { askedFor: _dropped, ...legacy } = JSON.parse(String(row.content)) as Record<
      string,
      unknown
    >;
    H.s.db
      .update(chiefMessage)
      .set({ content: JSON.stringify(legacy) })
      .where(eq(chiefMessage.id, 'ask-old'))
      .run();
    ageQuestion('ask-old');
    await holdForQuestion(
      { db: H.s.db },
      { threadId: H.threadId, requestId: 'ask-old', holdMs: 0 },
    );
    finish(asker);
    answerChiefQuestion(deps(), H.teamId, {
      threadId: H.threadId,
      requestId: 'ask-old',
      answers: [{ header: 'scope', text: '只改看板页' }],
    });
    const resumed = steps().find((s) => s.id !== asker)!;
    expect(owners(resumed.id)).toEqual(['ask-old']);
  });

  test('T8 an orchestration request cites no owner message', async () => {
    const task = createTodo(H.s, {
      teamId: H.teamId,
      projectId: H.projectId,
      title: '',
      spec: '把登录页改成邮箱登录',
      createdBy: H.userId,
      ownerId: H.userId,
    });
    const res = await req(H.s.app, 'POST', `/api/todos/${task.id}/orchestrate`);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { thread: { id: string }; message: { id: string } };
    const turn = H.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, body.thread.id))
      .all()[0]!;
    expect((turn as { ownerMessageIds?: string[] | null }).ownerMessageIds).toEqual([]);
  });
});

describe('static: turn attribution is written, never inferred', () => {
  const services = join(import.meta.dirname, '../src/services');
  const sources = readdirSync(services)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ f, text: readFileSync(join(services, f), 'utf8') }));

  test('every enqueueChiefStep call passes ownerMessageIds', () => {
    for (const { f, text } of sources) {
      for (const match of text.matchAll(/enqueueChiefStep\(deps, [^,]+, \{([\s\S]*?)\n\s*\}\)/g)) {
        expect(match[1], f).toContain('ownerMessageIds');
      }
    }
  });

  test('no code infers owner messages by id prefix, rewind text or answer time', () => {
    for (const { f, text } of sources) {
      expect(text, f).not.toMatch(/ASK_RESUME_STEP_PREFIX|turnAnchorMessageId|turnOwnerAnswerIds/);
      expect(text, f).not.toMatch(/answeredAt \?\? 0\) >= /);
    }
  });
});
