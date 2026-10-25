import { createHash } from 'node:crypto';
import { ISSUE_FENCE_OPEN, MEMORY_QUOTA_PER_AGENT } from '@cairn/shared';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agentMemory, memorySaveConflict } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';

function validateMemoryText(title: string, content: string): void {
  if (title.includes(ISSUE_FENCE_OPEN) || content.includes(ISSUE_FENCE_OPEN)) {
    throw new HttpError(
      400,
      'invalid params.content: text quoted from a GitHub issue fence is third-party data and is not saved as memory',
    );
  }
}

export function overlaps(left: string, right: string): boolean {
  const normalize = (value: string) =>
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, '');
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const grams = (value: string) => {
    const chars = Array.from(value);
    return new Set(chars.slice(1).map((char, index) => `${chars[index]}${char}`));
  };
  const aGrams = grams(a);
  const bGrams = grams(b);
  const shared = [...aGrams].filter((gram) => bGrams.has(gram)).length;
  return shared >= 2 && shared / Math.min(aGrams.size, bGrams.size) >= 0.5;
}

type MemoryTx = Parameters<Parameters<Db['transaction']>[0]>[0];

const stillValid = isNull(agentMemory.invalidAt);

export function listMemoryEntries(
  db: Db | MemoryTx,
  scope: { agentId: string; teamId: string },
  includeInvalid = false,
) {
  return db
    .select()
    .from(agentMemory)
    .where(
      and(
        eq(agentMemory.agentId, scope.agentId),
        eq(agentMemory.teamId, scope.teamId),
        includeInvalid ? undefined : stillValid,
      ),
    )
    .orderBy(asc(agentMemory.createdAt), asc(agentMemory.id))
    .all();
}

export function injectMemories(db: Db, scope: { agentId: string; projectId?: string }) {
  return db.transaction((tx) => {
    const rows = tx
      .select({ id: agentMemory.id, title: agentMemory.title, content: agentMemory.content })
      .from(agentMemory)
      .where(
        and(
          eq(agentMemory.agentId, scope.agentId),
          stillValid,
          scope.projectId === undefined
            ? undefined
            : or(eq(agentMemory.projectId, scope.projectId), isNull(agentMemory.projectId)),
        ),
      )
      .orderBy(asc(agentMemory.createdAt), asc(agentMemory.id))
      .all();
    if (rows.length > 0) {
      tx.update(agentMemory)
        .set({ lastInjectedAt: nowMs() })
        .where(
          inArray(
            agentMemory.id,
            rows.map((row) => row.id),
          ),
        )
        .run();
    }
    return rows.map(({ title, content }) => ({ title, content }));
  });
}

export function memoriesInScope(
  tx: MemoryTx,
  scope: { agentId: string; teamId: string; projectId: string | null },
  everyProject = false,
) {
  return tx
    .select()
    .from(agentMemory)
    .where(
      and(
        eq(agentMemory.agentId, scope.agentId),
        eq(agentMemory.teamId, scope.teamId),
        stillValid,
        everyProject
          ? undefined
          : scope.projectId === null
            ? isNull(agentMemory.projectId)
            : or(eq(agentMemory.projectId, scope.projectId), isNull(agentMemory.projectId)),
      ),
    )
    .orderBy(asc(agentMemory.createdAt), asc(agentMemory.id))
    .all();
}

