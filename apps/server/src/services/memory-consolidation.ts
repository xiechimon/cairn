import {
  CONSOLIDATION_FILE_EXCERPT_CHARS,
  CONSOLIDATION_INDEX_MAX_BYTES,
  CONSOLIDATION_INDEX_MAX_LINES,
  CONSOLIDATION_MAX_DROPS,
  CONSOLIDATION_MAX_EDITS,
  CONSOLIDATION_SOURCE,
  MEMORY_INDEX_TITLE,
  type MemoryConsolidationEdit,
  type MemoryConsolidationRecord,
  type MemoryConsolidationStatus,
} from '@cairn/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  agentMemory,
  type MemoryConsolidationDroppedFile,
  memoryConsolidation,
  project,
} from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { listStoredMemoryEntries, memoryDocumentVersion } from './memory.js';
import {
  memoryDocumentVersion as documentVersion,
  executeMemoryDocumentTool,
} from './memory-documents.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const CONSOLIDATION_RETENTION_ROWS = 10;
export const CONSOLIDATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const IMPORT_SOURCE_PREFIX = 'import:';

export class ConsolidationStale extends Error {
  constructor(message = 'memory changed while the consolidation ran') {
    super(message);
  }
}

export interface EvidenceMessage {
  role: string;
  text: string;
  at: number;
}

export interface CapturedFile {
  id: string;
  title: string;
  content: string;
  source: string | null;
}

export interface ConsolidationCapture {
  teamId: string;
  projectId: string | null;
  agentId: string;
  indexId: string;
  indexVersion: string;
  indexText: string;
  files: CapturedFile[];
  evidence: EvidenceMessage[];
}

export interface ModelEdit {
  op: 'merge' | 'rewrite' | 'delete';
  lines: number[];
  text?: string;
  message?: number;
  why: string;
}

export interface ModelDrop {
  file: string;
  why: string;
}

export interface ConsolidationPlan {
  text: string;
  edits: MemoryConsolidationEdit[];
  drops: MemoryConsolidationDroppedFile[];
}

const textOrEmpty = (value: unknown) => (typeof value === 'string' ? value : '');
const reasonOf = (value: unknown) =>
  textOrEmpty(value)
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 300);

function answerJson(raw: string): unknown {
  const fenced = /^```\w*\n([\s\S]*?)\n```$/.exec(raw.trim());
  try {
    return JSON.parse((fenced?.[1] ?? raw).trim());
  } catch {
    throw new Error('consolidation answer is not JSON');
  }
}

export function parseConsolidationAnswer(raw: string): {
  edits: ModelEdit[];
  dropFiles: ModelDrop[];
} {
  const answer = answerJson(raw);
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer))
    throw new Error('consolidation answer is not an object');
  const record = answer as Record<string, unknown>;
  const rawEdits = Array.isArray(record.edits) ? record.edits : [];
  const edits = rawEdits.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object') return [];
    const edit = entry as Record<string, unknown>;
    const op = edit.op;
    if (op !== 'merge' && op !== 'rewrite' && op !== 'delete') return [];
    if (!Array.isArray(edit.lines)) return [];
    const lines = edit.lines.filter(
      (line): line is number => typeof line === 'number' && Number.isInteger(line) && line > 0,
    );
    if (lines.length !== edit.lines.length || lines.length === 0) return [];
    return [
      {
        op,
        lines: [...new Set(lines)],
        ...(typeof edit.text === 'string' ? { text: edit.text } : {}),
        ...(typeof edit.message === 'number' && Number.isInteger(edit.message) && edit.message > 0
          ? { message: edit.message }
          : {}),
        why: reasonOf(edit.why),
      } satisfies ModelEdit,
    ];
  });
  const rawDrops = Array.isArray(record.dropFiles) ? record.dropFiles : [];
  const dropFiles = rawDrops.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object') return [];
    const drop = entry as Record<string, unknown>;
    const file = textOrEmpty(drop.file).trim();
    return file === '' ? [] : [{ file, why: reasonOf(drop.why) } satisfies ModelDrop];
  });
  return { edits, dropFiles };
}

