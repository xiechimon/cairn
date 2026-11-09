import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  chiefMessage,
  chiefThread,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { newRecordId, nowMs } from '../src/lib/ids.js';
import {
  addChiefWatch,
  enqueueOwnershipWake,
  fireDueChiefWakes,
  setChiefWake,
  triggerChiefWakes,
  upsertChiefMessage,
} from '../src/services/chief.js';
import { createOrGetQuestion } from '../src/services/chief-questions.js';
import { getTodo, setTodoPhase } from '../src/services/todos.js';
import { H, registerChiefHarness } from './chief-harness.js';
import { postProject, req } from './helpers.js';

registerChiefHarness();

const deps = () => ({ db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user });

function chiefSteps(threadId: string) {
  return H.s.db
    .select()
    .from(stepTable)
    .where(eq(stepTable.buildId, threadId))
    .all()
    .filter((s) => s.kind === 'chief');
}

async function sendFromComposer(content: string, projectId?: string) {
  const res = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/coordinator/messages`, {
    content,
    ...(projectId === undefined ? {} : { projectId }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { message: { id: string } }).message.id;
}

function claim(stepId: string) {
  H.s.db
    .update(stepTable)
    .set({ status: 'claimed', claimedAt: nowMs() })
    .where(eq(stepTable.id, stepId))
    .run();
}

function seedTodo(projectId: string): string {
  const id = newRecordId();
  H.s.db
    .insert(todoTable)
    .values({
      id,
      teamId: H.teamId,
      projectId,
      title: 'watched',
      spec: '',
      phase: 'todo',
      phaseAt: nowMs(),
      seqNum: 7,
      orderIndex: 0,
      ownerId: H.userId,
    })
    .run();
  return id;
}

describe('a Coordinator turn records its project scope as data (D74 P3)', () => {
  test('a composer message with a picked project stores that project on the step', async () => {
    const site = await postProject(H.s.app, 'cairn-site');
    const stepId = await sendFromComposer('fix the header', site);
    const row = chiefSteps(H.threadId).find((s) => s.id === stepId);
    expect(row?.scopeProjectId).toBe(site);
  });

  test('a composer message without a project has no scope', async () => {
    const stepId = await sendFromComposer('how is everything going');
    expect(chiefSteps(H.threadId).find((s) => s.id === stepId)?.scopeProjectId).toBeNull();
  });

  test('a wake about a watched todo is scoped to that todo project, not the composer pick', async () => {
    const site = await postProject(H.s.app, 'cairn-site');
    const todoId = seedTodo(site);
    const rec = getTodo(deps(), todoId)!;
    addChiefWatch(deps(), {
      teamId: H.teamId,
      todo: rec,
      projectName: 'cairn-site',
      threadId: H.threadId,
    });
    setTodoPhase(deps(), todoId, 'queued');
    enqueueOwnershipWake(deps(), { id: todoId }, 'review');
    triggerChiefWakes(deps(), getTodo(deps(), todoId)!, 'done');
    const wakes = chiefSteps(H.threadId).filter((s) => s.prompt?.startsWith('[wake:'));
    expect(wakes.length).toBeGreaterThanOrEqual(2);
    expect(wakes.every((s) => s.scopeProjectId === site)).toBe(true);
  });

  test('a timed wake the Coordinator set for itself has no scope', () => {
    setChiefWake(deps(), H.teamId, { threadId: H.threadId, at: nowMs() - 1, note: 'check back' });
    fireDueChiefWakes(deps(), nowMs());
    const wake = chiefSteps(H.threadId).find((s) => s.prompt?.startsWith('[wake:wake]'));
    expect(wake).toBeDefined();
    expect(wake?.scopeProjectId).toBeNull();
  });

  test('a timed wake set about a todo is scoped to that todo project', async () => {
    const site = await postProject(H.s.app, 'cairn-site');
    const todoId = seedTodo(site);
    setChiefWake(deps(), H.teamId, { threadId: H.threadId, at: nowMs() - 1, todoId });
    fireDueChiefWakes(deps(), nowMs());
    const wake = chiefSteps(H.threadId).find((s) => s.prompt?.startsWith('[wake:wake]'));
    expect(wake?.scopeProjectId).toBe(site);
  });

  test('a rewind re-sends the anchor message with the anchor project as scope', async () => {
    const site = await postProject(H.s.app, 'cairn-site');
    const res = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/chief/threads`, {
      content: 'unify button colours',
      projectId: site,
    });
    const { thread, message } = (await res.json()) as {
      thread: { id: string };
      message: { id: string };
    };
    H.s.db.update(chiefThread).set({ activeRun: null }).where(eq(chiefThread.id, thread.id)).run();
    const rewound = await req(
      H.s.app,
      'POST',
      `/api/teams/${H.teamId}/chief/threads/${thread.id}/rewind`,
      { messageId: message.id },
    );
    expect(rewound.status).toBe(200);
    expect(chiefSteps(thread.id).at(-1)?.scopeProjectId).toBe(site);
  });

  test('a message written during a scoped turn is tagged with the step scope even if the prompt has no marker', async () => {
    const site = await postProject(H.s.app, 'cairn-site');
    const stepId = await sendFromComposer('plan it', site);
    H.s.db.update(stepTable).set({ prompt: 'plan it' }).where(eq(stepTable.id, stepId)).run();
    claim(stepId);
    upsertChiefMessage(H.s.db, {
      id: 'assistant-1',
      threadId: H.threadId,
      role: 'assistant',
      content: 'on it',
      createdAt: nowMs(),
    });
    const row = H.s.db.select().from(chiefMessage).where(eq(chiefMessage.id, 'assistant-1')).get();
    expect(row?.projectId).toBe(site);
  });

  test('a question asked during a scoped turn records the step scope', async () => {
    const site = await postProject(H.s.app, 'cairn-site');
    const stepId = await sendFromComposer('plan it', site);
    H.s.db.update(stepTable).set({ prompt: 'plan it' }).where(eq(stepTable.id, stepId)).run();
    claim(stepId);
    createOrGetQuestion(
      { db: H.s.db },
      {
        threadId: H.threadId,
        requestId: 'ask-scope',
        questions: [{ header: 'scope', question: 'Which pages?', options: [] }],
      },
    );
    const row = H.s.db.select().from(chiefMessage).where(eq(chiefMessage.id, 'ask-scope')).get();
    expect(row?.projectId).toBe(site);
  });

  test('a step from before the column existed still resolves its scope from the prompt marker', async () => {
    const site = await postProject(H.s.app, 'cairn-site');
    const stepId = await sendFromComposer('plan it', site);
    H.s.db.update(stepTable).set({ scopeProjectId: null }).where(eq(stepTable.id, stepId)).run();
    claim(stepId);
    upsertChiefMessage(H.s.db, {
      id: 'assistant-legacy',
      threadId: H.threadId,
      role: 'assistant',
      content: 'on it',
      createdAt: nowMs(),
    });
    const row = H.s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.id, 'assistant-legacy'))
      .get();
    expect(row?.projectId).toBe(site);
  });
});
