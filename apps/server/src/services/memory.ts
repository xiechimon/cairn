import { createHash } from 'node:crypto';
import {
  ISSUE_FENCE_OPEN,
  MAIL_FENCE_OPEN,
  MEMORY_INDEX_ID_PREFIX,
  MEMORY_INDEX_TITLE,
  type MemoryLayer,
  memoryRecordSchema,
} from '@cairn/shared';
import { and, asc, eq, inArray, isNotNull, isNull, lt, ne, or, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { agentMemory } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';

export function validateMemoryText(title: string, content: string): void {
  if (
    title.includes(ISSUE_FENCE_OPEN) ||
    content.includes(ISSUE_FENCE_OPEN) ||
    title.includes(MAIL_FENCE_OPEN) ||
    content.includes(MAIL_FENCE_OPEN)
  ) {
    throw new HttpError(
      400,
      'invalid params.content: text quoted from a GitHub issue or mail fence is third-party data and is not saved as memory',
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

export const MEMORY_INDEX_MAX_LINES = 200;
export const MEMORY_INDEX_MAX_BYTES = 25 * 1024;

export interface InjectedMemory {
  id: string;
  title: string;
  content: string;
  baseVersion?: string;
}

interface InjectScope {
  agentId: string;
  projectId?: string | null;
  projectOnly?: boolean;
  recordUse?: boolean;
  teamId: string;
  teamScoped?: boolean;
  threadId?: string;
}

export function boundMemoryIndex(content: string): { content: string; omitted: number } {
  const lines = content === '' ? [] : content.split('\n');
  const prefix = lines.slice(0, MEMORY_INDEX_MAX_LINES).join('\n');
  const bytes = Buffer.from(prefix);
  let end = Math.min(bytes.length, MEMORY_INDEX_MAX_BYTES);
  while (end < bytes.length && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
  const loaded = bytes.subarray(0, end).toString('utf8');
  const loadedLines = loaded === '' ? 0 : loaded.split('\n').length;
  const omitted = lines.length - loadedLines + (end < bytes.length ? 1 : 0);
  return {
    content:
      omitted > 0
        ? `${loaded}\n（MEMORY.md 后面还有 ${omitted} 行没有加载；用 memories 读全文，并把细节移到记忆文件）`
        : loaded,
    omitted,
  };
}

export function memoryDocumentVersion(row: MemoryRow) {
  return `${row.id}:${row.updatedAt}:${row.invalidAt ?? 'live'}:${row.teamId}:${row.projectId ?? 'team'}:${row.agentId}:${row.independent}:${row.layer}:${row.title}`;
}

export function ensureMemoryIndex(
  db: Db | MemoryTx,
  scope: { agentId: string; teamId: string; projectId: string | null; teamScoped?: boolean },
) {
  return db.transaction((tx) => {
    const where = and(
      ownerWhere(scope),
      eq(agentMemory.independent, scope.teamScoped === false),
      scope.projectId === null
        ? isNull(agentMemory.projectId)
        : eq(agentMemory.projectId, scope.projectId),
    );
    foldMemoryIndexes(tx, nowMs(), where);
    const existing = tx
      .select()
      .from(agentMemory)
      .where(and(where, stillValid, eq(agentMemory.layer, 'core')))
      .get();
    if (existing) return existing;
    const now = nowMs();
    return tx
      .insert(agentMemory)
      .values({
        agentId: scope.agentId,
        teamId: scope.teamId,
        projectId: scope.projectId,
        id: `${MEMORY_INDEX_ID_PREFIX}${newRecordId()}`,
        title: MEMORY_INDEX_TITLE,
        content: '',
        independent: scope.teamScoped === false,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  });
}

export function injectMemoryDocuments(
  db: Db,
  scope: InjectScope,
): { memories: InjectedMemory[]; omitted: number; fileCount: number } {
  return db.transaction((tx) => {
    const owner = and(
      ownerWhere(scope),
      notAdoptedDuplicate(),
      eq(agentMemory.independent, scope.teamScoped === false),
    );
    const projectId = scope.projectId ?? null;
    const project =
      projectId === null
        ? isNull(agentMemory.projectId)
        : scope.projectOnly
          ? eq(agentMemory.projectId, projectId)
          : or(eq(agentMemory.projectId, projectId), isNull(agentMemory.projectId));
    const namespaces = (
      scope.projectOnly || projectId === null ? [projectId] : [null, projectId]
    ).map((projectId) => ({ ...scope, projectId }));
    const memories: InjectedMemory[] = [];
    let omitted = 0;
    for (const namespace of namespaces.values()) {
      const index = ensureMemoryIndex(tx, namespace);
      const rendered = memoryIndexText(index);
      const bounded = boundMemoryIndex(rendered);
      omitted += bounded.omitted;
      memories.push({
        id: index.id,
        title: MEMORY_INDEX_TITLE,
        content: bounded.content,
        baseVersion: memoryDocumentVersion(index),
      });
      if (scope.recordUse !== false && rendered !== '') {
        tx.update(agentMemory)
          .set({ lastInjectedAt: nowMs() })
          .where(eq(agentMemory.id, index.id))
          .run();
      }
    }
    const pads = tx
      .select()
      .from(agentMemory)
      .where(
        and(
          owner,
          project,
          stillValid,
          eq(agentMemory.layer, 'scratchpad'),
          scope.threadId === undefined ? sql`0` : eq(agentMemory.threadId, scope.threadId),
        ),
      )
      .orderBy(asc(agentMemory.createdAt), sql`${agentMemory}.rowid`)
      .all();
    memories.push(...pads.map(({ id, title, content }) => ({ id, title, content })));
    const fileCount =
      tx
        .select({ count: sql<number>`count(*)` })
        .from(agentMemory)
        .where(and(owner, project, stillValid, eq(agentMemory.layer, 'searchable')))
        .get()?.count ?? 0;
    return { memories, omitted, fileCount };
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
  return injectMemoryDocuments(db, scope).memories.map(({ title, content }) => ({
    title,
    content,
  }));
}

type MemoryRow = typeof agentMemory.$inferSelect;

const factMetadataSchema = memoryRecordSchema
  .pick({
    createdAt: true,
    updatedAt: true,
    lastInjectedAt: true,
    history: true,
    source: true,
    sourceTodoId: true,
    sourceBuildId: true,
  })
  .required();
const indexFactSchema = factMetadataSchema
  .extend({
    id: z.string(),
    title: z.string(),
    content: z.string(),
    fileId: z.string().nullable(),
    fileName: z.string().optional(),
  })
  .strict();
type IndexFact = z.infer<typeof indexFactSchema>;

function indexRow(row: Pick<MemoryRow, 'id' | 'layer'>): boolean {
  return row.layer === 'core' && row.id.startsWith(MEMORY_INDEX_ID_PREFIX);
}

export const MEMORY_MARKDOWN_INDEX_PREFIX = `${MEMORY_INDEX_ID_PREFIX}markdown:`;
function encodedIndex(row: Pick<MemoryRow, 'id' | 'content'>) {
  return !row.id.startsWith(MEMORY_MARKDOWN_INDEX_PREFIX) && row.content.startsWith('- {"');
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

export function memoryIndexText(row: MemoryRow): string {
  if (row.layer !== 'core' || !encodedIndex(row)) return row.content;
  try {
    return readIndex(row)
      .map(
        (fact) =>
          `- ${fact.title.replace(/[\r\n]+/g, ' ')}：${fact.content}${fact.fileId === null ? '' : `（记忆文件：${(fact.fileName ?? fact.title).replace(/[\r\n]+/g, ' ')}）`}`,
      )
      .join('\n');
  } catch {
    return row.content;
  }
}

function writeIndex(facts: IndexFact[]): string {
  return facts.map((fact) => `- ${JSON.stringify(fact)}`).join('\n');
}

function indexFacts(db: Db | MemoryTx, row: MemoryRow): MemoryRow[] {
  if (indexRow(row) && row.content === '') return [];
  if (!indexRow(row) || !encodedIndex(row)) return [row];
  return readIndex(row).map(({ fileId, ...fact }) => {
    const file =
      fileId === null
        ? undefined
        : db
            .select()
            .from(agentMemory)
            .where(
              and(
                eq(agentMemory.id, fileId),
                ownerWhere({ ...row, teamScoped: !row.independent }),
                row.projectId === null
                  ? isNull(agentMemory.projectId)
                  : eq(agentMemory.projectId, row.projectId),
                eq(agentMemory.layer, 'searchable'),
                stillValid,
              ),
            )
            .get();
    if (fileId !== null && file === undefined)
      throw new HttpError(409, `missing memory file ${fileId}`);
    return {
      ...row,
      ...fact,
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
      .filter((row) => indexRow(row) && encodedIndex(row))
      .flatMap((row) =>
        readIndex(row).flatMap((fact) => (fact.fileId === null ? [] : [fact.fileId])),
      ),
  );
  const expanded = rows
    .filter((row) => !files.has(row.id) && (!indexRow(row) || row.invalidAt === null))
    .flatMap((row) => indexFacts(db, row));
  const activeIds = new Set(expanded.filter((row) => row.invalidAt === null).map((row) => row.id));
  return expanded.filter((row) => row.invalidAt === null || !activeIds.has(row.id));
}

export function listMemoryEntries(...args: Parameters<typeof listStoredMemoryEntries>) {
  const rows = listStoredMemoryEntries(...args);
  return factRows(args[0], rows);
}

function indexedFact(
  db: Db | MemoryTx,
  scope: Parameters<typeof listStoredMemoryEntries>[1],
  id: string,
) {
  for (const document of listStoredMemoryEntries(db, scope).filter(
    (row) => indexRow(row) && encodedIndex(row),
  )) {
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
  return { ...factMetadataSchema.parse(row), id: row.id, title: row.title, content: first, fileId };
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
    teamScoped?: boolean;
  },
) {
  validateMemoryText(input.title, input.content);
  return db.transaction((tx) => {
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

export function replaceMemory(
  tx: MemoryTx,
  row: MemoryRow,
  content: string,
  markdown = false,
): MemoryRow {
  const now = Math.max(nowMs(), row.updatedAt + 1);
  const successor = tx
    .insert(agentMemory)
    .values({
      ...row,
      id: indexRow(row)
        ? `${markdown ? MEMORY_MARKDOWN_INDEX_PREFIX : MEMORY_INDEX_ID_PREFIX}${newRecordId()}`
        : newRecordId(),
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

function archiveFact(
  tx: MemoryTx,
  row: MemoryRow,
  invalidAt: number,
  supersededBy: string | null,
): void {
  const version = { ...row, invalidAt, supersededBy };
  tx.insert(agentMemory)
    .values(version)
    .onConflictDoUpdate({ target: agentMemory.id, set: version })
    .run();
}

function removeIndexedFact(
  tx: MemoryTx,
  indexed: NonNullable<ReturnType<typeof indexedFact>>,
): void {
  const entries = indexed.entries.filter((fact) => fact.id !== indexed.entry.id);
  const invalidAt = Math.max(nowMs(), indexed.document.updatedAt + 1);
  archiveFact(tx, indexed.row, invalidAt, null);
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
        history: [
          ...row.history,
          { title: row.title, content: row.content, updatedAt: row.updatedAt },
        ],
      };
      archiveFact(tx, row, updatedAt, successor.id);
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

function retainedHistory(row: Pick<MemoryRow, 'history' | 'createdAt'>, cutoff: number) {
  return row.history.filter((_, index) => {
    const supersededAt = row.history[index + 1]?.updatedAt ?? row.createdAt;
    return supersededAt >= cutoff;
  });
}

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
      const kept = retainedHistory(row, cutoff);
      if (kept.length !== row.history.length) {
        tx.update(agentMemory).set({ history: kept }).where(eq(agentMemory.id, row.id)).run();
      }
    }
    for (const row of tx
      .select()
      .from(agentMemory)
      .where(and(stillValid, eq(agentMemory.layer, 'core')))
      .all()
      .filter((row) => indexRow(row) && encodedIndex(row))) {
      const facts = readIndex(row);
      const kept = facts.map((fact) => ({ ...fact, history: retainedHistory(fact, cutoff) }));
      if (kept.some((fact, i) => fact.history.length !== facts[i]?.history.length))
        tx.update(agentMemory)
          .set({ content: writeIndex(kept) })
          .where(eq(agentMemory.id, row.id))
          .run();
    }
    return purged;
  });
}

export function normalizeMemoryFileName(title: string): string {
  const name = title.replace(/[\r\n\0]+/g, ' ').replace(/[\uD800-\uDBFF]$/, '') || 'untitled.md';
  return name.length <= 1024
    ? name
    : `${name.slice(0, 980).replace(/[\uD800-\uDBFF]$/, '')}-${createHash('sha256').update(title).digest('hex').slice(0, 32)}.md`;
}

export function allocateMemoryFileName(title: string, reserved: ReadonlySet<string>): string {
  const normalized = normalizeMemoryFileName(title);
  if (!reserved.has(normalized)) return normalized;
  const stem = normalized.endsWith('.md') ? normalized.slice(0, -3) : normalized;
  const extension = normalized.endsWith('.md') ? '.md' : '';
  for (let n = 2; ; n++) {
    const suffix = ` (${n})${extension}`;
    const candidate = `${stem.slice(0, 1024 - suffix.length).replace(/[\uD800-\uDBFF]$/, '')}${suffix}`;
    if (!reserved.has(candidate)) return candidate;
  }
}

type MemoryFileChange = {
  before: Pick<MemoryRow, 'id' | 'title'>;
  after: Pick<MemoryRow, 'id' | 'title'>;
};

function rewrittenMemoryIndex(
  index: Pick<MemoryRow, 'id' | 'content'>,
  changes: MemoryFileChange[],
) {
  if (encodedIndex(index)) {
    return writeIndex(
      readIndex(index).map((fact) => {
        const change = changes.find(({ before }) => before.id === fact.fileId);
        return change ? { ...fact, fileId: change.after.id, fileName: change.after.title } : fact;
      }),
    );
  }
  const replacements = new Map<string, string>();
  for (const { before, after } of changes) {
    if (before.title === after.title) continue;
    const pairs = [
      [`](${encodeURIComponent(before.title)})`, `](${encodeURIComponent(after.title)})`],
      [`（记忆文件：${before.title}）`, `（记忆文件：${after.title}）`],
      [`（记忆文件：${before.title.replace(/[\r\n]+/g, ' ')}）`, `（记忆文件：${after.title}）`],
    ];
    for (const [from, to] of pairs)
      if (from !== undefined && to !== undefined && !replacements.has(from))
        replacements.set(from, to);
  }
  if (replacements.size === 0) return index.content;
  const pattern = [...replacements.keys()]
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return index.content.replace(
    new RegExp(pattern, 'g'),
    (token) => replacements.get(token) ?? token,
  );
}

export function rewriteMemoryReferences(
  tx: MemoryTx,
  owner: Pick<MemoryRow, 'agentId' | 'teamId' | 'projectId' | 'independent'>,
  changes: MemoryFileChange[],
  now = nowMs(),
): void {
  if (changes.length === 0) return;
  const indexes = tx
    .select()
    .from(agentMemory)
    .where(
      and(
        ownerWhere({ ...owner, teamScoped: !owner.independent }),
        eq(agentMemory.independent, owner.independent),
        owner.projectId === null
          ? isNull(agentMemory.projectId)
          : eq(agentMemory.projectId, owner.projectId),
        stillValid,
        eq(agentMemory.layer, 'core'),
      ),
    )
    .all()
    .filter(indexRow);
  for (const index of indexes) {
    const content = rewrittenMemoryIndex(index, changes);
    if (content !== index.content)
      tx.update(agentMemory)
        .set({ content, updatedAt: Math.max(now, index.updatedAt + 1) })
        .where(eq(agentMemory.id, index.id))
        .run();
  }
}

export function foldMemoryIndexes(db: Db | MemoryTx, now: number = nowMs(), scope?: SQL): void {
  db.transaction((tx) => {
    const markdownFolds: {
      id: string;
      render: (changes: MemoryFileChange[]) => string;
      key: string;
    }[] = [];
    const namespaceChanges = new Map<string, MemoryFileChange[]>();
    tx.update(agentMemory)
      .set({ layer: 'searchable' })
      .where(and(scope, eq(agentMemory.layer, 'log' as MemoryLayer)))
      .run();
    const rows = tx
      .select()
      .from(agentMemory)
      .where(and(scope, stillValid, eq(agentMemory.layer, 'core'), notAdoptedDuplicate()))
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
      const existingText = group.some((row) => indexRow(row) && !encodedIndex(row));
      const parts = group.map((row) =>
        indexRow(row) ? (encodedIndex(row) ? readIndex(row) : row.content) : [fileEntry(tx, row)],
      );
      const render = (changes: MemoryFileChange[] = []) =>
        parts
          .map((part) => {
            if (typeof part === 'string')
              return rewrittenMemoryIndex(
                { id: MEMORY_MARKDOWN_INDEX_PREFIX, content: part },
                changes,
              );
            return memoryIndexText({
              ...head,
              id: MEMORY_INDEX_ID_PREFIX,
              content: rewrittenMemoryIndex(
                { id: MEMORY_INDEX_ID_PREFIX, content: writeIndex(part) },
                changes,
              ),
            });
          })
          .filter(Boolean)
          .join('\n');
      const content = existingText
        ? render()
        : writeIndex(parts.flatMap((part) => (typeof part === 'string' ? [] : part)));
      const index = tx
        .insert(agentMemory)
        .values({
          ...head,
          id: `${existingText ? MEMORY_MARKDOWN_INDEX_PREFIX : MEMORY_INDEX_ID_PREFIX}${newRecordId()}`,
          title: MEMORY_INDEX_TITLE,
          content,
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
      if (existingText)
        markdownFolds.push({
          id: index.id,
          render,
          key: JSON.stringify([
            head.teamId,
            head.projectId,
            head.independent ? head.agentId : null,
          ]),
        });
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
    const files = tx
      .select()
      .from(agentMemory)
      .where(
        and(
          scope,
          notAdoptedDuplicate(),
          eq(agentMemory.layer, 'searchable'),
          or(stillValid, isNull(agentMemory.supersededBy)),
        ),
      )
      .orderBy(asc(agentMemory.createdAt), sql`${agentMemory}.rowid`)
      .all();
    const namespaces = new Map<string, MemoryRow[]>();
    for (const row of files) {
      const key = JSON.stringify([row.teamId, row.projectId, row.independent ? row.agentId : null]);
      namespaces.set(key, [...(namespaces.get(key) ?? []), row]);
    }
    for (const [key, files] of namespaces) {
      const reserved = new Set([
        MEMORY_INDEX_TITLE,
        ...files.map((row) => normalizeMemoryFileName(row.title)),
      ]);
      const literals = new Set(files.map((row) => row.title));
      const used = new Set([MEMORY_INDEX_TITLE]);
      const changes: MemoryFileChange[] = [];
      for (const row of files) {
        const normalized = normalizeMemoryFileName(row.title);
        const title =
          used.has(normalized) || (normalized !== row.title && literals.has(normalized))
            ? allocateMemoryFileName(normalized, reserved)
            : normalized;
        if (title !== row.title) {
          tx.update(agentMemory)
            .set({ title, updatedAt: Math.max(now, row.updatedAt + 1) })
            .where(eq(agentMemory.id, row.id))
            .run();
          changes.push({ before: row, after: { ...row, title } });
        }
        used.add(title);
        reserved.add(title);
      }
      namespaceChanges.set(key, changes);
      const head = files[0];
      if (head) rewriteMemoryReferences(tx, head, changes, now);
    }
    for (const { id, render, key } of markdownFolds) {
      const index = tx.select().from(agentMemory).where(eq(agentMemory.id, id)).get();
      const content = render(namespaceChanges.get(key) ?? []);
      if (index && index.content !== content)
        tx.update(agentMemory)
          .set({ content, updatedAt: Math.max(now, index.updatedAt + 1) })
          .where(eq(agentMemory.id, id))
          .run();
    }
  });
}

export function moveProjectMemoriesToTeam(db: Db | MemoryTx, projectId: string): void {
  db.transaction((tx) => {
    foldMemoryIndexes(tx);
    const incoming = tx
      .select()
      .from(agentMemory)
      .where(and(eq(agentMemory.projectId, projectId), notAdoptedDuplicate()))
      .orderBy(asc(agentMemory.createdAt), sql`${agentMemory}.rowid`)
      .all();
    const owners = new Map(
      incoming.map((row) => [
        row.independent ? row.agentId : null,
        { ...row, teamScoped: !row.independent },
      ]),
    );
    for (const owner of owners.values()) {
      const files = incoming.filter(
        (row) =>
          row.layer === 'searchable' &&
          row.supersededBy === null &&
          row.independent === owner.independent &&
          (!row.independent || row.agentId === owner.agentId),
      );
      const taken = new Set(
        listStoredMemoryEntries(tx, { ...owner, threadId: undefined }, true)
          .filter(
            (row) =>
              row.projectId === null &&
              row.independent === owner.independent &&
              row.adoptedFrom === null &&
              row.layer === 'searchable' &&
              row.supersededBy === null,
          )
          .map((row) => row.title),
      );
      const reserved = new Set([...taken, ...files.map((row) => row.title), MEMORY_INDEX_TITLE]);
      const changes: MemoryFileChange[] = [];
      for (const file of files) {
        const title = taken.has(file.title)
          ? allocateMemoryFileName(file.title, reserved)
          : file.title;
        taken.add(title);
        reserved.add(title);
        if (title === file.title) continue;
        changes.push({ before: file, after: { ...file, title } });
        tx.update(agentMemory)
          .set({ title, updatedAt: Math.max(nowMs(), file.updatedAt + 1) })
          .where(eq(agentMemory.id, file.id))
          .run();
      }
      rewriteMemoryReferences(tx, owner, changes);
    }
    tx.update(agentMemory)
      .set({ projectId: null })
      .where(eq(agentMemory.projectId, projectId))
      .run();
    foldMemoryIndexes(tx);
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
        teamScoped: input.teamScoped,
      });
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
  if (indexRow(row))
    throw new HttpError(400, 'memory index is managed; promote a fact ID from memories');
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
    const physical =
      indexed === undefined
        ? tx
            .select()
            .from(agentMemory)
            .where(
              and(
                eq(agentMemory.id, input.memoryId),
                ownerWhere(input),
                scratchpadVisible(input.threadId),
              ),
            )
            .get()
        : undefined;
    if (physical !== undefined && indexRow(physical))
      throw new HttpError(400, 'memory index is managed; delete a fact ID from memories');
    const removed =
      indexed !== undefined
        ? 1
        : physical === undefined
          ? 0
          : tx.delete(agentMemory).where(eq(agentMemory.id, physical.id)).run().changes;
    if (removed === 0) return 0;
    return removed;
  });
}