function withinBudget(text: string): boolean {
  return (
    text.split('\n').length <= CONSOLIDATION_INDEX_MAX_LINES &&
    Buffer.byteLength(text) <= CONSOLIDATION_INDEX_MAX_BYTES
  );
}

function overBudget(text: string): boolean {
  return (
    text.split('\n').length > CONSOLIDATION_INDEX_MAX_LINES ||
    Buffer.byteLength(text) > CONSOLIDATION_INDEX_MAX_BYTES
  );
}

export type PlanResult = { ok: true; plan: ConsolidationPlan } | { ok: false; why: string };

export function planConsolidation(
  capture: Pick<ConsolidationCapture, 'indexText' | 'files' | 'evidence'>,
  answer: { edits: ModelEdit[]; dropFiles: ModelDrop[] },
): PlanResult {
  const lines = capture.indexText === '' ? [] : capture.indexText.split('\n');
  if (lines.length === 0) return { ok: false, why: 'the index is empty' };
  const edits = answer.edits.slice(0, CONSOLIDATION_MAX_EDITS);
  if (edits.length === 0 && answer.dropFiles.length === 0) return { ok: false, why: '' };
  const used = new Set<number>();
  const removed = new Set<number>();
  const replaced = new Map<number, string>();
  const recorded: MemoryConsolidationEdit[] = [];
  for (const edit of edits) {
    const numbers = edit.lines;
    if (numbers.some((line) => line > lines.length))
      return {
        ok: false,
        why: `line ${numbers.find((line) => line > lines.length)} does not exist`,
      };
    if (numbers.some((line) => used.has(line)))
      return { ok: false, why: 'two edits name the same line' };
    for (const line of numbers) used.add(line);
    if (edit.op === 'rewrite' && numbers.length !== 1)
      return { ok: false, why: 'rewrite needs exactly one line' };
    if (edit.op === 'merge' && numbers.length < 2)
      return { ok: false, why: 'merge needs two or more lines' };
    if (edit.op === 'delete') {
      const deleted = numbers
        .map((line) => lines[line - 1] ?? '')
        .filter((text) => text.trim() !== '');
      const duplicate =
        deleted.length > 0 &&
        deleted.every((text) =>
          lines.some((line, index) => !numbers.includes(index + 1) && line.trim() === text.trim()),
        );
      const cited =
        edit.message !== undefined && edit.message >= 1 && edit.message <= capture.evidence.length;
      if (!duplicate && !cited)
        return {
          ok: false,
          why: 'a deletion needs a duplicate line or a cited recent message',
        };
    }
    let replacement = '';
    if (edit.op !== 'delete') {
      const text = (edit.text ?? '').trim();
      if (text === '' || text.includes('\n'))
        return { ok: false, why: 'a merge or rewrite needs one replacement line' };
      if (!text.startsWith('- ')) return { ok: false, why: 'a replacement line starts with "- "' };
      replacement = text;
    }
    const before = numbers
      .slice()
      .sort((a, b) => a - b)
      .map((line) => lines[line - 1] ?? '')
      .join('\n');
    if (replacement !== '' && replacement === before) continue;
    if (replacement !== '') replaced.set(Math.min(...numbers), replacement);
    for (const line of numbers) removed.add(line);
    recorded.push({ kind: edit.op, lines: numbers, before, after: replacement, why: edit.why });
  }
  const next = lines
    .map((line, index) =>
      replaced.has(index + 1) ? replaced.get(index + 1) : removed.has(index + 1) ? null : line,
    )
    .filter((line): line is string => line !== null)
    .join('\n');
  if (next.trim() === '') return { ok: false, why: 'the index would be empty' };
  if (next.length > capture.indexText.length) return { ok: false, why: 'the index would grow' };
  if (overBudget(capture.indexText) && !withinBudget(next))
    return { ok: false, why: 'the index stays over its budget' };
  const live = new Map(capture.files.map((file) => [file.title, file]));
  const drops = answer.dropFiles.slice(0, CONSOLIDATION_MAX_DROPS).flatMap((drop) => {
    const file = live.get(drop.file);
    if (file === undefined || file.title === MEMORY_INDEX_TITLE) return [];
    if (file.source?.startsWith(IMPORT_SOURCE_PREFIX)) return [];
    if (next.includes(`[${file.title}]`)) return [];
    return [
      {
        title: file.title,
        memoryId: file.id,
        content: file.content.length > 4 * 1024 ? file.content.slice(0, 4 * 1024) : file.content,
        why: drop.why,
      } satisfies MemoryConsolidationDroppedFile,
    ];
  });
  if (recorded.length === 0 && drops.length === 0) return { ok: false, why: '' };
  return { ok: true, plan: { text: next, edits: recorded, drops } };
}

