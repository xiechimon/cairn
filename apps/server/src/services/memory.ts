import { createHash } from 'node:crypto';
import {
  estimateTokens,
  ISSUE_FENCE_OPEN,
  MEMORY_QUOTA_PER_AGENT,
  MEMORY_QUOTA_PER_TEAM,
  type MemoryLayer,
} from '@cairn/shared';
import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
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

function notAdoptedDuplicate() {
  return isNull(agentMemory.adoptedFrom);
}

function ownerWhere(scope: { agentId: string; teamId: string; teamScoped?: boolean }) {
  return scope.teamScoped !== false
    ? and(
        eq(agentMemory.teamId, scope.teamId),
        notAdoptedDuplicate(),
        eq(agentMemory.independent, false),
      )
    : and(eq(agentMemory.agentId, scope.agentId), eq(agentMemory.teamId, scope.teamId));
}

function layerWhere(scope: { layer?: MemoryLayer; threadId?: string | null }) {
  const layer = scope.layer ?? 'core';
  if (layer !== 'scratchpad') return eq(agentMemory.layer, layer);
  return and(
    eq(agentMemory.layer, 'scratchpad'),
    scope.threadId == null || scope.threadId === ''
      ? isNull(agentMemory.threadId)
      : eq(agentMemory.threadId, scope.threadId),
  );
}

function scratchpadVisible(threadId?: string) {
  return threadId === undefined
    ? ne(agentMemory.layer, 'scratchpad')
    : or(ne(agentMemory.layer, 'scratchpad'), eq(agentMemory.threadId, threadId));
}

function injectLayerWhere(threadId?: string) {
  return threadId === undefined
    ? eq(agentMemory.layer, 'core')
    : or(
        eq(agentMemory.layer, 'core'),
        and(eq(agentMemory.layer, 'scratchpad'), eq(agentMemory.threadId, threadId)),
      );
}

export function listMemoryEntries(
  db: Db | MemoryTx,
  scope: { agentId: string; teamId: string; threadId?: string; teamScoped?: boolean },
  includeInvalid = false,
) {
  return db
    .select()
    .from(agentMemory)
    .where(
      and(
        ownerWhere(scope),
        includeInvalid ? undefined : stillValid,
        scratchpadVisible(scope.threadId),
      ),
    )
    .orderBy(asc(agentMemory.createdAt), sql`${agentMemory}.rowid`)
    .all();
}

export const MEMORY_INJECT_TOKEN_CAP = 3_000;

export interface InjectedMemory {
  id: string;
  title: string;
  content: string;
}

interface InjectScope {
  agentId: string;
  projectId?: string | null;
  projectOnly?: boolean;
  teamId?: string;
  threadId?: string;
}

export function capMemories<T extends InjectedMemory & { updatedAt: number }>(
  rows: readonly T[],
  capTokens: number,
): { shown: T[]; omitted: number } {
  const byRecency = [...rows].sort((a, b) => b.updatedAt - a.updatedAt);
  const keep = new Set<string>();
  let used = 0;
  for (const row of byRecency) {
    const cost = estimateTokens(`- ${row.title}: ${row.content}`);
    if (used + cost > capTokens) continue;
    used += cost;
    keep.add(row.id);
  }
  const shown = rows.filter((row) => keep.has(row.id));
  const newest = byRecency[0];
  if (shown.length === 0 && newest !== undefined && Number.isFinite(capTokens)) {
    const room = Math.max(1, Math.floor(capTokens / 1.25) - newest.title.length);
    const content = `${newest.content.slice(0, room)} …`;
    return { shown: [{ ...newest, content }], omitted: rows.length - 1 };
  }
  return { shown, omitted: rows.length - shown.length };
}

export function injectMemoriesCapped(
  db: Db,
  scope: InjectScope,
  capTokens: number,
): { memories: InjectedMemory[]; omitted: number } {
  return db.transaction((tx) => {
    const teamId = scope.teamId;
    const teamScoped = teamId !== undefined;
    const rows = tx
      .select({
        id: agentMemory.id,
        title: agentMemory.title,
        content: agentMemory.content,
        updatedAt: agentMemory.updatedAt,
      })
      .from(agentMemory)
      .where(
        and(
          teamScoped
            ? ownerWhere({ agentId: scope.agentId, teamId, teamScoped: true })
            : eq(agentMemory.agentId, scope.agentId),
          injectLayerWhere(scope.threadId),
          stillValid,
          scope.projectId === undefined
            ? undefined
            : scope.projectId === null
              ? isNull(agentMemory.projectId)
              : scope.projectOnly === true
                ? eq(agentMemory.projectId, scope.projectId)
                : or(eq(agentMemory.projectId, scope.projectId), isNull(agentMemory.projectId)),
        ),
      )
      .orderBy(asc(agentMemory.createdAt), sql`${agentMemory}.rowid`)
      .all();
    const { shown, omitted } = capMemories(rows, capTokens);
    if (shown.length > 0) {
      tx.update(agentMemory)
        .set({ lastInjectedAt: nowMs() })
        .where(
          inArray(
            agentMemory.id,
            shown.map((row) => row.id),
          ),
        )
        .run();
    }
    return {
      memories: shown.map(({ id, title, content }) => ({ id, title, content })),
      omitted,
    };
  });
}

