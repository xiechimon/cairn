import {
  chiefMemoryThreadId,
  type MemoryEditBody,
  type MemoryEditReceiptRecord,
  type MemoryEditRecord,
  memoryEditRecordSchema,
} from '@cairn/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefThread, memoryEdit, memoryEditReceipt, step, stopPending } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import type { ChiefDeps } from './chief.js';
import { enqueueChiefStep, ensureChief } from './chief.js';
import { wakeCoordinator } from './coordinator-context.js';
import { executeMemoryDocumentTool, type MemoryDocumentOwner } from './memory-documents.js';
import {
  MEMORY_EDIT_CLARIFY_PREFIX,
  memoryEditProvenance,
  memoryEditReceipts,
} from './memory-edit-turns.js';
import { coordinatorMemoryOwner } from './routing-rules.js';

type Deps = ChiefDeps;
type EditRow = typeof memoryEdit.$inferSelect;
type ReceiptRow = typeof memoryEditReceipt.$inferSelect;

const CONTINUABLE_STATUSES = new Set(['awaiting_input', 'partial']);
const MEMORY_EDIT_THREAD_TITLE = 'Memory edits';

function requireEditRow(db: Db, teamId: string, editId: string): EditRow {
  const row = db
    .select()
    .from(memoryEdit)
    .where(and(eq(memoryEdit.id, editId), eq(memoryEdit.teamId, teamId)))
    .get();
  if (row === undefined) throw notFound(`memory edit ${editId}`);
  return row;
}

function toReceiptRecord(row: ReceiptRow): MemoryEditReceiptRecord {
  const stored = JSON.parse(row.result) as {
    before?: string | null;
    after?: string | null;
  };
  return {
    id: row.id,
    editId: row.editId,
    callId: row.callId,
    tool: row.tool,
    scope: row.scope,
    file: row.file,
    beforeVersion: row.beforeVersion,
    afterVersion: row.afterVersion,
    before: stored.before ?? null,
    after: stored.after ?? null,
    summary: row.summary,
    createdAt: row.createdAt,
  };
}