function scopeWhere(scope: { teamId: string; projectId: string | null }) {
  return scope.projectId === null
    ? isNull(agentMemory.projectId)
    : eq(agentMemory.projectId, scope.projectId);
}

function capturedVersion(db: Db | Tx, capture: ConsolidationCapture) {
  const row = db
    .select()
    .from(agentMemory)
    .where(
      and(
        eq(agentMemory.id, capture.indexId),
        eq(agentMemory.teamId, capture.teamId),
        eq(agentMemory.agentId, capture.agentId),
        isNull(agentMemory.invalidAt),
      ),
    )
    .get();
  if (row === undefined) return null;
  const version = memoryDocumentVersion(row);
  return version === capture.indexVersion ? row : null;
}

export function captureMemory(
  db: Db,
  scope: { teamId: string; agentId: string; projectId: string | null },
  evidence: EvidenceMessage[],
): ConsolidationCapture | null {
  const rows = listStoredMemoryEntries(db, { agentId: scope.agentId, teamId: scope.teamId });
  const index = rows.find(
    (row) =>
      row.layer === 'core' &&
      ((scope.projectId === null && row.projectId === null) || row.projectId === scope.projectId),
  );
  if (index === undefined) return null;
  const files = rows
    .filter(
      (row) =>
        row.layer === 'searchable' &&
        row.invalidAt === null &&
        row.supersededBy === null &&
        row.projectId === scope.projectId,
    )
    .map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      source: row.source ?? null,
    }));
  return {
    teamId: scope.teamId,
    projectId: scope.projectId,
    agentId: scope.agentId,
    indexId: index.id,
    indexVersion: memoryDocumentVersion(index),
    indexText: index.content,
    files,
    evidence,
  };
}

export function consolidationPrompt(
  capture: ConsolidationCapture,
  head: string,
  previous: MemoryConsolidationRecord | null = null,
): string {
  const lines = capture.indexText.split('\n');
  const numbered =
    capture.indexText === ''
      ? '(empty)'
      : lines.map((line, index) => `${index + 1}. ${line}`).join('\n');
  const files =
    capture.files.length === 0
      ? '(none)'
      : capture.files
          .map((file) => {
            const excerpt = file.content.slice(0, CONSOLIDATION_FILE_EXCERPT_CHARS);
            const size = Buffer.byteLength(file.content);
            return `--- ${file.title} (${size} bytes)\n${excerpt}${size > excerpt.length ? '\n(truncated)' : ''}`;
          })
          .join('\n');
  const evidence =
    capture.evidence.length === 0
      ? '(no recent messages in this scope)'
      : [
          '```',
          capture.evidence
            .map(
              (message, index) =>
                `[${index + 1}] ${message.role === 'user' ? '用户' : '总管'}：${message.text}`,
            )
            .join('\n'),
          '```',
        ].join('\n');
  const lastPass =
    previous === null
      ? ''
      : previous.undoneAt === null
        ? `\nPrevious pass (${previous.status}): ${previous.summary}`
        : `\nPrevious pass: the user undid it, so do not repeat these edits:\n${previous.edits
            .slice(0, 6)
            .map((edit) => `${edit.kind} ${edit.lines.join(',')}: ${edit.after || edit.before}`)
            .join('\n')}`;
  return `${head}

Scope: ${capture.projectId === null ? 'team' : capture.projectId}
Index budget: ${CONSOLIDATION_INDEX_MAX_LINES} lines, ${CONSOLIDATION_INDEX_MAX_BYTES} bytes. Current: ${lines.length} lines, ${Buffer.byteLength(capture.indexText)} bytes.

Numbered MEMORY.md:
${numbered}

Memory files:
${files}

Recent messages:
${evidence}${lastPass}`;
}

