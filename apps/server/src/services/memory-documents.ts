import { MEMORY_INDEX_ID_PREFIX, MEMORY_INDEX_TITLE, memoryToolParamsSchemas } from '@cairn/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agentMemory, project } from '../db/schema.js';
import { HttpError, parseWith } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import {
  allocateMemoryFileName,
  boundMemoryIndex,
  ensureMemoryIndex,
  MEMORY_MARKDOWN_INDEX_PREFIX,
  memoryDocumentVersion,
  memoryIndexText,
  replaceMemory,
  rewriteMemoryReferences,
  searchMemoryEntries,
  validateMemoryText,
} from './memory.js';

export { memoryDocumentVersion } from './memory.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Row = typeof agentMemory.$inferSelect;
export type MemoryDocumentOwner = Pick<Row, 'teamId' | 'agentId' | 'projectId'> &
  Partial<Pick<Row, 'sourceTodoId' | 'sourceBuildId' | 'source'>> & {
    teamScoped?: boolean;
    workerScope?: boolean;
  };
export const MEMORY_DOCUMENT_OUTPUT_BYTES = 30 * 1024;

function namespace(db: Db | Tx, owner: MemoryDocumentOwner, scope: string, write = false) {
  const projectId = scope === 'team' ? null : scope;
  if (owner.workerScope && projectId !== null && projectId !== owner.projectId)
    throw new HttpError(404, `project ${projectId}`);
  if (projectId !== null) {
    const row = db
      .select()
      .from(project)
      .where(and(eq(project.id, projectId), eq(project.teamId, owner.teamId)))
      .get();
    if (!row) throw new HttpError(404, `project ${projectId}`);
    if (write && row.archivedAt !== null)
      throw new HttpError(409, `project ${projectId} is archived`);
  }
  const resolved = { ...owner, projectId };
  const index = ensureMemoryIndex(db, resolved);
  const content = memoryIndexText(index);
  if (content !== index.content) db.transaction((tx) => replaceMemory(tx, index, content, true));
  return resolved;
}
function owned(owner: MemoryDocumentOwner) {
  return and(
    eq(agentMemory.teamId, owner.teamId),
    eq(agentMemory.independent, owner.teamScoped === false),
    isNull(agentMemory.adoptedFrom),
    owner.teamScoped === false ? eq(agentMemory.agentId, owner.agentId) : undefined,
  );
}
function scoped(owner: MemoryDocumentOwner) {
  return and(
    owned(owner),
    owner.projectId === null
      ? isNull(agentMemory.projectId)
      : eq(agentMemory.projectId, owner.projectId),
  );
}
function scopedRows(db: Db | Tx, owner: MemoryDocumentOwner) {
  return db.select().from(agentMemory).where(scoped(owner));
}
function metadata(row: Row) {
  return {
    id: row.id,
    agentId: row.agentId,
    projectId: row.projectId,
    source: row.source,
    sourceTodoId: row.sourceTodoId,
    sourceBuildId: row.sourceBuildId,
    file: row.title,
    scope: row.projectId ?? 'team',
    baseVersion: memoryDocumentVersion(row),
    updatedAt: row.updatedAt,
    deleted: row.invalidAt !== null,
  };
}
function current(db: Db | Tx, owner: MemoryDocumentOwner, file: string) {
  const rows = scopedRows(db, owner)
    .orderBy(desc(agentMemory.updatedAt), sql`${agentMemory}.rowid desc`)
    .all()
    .filter((r) => r.title === file && (r.layer === 'core' || r.layer === 'searchable'));
  const leaves = rows.filter((r) => r.supersededBy === null);
  const row = leaves.find((r) => r.invalidAt === null) ?? leaves[0];
  if (!row) {
    const prior = rows.find((r) => r.supersededBy !== null);
    if (prior)
      throw new HttpError(
        409,
        `memory file was superseded by ${prior.supersededBy}; read its current scope and name`,
      );
    throw new HttpError(404, `memory file ${file}`);
  }
  return row;
}
function reserve(db: Db | Tx, owner: MemoryDocumentOwner, file: string, except?: string) {
  if (file === MEMORY_INDEX_TITLE) throw new HttpError(400, 'MEMORY.md is reserved for the index');
  const row = scopedRows(db, owner)
    .all()
    .find((r) => r.title === file && (r.invalidAt === null || r.supersededBy === null));
  if (row && row.id !== except) throw new HttpError(409, `memory file ${file} already exists`);
}
function page(row: Row, offset = 0) {
  const content = memoryIndexText(row);
  const attributes = metadata(row);
  let end = Math.min(content.length, offset + 24 * 1024);
  for (;;) {
    if (end < content.length && /[\uD800-\uDBFF]/.test(content[end - 1] ?? '')) end--;
    const response = {
      ...attributes,
      content: content.slice(offset, end),
      nextOffset: end < content.length ? end : null,
    };
    if (
      Buffer.byteLength(JSON.stringify(response)) <= MEMORY_DOCUMENT_OUTPUT_BYTES ||
      end <= offset
    )
      return response;
    end = Math.max(offset, end - 256);
  }
}
function result(row: Row) {
  const bounded = row.layer === 'core' ? boundMemoryIndex(memoryIndexText(row)) : undefined;
  return {
    ...page(row),
    ...(bounded && bounded.omitted > 0
      ? {
          reminder: `Keep MEMORY.md to short one-line entries. Move detail into memory files, merge or drop stale lines; use memories to read the full index. ${bounded.omitted} lines exceed the load bound.`,
        }
      : {}),
  };
}
function ancestors(db: Db | Tx, owner: MemoryDocumentOwner, row: Row) {
  const rows = db.select().from(agentMemory).where(owned(owner)).all();
  const chain: Row[] = [];
  const seen = new Set([row.id]);
  let next = row;
  for (;;) {
    const previous = rows.find(
      (r) =>
        r.supersededBy === next.id &&
        (row.layer !== 'core' || r.id.startsWith(MEMORY_INDEX_ID_PREFIX)),
    );
    if (!previous || seen.has(previous.id)) break;
    chain.push(previous);
    seen.add(previous.id);
    next = previous;
  }
  return chain;
}

