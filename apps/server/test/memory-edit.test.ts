import { chiefMemoryThreadId } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import {
  agentMemory,
  chiefMessage,
  chiefThread,
  memoryEdit,
  memoryEditReceipt,
  step,
} from '../src/db/schema.js';
import { nowMs } from '../src/lib/ids.js';
import {
  editChiefMessage,
  listChiefThreads,
  rewindChiefThread,
  submitChiefMessage,
} from '../src/services/chief.js';
import { memoryDocumentVersion } from '../src/services/memory.js';
import { executeMemoryDocumentTool } from '../src/services/memory-documents.js';
import {
  executeMemoryEditTool,
  stopMemoryEdit,
  submitMemoryEdit,
} from '../src/services/memory-edit.js';
import {
  MEMORY_EDIT_CLARIFY_PREFIX,
  settleMemoryEditTurn,
  sweepAbandonedMemoryEditSteps,
} from '../src/services/memory-edit-turns.js';
import { refuseRestrictedTurnTool } from '../src/services/report-turn.js';
import { AGENT_ID, H, registerChiefHarness, toolDeps } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();

const OWNER = { agentId: AGENT_ID, teamId: '', projectId: null as string | null };
const owner = () => ({ ...OWNER, teamId: H.teamId });
const deps = () => toolDeps();

function submitEdit(text = '把部署口令改成 rotate-9') {
  return submitMemoryEdit(deps(), H.teamId, { text });
}

function editStep(editId: string) {
  const row = H.s.db.select().from(memoryEdit).where(eq(memoryEdit.id, editId)).get()!;
  return H.s.db.select().from(step).where(eq(step.id, row.stepId!)).get()!;
}

function saveDoc(file: string, content: string, scope = 'team') {
  return executeMemoryDocumentTool(H.s.db, owner(), 'save_memory', {
    scope,
    file,
    content,
  }) as { baseVersion: string };
}

test('submit creates a dedicated side thread, one edit row and no main-thread message', async () => {
  const record = submitEdit();
  expect(record.status).toBe('working');
  const thread = H.s.db
    .select()
    .from(chiefThread)
    .where(eq(chiefThread.id, chiefMemoryThreadId(H.chiefId)))
    .get();
  expect(thread).toBeDefined();
  const stepRow = editStep(record.id);
  expect(stepRow.buildId).toBe(thread!.id);
  expect(stepRow.prompt).toContain(`memory-edit:${record.id}`);
  const mainMessages = H.s.db
    .select()
    .from(chiefMessage)
    .where(eq(chiefMessage.threadId, H.threadId))
    .all();
  expect(mainMessages).toHaveLength(0);
  const listed = listChiefThreads(deps(), H.teamId).map((t) => t.id);
  expect(listed).not.toContain(thread!.id);
});

test('a second submit while working is rejected and the same row keeps running', () => {
  const first = submitEdit();
  expect(() => submitEdit('改点别的')).toThrow('already running');
  expect(editStep(first.id).status).toBe('pending');
});

test('memory-edit turns refuse every non-memory tool', () => {
  const prompt = `[wake:wake] provenance=memory-edit:edit-1\nedit`;
  for (const tool of ['notify_user', 'ask_user', 'create_todo', 'run_builds', 'threads']) {
    expect(() => refuseRestrictedTurnTool(H.s.db, prompt, tool)).toThrow(/403|cannot call/);
  }
  for (const tool of ['save_memory', 'update_memory', 'delete_memory', 'memories']) {
    expect(() => refuseRestrictedTurnTool(H.s.db, prompt, tool)).not.toThrow();
  }
});

test('ordinary thread verbs cannot touch the memory side thread', () => {
  submitEdit();
  const tid = chiefMemoryThreadId(H.chiefId);
  expect(() =>
    submitChiefMessage(deps(), H.teamId, {
      threadId: tid,
      content: 'hi',
      clientMessageId: 'c1',
    }),
  ).toThrow(`chief thread ${tid}`);
  expect(() => rewindChiefThread(deps(), H.teamId, tid, { messageId: 'm' })).toThrow(
    `chief thread ${tid}`,
  );
  expect(() => editChiefMessage(deps(), H.teamId, tid, 'm', { content: 'x' })).toThrow(
    `chief thread ${tid}`,
  );
});

