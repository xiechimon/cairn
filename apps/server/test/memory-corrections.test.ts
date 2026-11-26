import {
  ASK_USER_QUESTION_KIND,
  type MemoryCorrectionsResponse,
  memoryCorrectionsResponseSchema,
  type TranscriptUserOrigin,
} from '@cairn/shared';
import { eq, sql } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  agentMemory,
  build,
  chiefThread,
  coordinatorConversation,
  memoryCorrection,
  message,
  step,
  todo,
} from '../src/db/schema.js';
import {
  answerChiefQuestion,
  COORDINATOR_SYSTEM_PROMPT,
  enqueueChiefStep,
  rewindChiefThread,
} from '../src/services/chief.js';
import { writeQuestion } from '../src/services/chief-question-store.js';
import type { ChiefToolCtx } from '../src/services/chief-tools.js';
import { ackChiefSteer, steerChiefMessage, takeChiefSteer } from '../src/services/chief-turns.js';
import {
  consumeCoordinatorInput,
  pullCoordinatorInput,
} from '../src/services/coordinator-inputs.js';
import { chiefTurnContext } from '../src/services/coordinator-steps.js';
import { designCommentRelay } from '../src/services/design-comments.js';
import { injectMemoryDocuments, memoryDocumentVersion } from '../src/services/memory.js';
import { executeMemoryToolForStep } from '../src/services/memory-corrections.js';
import { executeMemoryDocumentTool } from '../src/services/memory-documents.js';
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
  expect(written.correction).toContain('no user message');
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
  expect(saved.correction).toContain('no user message');
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

test('a correction given as the answer to a question is recorded with the answer', async () => {
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
  await reportRepeat(current);
  expect(rows()).toMatchObject([
    {
      ownerMessageId: current.messageId,
      ownerWords: 'The conclusion, as I keep saying.\nWrite the summary.',
    },
  ]);
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
  answer('ask-0000000003', 'SECRET-ANSWER conclusion first');
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
  await reportRepeat(running, RULE, H.projectId);
  expect(rows()).toMatchObject([{ inTurnIndex: false }]);
  const usage = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/chief/memory-usage`);
  expect(((await usage.json()) as { usage: { stepId: string } }).usage.stepId).toBe(running.stepId);
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
  await reportRepeat(running, RULE, H.projectId);
  expect(rows()).toMatchObject([{ inTurnIndex: true }]);
});

test('project memory a runner acknowledged is part of the turn index', async () => {
  seedIndex(RULE, H.projectId);
  const running = await turn('How is the release going?');
  H.s.db.update(step).set({ machineId: 'runner-1' }).where(eq(step.id, running.stepId)).run();
  const waitingId = steerAtRunningTurn();
  expect(takeChiefSteer(H.s.db, H.threadId)).toEqual([waitingId]);
  const row = H.s.db.select().from(step).where(eq(step.id, running.stepId)).get()!;
  ackChiefSteer(toolDeps(), H.teamId, row, [waitingId]);
  await reportRepeat(running, RULE, H.projectId);
  expect(rows()).toMatchObject([{ inTurnIndex: true }]);
});

test('design comments relayed through the chat are not stored as the user words', async () => {
  seedIndex(RULE);
  const correction = await turn(designCommentRelay('', '「AGENT WRITTEN HEADLINE」', 'task'));
  const written = await reportRepeat(correction);
  expect(written.correction).toContain('no user message');
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
    correction: expect.stringContaining('no user message'),
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

test('words sent to a stopped task are never replaced by an earlier message', async () => {
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
  workStep('s-restarted', Date.now(), conversationId);
  expect(workerRepeat('s-restarted')).toMatchObject({
    correction: expect.stringContaining('no user message'),
  });
  expect(rows()).toEqual([]);
});
