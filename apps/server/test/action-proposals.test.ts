import type { ActionEntry } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { coordinatorToolsExtension, createStepGate } from '../src/coordinator/runtime/tools.js';
import {
  actionJournal,
  actionProposal,
  actionSubscriber,
  actionWakeOutbox,
  build,
  chief,
  chiefMessage,
  chiefThread,
  project as projectTable,
  step,
  todo,
} from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import {
  dispatchActionWakes,
  proposalById,
  sweepExpiredActionProposals,
} from '../src/services/action-proposals.js';
import { executeAction } from '../src/services/action-registry.js';
import { upsertChiefMessage } from '../src/services/chief.js';
import {
  answerQuestion,
  askQuestionContentOf,
  cancelQuestion,
} from '../src/services/chief-questions.js';
import { executeChiefTool } from '../src/services/chief-tools.js';
import { fakeMachineApi } from './coordinator/fake-machine-api.js';
import { bootServer, req } from './helpers.js';

const noted: ActionEntry = {
  id: 'project.delete',
  toolName: 'delete_project',
  inputSchema: z.object({ projectId: z.string().min(1), note: z.string().optional() }).strict(),
  outputSchema: z.object({ projectId: z.string(), deleted: z.literal(true) }).strict(),
  scope: 'project',
  class: 'confirm-once',
  standingGrant: false,
  inverse: null,
  surfaces: ['web', 'coordinator'],
  targetOf: (input) => (input as { projectId: string }).projectId,
};

function world() {
  const s = bootServer();
  s.db.insert(projectTable).values({ id: 'project-a', teamId: s.team.id, name: 'Alpha' }).run();
  s.db
    .insert(chief)
    .values({ id: 'chief-a', userId: s.user.id, teamId: s.team.id, createdAt: 1 })
    .run();
  s.db
    .insert(chief)
    .values({ id: 'chief-b', userId: s.user.id, teamId: s.team.id, createdAt: 1 })
    .run();
  for (const [id, chiefId] of [
    ['thread-a', 'chief-a'],
    ['thread-b', 'chief-b'],
  ] as const) {
    s.db
      .insert(chiefThread)
      .values({
        id,
        chiefId,
        userId: s.user.id,
        teamId: s.team.id,
        title: id,
        createdAt: 1,
        updatedAt: 1,
        sessionId: id,
        sessionOpenedAt: 1,
      })
      .run();
  }
  return s;
}

function propose(
  s: ReturnType<typeof world>,
  threadId: string,
  scopeProjectId: string | null,
  note?: string,
) {
  return executeAction(
    { db: s.db, reposDir: s.reposDir },
    {
      id: 'project.delete',
      input: note === undefined ? { projectId: 'project-a' } : { projectId: 'project-a', note },
      actor: 'coordinator',
      surface: 'coordinator',
      teamId: s.team.id,
      threadId,
      scopeProjectId,
      ...(note === undefined ? {} : { registry: [noted] }),
    },
  );
}