test('committed tool calls write receipts; duplicate call ids replay without rewriting', () => {
  const record = submitEdit();
  saveDoc('notes', 'old content');
  const doc = H.s.db
    .select()
    .from(agentMemory)
    .where(and(eq(agentMemory.title, 'notes'), eq(agentMemory.teamId, H.teamId)))
    .get()!;
  const base = memoryDocumentVersion(doc);
  const first = executeMemoryEditTool(H.s.db, owner(), record.id, 'call-1', 'update_memory', {
    scope: 'team',
    file: 'notes',
    content: 'new content',
    baseVersion: base,
  });
  expect(first.replayed).toBe(false);
  const replay = executeMemoryEditTool(H.s.db, owner(), record.id, 'call-1', 'update_memory', {
    scope: 'team',
    file: 'notes',
    content: 'new content',
    baseVersion: base,
  });
  expect(replay.replayed).toBe(true);
  const receipts = H.s.db
    .select()
    .from(memoryEditReceipt)
    .where(eq(memoryEditReceipt.editId, record.id))
    .all();
  expect(receipts).toHaveLength(1);
  const stored = JSON.parse(receipts[0]!.result) as { before: string; after: string };
  expect(stored.before).toBe('old content');
  expect(stored.after).toBe('new content');
});

test('mutating calls without baseVersion fail 400 and stale versions fail 409', () => {
  const record = submitEdit();
  saveDoc('notes', 'v1');
  expect(() =>
    executeMemoryEditTool(H.s.db, owner(), record.id, 'c1', 'update_memory', {
      scope: 'team',
      file: 'notes',
      content: 'v2',
    }),
  ).toThrow(/400|base/);
  expect(() =>
    executeMemoryEditTool(H.s.db, owner(), record.id, 'c2', 'update_memory', {
      scope: 'team',
      file: 'notes',
      content: 'v2',
      baseVersion: 'bogus',
    }),
  ).toThrow(/409|stale|version/);
  expect(
    H.s.db.select().from(memoryEditReceipt).where(eq(memoryEditReceipt.editId, record.id)).all(),
  ).toHaveLength(0);
});

test('a later failing call keeps earlier committed receipts (partial success)', () => {
  const record = submitEdit();
  saveDoc('a', 'one');
  const docA = H.s.db.select().from(agentMemory).where(eq(agentMemory.title, 'a')).get()!;
  executeMemoryEditTool(H.s.db, owner(), record.id, 'ok-1', 'update_memory', {
    scope: 'team',
    file: 'a',
    content: 'one+',
    baseVersion: memoryDocumentVersion(docA),
  });
  expect(() =>
    executeMemoryEditTool(H.s.db, owner(), record.id, 'bad-1', 'update_memory', {
      scope: 'team',
      file: 'missing',
      content: 'x',
      baseVersion: 'anything',
    }),
  ).toThrow();
  const receipts = H.s.db
    .select()
    .from(memoryEditReceipt)
    .where(eq(memoryEditReceipt.editId, record.id))
    .all();
  expect(receipts.map((r) => r.callId)).toEqual(['ok-1']);
});

function settle(record: { id: string }, outcome: 'success' | 'stopped' | 'failed', reply?: string) {
  const row = H.s.db.select().from(memoryEdit).where(eq(memoryEdit.id, record.id)).get()!;
  if (reply !== undefined) {
    H.s.db
      .insert(chiefMessage)
      .values({
        id: `asst-${nowMs()}`,
        threadId: row.threadId,
        role: 'assistant',
        content: reply,
        createdAt: nowMs(),
      })
      .run();
  }
  settleMemoryEditTurn(H.s.db, editStep(record.id), outcome);
  return H.s.db.select().from(memoryEdit).where(eq(memoryEdit.id, record.id)).get()!;
}

test('settle maps outcomes to edit statuses, CLARIFY to awaiting_input', () => {
  const done = submitEdit('a');
  expect(settle(done, 'success', 'changed notes').status).toBe('done');

  const clarifying = submitEdit('b');
  settle(clarifying, 'success', `${MEMORY_EDIT_CLARIFY_PREFIX} 哪个文件？`);
  const row = H.s.db.select().from(memoryEdit).where(eq(memoryEdit.id, clarifying.id)).get()!;
  expect(row.status).toBe('awaiting_input');
  expect(row.reply).toBe('哪个文件？');

  const failed = submitEdit('c');
  expect(settle(failed, 'failed', undefined).status).toBe('failed');
  const stopped = submitEdit('d');
  expect(settle(stopped, 'stopped', undefined).status).toBe('stopped');
});

