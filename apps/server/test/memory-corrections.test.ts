import {
  ASK_USER_QUESTION_KIND,
  encodeReplyQuote,
  type MachineDoneBody,
  type MemoryCorrectionsResponse,
  memoryCorrectionsResponseSchema,
  type TranscriptUserOrigin,
} from '@cairn/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  agentMemory,
  autonomousMergeAdmission,
  build,
  chiefMessage,
  chiefThread,
  coordinatorConversation,
  machine,
  memoryCorrection,
  message,
  project,
  queuedMessage,
  steerPending,
  step,
  todo,
} from '../src/db/schema.js';
import {
  answerChiefQuestion,
  COORDINATOR_SYSTEM_PROMPT,
  enqueueChiefStep,
  rewindChiefThread,
  sendChiefMessageFromComposer,
} from '../src/services/chief.js';
import { writeQuestion } from '../src/services/chief-question-store.js';
import type { ChiefToolCtx } from '../src/services/chief-tools.js';
import {
  ackChiefSteer,
  releaseUnconsumedSteer,
  steerChiefMessage,
  takeChiefSteer,
} from '../src/services/chief-turns.js';
import {
  consumeCoordinatorInput,
  pullCoordinatorInput,
  releaseCoordinatorInput,
} from '../src/services/coordinator-inputs.js';
import { chiefTurnContext, claimPendingChiefStep } from '../src/services/coordinator-steps.js';
import { designCommentRelay } from '../src/services/design-comments.js';
import { ackSteer, fetchSteer, finishStep as finishRunnerStep } from '../src/services/machines.js';
import { injectMemoryDocuments, memoryDocumentVersion } from '../src/services/memory.js';
import { executeMemoryToolForStep } from '../src/services/memory-corrections.js';
import { executeMemoryDocumentTool } from '../src/services/memory-documents.js';
import { deliverQueuedMessage, drainTaskMessageQueue } from '../src/services/task-message-queue.js';
import { answerTaskQuestion } from '../src/services/thread-message.js';
import { writeWorkerQuestion } from '../src/services/worker-question-store.js';
import { AGENT_ID, H, registerChiefHarness, relay, toolDeps } from './chief-harness.js';
import { claimedGeneration, issueApiKey, req, seedSessionRoute } from './helpers.js';
import { seedOwnerMessage } from './owner-message.js';

registerChiefHarness();

const RULE = '- Reply with the conclusion first.';

type Doc = { content: string; baseVersion: string; id: string };
type Written = Doc & {
  pointedRule?: string;
  correction?: string;
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 3));
const teamOwner = () => ({ agentId: AGENT_ID, teamId: H.teamId, projectId: null });

function seedDoc(scope: string, file: string) {
  return executeMemoryDocumentTool(H.s.db, teamOwner(), 'memories', { scope, file }) as Doc;
}
function seedIndex(content: string, scope = 'team') {
  executeMemoryDocumentTool(H.s.db, teamOwner(), 'update_memory', {
    scope,
    file: 'MEMORY.md',
    baseVersion: seedDoc(scope, 'MEMORY.md').baseVersion,
    content,
  });
}

async function turn(
  words: string | null,
  projectId: string | null = null,
  sameMessages?: string[],
) {
  await tick();
  const ownerMessageIds =
    sameMessages ?? (words === null ? [] : [seedOwnerMessage(H.s.db, H.threadId, words)]);
  const stepId = enqueueChiefStep(H.s.svc, H.threadId, {
    prompt: words ?? 'wake',
    ownerMessageIds,
    scopeProjectId: projectId,
    ...(words === null ? { trigger: 'wake', provenance: 'wake:test' } : { trigger: 'user' }),
  });
  const row = H.s.db.select().from(step).where(eq(step.id, stepId)).get()!;
  const thread = H.s.db.select().from(chiefThread).where(eq(chiefThread.id, H.threadId)).get()!;
  const claimedAt = Date.now();
  const { memoryTrace } = chiefTurnContext(
    toolDeps(),
    { ...row, scopeProjectId: projectId },
    thread,
    AGENT_ID,
  );
  H.s.db
    .update(step)
    .set({ status: 'claimed', claimedAt, memoryTrace })
    .where(eq(step.id, stepId))
    .run();
  await tick();
  const over: Partial<ChiefToolCtx> = { stepId, turnMessageIds: ownerMessageIds };
  return {
    stepId,
    messageId: ownerMessageIds[0] ?? null,
    async call(name: string, params: Record<string, unknown>) {
      return (await relay(name, params, over)) as Written;
    },
    async index(scope = 'team') {
      return (await relay('memories', { scope, file: 'MEMORY.md' }, over)) as Doc;
    },
    done() {
      H.s.db.update(step).set({ status: 'done' }).where(eq(step.id, stepId)).run();
    },
  };
}
type Turn = Awaited<ReturnType<typeof turn>>;

async function reportRepeat(current: Turn, entry = RULE, scope = 'team') {
  return current.call('update_memory', {
    scope,
    file: 'MEMORY.md',
    baseVersion: (await current.index(scope)).baseVersion,
    correction: true,
    repeats: entry,
  });
}
const rows = () => H.s.db.select().from(memoryCorrection).all();
const filler = (count: number) =>
  Array.from({ length: count }, (_, index) => `- filler ${index}`).join('\n');

test('the Coordinator is told to mark corrections and to name the rule already saved', () => {
  const section =
    /<corrections>([\s\S]*?)<\/corrections>/.exec(COORDINATOR_SYSTEM_PROMPT)?.[1] ?? '';
  expect(section).toContain('correction: true');
  expect(section).toContain('repeats');
  expect(section.trim().length).toBeLessThanOrEqual(600);
  expect(section).not.toMatch(/\p{Script=Han}/u);
});

test('a correction that names no old rule stores the words and no verdict', async () => {
  const first = await turn('Stop opening with background. Conclusion first.');
  const written = await first.call('update_memory', {
    scope: 'team',
    file: 'MEMORY.md',
    baseVersion: (await first.index()).baseVersion,
    content: RULE,
    correction: true,
  });
  expect(written.pointedRule).toBeUndefined();
  expect(rows()).toMatchObject([
    {
      pointedFile: null,
      pointedRule: null,
      inTurnIndex: null,
      stepId: first.stepId,
      ownerMessageId: first.messageId,
      ownerWords: 'Stop opening with background. Conclusion first.',
    },
  ]);
  expect(Object.keys(rows()[0]!).sort()).toEqual([
    'buildId',
    'createdAt',
    'id',
    'inTurnIndex',
    'ownerMessageId',
    'ownerWords',
    'pointedFile',
    'pointedRule',
    'projectId',
    'stepId',
    'teamId',
  ]);
});

test('pointing at a saved rule records whether this turn index held it and changes no memory', async () => {
  seedIndex(RULE);
  const correction = await turn('I told you: conclusion first.');
  const before = await correction.index();
  const written = await reportRepeat(correction);
  expect(written.pointedRule).toBe(RULE);
  expect((await correction.index()).baseVersion).toBe(before.baseVersion);
  expect(rows()).toMatchObject([
    {
      pointedFile: 'MEMORY.md',
      pointedRule: RULE,
      inTurnIndex: true,
      stepId: correction.stepId,
      ownerMessageId: correction.messageId,
    },
  ]);
});

test('a line past the loaded part of the index was not in the attached index', async () => {
  seedIndex(`${filler(200)}\n${RULE}`, H.projectId);
  const correction = await turn('不对。', H.projectId);
  await reportRepeat(correction, RULE, H.projectId);
  expect(rows()).toMatchObject([{ inTurnIndex: false }]);
});

test('an index version this chat wrote does not put unattached lines in the turn index', async () => {
  seedIndex(`${filler(200)}\n${RULE}`, H.projectId);
  const earlier = await turn('Note the release day.', H.projectId);
  await earlier.call('update_memory', {
    scope: H.projectId,
    file: 'MEMORY.md',
    baseVersion: (await earlier.index(H.projectId)).baseVersion,
    content: `${filler(200)}\n${RULE}\n- Releases are on Monday.`,
  });
  earlier.done();
  const correction = await turn('Again: conclusion first.');
  await reportRepeat(correction, RULE, H.projectId);
  expect(rows()).toMatchObject([{ pointedRule: RULE, inTurnIndex: false }]);
});

test('a rule file only the correcting message recalled was not in the attached index', async () => {
  executeMemoryDocumentTool(H.s.db, teamOwner(), 'save_memory', {
    scope: 'team',
    file: 'freeze.md',
    content: 'staging deploy freeze starts every friday afternoon',
  });
  const correction = await turn('You deployed during the staging deploy freeze on friday again');
  expect(
    H.s.db.select().from(step).where(eq(step.id, correction.stepId)).get()!.memoryTrace!
      .recalledMemoryIds,
  ).toHaveLength(1);
  await correction.call('update_memory', {
    scope: 'team',
    file: 'freeze.md',
    baseVersion: ((await correction.call('memories', { scope: 'team', file: 'freeze.md' })) as Doc)
      .baseVersion,
    correction: true,
    repeats: 'freeze.md',
  });
  expect(rows()).toMatchObject([
    { pointedFile: 'freeze.md', pointedRule: 'freeze.md', inTurnIndex: false },
  ]);
});

test('a rule rewritten while it is named is recorded as the old text', async () => {
  seedIndex(`${RULE}\n- Use metric units.`);
  const correction = await turn('Conclusion first, and keep it to one line.');
  const written = await correction.call('update_memory', {
    scope: 'team',
    file: 'MEMORY.md',
    baseVersion: (await correction.index()).baseVersion,
    old_str: RULE,
    new_str: '- Open with a one-line conclusion.',
    correction: true,
    repeats: RULE,
  });
  expect(written.content).toBe('- Open with a one-line conclusion.\n- Use metric units.');
  expect(rows()).toMatchObject([{ pointedRule: RULE, inTurnIndex: true }]);
});

