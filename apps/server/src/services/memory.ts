import { createHash } from 'node:crypto';
import { ISSUE_FENCE_OPEN, MEMORY_QUOTA_PER_AGENT } from '@cairn/shared';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
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

function overlaps(left: string, right: string): boolean {
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

function memoriesInScope(
  tx: MemoryTx,
  scope: { agentId: string; teamId: string; projectId: string | null },
) {
  return tx
    .select()
    .from(agentMemory)
    .where(
      and(
        eq(agentMemory.agentId, scope.agentId),
        eq(agentMemory.teamId, scope.teamId),
        scope.projectId === null
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
    const count = tx
      .select({ n: sql<number>`count(*)` })
      .from(agentMemory)
      .where(eq(agentMemory.agentId, input.agentId))
      .get();
    if ((count?.n ?? 0) >= MEMORY_QUOTA_PER_AGENT) {
      throw new HttpError(409, `memory quota exceeded (${MEMORY_QUOTA_PER_AGENT}/agent)`);
    }
    const rows = memoriesInScope(tx, input);
    if (rows.some((row) => row.content === input.content)) {
      throw new HttpError(409, 'memory already exists; use update_memory');
    }
    const id = createHash('sha256')
      .update(JSON.stringify([input.agentId, input.teamId, input.projectId, input.content]))
      .digest('hex');
    if (
      !input.force &&
      tx.select().from(memorySaveConflict).where(eq(memorySaveConflict.id, id)).get()
    ) {
      throw new HttpError(
        409,
        'same memory request already returned candidates; use update_memory or force:true',
      );
    }
    const candidates = rows.filter(
      (row) => overlaps(row.title, input.title) || overlaps(row.content, input.content),
    );
    if (candidates.length > 0 && !input.force) {
      const inserted = tx
        .insert(memorySaveConflict)
        .values({ id, createdAt: nowMs() })
        .onConflictDoNothing()
        .run();
      if (inserted.changes === 0)
        throw new HttpError(
          409,
          'same memory request already returned candidates; use update_memory or force:true',
        );
      return {
        status: 'candidates' as const,
        candidates,
        hint: '请用 update_memory 选择更新哪条，或确认新增并设置 force:true。',
      };
    }
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
    validateMemoryText(row.title, input.content);
    if (row.content === input.content) return row;
    const duplicate = memoriesInScope(tx, row).find(
      (other) => other.id !== row.id && other.content === input.content,
    );
    if (duplicate) {
      throw new HttpError(409, `memory ${duplicate.id} already has this content`);
    }
    return tx
      .update(agentMemory)
      .set({
        content: input.content,
        history: [
          ...row.history,
          { title: row.title, content: row.content, updatedAt: row.updatedAt },
        ],
        updatedAt: Math.max(nowMs(), row.updatedAt + 1),
      })
      .where(eq(agentMemory.id, row.id))
      .returning()
      .get();
  });
}