test('settle reads replies stored as transcript part arrays', () => {
  const record = submitEdit('parts');
  const row = H.s.db.select().from(memoryEdit).where(eq(memoryEdit.id, record.id)).get()!;
  H.s.db
    .insert(chiefMessage)
    .values({
      id: `asst-parts-${nowMs()}`,
      threadId: row.threadId,
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: `${MEMORY_EDIT_CLARIFY_PREFIX} 哪份文件？` },
      ],
      createdAt: nowMs(),
    })
    .run();
  settleMemoryEditTurn(H.s.db, editStep(record.id), 'success');
  const settled = H.s.db.select().from(memoryEdit).where(eq(memoryEdit.id, record.id)).get()!;
  expect(settled.status).toBe('awaiting_input');
  expect(settled.reply).toBe('哪份文件？');
});

test('a stopped turn with committed receipts settles partial, not stopped', () => {
  const record = submitEdit();
  saveDoc('a', 'one');
  const docA = H.s.db.select().from(agentMemory).where(eq(agentMemory.title, 'a')).get()!;
  executeMemoryEditTool(H.s.db, owner(), record.id, 'ok-1', 'update_memory', {
    scope: 'team',
    file: 'a',
    content: 'one+',
    baseVersion: memoryDocumentVersion(docA),
  });
  expect(settle(record, 'stopped').status).toBe('partial');
});

test('a stale turn finishing after a new attempt cannot overwrite it', () => {
  const record = submitEdit();
  const staleStep = editStep(record.id);
  const editRow = H.s.db.select().from(memoryEdit).where(eq(memoryEdit.id, record.id)).get()!;
  H.s.db
    .insert(chiefMessage)
    .values({
      id: 'clarify-1',
      threadId: editRow.threadId,
      role: 'assistant',
      content: `${MEMORY_EDIT_CLARIFY_PREFIX} 改哪个？`,
      createdAt: nowMs(),
    })
    .run();
  settleMemoryEditTurn(H.s.db, staleStep, 'success');
  const continued = submitMemoryEdit(deps(), H.teamId, {
    text: '就改 notes',
    editId: record.id,
  });
  expect(continued.attempt).toBe(2);
  settleMemoryEditTurn(H.s.db, staleStep, 'failed', 'timeout');
  const row = H.s.db.select().from(memoryEdit).where(eq(memoryEdit.id, record.id)).get()!;
  expect(row.status).toBe('working');
  expect(row.attempt).toBe(2);
});

test('continuing an awaiting edit reuses the same id with attempt+1', () => {
  const record = submitEdit();
  settleMemoryEditTurn(H.s.db, editStep(record.id), 'success');
  H.s.db
    .update(memoryEdit)
    .set({ status: 'awaiting_input' })
    .where(eq(memoryEdit.id, record.id))
    .run();
  const continued = submitMemoryEdit(deps(), H.teamId, {
    text: '就改 notes',
    editId: record.id,
  });
  expect(continued.id).toBe(record.id);
  expect(continued.attempt).toBe(2);
  expect(continued.status).toBe('working');
});

test('stop marks a pending step stopped and reports stopped with zero writes', () => {
  const record = submitEdit();
  const stopped = stopMemoryEdit(deps(), H.teamId, record.id);
  expect(stopped.status).toBe('stopped');
  expect(editStep(record.id).status).toBe('stopped');
});

test('a claimed step abandoned by a dead executor fails the edit', () => {
  const record = submitEdit();
  const stepRow = editStep(record.id);
  H.s.db
    .update(step)
    .set({ status: 'claimed', machineId: 'ghost-machine', lastHeartbeatAt: nowMs() - 10 * 60_000 })
    .where(eq(step.id, stepRow.id))
    .run();
  sweepAbandonedMemoryEditSteps({ db: H.s.db }, nowMs());
  const row = H.s.db.select().from(memoryEdit).where(eq(memoryEdit.id, record.id)).get()!;
  expect(row.status).toBe('failed');
});

test('REST round-trip: post, get current, stop', async () => {
  const created = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/memory-edits`, {
    text: '把 notes 里的端口改成 8080',
  });
  expect(created.status).toBe(201);
  const body = (await created.json()) as { id: string; status: string };
  expect(body.status).toBe('working');
  const current = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/memory-edits/current`);
  expect((await current.json())?.id).toBe(body.id);
  const stopped = await req(
    H.s.app,
    'POST',
    `/api/teams/${H.teamId}/memory-edits/${body.id}/stop`,
    {},
  );
  expect(stopped.status).toBe(200);
  expect(((await stopped.json()) as { status: string }).status).toBe('stopped');
});