test('Cairn infers no old rule from what a write removes', async () => {
  seedIndex(`${RULE}\n- Use metric units.`);
  const correction = await turn('Dates must be ISO.');
  await correction.call('update_memory', {
    scope: 'team',
    file: 'MEMORY.md',
    baseVersion: (await correction.index()).baseVersion,
    content: `${RULE}\n- Write ISO dates.`,
    correction: true,
  });
  expect(rows()).toMatchObject([{ pointedRule: null, inTurnIndex: null }]);
});

test('one message keeps one record per old rule, replacing the record that named none', async () => {
  executeMemoryDocumentTool(H.s.db, teamOwner(), 'save_memory', {
    scope: 'team',
    file: 'answers.md',
    content: 'Reply with the conclusion first.',
  });
  seedIndex(RULE);
  const correction = await turn('Again: conclusion first.');
  const detail = (file: string) =>
    correction.call('save_memory', {
      scope: 'team',
      file,
      content: 'Put the verdict in the first sentence.',
      correction: true,
    });
  await detail('detail.md');
  await detail('more.md');
  expect(rows()).toMatchObject([{ pointedRule: null }]);
  await reportRepeat(correction, 'answers.md');
  await reportRepeat(correction);
  await reportRepeat(correction, 'answers.md');
  await detail('last.md');
  expect(rows()).toMatchObject([
    { pointedRule: 'answers.md', inTurnIndex: false },
    { pointedRule: RULE, inTurnIndex: true },
  ]);
});

test('a rule of a project the turn was not given was not in the attached index', async () => {
  seedIndex(RULE, H.projectId);
  const correction = await turn('Again: conclusion first.');
  await reportRepeat(correction, RULE, H.projectId);
  expect(rows()).toMatchObject([{ inTurnIndex: false, projectId: H.projectId }]);
});

test('the same rule text attached from the team index counts as attached', async () => {
  seedIndex(RULE);
  seedIndex('* Reply with the conclusion first.', H.projectId);
  const correction = await turn('Again: conclusion first.');
  await reportRepeat(correction, RULE, H.projectId);
  expect(rows()).toMatchObject([{ inTurnIndex: true }]);
});

test('one user message records a named rule once', async () => {
  seedIndex(RULE);
  const correction = await turn('Conclusion first!');
  const first = await reportRepeat(correction);
  const again = await reportRepeat(correction);
  expect(again.pointedRule).toBe(first.pointedRule);
  expect(rows()).toHaveLength(1);
});

test('a rule this turn just saved is not an old rule', async () => {
  const correction = await turn('Conclusion first!');
  await correction.call('update_memory', {
    scope: 'team',
    file: 'MEMORY.md',
    baseVersion: (await correction.index()).baseVersion,
    content: RULE,
    correction: true,
  });
  const written = await reportRepeat(correction);
  expect(written.pointedRule).toBeUndefined();
  expect(rows()).toMatchObject([{ pointedRule: null }]);
});

test('a turn the user did not send writes memory and records nothing', async () => {
  const wake = await turn(null);
  const written = await wake.call('update_memory', {
    scope: 'team',
    file: 'MEMORY.md',
    baseVersion: (await wake.index()).baseVersion,
    content: RULE,
    correction: true,
  });
  expect(written.content).toBe(RULE);
  expect(written.correction).toContain('not recorded');
  expect(rows()).toEqual([]);
});

