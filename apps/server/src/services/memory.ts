import { createHash } from 'node:crypto';
import {
  estimateTokens,
  ISSUE_FENCE_OPEN,
  MEMORY_INDEX_ID_PREFIX,
  MEMORY_INDEX_TITLE,
  MEMORY_QUOTA_PER_AGENT,
  MEMORY_QUOTA_PER_TEAM,
  type MemoryLayer,
} from '@cairn/shared';
import { and, asc, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
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

export function listStoredMemoryEntries(
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
  recordUse?: boolean;
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
    if (shown.length > 0 && scope.recordUse !== false) {
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

type MemoryRow = typeof agentMemory.$inferSelect;

const indexFactSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    content: z.string(),
    fileId: z.string().nullable(),
  })
  .strict();
type IndexFact = z.infer<typeof indexFactSchema>;

function indexRow(row: Pick<MemoryRow, 'id' | 'layer'>): boolean {
  return row.layer === 'core' && row.id.startsWith(MEMORY_INDEX_ID_PREFIX);
}

function readIndex(row: Pick<MemoryRow, 'id' | 'content'>): IndexFact[] {
  try {
    const facts =
      row.content === ''
        ? []
        : row.content.split('\n').map((line) => {
            if (!line.startsWith('- ')) throw new Error('missing list marker');
            return indexFactSchema.parse(JSON.parse(line.slice(2)));
          });
    if (new Set(facts.map((fact) => fact.id)).size !== facts.length)
      throw new Error('duplicate fact id');
    return facts;
  } catch {
    throw new HttpError(400, `invalid memory index ${row.id}`);
  }
}

function writeIndex(facts: IndexFact[]): string {
  return facts.map((fact) => `- ${JSON.stringify(fact)}`).join('\n');
}

function indexFacts(db: Db | MemoryTx, row: MemoryRow): MemoryRow[] {
  if (!indexRow(row)) return [row];
  return readIndex(row).map((fact) => {
    const file =
      fact.fileId === null
        ? undefined
        : db
            .select()
            .from(agentMemory)
            .where(
              and(
                eq(agentMemory.id, fact.fileId),
                ownerWhere({ ...row, teamScoped: !row.independent }),
                row.projectId === null
                  ? isNull(agentMemory.projectId)
                  : eq(agentMemory.projectId, row.projectId),
                eq(agentMemory.layer, 'searchable'),
                stillValid,
              ),
            )
            .get();
    if (fact.fileId !== null && file === undefined)
      throw new HttpError(409, `missing memory file ${fact.fileId}`);
    return {
      ...row,
      ...file,
      id: fact.id,
      title: fact.title,
      content: file?.content ?? fact.content,
      layer: 'core',
      invalidAt: row.invalidAt,
      supersededBy: row.supersededBy,
    };
  });
}

function factRows(db: Db | MemoryTx, rows: MemoryRow[]): MemoryRow[] {
  const files = new Set(
    rows
      .filter(indexRow)
      .flatMap((row) =>
        readIndex(row).flatMap((fact) => (fact.fileId === null ? [] : [fact.fileId])),
      ),
  );
  return rows.filter((row) => !files.has(row.id)).flatMap((row) => indexFacts(db, row));
}

export function listMemoryEntries(...args: Parameters<typeof listStoredMemoryEntries>) {
  const rows = listStoredMemoryEntries(...args);
  return args[2] === true ? rows : factRows(args[0], rows);
}

function indexedFact(
  db: Db | MemoryTx,
  scope: Parameters<typeof listStoredMemoryEntries>[1],
  id: string,
) {
  for (const document of listStoredMemoryEntries(db, scope).filter(indexRow)) {
    const entries = readIndex(document);
    const entry = entries.find((fact) => fact.id === id || fact.fileId === id);
    const row = entry && indexFacts(db, document).find((fact) => fact.id === entry.id);
    if (entry && row)
      return {
        document,
        entries,
        entry,
        row,
      };
  }
  return undefined;
}

function fileEntry(tx: MemoryTx, row: MemoryRow): IndexFact {
  const [first = '', ...rest] = row.content.split('\n');
  const file = rest.length > 0;
  const fileId = file ? newRecordId() : null;
  if (fileId !== null)
    tx.insert(agentMemory)
      .values({
        ...row,
        id: fileId,
        layer: 'searchable',
        history: [],
        invalidAt: null,
        supersededBy: null,
      })
      .run();
  return { id: row.id, title: row.title, content: first, fileId };
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
  const rows = tx
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
  return factRows(tx, rows);
}

export function saveMemoryEntry(
  db: Db | MemoryTx,
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
    const used = factRows(
      tx,
      tx
        .select()
        .from(agentMemory)
        .where(and(ownerWhere(input), stillValid))
        .all(),
    ).length;
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
    const now = nowMs();
    return tx
      .insert(agentMemory)
      .values({
        id: newRecordId(),
        agentId: input.agentId,
        teamId: input.teamId,
        title: input.title,
        content: input.content,
        projectId: input.projectId,
        sourceTodoId: input.sourceTodoId,
        sourceBuildId: input.sourceBuildId,
        source: input.source ?? null,
        layer: input.layer ?? 'core',
        threadId: input.threadId ?? null,
        independent: input.teamScoped === false,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  });
}

function replaceMemory(tx: MemoryTx, row: MemoryRow, content: string): MemoryRow {
  const now = Math.max(nowMs(), row.updatedAt + 1);
  const successor = tx
    .insert(agentMemory)
    .values({
      ...row,
      id: indexRow(row) ? `${MEMORY_INDEX_ID_PREFIX}${newRecordId()}` : newRecordId(),
      content,
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
}

function removeIndexedFact(
  tx: MemoryTx,
  indexed: NonNullable<ReturnType<typeof indexedFact>>,
): void {
  const entries = indexed.entries.filter((fact) => fact.id !== indexed.entry.id);
  const invalidAt = Math.max(nowMs(), indexed.document.updatedAt + 1);
  if (entries.length === 0)
    tx.update(agentMemory).set({ invalidAt }).where(eq(agentMemory.id, indexed.document.id)).run();
  else replaceMemory(tx, indexed.document, writeIndex(entries));
  if (indexed.entry.fileId !== null)
    tx.update(agentMemory).set({ invalidAt }).where(eq(agentMemory.id, indexed.entry.fileId)).run();
}

export function updateMemoryEntry(
  db: Db | MemoryTx,
  input: {
    memoryId: string;
    agentId: string;
    teamId: string;
    content: string;
    threadId?: string;
    teamScoped?: boolean;
    absorb?: { ids: readonly string[]; at: number };
  },
) {
  return db.transaction((tx) => {
    const indexed = indexedFact(tx, input, input.memoryId);
    const row =
      indexed?.row ??
      tx
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
    if (indexed !== undefined && input.absorb !== undefined)
      throw new HttpError(409, 'document facts cannot be consolidated by the legacy pass');
    if (row.invalidAt !== null)
      throw new HttpError(
        409,
        row.supersededBy === null
          ? `memory ${row.id} is no longer valid`
          : `memory ${row.id} was superseded by ${row.supersededBy}; update that one`,
      );
    validateMemoryText(row.title, input.content);
    if (indexRow(row) && (row.content !== input.content || input.absorb !== undefined))
      throw new HttpError(400, 'memory index is managed; update a fact ID from memories');
    const absorbed = input.absorb?.ids ?? [];
    const absorb = (successorId: string) => {
      if (input.absorb === undefined || absorbed.length === 0) return;
      tx.update(agentMemory)
        .set({ invalidAt: input.absorb.at, supersededBy: successorId })
        .where(inArray(agentMemory.id, [...absorbed]))
        .run();
    };
    if (row.content === input.content) {
      absorb(row.id);
      return row;
    }
    const duplicate = memoriesInScope(
      tx,
      { ...row, teamScoped: input.teamScoped },
      row.projectId === null,
    ).find(
      (other) =>
        other.id !== row.id && !absorbed.includes(other.id) && other.content === input.content,
    );
    if (duplicate) throw new HttpError(409, `memory ${duplicate.id} already has this content`);
    if (indexed !== undefined) {
      const updatedAt = Math.max(nowMs(), row.updatedAt + 1);
      const successor = {
        ...row,
        id: newRecordId(),
        content: input.content,
        createdAt: updatedAt,
        updatedAt,
      };
      const replacement = fileEntry(tx, successor);
      replaceMemory(
        tx,
        indexed.document,
        writeIndex(
          indexed.entries.map((fact) => (fact.id === indexed.entry.id ? replacement : fact)),
        ),
      );
      if (indexed.entry.fileId !== null)
        tx.update(agentMemory)
          .set({ invalidAt: updatedAt, supersededBy: replacement.fileId })
          .where(eq(agentMemory.id, indexed.entry.fileId))
          .run();
      return successor;
    }
    const successor = replaceMemory(tx, row, input.content);
    absorb(successor.id);
    return successor;
  });
}

export function isMemoryIndex(db: Db | MemoryTx, memoryId: string): boolean {
  const row = db.select().from(agentMemory).where(eq(agentMemory.id, memoryId)).get();
  return row !== undefined && indexRow(row);
}

export const MEMORY_VERSION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export function purgeExpiredMemoryVersions(db: Db, now: number = nowMs()): number {
  const cutoff = now - MEMORY_VERSION_RETENTION_MS;
  return db.transaction((tx) => {
    const purged = tx
      .delete(agentMemory)
      .where(and(isNotNull(agentMemory.invalidAt), lt(agentMemory.invalidAt, cutoff)))
      .run().changes;
    for (const row of tx
      .select({
        id: agentMemory.id,
        history: agentMemory.history,
        createdAt: agentMemory.createdAt,
      })
      .from(agentMemory)
      .where(sql`json_array_length(${agentMemory.history}) > 0`)
      .all()) {
      const kept = row.history.filter((_, index) => {
        const supersededAt = row.history[index + 1]?.updatedAt ?? row.createdAt;
        return supersededAt >= cutoff;
      });
      if (kept.length !== row.history.length) {
        tx.update(agentMemory).set({ history: kept }).where(eq(agentMemory.id, row.id)).run();
      }
    }
    return purged;
  });
}

export function foldMemoryIndexes(db: Db | MemoryTx, now: number = nowMs()): void {
  db.transaction((tx) => {
    tx.update(agentMemory)
      .set({ layer: 'searchable' })
      .where(eq(agentMemory.layer, 'log' as MemoryLayer))
      .run();
    const rows = tx
      .select()
      .from(agentMemory)
      .where(and(stillValid, eq(agentMemory.layer, 'core'), notAdoptedDuplicate()))
      .orderBy(asc(agentMemory.createdAt), sql`${agentMemory}.rowid`)
      .all();
    const groups = new Map<string, MemoryRow[]>();
    for (const row of rows) {
      const key = JSON.stringify([row.teamId, row.projectId, row.independent ? row.agentId : null]);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    for (const group of groups.values()) {
      const [head] = group;
      if (head === undefined || (group.length === 1 && indexRow(head))) continue;
      const injectedAt = group.flatMap((row) =>
        row.lastInjectedAt === null ? [] : [row.lastInjectedAt],
      );
      const entries = group.flatMap((row) =>
        indexRow(row) ? readIndex(row) : [fileEntry(tx, row)],
      );
      const index = tx
        .insert(agentMemory)
        .values({
          ...head,
          id: `${MEMORY_INDEX_ID_PREFIX}${newRecordId()}`,
          title: MEMORY_INDEX_TITLE,
          content: writeIndex(entries),
          sourceTodoId: null,
          sourceBuildId: null,
          source: null,
          history: [],
          invalidAt: null,
          supersededBy: null,
          lastInjectedAt: injectedAt.length === 0 ? null : Math.max(...injectedAt),
          createdAt: head.createdAt,
          updatedAt: Math.max(...group.map((row) => row.updatedAt)),
        })
        .returning()
        .get();
      tx.update(agentMemory)
        .set({ invalidAt: now, supersededBy: index.id })
        .where(
          inArray(
            agentMemory.id,
            group.map((row) => row.id),
          ),
        )
        .run();
    }
  });
}

export function promoteMemoryEntry(
  db: Db | MemoryTx,
  input: {
    memoryId: string;
    agentId: string;
    teamId: string;
    threadId?: string;
    teamScoped?: boolean;
  },
): typeof agentMemory.$inferSelect | null {
  const indexed = indexedFact(db, input, input.memoryId);
  if (indexed !== undefined) {
    if (indexed.row.projectId === null) return indexed.row;
    return db.transaction((tx) => {
      const saved = saveMemoryEntry(tx, {
        ...indexed.row,
        projectId: null,
        force: true,
        teamScoped: input.teamScoped,
      });
      if ('status' in saved) throw new HttpError(409, 'memory promotion returned candidates');
      removeIndexedFact(tx, indexed);
      foldMemoryIndexes(tx);
      const promoted = indexedFact(tx, input, saved.id);
      if (promoted === undefined) throw new HttpError(409, 'promoted memory is missing');
      replaceMemory(
        tx,
        promoted.document,
        writeIndex(
          promoted.entries.map((fact) =>
            fact.id === saved.id ? { ...fact, id: indexed.entry.id } : fact,
          ),
        ),
      );
      return { ...saved, id: indexed.entry.id };
    });
  }
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
  db: Db | MemoryTx,
  input: {
    memoryId: string;
    agentId: string;
    teamId: string;
    threadId?: string;
    teamScoped?: boolean;
  },
) {
  return db.transaction((tx) => {
    const indexed = indexedFact(tx, input, input.memoryId);
    if (indexed !== undefined) removeIndexedFact(tx, indexed);
    const removed =
      indexed === undefined
        ? tx
            .delete(agentMemory)
            .where(
              and(
                eq(agentMemory.id, input.memoryId),
                ownerWhere(input),
                scratchpadVisible(input.threadId),
              ),
            )
            .run().changes
        : 1;
    if (removed === 0) return 0;
    const removedIds = [input.memoryId, ...(indexed === undefined ? [] : [indexed.entry.id])];
    const mentioning = tx
      .select()
      .from(memorySaveConflict)
      .where(
        or(...removedIds.map((id) => sql`instr(${memorySaveConflict.candidateIds}, ${id}) > 0`)),
      )
      .all();
    const emptied: string[] = [];
    for (const fingerprint of mentioning) {
      const remaining = fingerprint.candidateIds.filter((id) => !removedIds.includes(id));
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
