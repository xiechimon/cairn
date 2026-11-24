import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefMessage, machine, memoryEdit, memoryEditReceipt, step } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { stepActivityAt } from './dispatch-timeouts.js';
import { CHIEF_ABANDONED_STEP_MS, turnProvenance } from './turn-provenance.js';

export const MEMORY_EDIT_PROVENANCE_PREFIX = 'memory-edit:';
export const MEMORY_EDIT_CLARIFY_PREFIX = 'CLARIFY:';

export const memoryEditProvenance = (editId: string) => `${MEMORY_EDIT_PROVENANCE_PREFIX}${editId}`;

export function memoryEditIdOfPrompt(prompt: string | null): string | null {
  const provenance = turnProvenance(prompt);
  return provenance !== null && provenance.startsWith(MEMORY_EDIT_PROVENANCE_PREFIX)
    ? provenance.slice(MEMORY_EDIT_PROVENANCE_PREFIX.length)
    : null;
}

type EditRow = typeof memoryEdit.$inferSelect;
type ReceiptRow = typeof memoryEditReceipt.$inferSelect;
type StepRow = typeof step.$inferSelect;

export function memoryEditReceipts(db: Pick<Db, 'select'>, editId: string): ReceiptRow[] {
  return db
    .select()
    .from(memoryEditReceipt)
    .where(eq(memoryEditReceipt.editId, editId))
    .orderBy(memoryEditReceipt.createdAt)
    .all();
}

function assistantReplyText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((block): block is { type: 'text'; text: string } => {
      if (typeof block !== 'object' || block === null) return false;
      const rec = block as Record<string, unknown>;
      return rec.type === 'text' && typeof rec.text === 'string';
    })
    .map((block) => block.text)
    .join('')
    .trim();
}

function latestAssistantReply(db: Db, threadId: string): string | null {
  const row = db
    .select({ content: chiefMessage.content })
    .from(chiefMessage)
    .where(and(eq(chiefMessage.threadId, threadId), eq(chiefMessage.role, 'assistant')))
    .orderBy(desc(chiefMessage.createdAt), sql`rowid desc`)
    .limit(1)
    .get();
  if (row === undefined) return null;
  const text = assistantReplyText(row.content);
  return text === '' ? null : text;
}

export function settleMemoryEditTurn(
  db: Db,
  stepRow: StepRow,
  outcome: 'success' | 'stopped' | 'failed',
  reason?: string,
): void {
  const editId = memoryEditIdOfPrompt(stepRow.prompt);
  if (editId === null) return;
  db.transaction((tx) => {
    const row = tx.select().from(memoryEdit).where(eq(memoryEdit.id, editId)).get();
    if (row === undefined || row.stepId !== stepRow.id) return;
    const partial = memoryEditReceipts(tx, editId).length > 0;
    let status = row.status;
    let reply = row.reply;
    if (row.status === 'working' || row.status === 'awaiting_input') {
      if (outcome === 'success') {
        const text = latestAssistantReply(tx, row.threadId);
        reply =
          text !== null && text.startsWith(MEMORY_EDIT_CLARIFY_PREFIX)
            ? text.slice(MEMORY_EDIT_CLARIFY_PREFIX.length).trim()
            : text;
        status =
          text !== null && text.startsWith(MEMORY_EDIT_CLARIFY_PREFIX) ? 'awaiting_input' : 'done';
      } else if (outcome === 'stopped') {
        status = partial ? 'partial' : 'stopped';
      } else {
        status = partial ? 'partial' : 'failed';
      }
    } else if (outcome === 'stopped' && row.status === 'stopped' && partial) {
      status = 'partial';
    }
    tx.update(memoryEdit)
      .set({
        status,
        reply,
        ...(outcome !== 'success' ? { failureReason: reason ?? outcome } : {}),
        updatedAt: nowMs(),
      })
      .where(eq(memoryEdit.id, row.id))
      .run();
  });
}

function isMemoryEditStep(row: StepRow): boolean {
  return row.kind === 'chief' && memoryEditIdOfPrompt(row.prompt) !== null;
}

export function abandonMemoryEditStep(db: Db, stepRow: StepRow, reason: string): void {
  db.update(step)
    .set({ status: 'failed', finishedAt: nowMs() })
    .where(eq(step.id, stepRow.id))
    .run();
  settleMemoryEditTurn(db, stepRow, 'failed', reason);
}

export function sweepAbandonedMemoryEditSteps(
  deps: { db: Db; machineHub?: { silentSinceDrop: (id: string) => boolean } },
  now: number = nowMs(),
): void {
  const candidates = deps.db
    .select()
    .from(step)
    .where(and(eq(step.kind, 'chief'), eq(step.status, 'claimed')))
    .all()
    .filter(isMemoryEditStep);
  for (const row of candidates) {
    const stale = now - stepActivityAt(row) > CHIEF_ABANDONED_STEP_MS;
    if (!stale) continue;
    const machineRow =
      row.machineId === null
        ? undefined
        : deps.db.select().from(machine).where(eq(machine.id, row.machineId)).get();
    const live = machineRow?.online === true && !deps.machineHub?.silentSinceDrop(machineRow.id);
    if (live) continue;
    abandonMemoryEditStep(deps.db, row, 'executor lost');
  }
}
