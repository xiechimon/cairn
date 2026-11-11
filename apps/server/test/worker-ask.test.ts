import { threadReportContentSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { build, chiefMessage, machine, message, project, step, todo } from '../src/db/schema.js';
import {
  applyStoppedStep,
  completeStep,
  maybeEnqueueIndependentReview,
  startBuilds,
} from '../src/services/builds.js';
import { createCiPoller } from '../src/services/ci-loop.js';
import { workerRemoteTools } from '../src/services/machine-claim.js';
import { messageThreadAsUser } from '../src/services/thread-message.js';
import { getTodo, setTodoPhase } from '../src/services/todos.js';
import { pendingWorkerQuestionIds } from '../src/services/worker-question-store.js';
import { askWorkerQuestion } from '../src/services/worker-questions.js';
import { H, registerChiefHarness } from './chief-harness.js';
import { insertMachine } from './helpers.js';

registerChiefHarness();

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

function asking(todoId: string): boolean {
  const buildId = getTodo(deps(), todoId)?.latestBuildId;
  return buildId != null && pendingWorkerQuestionIds(H.s.db, buildId).length > 0;
}

function startSession() {
  if (
    H.s.db.select({ id: machine.id }).from(machine).where(eq(machine.teamId, H.teamId)).get() ===
    undefined
  ) {
    insertMachine(H.s);
  }
  const todoId = seedTodo();
  const [started] = startBuilds(deps(), {
    projectId: H.projectId,
    todoIds: [todoId],
  });
  const stepRow = H.s.db.select().from(step).where(eq(step.buildId, started!.id)).get()!;
  return { todoId, buildId: started!.id, stepRow };
}

describe('worker ask_user on a session step', () => {
  function questionReports() {
    return H.s.db
      .select()
      .from(chiefMessage)
      .all()
      .filter((row) => String(row.content).includes('thread-report'))
      .map((row) => threadReportContentSchema.parse(JSON.parse(String(row.content))));
  }

  function claim(stepId: string) {
    H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepId)).run();
    return H.s.db.select().from(step).where(eq(step.id, stepId)).get()!;
  }

  test('the question is stored pending and a needs-you report is written', async () => {
    const { todoId, stepRow } = startSession();
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    const claimed = claim(stepRow.id);
    const settled = await askWorkerQuestion(
      deps(),
      claimed,
      { requestId: REQUEST, questions: QUESTIONS },
      { holdMs: 0 },
    );
    expect(settled.status).toBe('pending');
    expect(asking(todoId)).toBe(true);
    const rows = H.s.db.select().from(message).where(eq(message.id, REQUEST)).all();
    expect(rows).toHaveLength(1);
    await askWorkerQuestion(
      deps(),
      claimed,
      { requestId: REQUEST, questions: QUESTIONS },
      { holdMs: 0 },
    );
    expect(H.s.db.select().from(message).where(eq(message.id, REQUEST)).all()).toHaveLength(1);
    expect(questionReports()).toHaveLength(1);
  });

  test('the needs-you report row carries the question own words, collapsed and capped', async () => {
    const { todoId, stepRow } = startSession();
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    const claimed = claim(stepRow.id);
    const long = `Which   export\nformat ${'and encoding '.repeat(30)}should it use?`;
    await askWorkerQuestion(
      deps(),
      claimed,
      { requestId: REQUEST, questions: [{ ...QUESTIONS[0]!, question: long }] },
      { holdMs: 0 },
    );
    const [report] = questionReports();
    expect(report!.phase).toBe('needs-you');
    expect(report!.todoId).toBe(todoId);
    expect(report!.line!.startsWith('Which export format and encoding')).toBe(true);
    expect(report!.line!.length).toBeLessThanOrEqual(200);
    expect(report!.line).not.toMatch(/\s{2}|\n/);
  });

  test('invisible format characters in the question never reach the report line', async () => {
    const { todoId, stepRow } = startSession();
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    await askWorkerQuestion(
      deps(),
      claim(stepRow.id),
      {
        requestId: REQUEST,
        questions: [{ ...QUESTIONS[0]!, question: '\uFEFFWhich\u202E export\u200B format?' }],
      },
      { holdMs: 0 },
    );
    const [line] = questionReports().map((r) => r.line);
    expect(line).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    expect(line).toBe('Which export format?');
  });

  test('a short question is the report line verbatim', async () => {
    const { todoId, stepRow } = startSession();
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    await askWorkerQuestion(
      deps(),
      claim(stepRow.id),
      { requestId: REQUEST, questions: QUESTIONS },
      { holdMs: 0 },
    );
    expect(questionReports().map((r) => r.line)).toEqual(['Which export format?']);
  });

  test('the answer delivered through the thread message settles the held ask', async () => {
    const { todoId, stepRow } = startSession();
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
    expect(asking(todoId)).toBe(false);
  });

  test('a parked question survives a move to review and is cancelled when the thread is closed', async () => {
    const { todoId, stepRow } = startSession();
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    const claimed = claim(stepRow.id);
    await askWorkerQuestion(
      deps(),
      claimed,
      { requestId: REQUEST, questions: QUESTIONS },
      { holdMs: 0 },
    );
    setTodoPhase(deps(), todoId, 'review');
    expect(asking(todoId)).toBe(true);
    setTodoPhase(deps(), todoId, 'closed');
    expect(asking(todoId)).toBe(false);
    const content = H.s.db.select().from(message).where(eq(message.id, REQUEST)).get()!.content as {
      status: string;
    };
    expect(content.status).toBe('cancelled');
  });

  test('a request id owned by another build is rejected and its message untouched', async () => {
    const { todoId, stepRow } = startSession();
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
    const { todoId, buildId, stepRow } = startSession();
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

  test('a delivery that throws leaves the question pending', async () => {
    const { todoId, stepRow } = startSession();
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
    expect(asking(todoId)).toBe(true);
    const content = H.s.db.select().from(message).where(eq(message.id, REQUEST)).get()!.content as {
      status: string;
    };
    expect(content.status).toBe('pending');
  });

  test('a non-session worker step still cannot ask', async () => {
    const { stepRow } = startSession();
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

describe('session steps share the build-step paths', () => {
  function claim(stepId: string) {
    H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepId)).run();
    return H.s.db.select().from(step).where(eq(step.id, stepId)).get()!;
  }

  test('a session turn that parked on an unanswered ask with no changes parks instead of failing', async () => {
    const { todoId, stepRow } = startSession();
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
    expect(record.phase).toBe('needs_input');
    const content = H.s.db.select().from(message).where(eq(message.id, REQUEST)).get()!.content as {
      status: string;
    };
    expect(content.status).toBe('pending');
  });

  test('a parked session does not dispatch further steps', async () => {
    const { todoId, buildId, stepRow } = startSession();
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
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

  test('a session turn with no changes and no question asks the Coordinator instead of failing', () => {
    const { todoId, stepRow } = startSession();
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    claim(stepRow.id);
    completeStep(deps(), stepRow.id, { hasChanges: false });
    expect(getTodo(deps(), todoId)!.phase).toBe('needs_input');
  });

  test('a reply that moves a review thread on marks the parked question answered', async () => {
    const { todoId, stepRow } = startSession();
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
    const sent = await messageThreadAsUser(deps(), H.teamId, todoId, {
      content: 'JSON please',
      clientMessageId: 'c-q',
    });
    expect(sent.delivered).toBe('new-turn');
    const content = H.s.db.select().from(message).where(eq(message.id, REQUEST)).get()!.content as {
      status: string;
      answers: unknown;
    };
    expect(content.status).toBe('answered');
    expect(content.answers).toEqual([{ header: 'Format', text: 'JSON please' }]);
    expect(asking(todoId)).toBe(false);
  });
});

describe('a parked worker question holds the gates', () => {
  async function parked(withPr: boolean) {
    const { todoId, buildId, stepRow } = startSession();
    H.s.db
      .update(project)
      .set({ repoKind: 'github', githubRepo: 'owner/repo' })
      .where(eq(project.id, H.projectId))
      .run();
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    if (withPr) H.s.db.update(build).set({ prNumber: 7 }).where(eq(build.id, buildId)).run();
    H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepRow.id)).run();
    const claimed = H.s.db.select().from(step).where(eq(step.id, stepRow.id)).get()!;
    await askWorkerQuestion(
      deps(),
      claimed,
      { requestId: REQUEST, questions: QUESTIONS },
      { holdMs: 0 },
    );
    return { todoId, buildId };
  }

  test('independent review is not dispatched while the question is pending', async () => {
    const { todoId, buildId } = await parked(true);
    const row = H.s.db.select().from(todo).where(eq(todo.id, todoId)).get()!;
    maybeEnqueueIndependentReview(deps(), row, buildId);
    expect(
      H.s.db
        .select()
        .from(step)
        .where(eq(step.buildId, buildId))
        .all()
        .filter((r) => r.kind === 'review'),
    ).toHaveLength(0);
  });

  test.each(['building', 'review'] as const)(
    'the CI poller does not touch a %s thread with a pending question and an open PR',
    async (phase) => {
      const { todoId } = await parked(true);
      H.s.db.update(todo).set({ phase }).where(eq(todo.id, todoId)).run();
      H.s.db.update(step).set({ status: 'done' }).where(eq(step.kind, 'session')).run();
      const fetched: string[] = [];
      const poller = createCiPoller(deps(), {
        githubFetch: async (url) => {
          fetched.push(String(url));
          return new Response('{}', { status: 404 });
        },
      });
      await poller.sweep();
      expect(fetched.filter((url) => url.includes('/pulls/7'))).toEqual([]);
      expect(getTodo(deps(), todoId)!.phase).toBe(phase);
    },
  );
});

describe('stopping a session with a pending question', () => {
  test('cancels the question', async () => {
    const { todoId, buildId, stepRow } = startSession();
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepRow.id)).run();
    const claimed = H.s.db.select().from(step).where(eq(step.id, stepRow.id)).get()!;
    await askWorkerQuestion(
      deps(),
      claimed,
      { requestId: REQUEST, questions: QUESTIONS },
      { holdMs: 0 },
    );
    expect(asking(todoId)).toBe(true);
    applyStoppedStep(deps(), stepRow.id);
    expect(asking(todoId)).toBe(false);
    const rows = H.s.db.select().from(message).where(eq(message.conversationId, buildId)).all();
    expect(JSON.stringify(rows)).toContain('cancelled');
    expect(JSON.stringify(rows)).not.toContain('"status":"pending"');
  });
});

describe('worker question hardening', () => {
  test('a request id owned by a non-question message in the same build is a 409 and stays intact', async () => {
    const { buildId, stepRow } = startSession();
    H.s.db
      .insert(message)
      .values({
        id: REQUEST,
        conversationId: buildId,
        role: 'user',
        content: 'plain text',
        createdAt: 1,
        actor: null,
      })
      .run();
    H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepRow.id)).run();
    const claimed = H.s.db.select().from(step).where(eq(step.id, stepRow.id)).get()!;
    await expect(
      askWorkerQuestion(
        deps(),
        claimed,
        { requestId: REQUEST, questions: QUESTIONS },
        { holdMs: 0 },
      ),
    ).rejects.toMatchObject({ status: 409 });
    const row = H.s.db.select().from(message).where(eq(message.id, REQUEST)).get()!;
    expect(row.content).toBe('plain text');
  });

  test('the Coordinator question wake caps and scrubs the question text', async () => {
    const { todoId, stepRow } = startSession();
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepRow.id)).run();
    const claimed = H.s.db.select().from(step).where(eq(step.id, stepRow.id)).get()!;
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH';
    await askWorkerQuestion(
      deps(),
      claimed,
      {
        requestId: REQUEST,
        questions: [
          {
            header: 'Key',
            question: `Use ${secret} ${'x'.repeat(400)}?`,
            options: [{ label: 'yes' }, { label: 'no' }],
          },
        ],
      },
      { holdMs: 0 },
    );
    const wakes = H.s.db
      .select()
      .from(step)
      .where(eq(step.kind, 'chief'))
      .all()
      .filter((row) => row.prompt?.includes(`watch:${todoId}`));
    expect(wakes).toHaveLength(1);
    const line = wakes[0]!.prompt!.split('\n').find((l) => l.startsWith(`- requestId ${REQUEST}`))!;
    expect(line.length).toBeLessThanOrEqual(400);
    expect(wakes[0]!.prompt).not.toContain(secret);
  });
});