export function toMemoryEditRecord(db: Db, row: EditRow): MemoryEditRecord {
  return memoryEditRecordSchema.parse({
    id: row.id,
    teamId: row.teamId,
    status: row.status,
    attempt: row.attempt,
    instruction: row.instruction,
    file: row.file,
    projectId: row.projectId,
    reply: row.reply,
    receipts: memoryEditReceipts(db, row.id).map(toReceiptRecord),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function currentMemoryEdit(db: Db, teamId: string): EditRow | undefined {
  return db
    .select()
    .from(memoryEdit)
    .where(eq(memoryEdit.teamId, teamId))
    .orderBy(desc(memoryEdit.createdAt))
    .limit(1)
    .get();
}

function ensureChiefMemoryThread(deps: Deps, chiefRow: ReturnType<typeof ensureChief>) {
  const id = chiefMemoryThreadId(chiefRow.id);
  const existing = deps.db.select().from(chiefThread).where(eq(chiefThread.id, id)).get();
  if (existing !== undefined) return existing;
  const now = nowMs();
  deps.db
    .insert(chiefThread)
    .values({
      id,
      chiefId: chiefRow.id,
      userId: chiefRow.userId,
      teamId: chiefRow.teamId,
      projectId: null,
      title: MEMORY_EDIT_THREAD_TITLE,
      createdAt: now,
      updatedAt: now,
      lastTurnAt: null,
      sessionRuntime: 'pi',
      sessionId: '',
      sessionOpenedAt: now,
      pendingSessionResumeAt: null,
      toolDefHashes: {},
      toolResultHashes: {},
      activeRun: null,
    })
    .onConflictDoNothing()
    .run();
  const row = deps.db.select().from(chiefThread).where(eq(chiefThread.id, id)).get();
  if (row === undefined) throw new Error('memory thread missing after insert');
  return row;
}

type MemoryOwner = Pick<MemoryDocumentOwner, 'agentId' | 'teamId' | 'projectId'>;

function readDocument(
  db: Db,
  owner: MemoryOwner,
  scope: string,
  file: string,
): { content: string; baseVersion: string } | null {
  try {
    const page = executeMemoryDocumentTool(db, owner, 'memories', { scope, file }) as {
      content?: string;
      baseVersion?: string;
    };
    return { content: page.content ?? '', baseVersion: page.baseVersion ?? '' };
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

function receiptsForPrompt(rows: ReceiptRow[]): string {
  return rows
    .map((row) => {
      const at = row.afterVersion ?? row.beforeVersion ?? 'none';
      return `- ${row.tool} ${row.file ?? ''} (scope ${row.scope ?? 'team'}, revision ${at}): ${row.summary}`;
    })
    .join('\n');
}

function memoryEditTurnPrompt(db: Db, owner: MemoryOwner, row: EditRow): string {
  const sections: string[] = [
    "You are editing the owner's memory documents on a dedicated memory-edit turn.",
    "Only the four memory tools are available. Every mutating call needs the document's current baseVersion; read it with memories first when you do not have a fresh one.",
    `If the request is ambiguous or unsafe to act on without an answer, reply starting with "${MEMORY_EDIT_CLARIFY_PREFIX}" followed by one short question for the owner, and change nothing else.`,
    'Otherwise reply with one short line naming each document you changed, or explain in one line why nothing needed changing.',
    '',
    '== Team MEMORY.md ==',
    readDocument(db, owner, 'team', 'MEMORY.md')?.content || '(empty)',
  ];
  if (row.projectId !== null) {
    sections.push('', `== Project ${row.projectId} MEMORY.md ==`);
    sections.push(readDocument(db, owner, row.projectId, 'MEMORY.md')?.content || '(empty)');
  }
  if (row.file !== null) {
    const scope = row.projectId ?? 'team';
    sections.push('', `== Focused file ${row.file} (scope ${scope}) ==`);
    sections.push(readDocument(db, owner, scope, row.file)?.content ?? '(not found)');
  }
  const receipts = memoryEditReceipts(db, row.id);
  if (receipts.length > 0) {
    sections.push('', '== Already committed in this edit (do not redo; revisions moved on) ==');
    sections.push(receiptsForPrompt(receipts));
  }
  sections.push('', '== The owner says ==', row.instruction);
  return sections.join('\n');
}

function requireMemoryOwner(deps: Deps, teamId: string): string {
  const agentId = coordinatorMemoryOwner(deps.db, teamId);
  if (agentId === undefined)
    throw new HttpError(409, 'no coordinator routing rule — memory has no store');
  return agentId;
}

export function submitMemoryEdit(
  deps: Deps,
  teamId: string,
  body: MemoryEditBody,
): MemoryEditRecord {
  const agentId = requireMemoryOwner(deps, teamId);
  const { record, threadId } = deps.db.transaction((tx) => {
    const chiefRow = ensureChief({ ...deps, db: tx }, teamId);
    const thread = ensureChiefMemoryThread({ ...deps, db: tx }, chiefRow);
    const owner: MemoryOwner = { agentId, teamId, projectId: null };
    const projectId = body.projectId ?? null;
    if (projectId !== null) executeMemoryDocumentTool(tx, owner, 'memories', { scope: projectId });
    const now = nowMs();
    let row: EditRow;
    const continuing = (existing: EditRow): EditRow => {
      if (body.attempt !== undefined && body.attempt !== existing.attempt)
        throw new HttpError(409, `memory edit moved to attempt ${existing.attempt}`);
      tx.update(memoryEdit)
        .set({
          status: 'working',
          attempt: existing.attempt + 1,
          instruction: body.text,
          reply: null,
          failureReason: null,
          ...(body.file !== undefined ? { file: body.file } : {}),
          ...(body.projectId !== undefined ? { projectId } : {}),
          updatedAt: now,
        })
        .where(eq(memoryEdit.id, existing.id))
        .run();
      return {
        ...existing,
        status: 'working',
        attempt: existing.attempt + 1,
        instruction: body.text,
        file: body.file !== undefined ? body.file : existing.file,
        projectId: body.projectId !== undefined ? projectId : existing.projectId,
      };
    };
    if (body.editId !== undefined) {
      const existing = requireEditRow(tx, teamId, body.editId);
      if (!CONTINUABLE_STATUSES.has(existing.status))
        throw new HttpError(409, `memory edit is ${existing.status}`);
      row = continuing(existing);
    } else {
      const latest = tx
        .select()
        .from(memoryEdit)
        .where(eq(memoryEdit.teamId, teamId))
        .orderBy(desc(memoryEdit.createdAt))
        .limit(1)
        .get();
      if (latest?.status === 'working')
        throw new HttpError(409, 'a memory edit is already running');
      if (latest !== undefined && CONTINUABLE_STATUSES.has(latest.status)) {
        row = continuing(latest);
      } else {
        const id = newRecordId();
        tx.insert(memoryEdit)
          .values({
            id,
            teamId,
            userId: deps.user.id,
            chiefId: chiefRow.id,
            threadId: thread.id,
            stepId: null,
            instruction: body.text,
            file: body.file ?? null,
            projectId,
            status: 'working',
            attempt: 1,
            reply: null,
            failureReason: null,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        const inserted = tx.select().from(memoryEdit).where(eq(memoryEdit.id, id)).get();
        if (inserted === undefined) throw new Error('memory edit missing after insert');
        row = inserted;
      }
    }
    const prompt = memoryEditTurnPrompt(tx, owner, row);
    const stepId = enqueueChiefStep({ ...deps, db: tx, machineHub: undefined }, thread.id, {
      prompt,
      trigger: 'wake',
      provenance: memoryEditProvenance(row.id),
      ownerMessageIds: [],
    });
    tx.update(memoryEdit).set({ stepId }).where(eq(memoryEdit.id, row.id)).run();
    return { record: toMemoryEditRecord(tx, { ...row, stepId }), threadId: thread.id };
  });
  deps.machineHub?.wake(teamId);
  wakeCoordinator(threadId);
  return record;
}

export function stopMemoryEdit(
  deps: Deps,
  teamId: string,
  editId: string,
  attempt?: number,
): MemoryEditRecord {
  let signal: string | null = null;
  const record = deps.db.transaction((tx) => {
    const row = requireEditRow(tx, teamId, editId);
    if (attempt !== undefined && attempt !== row.attempt)
      throw new HttpError(409, `memory edit moved to attempt ${row.attempt}`);
    if (row.status !== 'working' && row.status !== 'awaiting_input')
      throw new HttpError(409, `memory edit is ${row.status}`);
    const receipts = memoryEditReceipts(tx, row.id);
    const status = receipts.length > 0 ? 'partial' : 'stopped';
    tx.update(memoryEdit)
      .set({ status, failureReason: 'stopped by owner', updatedAt: nowMs() })
      .where(eq(memoryEdit.id, row.id))
      .run();
    const running = tx
      .select()
      .from(step)
      .where(eq(step.id, row.stepId ?? ''))
      .get();
    if (running !== undefined) {
      if (running.status === 'pending' || running.status === 'waiting_quota') {
        tx.update(step)
          .set({ status: 'stopped', finishedAt: nowMs() })
          .where(eq(step.id, running.id))
          .run();
      } else if (running.status === 'claimed') {
        tx.insert(stopPending)
          .values({
            conversationId: row.threadId,
            stepId: running.id,
            discard: false,
            createdAt: nowMs(),
          })
          .onConflictDoUpdate({
            target: stopPending.conversationId,
            set: { stepId: running.id, discard: false, createdAt: nowMs() },
          })
          .run();
        signal = running.id;
      }
    }
    return toMemoryEditRecord(tx, { ...row, status });
  });
  if (signal !== null) deps.machineHub?.stopSignal(teamId, signal);
  return record;
}

export interface MemoryReceiptResult {
  replayed: boolean;
  output: unknown;
}

export function executeMemoryEditTool(
  db: Db,
  owner: MemoryDocumentOwner,
  editId: string,
  callId: string,
  name: string,
  params: Record<string, unknown>,
): MemoryReceiptResult {
  return db.transaction((tx) => {
    const edit = tx.select().from(memoryEdit).where(eq(memoryEdit.id, editId)).get();
    if (edit === undefined) throw new HttpError(409, `memory edit ${editId} is gone`);
    const scopedOwner = edit.projectId === null ? owner : { ...owner, projectId: edit.projectId };
    const prior = tx
      .select()
      .from(memoryEditReceipt)
      .where(and(eq(memoryEditReceipt.editId, editId), eq(memoryEditReceipt.callId, callId)))
      .get();
    if (prior !== undefined) {
      const stored = JSON.parse(prior.result) as { toolResult: unknown };
      return { replayed: true, output: stored.toolResult };
    }
    const scope =
      typeof params.scope === 'string' ? params.scope : (scopedOwner.projectId ?? 'team');
    const file = typeof params.file === 'string' ? params.file : null;
    const mutating = name !== 'memories';
    const before = mutating && file !== null ? readDocument(tx, scopedOwner, scope, file) : null;
    const output = executeMemoryDocumentTool(tx, scopedOwner, name, params);
    if (!mutating) return { replayed: false, output };
    const page = output as { content?: string; baseVersion?: string; file?: string };
    const summary =
      name === 'save_memory'
        ? `created ${params.file}`
        : name === 'delete_memory'
          ? `deleted ${params.file}`
          : `updated ${page.file ?? params.file ?? 'document'}`;
    tx.insert(memoryEditReceipt)
      .values({
        id: newRecordId(),
        editId,
        callId,
        tool: name,
        scope,
        file,
        beforeVersion: before?.baseVersion ?? null,
        afterVersion:
          name === 'delete_memory'
            ? null
            : typeof page.baseVersion === 'string'
              ? page.baseVersion
              : null,
        summary,
        result: JSON.stringify({
          toolResult: output,
          before: before?.content ?? null,
          after: name === 'delete_memory' ? null : (page.content ?? null),
        }),
        createdAt: nowMs(),
      })
      .run();
    return { replayed: false, output };
  });
}
