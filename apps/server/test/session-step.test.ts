import { SESSION_BRIEF, threadReportContentSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { build, chiefMessage, message, step, todo } from '../src/db/schema.js';
import { completeStep, maybeEnqueueVerifyStep, startBuilds } from '../src/services/builds.js';
import { countMarkedRounds } from '../src/services/ci-loop.js';
import { setRoutingRulesEnabled } from '../src/services/routing-rules.js';
import { messageThreadAsUser } from '../src/services/thread-message.js';
import { getTodo, setTodoPhase } from '../src/services/todos.js';
import { askWorkerQuestion, recordThreadReportLine } from '../src/services/worker-questions.js';
import { AGENT_ID, H, registerChiefHarness } from './chief-harness.js';

registerChiefHarness();
beforeEach(() => setRoutingRulesEnabled(true));
afterEach(() => setRoutingRulesEnabled(false));

const REQUEST = 'ask-11111111-2222-3333-4444-555555555555';
const QUESTIONS = [
  {
    header: 'Format',
    question: 'Which export format?',
    options: [{ label: 'CSV' }, { label: 'JSON' }],
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

function seedTodo(id = 'session-todo') {
  H.s.db
    .insert(todo)
    .values({
      id,
      teamId: H.teamId,
      projectId: H.projectId,
      title: 'Export the board',
      spec: 'Add an export.',
      phase: 'todo',
      phaseAt: 1,
      seqNum: 3,
    })
    .run();
  return id;
}

function startSession(withPlan = true) {
  const todoId = seedTodo();
  const [started] = startBuilds(deps(), {
    projectId: H.projectId,
    todoIds: [todoId],
    assignment: { plan: null, build: { agentId: AGENT_ID } },
    withPlan,
  });
  const stepRow = H.s.db.select().from(step).where(eq(step.buildId, started!.id)).get()!;
  return { todoId, buildId: started!.id, stepRow };
}

function reports() {
  return H.s.db
    .select()
    .from(chiefMessage)
    .all()
    .filter((row) => String(row.content).includes('thread-report'))
    .map((row) => threadReportContentSchema.parse(JSON.parse(String(row.content))));
}

describe('session step kind (flag on)', () => {
  test('startBuilds enqueues one session step carrying the brief, even when a plan was requested', () => {
    const { buildId, stepRow } = startSession(true);
    const steps = H.s.db.select().from(step).where(eq(step.buildId, buildId)).all();
    expect(steps).toHaveLength(1);
    expect(stepRow.kind).toBe('session');
    expect(stepRow.prompt).toContain(SESSION_BRIEF);
    expect(H.s.db.select().from(build).where(eq(build.id, buildId)).get()!.withPlan).toBe(false);
  });

  test('flag off keeps the plan step', () => {
    setRoutingRulesEnabled(false);
    const { stepRow } = startSession(true);
    expect(stepRow.kind).toBe('plan');
  });

  test('a finished session build with a verifier assigned still gets a verify step', () => {
    const { todoId, buildId } = startSession(false);
    H.s.db
      .update(todo)
      .set({
        assignment: { plan: null, build: { agentId: AGENT_ID }, verify: { agentId: AGENT_ID } },
      })
      .where(eq(todo.id, todoId))
      .run();
    const row = H.s.db.select().from(todo).where(eq(todo.id, todoId)).get();
    if (row === undefined) throw new Error('todo missing');
    maybeEnqueueVerifyStep(deps(), row, buildId);
    expect(
      H.s.db
        .select()
        .from(step)
        .where(eq(step.buildId, buildId))
        .all()
        .map((r) => r.kind)
        .sort(),
    ).toEqual(['session', 'verify']);
  });

  test('rework at review continues the same session as a session step, not a plan', async () => {
    const { todoId, buildId, stepRow } = startSession(false);
    H.s.db
      .update(step)
      .set({ status: 'done', sessionId: 'sess-1' })
      .where(eq(step.id, stepRow.id))
      .run();
    H.s.db.update(todo).set({ phase: 'review' }).where(eq(todo.id, todoId)).run();
    const sent = await messageThreadAsUser(deps(), H.teamId, todoId, {
      content: 'Also cover the empty board',
      clientMessageId: 'c-1',
    });
    expect(sent.delivered).toBe('revision');
    const next = H.s.db
      .select()
      .from(step)
      .where(eq(step.buildId, buildId))
      .all()
      .find((r) => r.status === 'pending')!;
    expect(next.kind).toBe('session');
    expect(next.prompt).toContain('Also cover the empty board');
    expect(getTodo(deps(), todoId)!.phase).toBe('queued');
  });
});

describe('worker ask_user on a session step', () => {
  function claim(stepId: string) {
    H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepId)).run();
    return H.s.db.select().from(step).where(eq(step.id, stepId)).get()!;
  }

  test('the question parks the thread: awaitingReply is set and a needs-you report is written', async () => {
    const { todoId, stepRow } = startSession(false);
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    const claimed = claim(stepRow.id);
    const settled = await askWorkerQuestion(
      deps(),
      claimed,
      { requestId: REQUEST, questions: QUESTIONS },
      { holdMs: 0 },
    );
    expect(settled.status).toBe('pending');
    expect(getTodo(deps(), todoId)!.awaitingReply).toBe(true);
    expect(reports().map((r) => r.phase)).toEqual(['review']);
    const rows = H.s.db.select().from(message).where(eq(message.id, REQUEST)).all();
    expect(rows).toHaveLength(1);
    await askWorkerQuestion(
      deps(),
      claimed,
      { requestId: REQUEST, questions: QUESTIONS },
      { holdMs: 0 },
    );
    expect(H.s.db.select().from(message).where(eq(message.id, REQUEST)).all()).toHaveLength(1);
    expect(reports()).toHaveLength(1);
  });

  test('the answer delivered through the thread message clears awaitingReply and settles the held ask', async () => {
    const { todoId, stepRow } = startSession(false);
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    const claimed = claim(stepRow.id);
    const held = askWorkerQuestion(
      deps(),
      claimed,
      { requestId: REQUEST, questions: QUESTIONS },
      { holdMs: 5_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    await messageThreadAsUser(deps(), H.teamId, todoId, {
      content: 'JSON please',
      clientMessageId: 'c-2',
    });
    const settled = await held;
    expect(settled.status).toBe('answered');
    expect(settled.answers).toEqual([{ header: 'Format', text: 'JSON please' }]);
    expect(getTodo(deps(), todoId)!.awaitingReply).toBeUndefined();
  });

  test('a parked step keeps awaitingReply through the move to review and clears it when the thread moves on', async () => {
    const { todoId, stepRow } = startSession(false);
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    const claimed = claim(stepRow.id);
    await askWorkerQuestion(
      deps(),
      claimed,
      { requestId: REQUEST, questions: QUESTIONS },
      { holdMs: 0 },
    );
    setTodoPhase(deps(), todoId, 'review');
    expect(getTodo(deps(), todoId)!.awaitingReply).toBe(true);
    setTodoPhase(deps(), todoId, 'queued');
    expect(getTodo(deps(), todoId)!.awaitingReply).toBeUndefined();
    const content = H.s.db.select().from(message).where(eq(message.id, REQUEST)).get()!.content as {
      status: string;
    };
    expect(content.status).toBe('cancelled');
  });

  test('a request id owned by another build is rejected and its message untouched', async () => {
    const { todoId, stepRow } = startSession(false);
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    H.s.db
      .insert(message)
      .values({
        id: REQUEST,
        conversationId: 'other-build',
        role: 'assistant',
        content: 'foreign',
        createdAt: 5,
        actor: null,
      })
      .run();
    const claimed = claim(stepRow.id);
    await expect(
      askWorkerQuestion(
        deps(),
        claimed,
        { requestId: REQUEST, questions: QUESTIONS },
        { holdMs: 0 },
      ),
    ).rejects.toMatchObject({ status: 409 });
    const kept = H.s.db.select().from(message).where(eq(message.id, REQUEST)).get()!;
    expect(kept.conversationId).toBe('other-build');
    expect(kept.content).toBe('foreign');
  });

  test('a retried ask keeps the stored creation time', async () => {
    const { todoId, buildId, stepRow } = startSession(false);
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    const claimed = claim(stepRow.id);
    await askWorkerQuestion(
      deps(),
      claimed,
      { requestId: REQUEST, questions: QUESTIONS },
      { holdMs: 0 },
    );
    const { ASK_PARK_MS } = await import('../src/services/chief-questions.js');
    const old = Date.now() - ASK_PARK_MS - 1_000;
    H.s.db.update(message).set({ createdAt: old }).where(eq(message.id, REQUEST)).run();
    const retried = await askWorkerQuestion(
      deps(),
      claimed,
      { requestId: REQUEST, questions: QUESTIONS },
      { holdMs: 5_000 },
    );
    expect(retried.status).toBe('cancelled');
    expect(H.s.db.select().from(message).where(eq(message.id, REQUEST)).get()!.conversationId).toBe(
      buildId,
    );
  });

  test('a delivery that throws leaves the question pending and awaitingReply set', async () => {
    const { todoId, stepRow } = startSession(false);
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    const claimed = claim(stepRow.id);
    await askWorkerQuestion(
      deps(),
      claimed,
      { requestId: REQUEST, questions: QUESTIONS },
      { holdMs: 0 },
    );
    const failing = {
      ...deps(),
      machineHub: {
        steerSignal: vi.fn(() => {
          throw new Error('delivery down');
        }),
      },
    } as never;
    await expect(
      messageThreadAsUser(failing, H.teamId, todoId, { content: 'JSON', clientMessageId: 'c-9' }),
    ).rejects.toThrow('delivery down');
    expect(getTodo(deps(), todoId)!.awaitingReply).toBe(true);
    const content = H.s.db.select().from(message).where(eq(message.id, REQUEST)).get()!.content as {
      status: string;
    };
    expect(content.status).toBe('pending');
  });

  test('a non-session worker step still cannot ask', async () => {
    const { stepRow } = startSession(false);
    H.s.db
      .update(step)
      .set({ kind: 'verify', status: 'claimed' })
      .where(eq(step.id, stepRow.id))
      .run();
    const { machineAsk } = await import('../src/services/machine-relay.js');
    await expect(
      machineAsk(
        { ...deps(), vapidKeys: null } as never,
        'no-machine',
        stepRow.id,
        { requestId: REQUEST, questions: QUESTIONS },
        { holdMs: 0 },
      ),
    ).rejects.toThrow();
  });
});

describe('D65 report line on every thread', () => {
  test.each(['review', 'done', 'failed'] as const)(
    'an unwatched thread reaching %s writes a report with the session own line',
    (phase) => {
      const { todoId, buildId, stepRow } = startSession(false);
      H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
      H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepRow.id)).run();
      recordThreadReportLine(
        deps(),
        stepRow,
        'Export added; 12 tests pass, CSV and JSON verified.',
      );
      expect(H.s.db.select().from(build).where(eq(build.id, buildId)).get()!.reportLine).toContain(
        'Export added',
      );
      if (phase === 'done') setTodoPhase(deps(), todoId, 'review');
      setTodoPhase(deps(), todoId, phase);
      const last = reports().at(-1)!;
      expect(last.phase).toBe(phase);
      expect(last.line).toBe('Export added; 12 tests pass, CSV and JSON verified.');
      expect(last.line!.length).toBeLessThanOrEqual(200);
    },
  );

  test('a line over 200 characters or an empty line is rejected', () => {
    const { stepRow } = startSession(false);
    expect(() => recordThreadReportLine(deps(), stepRow, 'x'.repeat(201))).toThrow(/200/);
    expect(() => recordThreadReportLine(deps(), stepRow, '   ')).toThrow();
  });

  test('whitespace and control characters collapse before the cap', () => {
    const { buildId, stepRow } = startSession(false);
    recordThreadReportLine(deps(), stepRow, `a\n\n  b\u0007\tc${' '.repeat(300)}d`);
    expect(H.s.db.select().from(build).where(eq(build.id, buildId)).get()!.reportLine).toBe(
      'a b c d',
    );
  });

  test('flag off writes no report for an unwatched thread', () => {
    const { todoId } = startSession(false);
    setRoutingRulesEnabled(false);
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    setTodoPhase(deps(), todoId, 'review');
    expect(reports()).toHaveLength(0);
  });
});

describe('session steps share the build-step paths', () => {
  function claim(stepId: string) {
    H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepId)).run();
    return H.s.db.select().from(step).where(eq(step.id, stepId)).get()!;
  }

  test('a session turn that parked on an unanswered ask with no changes parks instead of failing', async () => {
    const { todoId, stepRow } = startSession(false);
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    const claimed = claim(stepRow.id);
    await askWorkerQuestion(
      deps(),
      claimed,
      { requestId: REQUEST, questions: QUESTIONS },
      { holdMs: 0 },
    );
    completeStep(deps(), stepRow.id, { hasChanges: false });
    const record = getTodo(deps(), todoId)!;
    expect(record.phase).not.toBe('failed');
    expect(record.awaitingReply).toBe(true);
    const content = H.s.db.select().from(message).where(eq(message.id, REQUEST)).get()!.content as {
      status: string;
    };
    expect(content.status).toBe('pending');
  });

  test('a parked session with a verifier assigned does not dispatch verification', async () => {
    const { todoId, buildId, stepRow } = startSession(false);
    H.s.db
      .update(todo)
      .set({
        phase: 'building',
        assignment: { plan: null, build: { agentId: AGENT_ID }, verify: { agentId: AGENT_ID } },
      })
      .where(eq(todo.id, todoId))
      .run();
    const claimed = claim(stepRow.id);
    await askWorkerQuestion(
      deps(),
      claimed,
      { requestId: REQUEST, questions: QUESTIONS },
      { holdMs: 0 },
    );
    completeStep(deps(), stepRow.id, { hasChanges: false });
    const kinds = H.s.db
      .select()
      .from(step)
      .where(eq(step.buildId, buildId))
      .all()
      .map((r) => r.kind);
    expect(kinds).toEqual(['session']);
  });

  test('a session turn with no changes and no question still fails the artifact gate', () => {
    const { todoId, stepRow } = startSession(false);
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    claim(stepRow.id);
    completeStep(deps(), stepRow.id, { hasChanges: false });
    expect(getTodo(deps(), todoId)!.phase).toBe('failed');
  });

  test('session steps count toward the marked repair rounds', () => {
    const { buildId } = startSession(false);
    H.s.db
      .insert(step)
      .values({
        id: 'repair-1',
        buildId,
        kind: 'session',
        status: 'done',
        prompt: '[ci-fix] round 1',
        createdAt: 5,
      })
      .run();
    expect(countMarkedRounds(H.s.db, buildId, '[ci-fix]')).toBe(1);
  });

  test('restart reuses the build when a failed session step preserved a checkpoint', async () => {
    const { todoId, buildId, stepRow } = startSession(false);
    H.s.db
      .update(step)
      .set({ status: 'failed', checkpointCommit: 'c'.repeat(40) })
      .where(eq(step.id, stepRow.id))
      .run();
    H.s.db.update(todo).set({ phase: 'failed' }).where(eq(todo.id, todoId)).run();
    const sent = await messageThreadAsUser(deps(), H.teamId, todoId, {
      content: 'Continue from the checkpoint',
      clientMessageId: 'c-r',
    });
    expect(sent.delivered).toBe('restart');
    expect(sent.conversationId).toBe(buildId);
  });

  test('a reply that moves a review thread on marks the parked question answered', async () => {
    const { todoId, stepRow } = startSession(false);
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    const claimed = claim(stepRow.id);
    await askWorkerQuestion(
      deps(),
      claimed,
      { requestId: REQUEST, questions: QUESTIONS },
      { holdMs: 0 },
    );
    H.s.db
      .update(step)
      .set({ status: 'done', sessionId: 'sess-1' })
      .where(eq(step.id, stepRow.id))
      .run();
    setTodoPhase(deps(), todoId, 'review');
    H.s.db.update(todo).set({ awaitingReply: true }).where(eq(todo.id, todoId)).run();
    const sent = await messageThreadAsUser(deps(), H.teamId, todoId, {
      content: 'JSON please',
      clientMessageId: 'c-q',
    });
    expect(sent.delivered).toBe('revision');
    const content = H.s.db.select().from(message).where(eq(message.id, REQUEST)).get()!.content as {
      status: string;
      answers: unknown;
    };
    expect(content.status).toBe('answered');
    expect(content.answers).toEqual([{ header: 'Format', text: 'JSON please' }]);
    expect(getTodo(deps(), todoId)!.awaitingReply).toBeUndefined();
  });
});