export interface RecordMeta {
  teamId: string;
  agentId: string;
  projectId: string | null;
  status: MemoryConsolidationStatus;
  summary: string;
  provider: string | null;
  modelId: string | null;
  startedAt: number;
  beforeText: string;
  afterText: string;
  edits: MemoryConsolidationEdit[];
  dropFiles: MemoryConsolidationDroppedFile[];
}

function prune(db: Db | Tx, teamId: string, projectId: string | null) {
  const rows = db
    .select({
      id: memoryConsolidation.id,
      status: memoryConsolidation.status,
      startedAt: memoryConsolidation.startedAt,
    })
    .from(memoryConsolidation)
    .where(
      and(
        eq(memoryConsolidation.teamId, teamId),
        projectId === null
          ? isNull(memoryConsolidation.projectId)
          : eq(memoryConsolidation.projectId, projectId),
      ),
    )
    .orderBy(desc(memoryConsolidation.startedAt))
    .all();
  const cutoff = nowMs() - CONSOLIDATION_RETENTION_MS;
  const newestApplied = rows.find((row) => row.status === 'applied')?.id ?? null;
  const limit =
    newestApplied === null ? CONSOLIDATION_RETENTION_ROWS : CONSOLIDATION_RETENTION_ROWS - 1;
  let others = 0;
  const stale = rows.filter((row) => {
    if (row.id === newestApplied) return false;
    if (others >= limit || row.startedAt < cutoff) return true;
    others += 1;
    return false;
  });
  for (const row of stale)
    db.delete(memoryConsolidation).where(eq(memoryConsolidation.id, row.id)).run();
}

function insertRecord(db: Db | Tx, meta: RecordMeta): MemoryConsolidationRecord {
  const row = db
    .insert(memoryConsolidation)
    .values({
      id: newRecordId(),
      teamId: meta.teamId,
      agentId: meta.agentId,
      projectId: meta.projectId,
      status: meta.status,
      summary: meta.summary,
      provider: meta.provider,
      modelId: meta.modelId,
      edits: meta.edits,
      dropFiles: meta.dropFiles,
      beforeText: meta.beforeText,
      afterText: meta.afterText,
      startedAt: meta.startedAt,
      finishedAt: nowMs(),
      undoneAt: null,
    })
    .returning()
    .get();
  return toRecord(row);
}

function toRecord(row: typeof memoryConsolidation.$inferSelect): MemoryConsolidationRecord {
  return {
    id: row.id,
    teamId: row.teamId,
    projectId: row.projectId,
    status: row.status,
    summary: row.summary,
    provider: row.provider,
    modelId: row.modelId,
    edits: row.edits,
    dropFiles: row.dropFiles.map((drop) => {
      const { title, memoryId, why } = drop;
      return { title, memoryId, why };
    }),
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    undoneAt: row.undoneAt,
  };
}