describe('worker ask_user tool dispatch and parked replies', () => {
  test('session steps get ask_user for both repo types, build steps never', () => {
    for (const github of [false, true]) {
      expect(workerRemoteTools('session', github, true).map((t) => t.name)).toContain('ask_user');
      expect(workerRemoteTools('build', github, true).map((t) => t.name)).not.toContain('ask_user');
    }
  });

  test('a reply to a parked session with no claimed step is delivered, answers the question and continues', async () => {
    const { todoId, buildId, stepRow } = startSession();
    H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    H.s.db.update(build).set({ prNumber: 7 }).where(eq(build.id, buildId)).run();
    H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, stepRow.id)).run();
    const claimed = H.s.db.select().from(step).where(eq(step.id, stepRow.id)).get()!;
    await askWorkerQuestion(
      deps(),
      claimed,
      { requestId: REQUEST, questions: QUESTIONS },
      { holdMs: 0 },
    );
    H.s.db.update(step).set({ status: 'done' }).where(eq(step.id, stepRow.id)).run();
    expect(asking(todoId)).toBe(true);
    const sent = await messageThreadAsUser(deps(), H.teamId, todoId, {
      content: 'JSON please',
      clientMessageId: 'c-parked',
    });
    expect(sent.delivered).toBe('new-turn');
    expect(asking(todoId)).toBe(false);
    const content = H.s.db.select().from(message).where(eq(message.id, REQUEST)).get()!.content as {
      status: string;
    };
    expect(content.status).toBe('answered');
    const pending = H.s.db
      .select()
      .from(step)
      .where(eq(step.buildId, buildId))
      .all()
      .filter((s) => s.status === 'pending');
    expect(pending.length).toBeGreaterThan(0);
  });
});