export function searchMemoryEntries<T extends { title: string; content: string }>(
  entries: readonly T[],
  query: string,
): T[] {
  const fold = (text: string) => text.normalize('NFKC').toLowerCase();
  const terms = query
    .split(/\s+/)
    .filter((term) => term !== '')
    .map(fold);
  if (terms.length === 0) return [...entries];
  return entries.filter((entry) => {
    const text = fold(`${entry.title}\n${entry.content}`);
    return terms.every((term) => text.includes(term));
  });
}

export function injectMemories(db: Db, scope: InjectScope) {
  return injectMemoriesCapped(db, scope, Number.POSITIVE_INFINITY).memories.map(
    ({ title, content }) => ({ title, content }),
  );
}

export function memoriesInScope(
  tx: MemoryTx,
  scope: {
    agentId: string;
    teamId: string;
    projectId: string | null;
    layer?: MemoryLayer;
    threadId?: string | null;
    teamScoped?: boolean;
  },
  everyProject = false,
) {
  return tx
    .select()
    .from(agentMemory)
    .where(
      and(
        ownerWhere(scope),
        stillValid,
        layerWhere(scope),
        everyProject
          ? undefined
          : scope.projectId === null
            ? isNull(agentMemory.projectId)
            : or(eq(agentMemory.projectId, scope.projectId), isNull(agentMemory.projectId)),
      ),
    )
    .orderBy(asc(agentMemory.createdAt), sql`${agentMemory}.rowid`)
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
    source?: string | null;
    layer?: MemoryLayer;
    threadId?: string | null;
    force?: boolean;
    teamScoped?: boolean;
  },
) {
  validateMemoryText(input.title, input.content);
  return db.transaction((tx) => {
    const teamQuota = input.teamScoped !== false;
    const quota = teamQuota ? MEMORY_QUOTA_PER_TEAM : MEMORY_QUOTA_PER_AGENT;
    const quotaLabel = teamQuota ? 'team' : 'agent';
    const used = tx
      .select({ id: agentMemory.id })
      .from(agentMemory)
      .where(and(ownerWhere(input), stillValid))
      .all().length;
    if (used >= quota) {
      throw new HttpError(409, `memory quota exceeded (${quota}/${quotaLabel})`);
    }
    const rows = memoriesInScope(tx, input);
    if (rows.some((row) => row.content === input.content)) {
      throw new HttpError(409, 'memory already exists; use update_memory');
    }
    const id = createHash('sha256')
      .update(
        JSON.stringify([
          input.teamId,
          input.projectId,
          input.layer ?? 'core',
          input.threadId ?? null,
          input.content,
        ]),
      )
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
    const { force: _force, source, layer, threadId, teamScoped: _teamScoped, ...entry } = input;
    const now = nowMs();
    return tx
      .insert(agentMemory)
      .values({
        id: newRecordId(),
        ...entry,
        source: source ?? null,
        layer: layer ?? 'core',
        threadId: threadId ?? null,
        independent: input.teamScoped === false,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  });
}

export function updateMemoryEntry(
  db: Db,
  input: {
    memoryId: string;
    agentId: string;
    teamId: string;
    content: string;
    threadId?: string;
    teamScoped?: boolean;
  },
) {
  return db.transaction((tx) => {
    const row = tx
      .select()
      .from(agentMemory)
      .where(
        and(
          eq(agentMemory.id, input.memoryId),
          ownerWhere(input),
          scratchpadVisible(input.threadId),
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
    const duplicate = memoriesInScope(
      tx,
      { ...row, teamScoped: input.teamScoped },
      row.projectId === null,
    ).find((other) => other.id !== row.id && other.content === input.content);
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
        source: row.source,
        layer: row.layer,
        threadId: row.threadId,
        adoptedFrom: row.adoptedFrom,
        independent: row.independent,
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

export function promoteMemoryEntry(
  db: Db,
  input: {
    memoryId: string;
    agentId: string;
    teamId: string;
    threadId?: string;
    teamScoped?: boolean;
  },
): typeof agentMemory.$inferSelect | null {
  const where = and(
    eq(agentMemory.id, input.memoryId),
    ownerWhere(input),
    scratchpadVisible(input.threadId),
  );
  const row = db.select().from(agentMemory).where(where).get();
  if (row === undefined) return null;
  if (row.projectId === null) return row;
  const updatedAt = nowMs();
  db.update(agentMemory).set({ projectId: null, updatedAt }).where(where).run();
  return { ...row, projectId: null, updatedAt };
}

export function deleteMemoryEntry(
  db: Db,
  input: {
    memoryId: string;
    agentId: string;
    teamId: string;
    threadId?: string;
    teamScoped?: boolean;
  },
) {
  return db.transaction((tx) => {
    const removed = tx
      .delete(agentMemory)
      .where(
        and(
          eq(agentMemory.id, input.memoryId),
          ownerWhere(input),
          scratchpadVisible(input.threadId),
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