describe('action proposals', () => {
  test('the Coordinator tool list omits delete_project and the proposal service still accepts it', () => {
    for (const routerTools of [true, false]) {
      const names = (
        coordinatorToolsExtension(fakeMachineApi(), createStepGate(), { routerTools }).tools ?? []
      ).map((tool) => tool.name);
      expect(names).toEqual(expect.arrayContaining(['archive_project', 'unarchive_project']));
      expect(names).not.toContain('delete_project');
    }
    const s = world();
    const proposed = propose(s, 'thread-a', 'project-a');
    expect(proposed.status).toBe('pending');
    if (proposed.status !== 'pending') return;
    expect(proposalById(s.db, proposed.proposalId)?.status).toBe('pending');
    expect(s.db.select().from(projectTable).get()?.id).toBe('project-a');
    s.dispose();
  });

  test('coordinator confirm-once without a thread writes nothing', () => {
    const s = world();
    expect(() =>
      executeAction(
        { db: s.db, reposDir: s.reposDir },
        {
          id: 'project.delete',
          input: { projectId: 'project-a' },
          actor: 'coordinator',
          surface: 'coordinator',
          teamId: s.team.id,
        },
      ),
    ).toThrow(HttpError);
    expect(s.db.select().from(actionProposal).all()).toEqual([]);
    s.dispose();
  });

  test('the same input returns one pending id and a second thread is a subscriber', () => {
    const s = world();
    const first = propose(s, 'thread-a', 'project-a');
    const second = propose(s, 'thread-b', null);
    expect(first).toMatchObject({ status: 'pending', created: true });
    expect(second).toEqual({ ...first, created: false });
    expect(s.db.select().from(actionSubscriber).all()).toHaveLength(2);
    s.dispose();
  });

  test('a repeat from the same thread replaces that subscriber scope', () => {
    const s = world();
    const first = propose(s, 'thread-a', 'project-a');
    const again = propose(s, 'thread-a', null);
    expect(again).toEqual({ ...first, created: false });
    expect(s.db.select().from(actionSubscriber).all()).toEqual([
      expect.objectContaining({ threadId: 'thread-a', scopeProjectId: null }),
    ]);
    s.db.update(actionProposal).set({ expiresAt: 1 }).run();
    sweepExpiredActionProposals(s.db, Date.now());
    expect(dispatchActionWakes(s).delivered).toBe(1);
    expect(
      s.db
        .select()
        .from(step)
        .all()
        .map((row) => row.scopeProjectId),
    ).toEqual([null]);
    s.dispose();
  });

  test('a different input supersedes the old proposal and wakes its subscribers', () => {
    const s = world();
    const first = propose(s, 'thread-a', 'project-a', 'old');
    const next = propose(s, 'thread-b', null, 'new');
    expect(next).not.toEqual(first);
    expect(proposalById(s.db, (first as { proposalId: string }).proposalId)?.status).toBe(
      'superseded',
    );
    expect(s.db.select().from(actionWakeOutbox).all()).toEqual([
      expect.objectContaining({ threadId: 'thread-a', outcome: 'superseded', state: 'pending' }),
    ]);
    s.dispose();
  });

  test('an answer that contains input writes nothing', async () => {
    const s = world();
    const proposed = propose(s, 'thread-a', null) as { proposalId: string };
    const response = await req(
      s.app,
      'POST',
      `/api/actions/proposals/${proposed.proposalId}/answer`,
      {
        decision: 'allow-once',
        input: { projectId: 'elsewhere' },
      },
    );
    expect(response.status).toBe(400);
    expect(proposalById(s.db, proposed.proposalId)?.status).toBe('pending');
    expect(s.db.select().from(projectTable).get()?.id).toBe('project-a');
    s.dispose();
  });

  test('unknown, not pending, and expired answers do not run the handler', async () => {
    const s = world();
    expect(
      (await req(s.app, 'POST', '/api/actions/proposals/missing/answer', { decision: 'refuse' }))
        .status,
    ).toBe(409);
    const proposed = propose(s, 'thread-a', 'project-a') as { proposalId: string };
    s.db
      .update(actionProposal)
      .set({ expiresAt: 1 })
      .where(eq(actionProposal.id, proposed.proposalId))
      .run();
    const expired = await req(
      s.app,
      'POST',
      `/api/actions/proposals/${proposed.proposalId}/answer`,
      {
        decision: 'allow-once',
      },
    );
    expect(expired.status).toBe(409);
    expect(proposalById(s.db, proposed.proposalId)?.status).toBe('expired');
    expect(s.db.select().from(actionWakeOutbox).all()[0]?.outcome).toBe('expired');
    expect(s.db.select().from(projectTable).get()?.id).toBe('project-a');
    const again = await req(s.app, 'POST', `/api/actions/proposals/${proposed.proposalId}/answer`, {
      decision: 'allow-once',
    });
    expect(again.status).toBe(409);
    s.dispose();
  });

  test('refuse wakes subscribers and does not delete the project', async () => {
    const s = world();
    const proposed = propose(s, 'thread-a', null) as { proposalId: string };
    const response = await req(
      s.app,
      'POST',
      `/api/actions/proposals/${proposed.proposalId}/answer`,
      {
        decision: 'refuse',
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'refused' });
    expect(s.db.select().from(projectTable).get()?.id).toBe('project-a');
    expect(s.db.select().from(actionWakeOutbox).all()[0]?.outcome).toBe('refused');
    s.dispose();
  });

  test('allow once deletes, journals, and wakes; a running project fails without a partial delete', async () => {
    const s = world();
    const proposed = propose(s, 'thread-a', 'project-a') as { proposalId: string };
    s.db
      .insert(step)
      .values({
        id: 'running',
        buildId: 'build',
        kind: 'chief',
        status: 'pending',
        scopeProjectId: 'project-a',
        createdAt: 1,
      })
      .run();
    const blocked = await req(
      s.app,
      'POST',
      `/api/actions/proposals/${proposed.proposalId}/answer`,
      {
        decision: 'allow-once',
      },
    );
    expect(blocked.status).toBe(200);
    expect(await blocked.json()).toEqual({ status: 'failed' });
    expect(s.db.select().from(projectTable).get()?.id).toBe('project-a');
    expect(
      s.db
        .select()
        .from(actionJournal)
        .all()
        .map((row) => row.kind),
    ).toEqual(['error']);
    s.db.delete(step).where(eq(step.id, 'running')).run();
    s.db.delete(actionProposal).where(eq(actionProposal.id, proposed.proposalId)).run();
    const again = propose(s, 'thread-b', null) as { proposalId: string };
    const allowed = await req(s.app, 'POST', `/api/actions/proposals/${again.proposalId}/answer`, {
      decision: 'allow-once',
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ status: 'executed' });
    expect(s.db.select().from(projectTable).all()).toEqual([]);
    expect(
      s.db
        .select()
        .from(actionJournal)
        .all()
        .some((row) => row.kind === 'run'),
    ).toBe(true);
    s.dispose();
  });

  test('a failed executed transition rolls back the delete and keeps the proposal pending', async () => {
    const s = world();
    const proposed = propose(s, 'thread-a', 'project-a') as { proposalId: string };
    s.db.run(
      "CREATE TRIGGER reject_executed BEFORE UPDATE ON action_proposal WHEN NEW.status = 'executed' BEGIN SELECT RAISE(FAIL, 'proposal close unavailable'); END",
    );
    const answered = await req(
      s.app,
      'POST',
      `/api/actions/proposals/${proposed.proposalId}/answer`,
      { decision: 'allow-once' },
    );
    expect(answered.status).toBe(500);
    expect(s.db.select().from(projectTable).get()?.id).toBe('project-a');
    expect(proposalById(s.db, proposed.proposalId)?.status).toBe('pending');
    expect(s.db.select().from(actionJournal).all()).toEqual([]);
    s.dispose();
  });

  test('always is refused and the proposal stays pending', async () => {
    const s = world();
    const proposed = propose(s, 'thread-a', null) as { proposalId: string };
    const response = await req(
      s.app,
      'POST',
      `/api/actions/proposals/${proposed.proposalId}/answer`,
      {
        decision: 'always',
      },
    );
    expect(response.status).toBe(409);
    expect(proposalById(s.db, proposed.proposalId)?.status).toBe('pending');
    expect(s.db.select().from(actionWakeOutbox).all()).toEqual([]);
    s.dispose();
  });

  test('the expiry sweep marks due proposals and wakes every subscriber', () => {
    const s = world();
    const proposed = propose(s, 'thread-a', 'project-a') as { proposalId: string };
    propose(s, 'thread-b', null);
    expect(sweepExpiredActionProposals(s.db, Date.now())).toBe(0);
    s.db.update(actionProposal).set({ expiresAt: 1 }).run();
    expect(sweepExpiredActionProposals(s.db, Date.now())).toBe(1);
    expect(proposalById(s.db, proposed.proposalId)?.status).toBe('expired');
    expect(s.db.select().from(actionWakeOutbox).all()).toHaveLength(2);
    s.dispose();
  });

  test('the wake dispatcher passes each subscriber scope and records a missing thread', () => {
    const s = world();
    propose(s, 'thread-a', 'project-a');
    propose(s, 'thread-b', null);
    s.db.update(actionProposal).set({ expiresAt: 1 }).run();
    sweepExpiredActionProposals(s.db, Date.now());
    const result = dispatchActionWakes(s);
    expect(result.delivered).toBe(2);
    const steps = s.db.select().from(step).all();
    expect(steps.map((row) => row.scopeProjectId).sort()).toEqual(['project-a', null].sort());
    expect(steps.every((row) => row.prompt?.includes('provenance=action-proposal:'))).toBe(true);
    s.db
      .insert(actionWakeOutbox)
      .values({
        id: 'wake-missing',
        proposalId: s.db.select().from(actionProposal).get()?.id ?? '',
        threadId: 'missing-thread',
        outcome: 'expired',
        state: 'pending',
      })
      .run();
    s.db
      .insert(actionSubscriber)
      .values({
        id: 'sub-missing',
        proposalId: s.db.select().from(actionProposal).get()?.id ?? '',
        threadId: 'missing-thread',
        wakeStepId: 'wake:missing',
        scopeProjectId: null,
      })
      .run();
    expect(dispatchActionWakes(s).undeliverable).toBe(1);
    s.dispose();
  });
});

