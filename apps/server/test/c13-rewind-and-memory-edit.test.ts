import { CHIEF_TURN_ERROR_KIND } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { agentMemory, chiefMessage, memoryEdit, project, step } from '../src/db/schema.js';
import { nowMs } from '../src/lib/ids.js';
import { rewindChiefThread } from '../src/services/chief.js';
import { setCoordinatorSignal } from '../src/services/coordinator-signal.js';
import { memoryDocumentVersion } from '../src/services/memory.js';
import { executeMemoryDocumentTool } from '../src/services/memory-documents.js';
import {
  executeMemoryEditTool,
  stopMemoryEdit,
  submitMemoryEdit,
} from '../src/services/memory-edit.js';
import { AGENT_ID, H, registerChiefHarness, toolDeps } from './chief-harness.js';

registerChiefHarness();

const owner = () => ({ agentId: AGENT_ID, teamId: H.teamId, projectId: null as string | null });

test('rewindChiefThread deletes subsequent chief-err-* and chief-fallback-* rows', () => {
  const now = nowMs();
  H.s.db
    .insert(chiefMessage)
    .values([
      { id: 'msg-1', threadId: H.threadId, role: 'user', content: 'first', createdAt: now },
      {
        id: 'chief-err-step-1',
        threadId: H.threadId,
        role: 'system',
        content: JSON.stringify({ kind: CHIEF_TURN_ERROR_KIND, message: 'Timed out' }),
        createdAt: now + 10,
      },
      {
        id: 'chief-fallback-step-1-1',
        threadId: H.threadId,
        role: 'system',
        content: JSON.stringify({
          kind: 'chief_model_fallback',
          from: 'model-a',
          to: 'model-b',
          stepId: 'step-1',
          announced: true,
        }),
        createdAt: now + 20,
      },
      {
        id: 'asst-1',
        threadId: H.threadId,
        role: 'assistant',
        content: 'old reply',
        createdAt: now + 30,
      },
    ])
    .run();

  const res = rewindChiefThread(toolDeps(), H.teamId, H.threadId, { messageId: 'msg-1' });
  expect(res.deletedCount).toBe(3);
  const remaining = H.s.db
    .select({ id: chiefMessage.id })
    .from(chiefMessage)
    .where(eq(chiefMessage.threadId, H.threadId))
    .all()
    .map((row) => row.id);
  expect(remaining).toEqual(['msg-1']);
});

test('stopMemoryEdit signals coordinator immediately and blocks post-stop memory writeback', () => {
  executeMemoryDocumentTool(H.s.db, owner(), 'save_memory', {
    scope: 'team',
    file: 'notes',
    content: 'original content',
  });
  const doc = H.s.db
    .select()
    .from(agentMemory)
    .where(and(eq(agentMemory.title, 'notes'), eq(agentMemory.teamId, H.teamId)))
    .get()!;
  const baseVersion = memoryDocumentVersion(doc);

  const edit = submitMemoryEdit(toolDeps(), H.teamId, { text: 'overwrite notes' });
  const editRow = H.s.db.select().from(memoryEdit).where(eq(memoryEdit.id, edit.id)).get()!;
  H.s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, editRow.stepId!)).run();

  const signals: Array<{ threadId: string; kind: string }> = [];
  setCoordinatorSignal((threadId, kind) => {
    signals.push({ threadId, kind });
  });
  try {
    const stopped = stopMemoryEdit(toolDeps(), H.teamId, edit.id);
    expect(stopped.status).toBe('stopped');
    expect(signals).toContainEqual({ threadId: editRow.threadId, kind: 'stop' });
  } finally {
    setCoordinatorSignal(() => {});
  }

  expect(() =>
    executeMemoryEditTool(H.s.db, owner(), edit.id, 'late-call', 'update_memory', {
      scope: 'team',
      file: 'notes',
      content: 'corrupted after stop',
      baseVersion,
    }),
  ).toThrow(/409|stopped|stopping/);

  const after = H.s.db
    .select()
    .from(agentMemory)
    .where(and(eq(agentMemory.title, 'notes'), eq(agentMemory.teamId, H.teamId)))
    .get()!;
  expect(after.content).toBe('original content');
});

test('submitMemoryEdit does not auto-continue an awaiting_input edit from another project', () => {
  H.s.db
    .insert(project)
    .values([
      { id: 'proj-a', teamId: H.teamId, name: 'Project A' },
      { id: 'proj-b', teamId: H.teamId, name: 'Project B' },
    ])
    .run();

  const editA = submitMemoryEdit(toolDeps(), H.teamId, {
    text: 'edit A',
    projectId: 'proj-a',
  });
  H.s.db
    .update(memoryEdit)
    .set({ status: 'awaiting_input' })
    .where(eq(memoryEdit.id, editA.id))
    .run();

  const editB = submitMemoryEdit(toolDeps(), H.teamId, {
    text: 'edit B',
    projectId: 'proj-b',
  });
  expect(editB.id).not.toBe(editA.id);
  expect(editB.projectId).toBe('proj-b');
});