export function saveMemoryEntry(
  db: Db,
  input: {
    agentId: string;
    teamId: string;
    title: string;
    content: string;
    projectId: string | null;
    sourceTodoId: string | null;
    sourceBuildId: string | null;
    force?: boolean;
  },
) {
  validateMemoryText(input.title, input.content);
  return db.transaction((tx) => {
    if (listMemoryEntries(tx, input).length >= MEMORY_QUOTA_PER_AGENT) {
      throw new HttpError(409, `memory quota exceeded (${MEMORY_QUOTA_PER_AGENT}/agent)`);
    }
    const rows = memoriesInScope(tx, input);
    if (rows.some((row) => row.content === input.content)) {
      throw new HttpError(409, 'memory already exists; use update_memory');
    }
    const id = createHash('sha256')
      .update(JSON.stringify([input.agentId, input.teamId, input.projectId, input.content]))
      .digest('hex');
    const candidates = rows.filter(
      (row) => overlaps(row.title, input.title) || overlaps(row.content, input.content),
    );
    const returned = tx
      .select()
      .from(memorySaveConflict)
      .where(eq(memorySaveConflict.id, id))
      .get();
    const returnedCandidateStillExists = returned?.candidateIds.some((candidateId) =>
      rows.some((row) => row.id === candidateId),
    );
    if (!input.force && returnedCandidateStillExists) {
      throw new HttpError(
        409,
        'same memory request already returned candidates; use update_memory or force:true',
      );
    }
    if (candidates.length > 0 && !input.force) {
      tx.insert(memorySaveConflict)
        .values({ id, candidateIds: candidates.map((row) => row.id), createdAt: nowMs() })
        .onConflictDoUpdate({
          target: memorySaveConflict.id,
          set: { candidateIds: candidates.map((row) => row.id), createdAt: nowMs() },
        })
        .run();
      return {
        status: 'candidates' as const,
        candidates,
        hint: '请用 update_memory 选择更新哪条，或确认新增并设置 force:true。',
      };
    }
    tx.delete(memorySaveConflict).where(eq(memorySaveConflict.id, id)).run();
    const { force: _force, ...entry } = input;
    const now = nowMs();
    return tx
      .insert(agentMemory)
      .values({ id: newRecordId(), ...entry, createdAt: now, updatedAt: now })
      .returning()
      .get();
  });
}

export function updateMemoryEntry(
  db: Db,
  input: { memoryId: string; agentId: string; teamId: string; content: string },
) {
  return db.transaction((tx) => {
    const row = tx
      .select()
      .from(agentMemory)
      .where(
        and(
          eq(agentMemory.id, input.memoryId),
          eq(agentMemory.agentId, input.agentId),
          eq(agentMemory.teamId, input.teamId),
        ),
      )
      .get();
    if (!row) throw new HttpError(404, `memory ${input.memoryId}`);
    if (row.invalidAt !== null) {
      throw new HttpError(
        409,
        row.supersededBy === null
          ? `memory ${row.id} is no longer valid`
          : `memory ${row.id} was superseded by ${row.supersededBy}; update that one`,
      );
    }
    validateMemoryText(row.title, input.content);
    if (row.content === input.content) return row;
    const duplicate = memoriesInScope(tx, row, row.projectId === null).find(
      (other) => other.id !== row.id && other.content === input.content,
    );
    if (duplicate) {
      throw new HttpError(409, `memory ${duplicate.id} already has this content`);
    }
    const now = Math.max(nowMs(), row.updatedAt + 1);
    const successor = tx
      .insert(agentMemory)
      .values({
        id: newRecordId(),
        agentId: row.agentId,
        teamId: row.teamId,
        title: row.title,
        content: input.content,
        projectId: row.projectId,
        sourceTodoId: row.sourceTodoId,
        sourceBuildId: row.sourceBuildId,
        history: [
          ...row.history,
          { title: row.title, content: row.content, updatedAt: row.updatedAt },
        ],
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    tx.update(agentMemory)
      .set({ invalidAt: now, supersededBy: successor.id })
      .where(eq(agentMemory.id, row.id))
      .run();
    return successor;
  });
}

export function deleteMemoryEntry(
  db: Db,
  input: { memoryId: string; agentId: string; teamId: string },
) {
  return db.transaction((tx) => {
    const removed = tx
      .delete(agentMemory)
      .where(
        and(
          eq(agentMemory.id, input.memoryId),
          eq(agentMemory.agentId, input.agentId),
          eq(agentMemory.teamId, input.teamId),
        ),
      )
      .run().changes;
    if (removed === 0) return 0;
    const mentioning = tx
      .select()
      .from(memorySaveConflict)
      .where(sql`instr(${memorySaveConflict.candidateIds}, ${input.memoryId}) > 0`)
      .all();
    const emptied: string[] = [];
    for (const fingerprint of mentioning) {
      const remaining = fingerprint.candidateIds.filter((id) => id !== input.memoryId);
      if (remaining.length === 0) emptied.push(fingerprint.id);
      else
        tx.update(memorySaveConflict)
          .set({ candidateIds: remaining })
          .where(eq(memorySaveConflict.id, fingerprint.id))
          .run();
    }
    if (emptied.length > 0)
      tx.delete(memorySaveConflict).where(inArray(memorySaveConflict.id, emptied)).run();
    return removed;
  });
}