export function recordConsolidation(
  db: Db,
  meta: RecordMeta & { status: 'empty' | 'rejected' },
): MemoryConsolidationRecord {
  return db.transaction((tx) => {
    const record = insertRecord(tx, meta);
    prune(tx, meta.teamId, meta.projectId);
    return record;
  });
}

export function applyConsolidation(
  db: Db,
  capture: ConsolidationCapture,
  plan: ConsolidationPlan,
  meta: Omit<RecordMeta, 'status' | 'summary' | 'beforeText' | 'afterText' | 'edits' | 'dropFiles'>,
): MemoryConsolidationRecord {
  return db.transaction((tx) => {
    if (capturedVersion(tx, capture) === null) throw new ConsolidationStale();
    if (capture.projectId !== null) {
      const live = tx
        .select({ archivedAt: project.archivedAt })
        .from(project)
        .where(eq(project.id, capture.projectId))
        .get();
      if (live === undefined || live.archivedAt !== null)
        throw new ConsolidationStale('the project was archived while the consolidation ran');
    }
    const owner = {
      agentId: capture.agentId,
      teamId: capture.teamId,
      projectId: capture.projectId,
      source: CONSOLIDATION_SOURCE,
    };
    for (const drop of plan.drops) {
      const file = capture.files.find((candidate) => candidate.title === drop.title);
      if (file === undefined) throw new ConsolidationStale(`memory file ${drop.title} is gone`);
      const current = tx
        .select()
        .from(agentMemory)
        .where(and(eq(agentMemory.id, file.id), eq(agentMemory.teamId, capture.teamId)))
        .get();
      if (current === undefined || current.invalidAt !== null || current.supersededBy !== null)
        throw new ConsolidationStale(`memory file ${drop.title} is gone`);
      executeMemoryDocumentTool(tx, owner, 'delete_memory', {
        scope: capture.projectId ?? 'team',
        file: drop.title,
        baseVersion: documentVersion(current),
      });
    }
    executeMemoryDocumentTool(tx, owner, 'update_memory', {
      scope: capture.projectId ?? 'team',
      file: MEMORY_INDEX_TITLE,
      baseVersion: capture.indexVersion,
      content: plan.text,
    });
    const record = insertRecord(tx, {
      ...meta,
      teamId: capture.teamId,
      projectId: capture.projectId,
      status: 'applied',
      summary: '',
      beforeText: capture.indexText,
      afterText: plan.text,
      edits: plan.edits,
      dropFiles: plan.drops,
    });
    prune(tx, capture.teamId, capture.projectId);
    return record;
  });
}

export function listConsolidations(
  db: Db,
  teamId: string,
  projectId: string | null,
  limit = CONSOLIDATION_RETENTION_ROWS,
): MemoryConsolidationRecord[] {
  return db
    .select()
    .from(memoryConsolidation)
    .where(
      and(
        eq(memoryConsolidation.teamId, teamId),
        projectId === null
          ? isNull(memoryConsolidation.projectId)
          : eq(memoryConsolidation.projectId, projectId),
      ),
    )
    .orderBy(desc(memoryConsolidation.startedAt))
    .limit(limit)
    .all()
    .map(toRecord);
}