describe('todo deletion approval', () => {
  function taskWorld() {
    const s = world();
    for (const [id, seqNum] of [
      ['todo-1', 1],
      ['todo-2', 2],
    ] as const) {
      s.db
        .insert(todo)
        .values({
          id,
          teamId: s.team.id,
          projectId: 'project-a',
          title: `Task ${seqNum}`,
          phaseAt: 1,
          seqNum,
        })
        .run();
    }
    return s;
  }

  async function modelDeletes(s: ReturnType<typeof taskWorld>, todoIds: string[]) {
    const text = await executeChiefTool(
      {
        db: s.db,
        hub: s.hub,
        machineHub: s.machineHub,
        box: s.secretBox,
        user: s.user,
        reposDir: s.reposDir,
        attachmentsDir: s.attachmentsDir,
        skillsDir: s.skillsDir,
      },
      {
        teamId: s.team.id,
        userId: s.user.id,
        chiefId: 'chief-a',
        threadId: 'thread-a',
        chiefAgentId: null,
        conversationId: 'thread-a',
      },
      'delete_todos',
      { todoIds },
    );
    return JSON.parse(text) as { status: string; proposalId: string };
  }

  const tasks = (s: ReturnType<typeof taskWorld>) =>
    s.db
      .select({ id: todo.id })
      .from(todo)
      .all()
      .map((row) => row.id)
      .sort();

  const card = (s: ReturnType<typeof taskWorld>, proposalId: string) =>
    askQuestionContentOf(
      s.db
        .select()
        .from(chiefMessage)
        .where(eq(chiefMessage.id, `approval-${proposalId}`))
        .get()?.content,
    );

  const answer = (s: ReturnType<typeof taskWorld>, proposalId: string, choice: string) =>
    req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/chief/threads/thread-a/questions/approval-${proposalId}/answer`,
      { answers: [{ header: '审批', choices: [choice] }] },
    );

  test('the model calling delete_todos deletes nothing and leaves a parked approval card', async () => {
    const s = taskWorld();
    const proposed = await modelDeletes(s, ['todo-1']);
    expect(proposed.status).toBe('pending');
    expect(tasks(s)).toEqual(['todo-1', 'todo-2']);
    expect(card(s, proposed.proposalId)).toMatchObject({
      status: 'pending',
      askedFor: [`action-proposal:${proposed.proposalId}`],
    });
    expect(card(s, proposed.proposalId)?.parkedAt).toBeTypeOf('number');
    expect(card(s, proposed.proposalId)?.questions[0]?.question).toContain('#1「Task 1」');
    s.dispose();
  });

  test('the same set in another order is the same proposal and card', async () => {
    const s = taskWorld();
    const first = await modelDeletes(s, ['todo-2', 'todo-1']);
    const again = await modelDeletes(s, ['todo-1', 'todo-2', 'todo-1']);
    expect(again.proposalId).toBe(first.proposalId);
    expect(s.db.select().from(actionProposal).all()).toHaveLength(1);
    s.dispose();
  });

  test('approving on the card deletes once; a repeat answer runs nothing', async () => {
    const s = taskWorld();
    const proposed = await modelDeletes(s, ['todo-1']);
    expect((await answer(s, proposed.proposalId, '批准执行')).status).toBe(200);
    expect(tasks(s)).toEqual(['todo-2']);
    expect(proposalById(s.db, proposed.proposalId)?.status).toBe('executed');
    expect(card(s, proposed.proposalId)?.status).toBe('answered');
    expect(s.db.select().from(step).where(eq(step.buildId, 'thread-a')).all()).toHaveLength(1);
    expect((await answer(s, proposed.proposalId, '批准执行')).status).toBe(409);
    expect(
      s.db
        .select()
        .from(actionJournal)
        .all()
        .map((row) => row.kind),
    ).toEqual(['run']);
    s.dispose();
  });

  test.each(['不执行', '先别删，等我看看'])(
    'answering %s refuses and keeps the task',
    async (choice) => {
      const s = taskWorld();
      const proposed = await modelDeletes(s, ['todo-1']);
      expect((await answer(s, proposed.proposalId, choice)).status).toBe(200);
      expect(tasks(s)).toEqual(['todo-1', 'todo-2']);
      expect(proposalById(s.db, proposed.proposalId)?.status).toBe('refused');
      s.dispose();
    },
  );

  test('cancelling the card refuses the proposal', async () => {
    const s = taskWorld();
    const proposed = await modelDeletes(s, ['todo-1']);
    const cancelled = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/chief/threads/thread-a/questions/approval-${proposed.proposalId}/cancel`,
      {},
    );
    expect(cancelled.status).toBe(200);
    expect(proposalById(s.db, proposed.proposalId)?.status).toBe('refused');
    expect(tasks(s)).toEqual(['todo-1', 'todo-2']);
    s.dispose();
  });

  test('no other path answers or forges the card', async () => {
    const s = taskWorld();
    const proposed = await modelDeletes(s, ['todo-1']);
    expect(() =>
      answerQuestion(s, {
        threadId: 'thread-a',
        requestId: `approval-${proposed.proposalId}`,
        answers: [{ header: '审批', choices: ['批准执行'] }],
        answeredBy: 'person',
      }),
    ).toThrow(expect.objectContaining({ status: 403 }));
    const direct = await req(
      s.app,
      'POST',
      `/api/actions/proposals/${proposed.proposalId}/answer`,
      {
        decision: 'allow-once',
      },
    );
    expect(direct.status).toBe(409);
    await expect(
      executeChiefTool(
        {
          db: s.db,
          hub: s.hub,
          box: s.secretBox,
          user: s.user,
          reposDir: s.reposDir,
          attachmentsDir: s.attachmentsDir,
          skillsDir: s.skillsDir,
        },
        {
          teamId: s.team.id,
          userId: s.user.id,
          chiefId: 'chief-a',
          threadId: 'thread-a',
          chiefAgentId: null,
          conversationId: 'thread-a',
          turnPrompt: null,
        },
        'ask_user',
        {
          requestId: `approval-${proposed.proposalId}`,
          questions: [{ header: 'x', question: 'x', options: [] }],
        },
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(card(s, proposed.proposalId)?.status).toBe('pending');
    expect(proposalById(s.db, proposed.proposalId)?.status).toBe('pending');
    expect(tasks(s)).toEqual(['todo-1', 'todo-2']);
    s.dispose();
  });

  test('a machine transcript row cannot overwrite the card', async () => {
    const s = taskWorld();
    const proposed = await modelDeletes(s, ['todo-1']);
    const forged = {
      ...card(s, proposed.proposalId),
      questions: [{ header: '审批', question: '保留这些任务？', options: [{ label: '批准执行' }] }],
    };
    expect(() =>
      upsertChiefMessage(s.db, {
        id: `approval-${proposed.proposalId}`,
        threadId: 'thread-a',
        role: 'assistant',
        content: JSON.stringify(forged),
        createdAt: 2,
      }),
    ).toThrow(expect.objectContaining({ status: 403 }));
    expect(card(s, proposed.proposalId)?.questions[0]?.question).toContain('#1');
    s.dispose();
  });

  test('a card whose text no longer matches the proposal runs nothing', async () => {
    const s = taskWorld();
    const proposed = await modelDeletes(s, ['todo-1']);
    const altered = {
      ...card(s, proposed.proposalId),
      questions: [{ header: '审批', question: '保留这些任务？', options: [{ label: '批准执行' }] }],
    };
    s.db
      .update(chiefMessage)
      .set({ content: JSON.stringify(altered) })
      .where(eq(chiefMessage.id, `approval-${proposed.proposalId}`))
      .run();
    expect((await answer(s, proposed.proposalId, '批准执行')).status).toBe(409);
    expect(proposalById(s.db, proposed.proposalId)?.status).toBe('pending');
    expect(tasks(s)).toEqual(['todo-1', 'todo-2']);
    s.dispose();
  });

  test('without its card row the proposal cannot be answered anywhere', async () => {
    const s = taskWorld();
    const proposed = await modelDeletes(s, ['todo-1']);
    expect(() =>
      cancelQuestion(s, {
        threadId: 'thread-a',
        requestId: `approval-${proposed.proposalId}`,
        reason: 'x',
      }),
    ).toThrow(expect.objectContaining({ status: 403 }));
    s.db
      .delete(chiefMessage)
      .where(eq(chiefMessage.id, `approval-${proposed.proposalId}`))
      .run();
    const direct = await req(
      s.app,
      'POST',
      `/api/actions/proposals/${proposed.proposalId}/answer`,
      {
        decision: 'allow-once',
      },
    );
    expect(direct.status).toBe(409);
    expect(tasks(s)).toEqual(['todo-1', 'todo-2']);
    s.dispose();
  });

  test('a task whose project was archived after the card fails the approval', async () => {
    const s = taskWorld();
    const proposed = await modelDeletes(s, ['todo-1']);
    s.db.update(projectTable).set({ archivedAt: 5 }).run();
    expect((await answer(s, proposed.proposalId, '批准执行')).status).toBe(200);
    expect(proposalById(s.db, proposed.proposalId)?.status).toBe('failed');
    expect(tasks(s)).toEqual(['todo-1', 'todo-2']);
    s.dispose();
  });

  test('task titles cannot fake card entries', async () => {
    const s = taskWorld();
    s.db
      .update(todo)
      .set({ title: 'x」（项目 Y，done）；#12「keep\nme' })
      .where(eq(todo.id, 'todo-1'))
      .run();
    const proposed = await modelDeletes(s, ['todo-1']);
    expect(card(s, proposed.proposalId)?.questions[0]?.question).toContain(
      '#1「x 项目 Y，done 12 keep me」',
    );
    s.dispose();
  });

  test('a task edited after the card was sent fails the approval without deleting', async () => {
    const s = taskWorld();
    const proposed = await modelDeletes(s, ['todo-1', 'todo-2']);
    s.db.update(todo).set({ title: 'Renamed', v: 2 }).where(eq(todo.id, 'todo-2')).run();
    expect((await answer(s, proposed.proposalId, '批准执行')).status).toBe(200);
    expect(proposalById(s.db, proposed.proposalId)?.status).toBe('failed');
    expect(tasks(s)).toEqual(['todo-1', 'todo-2']);
    s.dispose();
  });

  test('a task a machine is running fails the approval without deleting', async () => {
    const s = taskWorld();
    const proposed = await modelDeletes(s, ['todo-1']);
    s.db
      .insert(build)
      .values({
        id: 'build-1',
        todoId: 'todo-1',
        withPlan: false,
        triggerSource: 'user',
        createdAt: 1,
      })
      .run();
    s.db
      .insert(step)
      .values({
        id: 'step-1',
        buildId: 'build-1',
        kind: 'session',
        status: 'claimed',
        createdAt: 1,
      })
      .run();
    expect((await answer(s, proposed.proposalId, '批准执行')).status).toBe(200);
    expect(proposalById(s.db, proposed.proposalId)?.status).toBe('failed');
    expect(tasks(s)).toEqual(['todo-1', 'todo-2']);
    s.dispose();
  });

  test('an expired card cannot be approved and is closed', async () => {
    const s = taskWorld();
    const proposed = await modelDeletes(s, ['todo-1']);
    s.db.update(actionProposal).set({ expiresAt: 1 }).run();
    expect((await answer(s, proposed.proposalId, '批准执行')).status).toBe(409);
    expect(proposalById(s.db, proposed.proposalId)?.status).toBe('expired');
    expect(card(s, proposed.proposalId)?.status).toBe('cancelled');
    expect(tasks(s)).toEqual(['todo-1', 'todo-2']);
    s.dispose();
  });
});