test('repeats must copy a saved entry and needs correction', async () => {
  seedIndex(RULE);
  const correction = await turn('Conclusion first!');
  const baseVersion = (await correction.index()).baseVersion;
  const write = { scope: 'team', file: 'MEMORY.md', baseVersion, content: '- other' };
  await expect(
    correction.call('update_memory', { ...write, correction: true, repeats: '- never saved' }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(correction.call('update_memory', { ...write, repeats: RULE })).rejects.toMatchObject(
    { status: 400 },
  );
  expect((await correction.index()).content).toBe(RULE);
  expect(rows()).toEqual([]);
});

test('a failed write records nothing', async () => {
  seedIndex(RULE);
  const correction = await turn('Conclusion first!');
  await expect(
    correction.call('update_memory', {
      scope: 'team',
      file: 'MEMORY.md',
      baseVersion: 'stale',
      correction: true,
      repeats: RULE,
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(rows()).toEqual([]);
});

test('when the record cannot be stored the memory write rolls back', async () => {
  const correction = await turn('Conclusion first!');
  const baseVersion = (await correction.index()).baseVersion;
  H.s.db.run(sql`DROP TABLE memory_correction`);
  await expect(
    correction.call('update_memory', {
      scope: 'team',
      file: 'MEMORY.md',
      baseVersion,
      content: RULE,
      correction: true,
    }),
  ).rejects.toThrow('memory_correction');
  const index = H.s.db
    .select()
    .from(agentMemory)
    .all()
    .find((row) => row.title === 'MEMORY.md' && row.invalidAt === null)!;
  expect(memoryDocumentVersion(index)).toBe(baseVersion);
});

test('the records are readable and carry no counts or verdicts', async () => {
  seedIndex(RULE);
  const correction = await turn('Conclusion first!');
  await reportRepeat(correction);
  const res = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/chief/memory-corrections`);
  expect(res.status).toBe(200);
  const raw = (await res.json()) as Record<string, unknown>;
  expect(Object.keys(raw)).toEqual(['corrections']);
  const body: MemoryCorrectionsResponse = memoryCorrectionsResponseSchema.parse(raw);
  expect(body.corrections).toMatchObject([
    { ownerWords: 'Conclusion first!', pointedRule: RULE, inTurnIndex: true },
  ]);
  expect(JSON.stringify(raw)).not.toMatch(/outcome|repeated_injected|retrieval_miss/);
});

test('a worker turn records its trace and a follow-up correction, never the task prompt', async () => {
  const workerAgent = 'route-corrections';
  const token = await (async () => {
    const key = await issueApiKey(H.s);
    const res = await H.s.app.request('/api/machine/enroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(
        readyMachine({ teamId: H.teamId, name: 'corrections', cliVersion: '0.1.0' }),
      ),
    });
    return ((await res.json()) as { token: string }).token;
  })();
  const machine = async (path: string, body: unknown) => {
    const res = await H.s.app.request(path, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  seedSessionRoute(H.s, { id: workerAgent, provider: 'p', modelId: 'm' });
  const todoRes = await req(H.s.app, 'POST', `/api/projects/${H.projectId}/todos`, {
    title: 'task',
    spec: 'Add a section to the README.',
  });
  const { id: todoId } = (await todoRes.json()) as { id: string };
  await req(H.s.app, 'POST', `/api/projects/${H.projectId}/builds`, { todoIds: [todoId] });
  const claim = async () => {
    for (;;) {
      await tick();
      const res = await machine('/api/machine/tasks/claim', {});
      const claimed = res.body.step as { step: { id: string; buildId: string; kind: string } };
      await tick();
      if (claimed.step.kind === 'session') return claimed.step;
    }
  };
  const tool = async (stepId: string, name: string, params: Record<string, unknown>) => {
    const res = await machine(`/api/machine/tool/${stepId}`, { name, params });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return JSON.parse(res.body.text as string) as Written;
  };
  const index = (stepId: string) =>
    tool(stepId, 'memories', { scope: H.projectId, file: 'MEMORY.md' });

  const first = await claim();
  expect(
    H.s.db.select().from(step).where(eq(step.id, first.id)).get()!.memoryTrace?.projectMemoryIds,
  ).toHaveLength(1);
  const saved = await tool(first.id, 'update_memory', {
    scope: H.projectId,
    file: 'MEMORY.md',
    baseVersion: (await index(first.id)).baseVersion,
    content: RULE,
    correction: true,
  });
  expect(saved.correction).toContain('not recorded');
  expect(rows()).toEqual([]);
  await machine(`/api/machine/done/${first.id}`, {
    status: 'success',
    sessionId: 'sess-1',
    hasChanges: true,
    generation: claimedGeneration(H.s.db, first.id),
  });
  await tick();
  const sent = await req(H.s.app, 'POST', `/api/conversations/${first.buildId}/messages`, {
    content: 'Conclusion first, as I said.',
  });
  expect(sent.status).toBe(201);
  const second = await claim();
  const written = await tool(second.id, 'update_memory', {
    scope: H.projectId,
    file: 'MEMORY.md',
    baseVersion: (await index(second.id)).baseVersion,
    correction: true,
    repeats: RULE,
  });
  expect(written.pointedRule).toBe(RULE);
  expect(rows()).toMatchObject([
    { inTurnIndex: true, ownerWords: 'Conclusion first, as I said.', stepId: second.id },
  ]);

  await machine(`/api/machine/done/${second.id}`, {
    status: 'failed',
    errorMessage: 'the runner stopped',
    generation: claimedGeneration(H.s.db, second.id),
  });
  await tick();
  const restarted = await req(H.s.app, 'POST', `/api/builds/${second.buildId}/steps`, {
    action: 'restart',
    feedback: 'Still not conclusion first.',
    clientMessageId: 'restart-1',
  });
  expect(restarted.status, await restarted.clone().text()).toBe(202);
  const third = await claim();
  const again = await tool(third.id, 'update_memory', {
    scope: H.projectId,
    file: 'MEMORY.md',
    baseVersion: (await index(third.id)).baseVersion,
    correction: true,
    repeats: RULE,
  });
  expect(again.correction).toBeUndefined();
  expect(rows()).toHaveLength(2);
  expect(rows()[1]!.ownerWords).toContain('Still not conclusion first.');
});

test('a typed answer to a Coordinator question card records no correction words', async () => {
  seedIndex(RULE);
  const current = await turn('Write the summary.');
  writeQuestion(
    H.s.db,
    H.threadId,
    'ask-0000000001',
    {
      kind: ASK_USER_QUESTION_KIND,
      requestId: 'ask-0000000001',
      status: 'pending',
      questions: [{ header: 'Order', question: 'What comes first?', options: [] }],
      answers: null,
    },
    Date.now(),
  );
  answerChiefQuestion(H.s.svc, H.teamId, {
    threadId: H.threadId,
    requestId: 'ask-0000000001',
    answers: [{ header: 'Order', text: 'The conclusion, as I keep saying.' }],
  });
  const written = await reportRepeat(current);
  expect(written.correction).toContain('not recorded');
  expect(rows()).toEqual([]);
});

test('a typed composer answer to a plain Coordinator question records no correction words', async () => {
  seedIndex(RULE);
  const current = await turn('Write the summary.');
  writeQuestion(
    H.s.db,
    H.threadId,
    'ask-0000000002',
    {
      kind: ASK_USER_QUESTION_KIND,
      requestId: 'ask-0000000002',
      status: 'pending',
      questions: [{ header: 'Order', question: 'What comes first?', options: [] }],
      answers: null,
    },
    Date.now(),
  );
  sendChiefMessageFromComposer(H.s.svc, H.teamId, {
    threadId: H.threadId,
    content: 'The conclusion, as I keep saying.',
    clientMessageId: 'plain-answer-1',
  });
  const written = await reportRepeat(current);
  expect(written.correction).toContain('not recorded');
  expect(rows()).toEqual([]);
});

function workStep(id: string, claimedAt: number, buildId = 'build-1') {
  const { indexes } = injectMemoryDocuments(H.s.db, {
    ...teamOwner(),
    teamScoped: true,
  });
  H.s.db
    .insert(step)
    .values({
      id,
      buildId,
      kind: 'session',
      status: 'claimed',
      claimedAt,
      createdAt: claimedAt,
      memoryTrace: {
        teamMemoryIds: indexes.map((index) => index.id),
        teamMemoriesOmitted: 0,
        projectMemoryIds: [],
        projectMemoriesOmitted: 0,
        recalledMemoryIds: [],
      },
    })
    .run();
}

function said(
  origin: TranscriptUserOrigin,
  createdAt: number,
  conversationId = 'build-1',
  content = 'Again: conclusion first.',
) {
  H.s.db
    .insert(message)
    .values({
      id: `said-${createdAt}`,
      conversationId,
      role: 'user',
      content,
      createdAt,
      origin,
    })
    .run();
}

function workerRepeatOnChiefThread(threadId: string) {
  const { id } = H.s.db
    .select()
    .from(step)
    .where(and(eq(step.buildId, threadId), eq(step.kind, 'chief')))
    .orderBy(desc(step.createdAt), sql`rowid desc`)
    .get()!;
  H.s.db
    .update(step)
    .set({ status: 'claimed', claimedAt: Date.now() })
    .where(eq(step.id, id))
    .run();
  return executeMemoryToolForStep(H.s.db, teamOwner(), id, 'save_memory', {
    scope: 'team',
    file: 'note.md',
    content: 'A note.',
    correction: true,
  });
}

const workerRepeat = (stepId: string) =>
  executeMemoryToolForStep(H.s.db, teamOwner(), stepId, 'update_memory', {
    scope: 'team',
    file: 'MEMORY.md',
    baseVersion: seedDoc('team', 'MEMORY.md').baseVersion,
    correction: true,
    repeats: RULE,
  });

test('messages the system or the Coordinator sent are not the user correcting', async () => {
  seedIndex(RULE);
  await tick();
  const now = Date.now();
  said('task-prompt', now + 1);
  said('synthetic', now + 2);
  workStep('s-next', now + 3);
  workerRepeat('s-next');
  expect(rows()).toEqual([]);
});

test('a rule first saved earlier in the same turn is not an old rule', async () => {
  const current = await turn('Conclusion first!');
  await current.call('update_memory', {
    scope: 'team',
    file: 'MEMORY.md',
    baseVersion: (await current.index()).baseVersion,
    content: RULE,
  });
  await reportRepeat(current);
  expect(rows()).toMatchObject([{ pointedRule: null }]);
});

test('rewinding the chat removes the evidence copied from the removed messages', async () => {
  seedIndex(RULE);
  const anchor = await turn('Write the summary.');
  anchor.done();
  const steered = seedOwnerMessage(H.s.db, H.threadId, 'Again: conclusion first.');
  const later = await turn(null, null, [anchor.messageId!, steered]);
  await reportRepeat(later);
  later.done();
  H.s.db.update(chiefThread).set({ activeRun: null }).where(eq(chiefThread.id, H.threadId)).run();
  rewindChiefThread(H.s.svc, H.teamId, H.threadId, { messageId: anchor.messageId! });
  expect(rows()).toEqual([]);
});

test('deleting a project removes the evidence kept about it', async () => {
  seedIndex(RULE, H.projectId);
  const correction = await turn('Again: conclusion first.', H.projectId);
  await reportRepeat(correction, RULE, H.projectId);
  correction.done();
  H.s.db.update(chiefThread).set({ activeRun: null }).where(eq(chiefThread.id, H.threadId)).run();
  const res = await req(H.s.app, 'DELETE', `/api/projects/${H.projectId}`);
  expect(res.status).toBeLessThan(300);
  expect(rows()).toEqual([]);
});

function answer(requestId: string, text: string) {
  writeQuestion(
    H.s.db,
    H.threadId,
    requestId,
    {
      kind: ASK_USER_QUESTION_KIND,
      requestId,
      status: 'pending',
      questions: [{ header: 'Next', question: 'Shall I go on?', options: [] }],
      answers: null,
    },
    Date.now(),
  );
  answerChiefQuestion(H.s.svc, H.teamId, {
    threadId: H.threadId,
    requestId,
    answers: [{ header: 'Next', text }],
  });
}

test('answering a later question does not record the same rule again', async () => {
  seedIndex(RULE);
  const current = await turn('Again: conclusion first.');
  await reportRepeat(current);
  answer('ask-0000000002', 'yes');
  await reportRepeat(current);
  current.done();
  const resumed = await turn(null, null, [current.messageId!, 'ask-0000000002']);
  await reportRepeat(resumed);
  expect(rows()).toHaveLength(1);
  expect(rows()[0]!.ownerWords).toBe('Again: conclusion first.');
});

test('rewinding to an answer removes every record that quotes it', async () => {
  seedIndex(RULE);
  const current = await turn('Write the summary.');
  await current.call('save_memory', {
    scope: 'team',
    file: 'summary.md',
    content: 'Summaries are short.',
    correction: true,
  });
  await tick();
  const between = seedOwnerMessage(H.s.db, H.threadId, 'One more thing.');
  await tick();
  writeQuestion(
    H.s.db,
    H.threadId,
    'ask-0000000003',
    {
      kind: ASK_USER_QUESTION_KIND,
      requestId: 'ask-0000000003',
      status: 'pending',
      questions: [
        {
          header: 'Next',
          question: 'Shall I go on?',
          options: [{ label: 'SECRET-ANSWER conclusion first' }],
        },
      ],
      answers: null,
    },
    Date.now(),
  );
  answerChiefQuestion(H.s.svc, H.teamId, {
    threadId: H.threadId,
    requestId: 'ask-0000000003',
    answers: [{ header: 'Next', choices: ['SECRET-ANSWER conclusion first'] }],
  });
  await tick();
  const resumed = await turn(null, null, [current.messageId!, 'ask-0000000003']);
  await reportRepeat(resumed);
  expect(JSON.stringify(rows())).toContain('SECRET-ANSWER');
  resumed.done();
  H.s.db.update(chiefThread).set({ activeRun: null }).where(eq(chiefThread.id, H.threadId)).run();
  rewindChiefThread(H.s.svc, H.teamId, H.threadId, { messageId: between });
  expect(JSON.stringify(rows())).not.toContain('SECRET-ANSWER');
});

test('a retry of the turn that saved the rule does not treat it as old', async () => {
  const failed = await turn('Conclusion first!');
  await failed.call('update_memory', {
    scope: 'team',
    file: 'MEMORY.md',
    baseVersion: (await failed.index()).baseVersion,
    content: RULE,
  });
  failed.done();
  const retry = await turn(null, null, [failed.messageId!]);
  await reportRepeat(retry);
  expect(rows()).toMatchObject([{ pointedRule: null }]);
});

function steerAtRunningTurn() {
  const messageId = seedOwnerMessage(H.s.db, H.threadId, 'Again, for this project too.');
  const waitingId = enqueueChiefStep(H.s.svc, H.threadId, {
    prompt: 'Again, for this project too.',
    ownerMessageIds: [messageId],
    scopeProjectId: H.projectId,
    trigger: 'user',
  });
  expect(steerChiefMessage(H.s.svc, H.teamId, H.threadId, messageId)).toEqual({ steered: true });
  return waitingId;
}

test('a queued steer that was never delivered attached nothing', async () => {
  seedIndex(RULE, H.projectId);
  const running = await turn('How is the release going?');
  steerAtRunningTurn();
  const written = await reportRepeat(running, RULE, H.projectId);
  expect(written.correction).toContain('not recorded');
  expect(rows()).toEqual([]);
  const usage = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/chief/memory-usage`);
  expect(await usage.json()).toMatchObject({
    usage: { stepId: running.stepId, projectMemoryIds: [] },
  });
});

test('project memory a consumed steer delivered is part of the turn index', async () => {
  seedIndex(RULE, H.projectId);
  const running = await turn('How is the release going?');
  const waitingId = steerAtRunningTurn();
  H.s.db
    .insert(coordinatorConversation)
    .values({ threadId: H.threadId, conversationId: 'c1', piVersion: '1', updatedAt: Date.now() })
    .run();
  expect(pullCoordinatorInput(H.s.db, running.stepId, 'c1')?.id).toBe(waitingId);
  consumeCoordinatorInput(H.s.db, waitingId, 'c1', '1');
  const written = await reportRepeat(running, RULE, H.projectId);
  expect(written.correction).toContain('not recorded');
  expect(rows()).toEqual([]);
  const usage = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/chief/memory-usage`);
  expect(
    ((await usage.json()) as { usage: { projectMemoryIds: string[] } }).usage.projectMemoryIds,
  ).toHaveLength(1);
});

test('project memory a runner acknowledged is part of the turn index', async () => {
  seedIndex(RULE, H.projectId);
  const running = await turn('How is the release going?');
  H.s.db.update(step).set({ machineId: 'runner-1' }).where(eq(step.id, running.stepId)).run();
  const waitingId = steerAtRunningTurn();
  expect(takeChiefSteer(H.s.db, H.threadId)).toEqual([waitingId]);
  const row = H.s.db.select().from(step).where(eq(step.id, running.stepId)).get()!;
  ackChiefSteer(toolDeps(), H.teamId, row, [waitingId]);
  const written = await reportRepeat(running, RULE, H.projectId);
  expect(written.correction).toContain('not recorded');
  expect(rows()).toEqual([]);
  const usage = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/chief/memory-usage`);
  expect(
    ((await usage.json()) as { usage: { projectMemoryIds: string[] } }).usage.projectMemoryIds,
  ).toHaveLength(1);
});

test('design comments relayed through the chat are not stored as the user words', async () => {
  seedIndex(RULE);
  const correction = await turn(designCommentRelay('', '「AGENT WRITTEN HEADLINE」', 'task'));
  const written = await reportRepeat(correction);
  expect(written.correction).toContain('not recorded');
  expect(rows()).toEqual([]);
});

test('a file that reuses the name of a renamed file is not an old rule', async () => {
  executeMemoryDocumentTool(H.s.db, teamOwner(), 'save_memory', {
    scope: 'team',
    file: 'style.md',
    content: 'Use metric units.',
  });
  executeMemoryDocumentTool(H.s.db, teamOwner(), 'update_memory', {
    scope: 'team',
    file: 'style.md',
    baseVersion: seedDoc('team', 'style.md').baseVersion,
    renameTo: 'units.md',
  });
  const correction = await turn('Conclusion first!');
  await correction.call('save_memory', { scope: 'team', file: 'style.md', content: RULE });
  await correction.call('update_memory', {
    scope: 'team',
    file: 'style.md',
    baseVersion: seedDoc('team', 'style.md').baseVersion,
    correction: true,
    repeats: 'style.md',
  });
  expect(rows()).toMatchObject([{ pointedRule: null }]);
});

function finishStep(id: string, status: 'done' | 'stopped') {
  H.s.db.update(step).set({ status, finishedAt: Date.now() }).where(eq(step.id, id)).run();
}

test('a message an earlier turn already answered is not quoted for a later one', async () => {
  seedIndex(RULE);
  await tick();
  said('user', Date.now(), 'build-1', 'Please also add a license section.');
  await tick();
  workStep('s-license', Date.now());
  await tick();
  finishStep('s-license', 'done');
  await tick();
  said('synthetic', Date.now(), 'build-1', 'Reviewer: you buried the conclusion.');
  await tick();
  workStep('s-review', Date.now());
  expect(workerRepeat('s-review')).toMatchObject({
    correction: expect.stringContaining('not recorded'),
  });
  expect(rows()).toEqual([]);
});

test('a rerun of a stopped turn judges the rule against the first message it quotes', async () => {
  await tick();
  said('user', Date.now(), 'build-1', 'No. Always put the conclusion first.');
  await tick();
  workStep('s-first', Date.now());
  executeMemoryToolForStep(H.s.db, teamOwner(), 's-first', 'update_memory', {
    scope: 'team',
    file: 'MEMORY.md',
    baseVersion: seedDoc('team', 'MEMORY.md').baseVersion,
    content: RULE,
    correction: true,
  });
  await tick();
  said('user', Date.now(), 'build-1', 'Also update the docs page.');
  finishStep('s-first', 'stopped');
  await tick();
  workStep('s-rerun', Date.now());
  workerRepeat('s-rerun');
  expect(rows()).toMatchObject([
    {
      pointedRule: null,
      ownerWords: 'No. Always put the conclusion first.',
    },
  ]);
});

async function startedTask() {
  const created = await req(H.s.app, 'POST', `/api/projects/${H.projectId}/todos`, {
    title: 'task',
    spec: 'Add a section.',
  });
  const { id } = (await created.json()) as { id: string };
  await req(H.s.app, 'POST', `/api/projects/${H.projectId}/builds`, { todoIds: [id] });
  const buildId = H.s.db.select().from(build).where(eq(build.todoId, id)).get()!.id;
  return {
    todoId: id,
    buildId,
    finishSteps() {
      H.s.db
        .update(step)
        .set({ status: 'done', finishedAt: Date.now() })
        .where(eq(step.buildId, buildId))
        .run();
      H.s.db.update(todo).set({ phase: 'done' }).where(eq(todo.id, id)).run();
    },
  };
}

function claimOnRunner(buildId: string) {
  const { id } = H.s.db.select().from(step).where(eq(step.buildId, buildId)).get()!;
  H.s.db
    .insert(machine)
    .values(readyMachine({ id: 'runner-1', teamId: H.teamId, name: 'runner', online: true }))
    .onConflictDoNothing()
    .run();
  H.s.db
    .update(step)
    .set({
      status: 'claimed',
      claimedAt: Date.now(),
      lastHeartbeatAt: Date.now(),
      machineId: 'runner-1',
    })
    .where(eq(step.id, id))
    .run();
  return id;
}

async function mcpKey() {
  const res = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/api-keys`, {
    name: 'MCP',
    gitAccess: false,
    mcpAccess: true,
    toolGrants: { read: [], write: ['Message Todo', 'Reply Thread', 'Interrupt Thread'] },
  });
  return ((await res.json()) as { plaintext: string }).plaintext;
}

async function viaMcp(key: string, name: string, args: Record<string, unknown>) {
  const res = await H.s.app.request('/api/mcp', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const text = await res.text();
  expect(res.status, text).toBe(200);
  expect(text).not.toContain('"isError":true');
  return text;
}

test('a queued task message is judged against the time the user typed it', async () => {
  const task = await startedTask();
  const send = (body: Record<string, unknown>) =>
    req(H.s.app, 'POST', `/api/conversations/${task.buildId}/messages`, body);
  await tick();
  const queued = await send({ content: 'Conclusion first!', mode: 'queue' });
  const { message: waiting } = (await queued.json()) as { message: { id: string } };
  await tick();
  seedIndex(RULE);
  await tick();
  task.finishSteps();
  await tick();
  const delivered = await send({ content: 'Conclusion first!', queuedMessageId: waiting.id });
  expect(delivered.status, await delivered.clone().text()).toBe(201);
  await tick();
  workStep('s-queued', Date.now(), task.buildId);
  workerRepeat('s-queued');
  expect(rows()).toMatchObject([{ pointedRule: null, ownerWords: 'Conclusion first!' }]);
});

test.each([
  ['message_todo', undefined],
  ['reply_thread', 'steer'],
  ['reply_thread', 'queue'],
])('task text an MCP client sent with %s %s is not the user words', async (name, mode) => {
  seedIndex(RULE);
  const key = await mcpKey();
  const task = await startedTask();
  if (mode !== 'queue') task.finishSteps();
  await tick();
  await viaMcp(
    key,
    name,
    name === 'message_todo'
      ? { todoId: task.todoId, content: 'AGENT AUTHORED' }
      : { threadId: task.todoId, content: 'AGENT AUTHORED', mode },
  );
  if (mode === 'queue') {
    await tick();
    task.finishSteps();
    await drainTaskMessageQueue({ ...H.s.svc, steerOptions: undefined }, task.buildId);
  }
  await tick();
  expect(
    H.s.db.select().from(message).where(eq(message.content, 'AGENT AUTHORED')).all(),
  ).toHaveLength(1);
  workStep('s-mcp', Date.now(), task.buildId);
  expect(workerRepeat('s-mcp')).toMatchObject({
    correction: expect.stringContaining('not recorded'),
  });
  expect(rows()).toEqual([]);
});

test('Coordinator chat text an MCP client sent is not the user words', async () => {
  seedIndex(RULE);
  const key = await mcpKey();
  await viaMcp(key, 'reply_thread', { threadId: H.threadId, content: 'AGENT AUTHORED' });
  const sent = H.s.db
    .select()
    .from(chiefMessage)
    .where(eq(chiefMessage.threadId, H.threadId))
    .all()
    .find((row) => row.content === 'AGENT AUTHORED')!;
  const relayed = await turn('unused', null, [sent.id]);
  const written = await reportRepeat(relayed);
  expect(written.correction).toContain('not recorded');
  expect(rows()).toEqual([]);
});

test('a steer a runner fetched but never acknowledged records no correction words', async () => {
  seedIndex(RULE);
  const running = await turn('How is the release going?');
  H.s.db.update(step).set({ machineId: 'runner-1' }).where(eq(step.id, running.stepId)).run();
  const waitingId = steerAtRunningTurn();
  expect(takeChiefSteer(H.s.db, H.threadId)).toEqual([waitingId]);
  const written = await reportRepeat(running);
  expect(written.correction).toContain('not recorded');
  expect(rows()).toEqual([]);
});

test('a resumed Antigravity turn does not claim the index was attached', async () => {
  seedIndex(RULE);
  await tick();
  workStep('s-before', Date.now());
  await tick();
  finishStep('s-before', 'done');
  await tick();
  said('user', Date.now());
  workStep('s-resumed', Date.now());
  H.s.db
    .update(step)
    .set({ antigravitySubscriptionId: 'sub-1' })
    .where(eq(step.id, 's-resumed'))
    .run();
  workerRepeat('s-resumed');
  expect(rows()).toMatchObject([{ pointedRule: RULE, inTurnIndex: null }]);
});

test('deleting a task removes the evidence copied from its messages', async () => {
  seedIndex(RULE);
  const created = await req(H.s.app, 'POST', `/api/projects/${H.projectId}/todos`, {
    title: 'task',
    spec: 'Add a section.',
  });
  const { id } = (await created.json()) as { id: string };
  await req(H.s.app, 'POST', `/api/projects/${H.projectId}/builds`, { todoIds: [id] });
  const { id: buildId } = H.s.db.select().from(build).where(eq(build.todoId, id)).get()!;
  await tick();
  const now = Date.now();
  said('user', now, buildId);
  workStep('s-next', now + 1, buildId);
  workerRepeat('s-next');
  expect(rows()).toHaveLength(1);
  const res = await req(H.s.app, 'DELETE', `/api/todos/${id}`);
  expect(res.status).toBeLessThan(300);
  expect(rows()).toEqual([]);
});

test('words sent to a stopped task are the ones kept, never an earlier message', async () => {
  seedIndex(RULE);
  const created = await req(H.s.app, 'POST', `/api/projects/${H.projectId}/todos`, {
    title: 'task',
    spec: 'Add a section.',
  });
  const { id } = (await created.json()) as { id: string };
  await req(H.s.app, 'POST', `/api/projects/${H.projectId}/builds`, { todoIds: [id] });
  const first = H.s.db.select().from(build).where(eq(build.todoId, id)).get()!;
  await tick();
  said('user', Date.now(), first.id);
  H.s.db.update(step).set({ status: 'stopped' }).where(eq(step.buildId, first.id)).run();
  H.s.db.update(todo).set({ phase: 'stopped' }).where(eq(todo.id, id)).run();
  await tick();
  const sent = await req(H.s.app, 'POST', `/api/todos/${id}/messages`, {
    content: 'NEW CORRECTION: use metric units.',
    clientMessageId: 'stopped-1',
  });
  const { conversationId, delivered } = (await sent.json()) as {
    conversationId: string;
    delivered: string;
  };
  expect(delivered).toBe('restart');
  expect(conversationId).not.toBe(first.id);
  await tick();
  const restarted = claimOnRunner(conversationId);
  workerRepeat(restarted);
  expect(rows()).toMatchObject([{ ownerWords: 'NEW CORRECTION: use metric units.' }]);
});

test('a first Antigravity step claimed again does not claim the index was attached', async () => {
  seedIndex(RULE);
  await tick();
  said('user', Date.now());
  workStep('s-parked', Date.now());
  H.s.db
    .update(step)
    .set({ antigravitySubscriptionId: 'sub-1', sessionId: 'ag-session-1' })
    .where(eq(step.id, 's-parked'))
    .run();
  workerRepeat('s-parked');
  expect(rows()).toMatchObject([{ pointedRule: RULE, inTurnIndex: null }]);
});

test('a steer still undelivered when the turn reruns records no correction words', async () => {
  seedIndex(RULE);
  const running = await turn('How is the release going?');
  H.s.db.update(step).set({ machineId: 'runner-1' }).where(eq(step.id, running.stepId)).run();
  const waitingId = steerAtRunningTurn();
  expect(takeChiefSteer(H.s.db, H.threadId)).toEqual([waitingId]);
  const claimed = H.s.db.select().from(step).where(eq(step.id, running.stepId)).get()!;
  releaseUnconsumedSteer(H.s.db, claimed);
  const written = await reportRepeat(running);
  expect(written.correction).toContain('not recorded');
  expect(rows()).toEqual([]);
});

test('a queued message the user typed stays theirs when an MCP interrupt sends it', async () => {
  seedIndex(RULE);
  const key = await mcpKey();
  const task = await startedTask();
  H.s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, task.todoId)).run();
  await tick();
  const queued = await req(H.s.app, 'POST', `/api/conversations/${task.buildId}/messages`, {
    content: 'USER TYPED: conclusion first!',
    mode: 'queue',
    deliverAfterStop: true,
  });
  expect(queued.status, await queued.clone().text()).toBe(201);
  await viaMcp(key, 'interrupt_thread', { threadId: task.todoId });
  await tick();
  expect(
    H.s.db.select().from(message).where(eq(message.conversationId, task.buildId)).all(),
  ).toMatchObject([{ content: 'USER TYPED: conclusion first!', sentByAgent: false }]);
  workStep('s-after-interrupt', Date.now(), task.buildId);
  workerRepeat('s-after-interrupt');
  expect(rows()).toMatchObject([{ ownerWords: 'USER TYPED: conclusion first!' }]);
});

test.each([true, false])(
  'an answer an MCP client gave to a Coordinator question is not the user words, parked %s',
  async (parked) => {
    seedIndex(RULE);
    const key = await mcpKey();
    const asking = await turn(null);
    writeQuestion(
      H.s.db,
      H.threadId,
      'ask-0000000009',
      {
        kind: ASK_USER_QUESTION_KIND,
        requestId: 'ask-0000000009',
        status: 'pending',
        questions: [{ header: 'Next', question: 'Shall I go on?', options: [] }],
        answers: null,
        ...(parked ? { parkedAt: Date.now() } : {}),
      },
      Date.now(),
    );
    if (parked) asking.done();
    await viaMcp(key, 'reply_thread', {
      threadId: H.threadId,
      requestId: 'ask-0000000009',
      answers: [{ header: 'Next', text: 'AGENT AUTHORED' }],
    });
    const current = parked ? await turn(null, null, ['ask-0000000009']) : asking;
    const written = await reportRepeat(current);
    expect(written.correction).toContain('not recorded');
    expect(rows()).toEqual([]);
  },
);

test.each(['runner', 'server'])(
  'a Coordinator steer delivered by the %s records no correction words',
  async (carrier) => {
    const messageId = seedOwnerMessage(H.s.db, H.threadId, 'Conclusion first!');
    const waitingId = enqueueChiefStep(H.s.svc, H.threadId, {
      id: messageId,
      prompt: 'Conclusion first!',
      ownerMessageIds: [messageId],
      trigger: 'user',
    });
    await tick();
    seedIndex(RULE);
    await tick();
    const running = await turn(null);
    if (carrier === 'runner')
      H.s.db.update(step).set({ machineId: 'runner-1' }).where(eq(step.id, running.stepId)).run();
    expect(steerChiefMessage(H.s.svc, H.teamId, H.threadId, messageId)).toEqual({ steered: true });
    if (carrier === 'runner') {
      expect(takeChiefSteer(H.s.db, H.threadId)).toEqual([waitingId]);
      const claimed = H.s.db.select().from(step).where(eq(step.id, running.stepId)).get()!;
      ackChiefSteer(toolDeps(), H.teamId, claimed, [waitingId]);
    } else {
      H.s.db
        .insert(coordinatorConversation)
        .values({
          threadId: H.threadId,
          conversationId: 'c1',
          piVersion: '1',
          updatedAt: Date.now(),
        })
        .run();
      expect(pullCoordinatorInput(H.s.db, running.stepId, 'c1')?.id).toBe(waitingId);
      consumeCoordinatorInput(H.s.db, waitingId, 'c1', '1', Date.now());
    }
    const written = await reportRepeat(running);
    expect(written.correction).toContain('not recorded');
    expect(rows()).toEqual([]);
  },
);

async function missedSteer(carrier: 'runner' | 'server') {
  seedIndex(RULE);
  const running = await turn('REQUEST: draft the notes.');
  const messageId = seedOwnerMessage(H.s.db, H.threadId, 'MISSED: what time is it?');
  enqueueChiefStep(H.s.svc, H.threadId, {
    id: messageId,
    prompt: 'MISSED: what time is it?',
    ownerMessageIds: [messageId],
    trigger: 'user',
  });
  const producer = () => H.s.db.select().from(step).where(eq(step.id, running.stepId)).get()!;
  if (carrier === 'runner')
    H.s.db.update(step).set({ machineId: 'runner-1' }).where(eq(step.id, running.stepId)).run();
  steerChiefMessage(H.s.svc, H.teamId, H.threadId, messageId);
  if (carrier === 'runner') {
    takeChiefSteer(H.s.db, H.threadId);
    releaseUnconsumedSteer(H.s.db, producer());
  } else {
    H.s.db
      .insert(coordinatorConversation)
      .values({ threadId: H.threadId, conversationId: 'c1', piVersion: '1', updatedAt: Date.now() })
      .run();
    const input = pullCoordinatorInput(H.s.db, running.stepId, 'c1')!;
    releaseCoordinatorInput(H.s.db, input.id, 'c1');
  }
  running.done();
  return { running, messageId, askedFor: [running.messageId!, messageId] };
}

function claimNow(stepId: string) {
  H.s.db
    .update(step)
    .set({ status: 'claimed', claimedAt: Date.now() })
    .where(eq(step.id, stepId))
    .run();
}

test('a turn whose askedFor carries an unconsumed steer records no correction words', async () => {
  const missed = await missedSteer('runner');
  claimNow(missed.messageId);
  H.s.db.update(step).set({ status: 'done' }).where(eq(step.id, missed.messageId)).run();
  const answerId = seedOwnerMessage(H.s.db, H.threadId, 'ANSWER: conclusion first.');
  const resumed = await turn('go on', null, [...missed.askedFor, answerId]);
  const written = await reportRepeat(resumed);
  expect(written.correction).toContain('not recorded');
  expect(rows()).toEqual([]);
});

test.each(['runner', 'server'] as const)(
  'a steer the %s missed records no correction words in the turn that then runs it',
  async (carrier) => {
    await missedSteer(carrier);
    const own = H.s.db
      .select()
      .from(step)
      .where(and(eq(step.buildId, H.threadId), eq(step.status, 'pending')))
      .get()!;
    claimNow(own.id);
    const written = executeMemoryToolForStep(H.s.db, teamOwner(), own.id, 'save_memory', {
      scope: 'team',
      file: 'note.md',
      content: 'A note.',
      correction: true,
    }) as Written;
    expect(written.correction).toContain('not recorded');
    expect(rows()).toEqual([]);
  },
);

test('missed Coordinator interjections folded into one later turn record no correction words', async () => {
  seedIndex(RULE);
  const running = await turn('REQUEST: draft the notes.');
  H.s.db.update(step).set({ machineId: 'runner-1' }).where(eq(step.id, running.stepId)).run();
  for (const text of ['FIRST: how long will it take?', 'SECOND: conclusion first!']) {
    const messageId = seedOwnerMessage(H.s.db, H.threadId, text);
    enqueueChiefStep(H.s.svc, H.threadId, {
      id: messageId,
      prompt: text,
      ownerMessageIds: [messageId],
      trigger: 'user',
    });
    steerChiefMessage(H.s.svc, H.teamId, H.threadId, messageId);
    await tick();
  }
  const producer = H.s.db.select().from(step).where(eq(step.id, running.stepId)).get()!;
  releaseUnconsumedSteer(H.s.db, producer);
  running.done();
  const head = H.s.db
    .select()
    .from(step)
    .where(and(eq(step.buildId, H.threadId), eq(step.status, 'pending')))
    .orderBy(step.createdAt)
    .get()!;
  const claimed = claimPendingChiefStep(H.s.db, head, { machineId: 'runner-1' })!;
  expect(claimed.ownerMessageIds).toHaveLength(2);
  const written = executeMemoryToolForStep(H.s.db, teamOwner(), claimed.id, 'save_memory', {
    scope: 'team',
    file: 'note.md',
    content: 'A note.',
    correction: true,
  }) as Written;
  expect(written.correction).toContain('not recorded');
  expect(rows()).toEqual([]);
});

test('rewinding to a steered message keeps its words as the evidence', async () => {
  seedIndex(RULE);
  const running = await turn('REQUEST: draft the notes.');
  const messageId = seedOwnerMessage(H.s.db, H.threadId, 'ANCHOR: conclusion first.');
  const waitingId = enqueueChiefStep(H.s.svc, H.threadId, {
    id: messageId,
    prompt: 'ANCHOR: conclusion first.',
    ownerMessageIds: [messageId],
    trigger: 'user',
  });
  H.s.db.update(step).set({ machineId: 'runner-1' }).where(eq(step.id, running.stepId)).run();
  steerChiefMessage(H.s.svc, H.teamId, H.threadId, messageId);
  takeChiefSteer(H.s.db, H.threadId);
  await tick();
  const producer = H.s.db.select().from(step).where(eq(step.id, running.stepId)).get()!;
  ackChiefSteer(toolDeps(), H.teamId, producer, [waitingId]);
  running.done();
  H.s.db.update(chiefThread).set({ activeRun: null }).where(eq(chiefThread.id, H.threadId)).run();
  await tick();
  rewindChiefThread(H.s.svc, H.teamId, H.threadId, { messageId });
  const again = H.s.db
    .select()
    .from(step)
    .where(and(eq(step.buildId, H.threadId), eq(step.status, 'pending')))
    .get()!;
  claimNow(again.id);
  executeMemoryToolForStep(H.s.db, teamOwner(), again.id, 'save_memory', {
    scope: 'team',
    file: 'note.md',
    content: 'A note.',
    correction: true,
  });
  expect(rows()).toMatchObject([{ ownerWords: 'ANCHOR: conclusion first.' }]);
});

test('an acknowledgement arriving after the turn was claimed again counts nothing', async () => {
  seedIndex(RULE);
  const task = await startedTask();
  const stepId = claimOnRunner(task.buildId);
  await steerTask(task.buildId, 'OLD-CLAIM: never read by the second claim.');
  const fetched = fetchSteer(toolDeps(), runner(), stepId);
  await tick();
  claimOnRunner(task.buildId);
  ackSteer(toolDeps(), runner(), stepId, { steerSentAt: fetched.steerSentAt });
  workerRepeat(stepId);
  expect(rows()).toEqual([]);
});

test('a task steer records no correction words even after the runner acknowledges it', async () => {
  seedIndex(RULE);
  const task = await startedTask();
  const stepId = claimOnRunner(task.buildId);
  await tick();
  const sent = await req(H.s.app, 'POST', `/api/conversations/${task.buildId}/messages`, {
    content: 'STEERED: conclusion first.',
  });
  expect(sent.status, await sent.clone().text()).toBe(201);
  const machine = { id: 'runner-1', teamId: H.teamId };
  const fetched = fetchSteer(toolDeps(), machine, stepId);
  expect(fetched.content).toBe('STEERED: conclusion first.');
  ackSteer(toolDeps(), machine, stepId, { steerSentAt: fetched.steerSentAt });
  const written = workerRepeat(stepId) as Written;
  expect(written.correction).toContain('not recorded');
  expect(rows()).toEqual([]);
});

async function steerTask(buildId: string, content: string) {
  await tick();
  const sent = await req(H.s.app, 'POST', `/api/conversations/${buildId}/messages`, { content });
  expect(sent.status, await sent.clone().text()).toBe(201);
  await tick();
}

const runner = () => ({ id: 'runner-1', teamId: H.teamId });

test('a task steer the runner dropped records no correction words even after a later one is acknowledged', async () => {
  seedIndex(RULE);
  const task = await startedTask();
  const stepId = claimOnRunner(task.buildId);
  await steerTask(task.buildId, 'DROPPED: never delivered.');
  fetchSteer(toolDeps(), runner(), stepId);
  await steerTask(task.buildId, 'DELIVERED: conclusion first.');
  const fetched = fetchSteer(toolDeps(), runner(), stepId);
  ackSteer(toolDeps(), runner(), stepId, { steerSentAt: fetched.steerSentAt });
  const written = workerRepeat(stepId) as Written;
  expect(written.correction).toContain('not recorded');
  expect(rows()).toEqual([]);
});

test('a late acknowledgement still leaves a steered task turn unrecorded', async () => {
  seedIndex(RULE);
  const task = await startedTask();
  const stepId = claimOnRunner(task.buildId);
  await steerTask(task.buildId, 'FIRST: delivered.');
  const first = fetchSteer(toolDeps(), runner(), stepId);
  await steerTask(task.buildId, 'SECOND: not read yet.');
  ackSteer(toolDeps(), runner(), stepId, { steerSentAt: first.steerSentAt });
  const written = workerRepeat(stepId) as Written;
  expect(written.correction).toContain('not recorded');
  expect(rows()).toEqual([]);
});

test('a task rerun after a fallback is not quoted the steer the failed attempt read', async () => {
  seedIndex(RULE);
  const task = await startedTask();
  const stepId = claimOnRunner(task.buildId);
  await steerTask(task.buildId, 'STEERED: conclusion first.');
  const fetched = fetchSteer(toolDeps(), runner(), stepId);
  ackSteer(toolDeps(), runner(), stepId, { steerSentAt: fetched.steerSentAt });
  const generation = H.s.db.select().from(step).where(eq(step.id, stepId)).get()!.claimedAt;
  await finishRunnerStep(toolDeps(), 'runner-1', stepId, {
    generation,
    status: 'success',
    noOutput: true,
    hasChanges: false,
    usage: [],
  } as unknown as MachineDoneBody);
  expect(H.s.db.select().from(step).where(eq(step.id, stepId)).get()).toMatchObject({
    status: 'pending',
  });
  claimOnRunner(task.buildId);
  workerRepeat(stepId);
  expect(rows()).toEqual([]);
});

test('a retry of a failed task is not quoted the steer the failed attempt read', async () => {
  seedIndex(RULE);
  const task = await startedTask();
  const stepId = claimOnRunner(task.buildId);
  await steerTask(task.buildId, 'STEERED: conclusion first.');
  const fetched = fetchSteer(toolDeps(), runner(), stepId);
  ackSteer(toolDeps(), runner(), stepId, { steerSentAt: fetched.steerSentAt });
  const generation = H.s.db.select().from(step).where(eq(step.id, stepId)).get()!.claimedAt;
  await finishRunnerStep(toolDeps(), 'runner-1', stepId, {
    generation,
    status: 'failed',
    error: 'read failed',
    sessionId: 'session-1',
    commit: 'abc1234abc1234abc1234abc1234abc1234abc1',
    hasChanges: false,
    usage: [],
  } as unknown as MachineDoneBody);
  const retried = await req(H.s.app, 'POST', `/api/builds/${task.buildId}/retry-now`, {});
  expect(retried.status, await retried.clone().text()).toBe(202);
  const retry = H.s.db
    .select()
    .from(step)
    .where(and(eq(step.buildId, task.buildId), eq(step.status, 'pending')))
    .get()!;
  expect(retry.id).not.toBe(stepId);
  H.s.db
    .update(step)
    .set({ status: 'claimed', claimedAt: Date.now(), machineId: 'runner-1' })
    .where(eq(step.id, retry.id))
    .run();
  workerRepeat(retry.id);
  expect(rows()).toEqual([]);
});

test('a task steer replaced by another notice is not quoted when the notice is acknowledged', async () => {
  seedIndex(RULE);
  const task = await startedTask();
  const stepId = claimOnRunner(task.buildId);
  await steerTask(task.buildId, 'REPLACED: never delivered.');
  fetchSteer(toolDeps(), runner(), stepId);
  H.s.db
    .update(steerPending)
    .set({ content: 'CI failed.', sentAt: null, createdAt: Date.now() })
    .where(eq(steerPending.conversationId, task.buildId))
    .run();
  await tick();
  const notice = fetchSteer(toolDeps(), runner(), stepId);
  expect(notice.content).toBe('CI failed.');
  ackSteer(toolDeps(), runner(), stepId, { steerSentAt: notice.steerSentAt });
  workerRepeat(stepId);
  expect(rows()).toEqual([]);
});

test('a task steer dropped by one attempt and delivered to the next records no correction words', async () => {
  seedIndex(RULE);
  const task = await startedTask();
  const stepId = claimOnRunner(task.buildId);
  await steerTask(task.buildId, 'REDELIVERED: conclusion first.');
  fetchSteer(toolDeps(), runner(), stepId);
  await tick();
  claimOnRunner(task.buildId);
  H.s.db
    .update(steerPending)
    .set({ sentAt: 1 })
    .where(eq(steerPending.conversationId, task.buildId))
    .run();
  const again = fetchSteer(toolDeps(), runner(), stepId);
  ackSteer(toolDeps(), runner(), stepId, { steerSentAt: again.steerSentAt });
  const written = workerRepeat(stepId) as Written;
  expect(written.correction).toContain('not recorded');
  expect(rows()).toEqual([]);
});

test('a Coordinator rerun after a fallback records no correction words when a steer entered the turn', async () => {
  seedIndex(RULE);
  const running = await turn('How is the release going?');
  const messageId = seedOwnerMessage(H.s.db, H.threadId, 'STEERED: conclusion first!');
  const waitingId = enqueueChiefStep(H.s.svc, H.threadId, {
    id: messageId,
    prompt: 'STEERED: conclusion first!',
    ownerMessageIds: [messageId],
    trigger: 'user',
  });
  H.s.db.update(step).set({ machineId: 'runner-1' }).where(eq(step.id, running.stepId)).run();
  steerChiefMessage(H.s.svc, H.teamId, H.threadId, messageId);
  takeChiefSteer(H.s.db, H.threadId);
  await tick();
  const claimed = () => H.s.db.select().from(step).where(eq(step.id, running.stepId)).get()!;
  ackChiefSteer(toolDeps(), H.teamId, claimed(), [waitingId]);
  await tick();
  H.s.db
    .update(step)
    .set({ status: 'claimed', sessionId: null, claimedAt: Date.now() })
    .where(eq(step.id, running.stepId))
    .run();
  const written = await reportRepeat(running);
  expect(written.correction).toContain('not recorded');
  expect(rows()).toEqual([]);
});

test('a quoted reply keeps only what the user typed', async () => {
  seedIndex(RULE);
  const quote = 'ASSISTANT WROTE THIS. '.repeat(80);
  const current = await turn(
    encodeReplyQuote({ sourceMessageId: 'm1', quote }, 'TYPED: conclusion first.'),
  );
  await reportRepeat(current);
  expect(rows()).toMatchObject([{ ownerWords: 'TYPED: conclusion first.' }]);
});

test.each([
  ['the task page message box', 'done', 'conversation'],
  ['a task reply from the Coordinator chat', 'done', 'thread'],
  ['plan revision feedback', 'confirm', 'revision'],
  ['review rejection feedback', 'review', 'revision'],
])('words the user sent through %s are kept', async (_label, phase, route) => {
  seedIndex(RULE);
  const task = await startedTask();
  task.finishSteps();
  H.s.db
    .update(todo)
    .set({ phase: phase as 'done' })
    .where(eq(todo.id, task.todoId))
    .run();
  await tick();
  const words = 'TYPED: conclusion first.';
  const res =
    route === 'conversation'
      ? await req(H.s.app, 'POST', `/api/conversations/${task.buildId}/messages`, {
          content: words,
        })
      : route === 'thread'
        ? await req(H.s.app, 'POST', `/api/todos/${task.todoId}/messages`, {
            content: words,
            clientMessageId: 'typed-1',
          })
        : await req(H.s.app, 'POST', `/api/builds/${task.buildId}/steps`, {
            action: 'revision',
            side: 'plan',
            feedback: words,
            clientMessageId: 'typed-1',
          });
  expect(res.status, await res.clone().text()).toBeLessThan(300);
  await tick();
  workStep('s-typed', Date.now(), task.buildId);
  workerRepeat('s-typed');
  expect(rows()).toMatchObject([{ ownerWords: words }]);
});

test('an answer the user typed to a worker question records no correction words', async () => {
  seedIndex(RULE);
  const task = await startedTask();
  const stepId = claimOnRunner(task.buildId);
  writeWorkerQuestion(
    { db: H.s.db },
    task.buildId,
    'ask-0000000010',
    {
      kind: ASK_USER_QUESTION_KIND,
      requestId: 'ask-0000000010',
      status: 'pending',
      questions: [{ header: 'Unit', question: 'Which unit?', options: [] }],
      answers: null,
    },
    Date.now(),
  );
  await tick();
  const res = await req(H.s.app, 'POST', `/api/conversations/${task.buildId}/messages`, {
    content: 'ANSWERED: metric, as I said.',
  });
  expect(res.status, await res.clone().text()).toBe(201);
  const written = workerRepeat(stepId) as Written;
  expect(written.correction).toContain('not recorded');
  expect(rows()).toEqual([]);
});

test('what the Coordinator sends a task is not the user words', async () => {
  seedIndex(RULE);
  const task = await startedTask();
  task.finishSteps();
  await tick();
  await relay('message_thread', { todoId: task.todoId, content: 'COORDINATOR AUTHORED' });
  await tick();
  expect(
    H.s.db.select().from(message).where(eq(message.content, 'COORDINATOR AUTHORED')).all(),
  ).toHaveLength(1);
  workStep('s-relayed', Date.now(), task.buildId);
  expect(workerRepeat('s-relayed')).toMatchObject({
    correction: expect.stringContaining('not recorded'),
  });
  expect(rows()).toEqual([]);
});

test('words typed into the Coordinator composer are kept', async () => {
  const res = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/chief/threads`, {
    content: 'COMPOSER: conclusion first.',
    clientMessageId: 'composer-1',
  });
  expect(res.status, await res.clone().text()).toBe(201);
  const { thread } = (await res.json()) as { thread: { id: string } };
  workerRepeatOnChiefThread(thread.id);
  expect(rows()).toMatchObject([{ ownerWords: 'COMPOSER: conclusion first.' }]);
});

test('waiting Coordinator messages folded into one turn are all quoted', async () => {
  const queue = (content: string) => {
    const messageId = seedOwnerMessage(H.s.db, H.threadId, content);
    return enqueueChiefStep(H.s.svc, H.threadId, {
      prompt: content,
      ownerMessageIds: [messageId],
      trigger: 'user',
    });
  };
  const head = queue('FIRST: conclusion first.');
  await tick();
  queue('SECOND: and keep it short.');
  const waiting = H.s.db.select().from(step).where(eq(step.id, head)).get()!;
  expect(claimPendingChiefStep(H.s.db, waiting, { machineId: 'runner-1' })).not.toBeNull();
  workerRepeatOnChiefThread(H.threadId);
  expect(rows()).toMatchObject([
    { ownerWords: 'SECOND: and keep it short.\nFIRST: conclusion first.' },
  ]);
});

test('the instruction Cairn writes when the user presses orchestrate is not their words', async () => {
  const task = await req(H.s.app, 'POST', `/api/projects/${H.projectId}/todos`, {
    title: 'task',
    spec: 'Add a section.',
  });
  const { id } = (await task.json()) as { id: string };
  const res = await req(H.s.app, 'POST', `/api/todos/${id}/orchestrate`);
  expect(res.status, await res.clone().text()).toBeLessThan(300);
  const turnRow = H.s.db.select().from(step).where(eq(step.kind, 'chief')).get()!;
  expect(workerRepeatOnChiefThread(turnRow.buildId)).toMatchObject({
    correction: expect.stringContaining('not recorded'),
  });
  expect(rows()).toEqual([]);
});

test.each([null, true])(
  'a queued task message that moves to a new thread keeps its author, agent %s',
  async (agent) => {
    seedIndex(RULE);
    const task = await startedTask();
    task.finishSteps();
    H.s.db
      .update(project)
      .set({ repoKind: 'local', localPath: '/tmp/continue-local', autonomy: {} })
      .where(eq(project.id, H.projectId))
      .run();
    H.s.db
      .insert(autonomousMergeAdmission)
      .values({
        buildId: task.buildId,
        teamId: H.teamId,
        state: 'merged',
        createdAt: 1,
        landedAt: 2,
      })
      .run();
    H.s.db
      .insert(queuedMessage)
      .values({
        id: 'queued-moving',
        conversationId: task.buildId,
        content: 'MOVED: conclusion first.',
        deliverAfterStop: false,
        createdAt: Date.now(),
        sentByAgent: agent,
      })
      .run();
    await tick();
    const res = await req(H.s.app, 'POST', `/api/conversations/${task.buildId}/messages`, {
      content: 'Continue after landing',
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const nextBuild = H.s.db.select().from(todo).where(eq(todo.id, task.todoId)).get()!
      .latestBuildId!;
    expect(nextBuild).not.toBe(task.buildId);
    const claimed = claimOnRunner(nextBuild);
    H.s.db
      .update(step)
      .set({ status: 'done', finishedAt: Date.now() })
      .where(eq(step.id, claimed))
      .run();
    H.s.db.update(todo).set({ phase: 'done' }).where(eq(todo.id, task.todoId)).run();
    await tick();
    await deliverQueuedMessage(
      { ...H.s.svc, steerOptions: undefined },
      nextBuild,
      'queued-moving',
      true,
    );
    await tick();
    workStep('s-moved', Date.now(), nextBuild);
    workerRepeat('s-moved');
    expect(rows().map((row) => row.ownerWords)).toEqual(agent ? [] : ['MOVED: conclusion first.']);
  },
);

test('a rerun of the thread a stopped task restarted keeps the words that restarted it', async () => {
  seedIndex(RULE);
  const task = await startedTask();
  H.s.db.update(step).set({ status: 'stopped' }).where(eq(step.buildId, task.buildId)).run();
  H.s.db.update(todo).set({ phase: 'stopped' }).where(eq(todo.id, task.todoId)).run();
  await tick();
  const restarted = await req(H.s.app, 'POST', `/api/todos/${task.todoId}/messages`, {
    content: 'RESTART: use metric units.',
    clientMessageId: 'restart-1',
  });
  expect(restarted.status, await restarted.clone().text()).toBeLessThan(300);
  const buildId = H.s.db.select().from(todo).where(eq(todo.id, task.todoId)).get()!.latestBuildId!;
  const first = claimOnRunner(buildId);
  H.s.db
    .update(step)
    .set({ status: 'failed', finishedAt: Date.now() })
    .where(eq(step.id, first))
    .run();
  await tick();
  workStep('s-rerun', Date.now(), buildId);
  workerRepeat('s-rerun');
  expect(rows()).toMatchObject([{ ownerWords: 'RESTART: use metric units.' }]);
});

test('words that started a thread are not quoted again after a turn of it succeeded', async () => {
  seedIndex(RULE);
  const task = await startedTask();
  H.s.db
    .update(step)
    .set({ ownerSaid: 'ALREADY ANSWERED', status: 'done', finishedAt: Date.now() })
    .where(eq(step.buildId, task.buildId))
    .run();
  await tick();
  workStep('s-later', Date.now(), task.buildId);
  expect(workerRepeat('s-later')).toMatchObject({
    correction: expect.stringContaining('not recorded'),
  });
});

test('a clean Coordinator turn after an earlier steered turn still records correction words', async () => {
  seedIndex(RULE);
  const running = await turn('First request.');
  H.s.db.update(step).set({ machineId: 'runner-1' }).where(eq(step.id, running.stepId)).run();
  const waitingId = steerAtRunningTurn();
  takeChiefSteer(H.s.db, H.threadId);
  const claimed = H.s.db.select().from(step).where(eq(step.id, running.stepId)).get()!;
  ackChiefSteer(toolDeps(), H.teamId, claimed, [waitingId]);
  running.done();
  await tick();
  const clean = await turn('CLEAN: conclusion first!');
  const written = await reportRepeat(clean);
  expect(written.correction).toBeUndefined();
  expect(rows()).toMatchObject([{ ownerWords: 'CLEAN: conclusion first!' }]);
});

test('a clean Coordinator turn typing the same text as an earlier answered question still records', async () => {
  seedIndex(RULE);
  const asking = await turn('Write the summary.');
  const repeatedText = 'The conclusion, as I keep saying.';
  writeQuestion(
    H.s.db,
    H.threadId,
    'ask-0000000011',
    {
      kind: ASK_USER_QUESTION_KIND,
      requestId: 'ask-0000000011',
      status: 'pending',
      questions: [{ header: 'Order', question: 'What comes first?', options: [] }],
      answers: null,
    },
    Date.now(),
  );
  answerChiefQuestion(H.s.svc, H.teamId, {
    threadId: H.threadId,
    requestId: 'ask-0000000011',
    answers: [{ header: 'Order', text: repeatedText }],
  });
  asking.done();
  await tick();
  const clean = await turn(repeatedText);
  const written = await reportRepeat(clean);
  expect(written.correction).toBeUndefined();
  expect(rows()).toMatchObject([{ ownerWords: repeatedText }]);
});

test('a parked plain Coordinator question answered from composer records no correction words', async () => {
  seedIndex(RULE);
  const asking = await turn('Write the summary.');
  writeQuestion(
    H.s.db,
    H.threadId,
    'ask-0000000012',
    {
      kind: ASK_USER_QUESTION_KIND,
      requestId: 'ask-0000000012',
      status: 'pending',
      questions: [{ header: 'Order', question: 'What comes first?', options: [] }],
      answers: null,
      parkedAt: Date.now(),
    },
    Date.now(),
  );
  asking.done();
  await tick();
  sendChiefMessageFromComposer(H.s.svc, H.teamId, {
    threadId: H.threadId,
    content: 'The conclusion, as I keep saying.',
    clientMessageId: 'plain-parked-1',
  });
  const written = workerRepeatOnChiefThread(H.threadId) as Written;
  expect(written.correction).toContain('not recorded');
  expect(rows()).toEqual([]);
});

test('a predefined Coordinator question option tap still records correction words', async () => {
  seedIndex(RULE);
  const asking = await turn(null);
  writeQuestion(
    H.s.db,
    H.threadId,
    'ask-0000000013',
    {
      kind: ASK_USER_QUESTION_KIND,
      requestId: 'ask-0000000013',
      status: 'pending',
      questions: [
        {
          header: 'Order',
          question: 'What comes first?',
          options: [{ label: 'Conclusion first' }, { label: 'Background first' }],
        },
      ],
      answers: null,
    },
    Date.now(),
  );
  answerChiefQuestion(H.s.svc, H.teamId, {
    threadId: H.threadId,
    requestId: 'ask-0000000013',
    answers: [{ header: 'Order', choices: ['Conclusion first'] }],
  });
  const written = await reportRepeat(asking);
  expect(written.correction).toBeUndefined();
  expect(rows()).toMatchObject([{ ownerWords: 'Conclusion first' }]);
});

test('a custom choice typed on a Coordinator question card records no correction words', async () => {
  seedIndex(RULE);
  const asking = await turn(null);
  writeQuestion(
    H.s.db,
    H.threadId,
    'ask-0000000014',
    {
      kind: ASK_USER_QUESTION_KIND,
      requestId: 'ask-0000000014',
      status: 'pending',
      questions: [
        {
          header: 'Order',
          question: 'What comes first?',
          options: [{ label: 'Conclusion first' }, { label: 'Background first' }],
        },
      ],
      answers: null,
    },
    Date.now(),
  );
  answerChiefQuestion(H.s.svc, H.teamId, {
    threadId: H.threadId,
    requestId: 'ask-0000000014',
    answers: [{ header: 'Order', choices: ['Always bullet points first'] }],
  });
  const written = await reportRepeat(asking);
  expect(written.correction).toContain('not recorded');
  expect(rows()).toEqual([]);
});

test.each([false, true])(
  'a typed answer via answerTaskQuestion records no correction words, parked %s',
  async (parked) => {
    seedIndex(RULE);
    const task = await startedTask();
    const stepId = claimOnRunner(task.buildId);
    await tick();
    said('user', Date.now(), task.buildId, 'Initial request.');
    writeWorkerQuestion(
      { db: H.s.db },
      task.buildId,
      'ask-worker-1',
      {
        kind: ASK_USER_QUESTION_KIND,
        requestId: 'ask-worker-1',
        status: 'pending',
        questions: [{ header: 'Unit', question: 'Which unit?', options: [] }],
        answers: null,
        ...(parked ? { parkedAt: Date.now() } : {}),
      },
      Date.now(),
    );
    if (parked) {
      finishStep(stepId, 'done');
      H.s.db.update(todo).set({ phase: 'needs_input' }).where(eq(todo.id, task.todoId)).run();
    }
    await tick();
    const answered = await answerTaskQuestion(
      { ...H.s.svc, steerOptions: undefined },
      H.teamId,
      { todoId: task.todoId, requestId: 'ask-worker-1', answer: 'TYPED: metric, as I said.' },
      'person',
    );
    expect(answered.delivered).toBe(parked ? 'new-turn' : 'held-step');
    const targetStep = parked ? claimOnRunner(task.buildId) : stepId;
    const written = workerRepeat(targetStep) as Written;
    expect(written.correction).toContain('not recorded');
    expect(rows()).toEqual([]);
  },
);

test('a clean worker turn after an earlier steered turn still records correction words', async () => {
  seedIndex(RULE);
  const task = await startedTask();
  const firstStep = claimOnRunner(task.buildId);
  await steerTask(task.buildId, 'STEERED: hurry up.');
  finishStep(firstStep, 'done');
  H.s.db.update(todo).set({ phase: 'done' }).where(eq(todo.id, task.todoId)).run();
  await tick();
  const clean = await req(H.s.app, 'POST', `/api/conversations/${task.buildId}/messages`, {
    content: 'CLEAN WORKER: conclusion first.',
  });
  expect(clean.status, await clean.clone().text()).toBe(201);
  await tick();
  const secondStep = H.s.db
    .select()
    .from(step)
    .where(and(eq(step.buildId, task.buildId), eq(step.status, 'pending')))
    .get()!.id;
  H.s.db
    .update(step)
    .set({ status: 'claimed', claimedAt: Date.now() })
    .where(eq(step.id, secondStep))
    .run();
  const written = workerRepeat(secondStep) as Written;
  expect(written.correction).toBeUndefined();
  expect(rows()).toMatchObject([{ ownerWords: 'CLEAN WORKER: conclusion first.' }]);
});

test('a worker steer before a step is claimed again still records no correction words', async () => {
  seedIndex(RULE);
  const task = await startedTask();
  const stepId = claimOnRunner(task.buildId);
  await steerTask(task.buildId, 'STEERED BEFORE RECLAIM');
  await tick();
  H.s.db
    .update(step)
    .set({ status: 'claimed', claimedAt: Date.now() })
    .where(eq(step.id, stepId))
    .run();
  const written = workerRepeat(stepId) as Written;
  expect(written.correction).toContain('not recorded');
  expect(rows()).toEqual([]);
});

test('a clean worker turn after an earlier typed-answer turn still records correction words', async () => {
  seedIndex(RULE);
  const task = await startedTask();
  const firstStep = claimOnRunner(task.buildId);
  writeWorkerQuestion(
    { db: H.s.db },
    task.buildId,
    'ask-worker-2',
    {
      kind: ASK_USER_QUESTION_KIND,
      requestId: 'ask-worker-2',
      status: 'pending',
      questions: [{ header: 'Unit', question: 'Which unit?', options: [] }],
      answers: null,
    },
    Date.now(),
  );
  await answerTaskQuestion(
    { ...H.s.svc, steerOptions: undefined },
    H.teamId,
    { todoId: task.todoId, requestId: 'ask-worker-2', answer: 'metric' },
    'person',
  );
  finishStep(firstStep, 'done');
  H.s.db.update(todo).set({ phase: 'done' }).where(eq(todo.id, task.todoId)).run();
  await tick();
  const clean = await req(H.s.app, 'POST', `/api/conversations/${task.buildId}/messages`, {
    content: 'CLEAN WORKER AFTER ANSWER: conclusion first.',
  });
  expect(clean.status, await clean.clone().text()).toBe(201);
  await tick();
  const secondStep = H.s.db
    .select()
    .from(step)
    .where(and(eq(step.buildId, task.buildId), eq(step.status, 'pending')))
    .get()!.id;
  H.s.db
    .update(step)
    .set({ status: 'claimed', claimedAt: Date.now() })
    .where(eq(step.id, secondStep))
    .run();
  const written = workerRepeat(secondStep) as Written;
  expect(written.correction).toBeUndefined();
  expect(rows()).toMatchObject([{ ownerWords: 'CLEAN WORKER AFTER ANSWER: conclusion first.' }]);
});