export function undoConsolidation(
  db: Db,
  teamId: string,
  consolidationId: string,
): MemoryConsolidationRecord {
  const row = db
    .select()
    .from(memoryConsolidation)
    .where(and(eq(memoryConsolidation.id, consolidationId), eq(memoryConsolidation.teamId, teamId)))
    .get();
  if (row === undefined) throw new HttpError(404, `consolidation ${consolidationId}`);
  if (row.status !== 'applied') throw new HttpError(409, 'this pass applied no edits');
  if (row.undoneAt !== null) throw new HttpError(409, 'this pass was already undone');
  return db.transaction((tx) => {
    const ownerRow = row.agentId;
    const index = tx
      .select()
      .from(agentMemory)
      .where(
        and(
          eq(agentMemory.teamId, teamId),
          eq(agentMemory.agentId, ownerRow),
          scopeWhere({ teamId, projectId: row.projectId }),
          eq(agentMemory.layer, 'core'),
          isNull(agentMemory.invalidAt),
        ),
      )
      .get();
    if (index === undefined) throw new HttpError(409, 'memory changed after this pass');
    if (index.content !== row.afterText) throw new HttpError(409, 'memory changed after this pass');
    const owner = {
      agentId: ownerRow,
      teamId,
      projectId: row.projectId,
      source: CONSOLIDATION_SOURCE,
    };
    for (const drop of row.dropFiles) {
      if (drop.memoryId === null) throw new HttpError(409, `memory file ${drop.title} is gone`);
      const file = tx
        .select()
        .from(agentMemory)
        .where(and(eq(agentMemory.id, drop.memoryId), eq(agentMemory.teamId, teamId)))
        .get();
      if (file === undefined || file.invalidAt === null)
        throw new HttpError(409, `memory file ${drop.title} is gone`);
      executeMemoryDocumentTool(
        tx,
        { ...owner, source: file.source ?? CONSOLIDATION_SOURCE },
        'update_memory',
        {
          scope: row.projectId ?? 'team',
          file: drop.title,
          baseVersion: documentVersion(file),
          restoreVersion: file.id,
        },
      );
    }
    executeMemoryDocumentTool(tx, owner, 'update_memory', {
      scope: row.projectId ?? 'team',
      file: MEMORY_INDEX_TITLE,
      baseVersion: documentVersion(index),
      content: row.beforeText,
    });
    const undoneAt = nowMs();
    tx.update(memoryConsolidation)
      .set({ undoneAt })
      .where(eq(memoryConsolidation.id, row.id))
      .run();
    return toRecord({ ...row, undoneAt });
  });
}

export function lastConsolidationAt(
  db: Db,
  teamId: string,
  projectId: string | null,
): { startedAt: number; finishedAt: number } | null {
  const row = db
    .select({
      startedAt: memoryConsolidation.startedAt,
      finishedAt: memoryConsolidation.finishedAt,
    })
    .from(memoryConsolidation)
    .where(
      and(
        eq(memoryConsolidation.teamId, teamId),
        projectId === null
          ? isNull(memoryConsolidation.projectId)
          : eq(memoryConsolidation.projectId, projectId),
      ),
    )
    .orderBy(desc(memoryConsolidation.startedAt))
    .get();
  return row ?? null;
}

export function memoryChangedAfter(
  db: Db,
  scope: { teamId: string; agentId: string; projectId: string | null },
  after: number,
): number | null {
  const row = db
    .select({ updatedAt: agentMemory.updatedAt })
    .from(agentMemory)
    .where(
      and(
        eq(agentMemory.teamId, scope.teamId),
        eq(agentMemory.agentId, scope.agentId),
        scopeWhere(scope),
        isNull(agentMemory.invalidAt),
        sql`${agentMemory.layer} <> 'scratchpad'`,
        sql`${agentMemory.updatedAt} > ${after}`,
      ),
    )
    .orderBy(desc(agentMemory.updatedAt))
    .get();
  return row?.updatedAt ?? null;
}

export function entryCount(
  db: Db,
  scope: { teamId: string; agentId: string; projectId: string | null },
) {
  const rows = listStoredMemoryEntries(db, { agentId: scope.agentId, teamId: scope.teamId });
  const index = rows.find(
    (row) =>
      row.layer === 'core' &&
      (scope.projectId === null ? row.projectId === null : row.projectId === scope.projectId),
  );
  const lines = (index?.content ?? '').split('\n').filter((line) => line.trim() !== '').length;
  const files = rows.filter(
    (row) =>
      row.layer === 'searchable' &&
      row.invalidAt === null &&
      row.supersededBy === null &&
      row.projectId === scope.projectId,
  ).length;
  return lines + files;
}