export function executeMemoryDocumentTool(
  db: Db | Tx,
  owner: MemoryDocumentOwner,
  name: string,
  params: Record<string, unknown>,
): unknown {
  if (name === 'memories') {
    const input = parseWith(memoryToolParamsSchemas.memories, params, 'params');
    return db.transaction((tx) => {
      const scopes =
        input.scope === undefined
          ? owner.projectId === null
            ? ['team']
            : ['team', owner.projectId]
          : [input.scope];
      const namespaces = scopes.map((s) => namespace(tx, owner, s));
      if (input.file !== undefined) {
        const selected = namespaces[0];
        if (namespaces.length !== 1 || selected === undefined)
          throw new HttpError(400, 'scope is required when reading a file');
        const row = current(tx, selected, input.file);
        if (!input.versions) return page(row, input.offset);
        const all = [...(row.invalidAt === null ? [] : [row]), ...ancestors(tx, owner, row)];
        if (input.versions !== 'list') {
          const version = all.find((v) => v.id === input.versions);
          if (!version) throw new HttpError(404, 'retained memory version not found');
          return {
            ...page(version, input.offset),
            versionId: version.id,
            baseVersion: memoryDocumentVersion(row),
          };
        }
        const versions: ReturnType<typeof page>[] = [];
        const response = { ...metadata(row), versions, nextOffset: null as number | null };
        for (const version of all.slice(input.offset ?? 0)) {
          versions.push({
            ...page(version),
            content: memoryIndexText(version).slice(0, 1024),
            nextOffset: memoryIndexText(version).length > 1024 ? 1024 : null,
          });
          if (Buffer.byteLength(JSON.stringify(response)) > MEMORY_DOCUMENT_OUTPUT_BYTES) {
            versions.pop();
            break;
          }
        }
        const end = (input.offset ?? 0) + versions.length;
        response.nextOffset = end < all.length ? end : null;
        return response;
      }
      const all = namespaces.flatMap((ns) =>
        scopedRows(tx, ns)
          .all()
          .filter(
            (r) => r.supersededBy === null && (r.layer === 'core' || r.layer === 'searchable'),
          ),
      );
      const rows =
        input.query === undefined
          ? all
          : searchMemoryEntries(
              all.map((r) => ({ ...r, content: memoryIndexText(r) })),
              input.query,
            );
      const documents: (ReturnType<typeof metadata> & { firstLine: string })[] = [];
      const response = { documents, nextOffset: null as number | null };
      for (const row of rows.slice(input.offset ?? 0)) {
        documents.push({
          ...metadata(row),
          firstLine: (memoryIndexText(row).split('\n')[0] ?? '').slice(0, 1024),
        });
        if (Buffer.byteLength(JSON.stringify(response)) > MEMORY_DOCUMENT_OUTPUT_BYTES) {
          documents.pop();
          break;
        }
      }
      const end = (input.offset ?? 0) + documents.length;
      response.nextOffset = end < rows.length ? end : null;
      return response;
    });
  }
  if (name === 'save_memory') {
    const input = parseWith(memoryToolParamsSchemas.save_memory, params, 'params');
    return db.transaction((tx) => {
      const ns = namespace(tx, owner, input.scope, true);
      reserve(tx, ns, input.file);
      validateMemoryText(input.file, input.content);
      const now = nowMs();
      const row = tx
        .insert(agentMemory)
        .values({
          id: newRecordId(),
          agentId: owner.agentId,
          teamId: owner.teamId,
          projectId: ns.projectId,
          independent: owner.teamScoped === false,
          title: input.file,
          content: input.content,
          layer: 'searchable',
          source: owner.source,
          sourceTodoId: owner.sourceTodoId,
          sourceBuildId: owner.sourceBuildId,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      return result(row);
    });
  }
  if (name !== 'update_memory' && name !== 'delete_memory')
    throw new HttpError(400, `unknown memory tool ${name}`);
  const input =
    name === 'delete_memory'
      ? parseWith(memoryToolParamsSchemas.delete_memory, params, 'params')
      : parseWith(memoryToolParamsSchemas.update_memory, params, 'params');
  return db.transaction((tx) => {
    const ns = namespace(tx, owner, input.scope, true);
    const row = current(tx, ns, input.file);
    if (input.baseVersion !== memoryDocumentVersion(row))
      throw new HttpError(
        409,
        `stale memory base; current ${row.id} revision ${memoryDocumentVersion(row)}`,
      );
    const now = Math.max(nowMs(), row.updatedAt + 1);
    if (name === 'delete_memory') {
      if (row.layer === 'core')
        throw new HttpError(400, 'MEMORY.md cannot be deleted; empty it instead');
      if (row.invalidAt !== null) throw new HttpError(409, 'memory file is already deleted');
      tx.update(agentMemory)
        .set({ invalidAt: now, updatedAt: now })
        .where(eq(agentMemory.id, row.id))
        .run();
      return result({ ...row, invalidAt: now, updatedAt: now });
    }
    const edit = parseWith(memoryToolParamsSchemas.update_memory, params, 'params');
    if (row.layer === 'core' && (edit.moveTo !== undefined || edit.renameTo !== undefined))
      throw new HttpError(400, 'MEMORY.md cannot move or rename');
    if (
      edit.restoreVersion !== undefined &&
      (edit.content !== undefined || edit.old_str !== undefined || edit.new_str !== undefined)
    )
      throw new HttpError(400, 'restoreVersion cannot be combined with text edits');
    if (edit.content !== undefined && (edit.old_str !== undefined || edit.new_str !== undefined))
      throw new HttpError(400, 'choose content or old_str and new_str');
    if ((edit.old_str === undefined) !== (edit.new_str === undefined))
      throw new HttpError(400, 'old_str and new_str are required together');
    if (row.invalidAt !== null && edit.restoreVersion === undefined)
      throw new HttpError(409, 'deleted memory requires restoreVersion');
    if (
      [edit.content, edit.old_str, edit.restoreVersion, edit.moveTo, edit.renameTo].every(
        (value) => value === undefined,
      )
    )
      throw new HttpError(400, 'no memory edit provided');
    let content = edit.content ?? memoryIndexText(row);
    if (edit.old_str !== undefined) {
      const first = content.indexOf(edit.old_str);
      if (first < 0) throw new HttpError(400, 'old_str not found verbatim');
      if (content.indexOf(edit.old_str, first + 1) >= 0)
        throw new HttpError(400, 'old_str has multiple occurrences');
      content = content.slice(0, first) + edit.new_str + content.slice(first + edit.old_str.length);
    }
    if (edit.restoreVersion !== undefined) {
      const version = [row, ...ancestors(tx, owner, row)].find((v) => v.id === edit.restoreVersion);
      if (!version) throw new HttpError(404, 'retained memory version not found');
      content = memoryIndexText(version);
    }
    const destination = edit.moveTo === undefined ? ns : namespace(tx, owner, edit.moveTo, true);
    const title = edit.renameTo ?? row.title;
    if (row.layer !== 'core') reserve(tx, destination, title, row.id);
    validateMemoryText(title, content);
    const successor = tx
      .insert(agentMemory)
      .values({
        ...row,
        id: `${row.layer === 'core' ? MEMORY_MARKDOWN_INDEX_PREFIX : ''}${newRecordId()}`,
        title,
        content,
        projectId: destination.projectId,
        invalidAt: null,
        supersededBy: null,
        source: owner.source ?? row.source,
        sourceTodoId: owner.sourceTodoId ?? row.sourceTodoId,
        sourceBuildId: owner.sourceBuildId ?? row.sourceBuildId,
        history: [
          ...row.history,
          { title: row.title, content: memoryIndexText(row), updatedAt: row.updatedAt },
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
    if (row.layer !== 'core')
      rewriteMemoryReferences(tx, row, [{ before: row, after: successor }], now);
    return result(successor);
  });
}

function memoryFileReference(title: string, file: string) {
  const reference = `- [${title.replace(/[\r\n\0]+/g, ' ')}](${encodeURIComponent(file)})`;
  return boundMemoryIndex(reference).omitted > 0
    ? `- [${file}](${encodeURIComponent(file)})`
    : reference;
}

function indexWithReference(content: string, reference: string) {
  const appended = [content, reference].filter(Boolean).join('\n');
  return boundMemoryIndex(appended).omitted > 0
    ? [reference, content].filter(Boolean).join('\n')
    : appended;
}

function ensureMemoryFileReference(
  tx: Tx,
  owner: MemoryDocumentOwner,
  index: Row,
  title: string,
  file: string,
) {
  const content = memoryIndexText(index);
  if (content.includes(`](${encodeURIComponent(file)})`)) return false;
  executeMemoryDocumentTool(tx, owner, 'update_memory', {
    scope: owner.projectId ?? 'team',
    file: MEMORY_INDEX_TITLE,
    baseVersion: memoryDocumentVersion(index),
    content: indexWithReference(content, memoryFileReference(title, file)),
  });
  return true;
}

export function appendMemoryIndex(
  db: Db,
  owner: MemoryDocumentOwner,
  title: string,
  detail: string,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return db.transaction((tx) => {
        const index = ensureMemoryIndex(tx, namespace(tx, owner, owner.projectId ?? 'team', true));
        const currentText = memoryIndexText(index);
        const label = title.replace(/[\r\n\0]+/g, ' ').replace(/：/g, ':');
        const line = `- ${label}：${detail}`;
        const files = scopedRows(tx, namespace(tx, owner, owner.projectId ?? 'team')).all();
        const existing = files.find(
          (row) =>
            row.layer === 'searchable' &&
            row.invalidAt === null &&
            row.supersededBy === null &&
            row.content === detail,
        );
        if (existing) return ensureMemoryFileReference(tx, owner, index, title, existing.title);
        if (
          currentText
            .split('\n')
            .some(
              (entry) =>
                entry.startsWith('- ') &&
                entry.includes('：') &&
                entry.slice(entry.indexOf('：') + 1) === detail,
            )
        )
          return false;
        const file = allocateMemoryFileName(
          title,
          new Set([MEMORY_INDEX_TITLE, ...files.map((row) => row.title)]),
        );
        const reference = memoryFileReference(title, file);
        if (currentText.split('\n').includes(line) || currentText.split('\n').includes(reference))
          return false;
        const content = [currentText, line].filter(Boolean).join('\n');
        const spill = detail.includes('\n') || boundMemoryIndex(content).omitted > 0;
        if (spill)
          executeMemoryDocumentTool(tx, owner, 'save_memory', {
            scope: owner.projectId ?? 'team',
            file,
            content: detail,
          });
        executeMemoryDocumentTool(tx, owner, 'update_memory', {
          scope: owner.projectId ?? 'team',
          file: MEMORY_INDEX_TITLE,
          baseVersion: memoryDocumentVersion(index),
          content: spill ? indexWithReference(currentText, reference) : content,
        });
        return true;
      });
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 409 || attempt >= 1) throw error;
    }
  }
}

export function rememberMemoryFile(
  db: Db,
  owner: MemoryDocumentOwner,
  title: string,
  content: string,
) {
  return db.transaction((tx) => {
    const ns = namespace(tx, owner, owner.projectId ?? 'team', true);
    const existing = scopedRows(tx, ns)
      .all()
      .find(
        (r) =>
          r.layer === 'searchable' &&
          r.invalidAt === null &&
          r.supersededBy === null &&
          r.content === content,
      );
    const file =
      existing?.title ??
      allocateMemoryFileName(
        title,
        new Set([
          MEMORY_INDEX_TITLE,
          ...scopedRows(tx, ns)
            .all()
            .map((row) => row.title),
        ]),
      );
    const saved =
      existing ??
      (executeMemoryDocumentTool(tx, owner, 'save_memory', {
        scope: owner.projectId ?? 'team',
        file,
        content,
      }) as { id: string });
    const index = ensureMemoryIndex(tx, ns);
    ensureMemoryFileReference(tx, owner, index, title, file);
    return saved;
  });
}
