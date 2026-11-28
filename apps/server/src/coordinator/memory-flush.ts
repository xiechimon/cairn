import {
  COORDINATOR_MEMORY_FLUSH_MAX,
  COORDINATOR_MEMORY_FLUSH_PROMPT_HEAD,
  MEMORY_INDEX_ID_PREFIX,
  MEMORY_INDEX_TITLE,
} from '@cairn/shared';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { project } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import { ensureMemoryIndex, listStoredMemoryEntries, memoryIndexText } from '../services/memory.js';
import {
  appendMemoryIndex,
  executeMemoryDocumentTool,
  memoryDocumentVersion,
} from '../services/memory-documents.js';
import { listedProjects } from '../services/personal-space.js';
import { coordinatorMemoryOwner } from '../services/routing-rules.js';
import {
  markTeamMemoryUsed,
  mentionedProject,
  retirementPlan,
  syncTeamMemoryEntries,
  teamMemoryLines,
} from '../services/team-memory.js';
import type { MemoryFlush } from './runtime/compaction.js';

type FlushDb = Db | Parameters<Parameters<Db['transaction']>[0]>[0];
interface FlushScope {
  teamId: string;
  threadId: string;
  projectId?: string | null;
}

const EXISTING_MAX_CHARS = 8_000;
export const FLUSH_SOURCE = 'compaction-flush';

const entryNumbers = z
  .array(z.unknown())
  .transform((values) => values.filter((value): value is number => Number.isInteger(value)));
const candidateSchema = z.object({
  title: z.string(),
  content: z.string(),
  projectId: z.string().nullish(),
  replaces: entryNumbers.optional(),
});
const outputSchema = z.object({ memories: z.array(z.unknown()), used: entryNumbers.optional() });

export interface FlushResult {
  saved: number;
  retired: number;
  skipped: number;
}

function flushJson(raw: string) {
  const fenced = /^```\w*\n([\s\S]*?)\n```$/.exec(raw.trim());
  let json: unknown;
  try {
    json = JSON.parse((fenced?.[1] ?? raw).trim());
  } catch {
    throw new Error('memory flush output is not JSON');
  }
  const outer = outputSchema.safeParse(json);
  if (!outer.success) throw new Error('memory flush output has no memories array');
  return outer.data;
}

export function parseFlushOutput(raw: string) {
  return flushJson(raw)
    .memories.flatMap((entry) => {
      const parsed = candidateSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    })
    .map((entry) => ({
      ...entry,
      title: entry.title.trim(),
      content: entry.content.trim(),
      replaces: entry.replaces ?? [],
    }))
    .filter((entry) => entry.title !== '' && entry.content !== '')
    .slice(0, COORDINATOR_MEMORY_FLUSH_MAX);
}

function existingScopes(db: FlushDb, teamId: string) {
  const agentId = coordinatorMemoryOwner(db, teamId);
  const scopes = new Map<string | null, { content: string; version?: string }>([
    [null, { content: '' }],
  ]);
  if (agentId === undefined) return scopes;
  for (const row of listStoredMemoryEntries(db, { agentId, teamId })) {
    if (row.layer !== 'core') continue;
    const scope = scopes.get(row.projectId) ?? { content: '' };
    const index = row.id.startsWith(MEMORY_INDEX_ID_PREFIX);
    const line = index
      ? memoryIndexText(row)
      : `- ${row.title.replace(/[\r\n]+/g, ' ')}：${row.content}`;
    scope.content = [scope.content, line].filter(Boolean).join('\n');
    if (index || scope.version === undefined) scope.version = memoryDocumentVersion(row);
    scopes.set(row.projectId, scope);
  }
  return scopes;
}

function curateTeamMemory(
  db: FlushDb,
  owner: { agentId: string; teamId: string },
  numbered: readonly string[],
  replaces: readonly number[],
  used: readonly number[],
) {
  const linesAt = (numbers: readonly number[]) => numbers.flatMap((n) => numbered[n - 1] ?? []);
  return db.transaction((tx) => {
    const index = ensureMemoryIndex(tx, { ...owner, projectId: null });
    const content = memoryIndexText(index);
    const now = nowMs();
    const entries = syncTeamMemoryEntries(tx, owner.teamId, content, { now });
    const usedLines = linesAt(used);
    markTeamMemoryUsed(tx, owner.teamId, usedLines, now);
    const retire = new Set(
      retirementPlan(entries, new Set(linesAt(replaces)), new Set(usedLines), now),
    );
    if (retire.size === 0) return 0;
    executeMemoryDocumentTool(
      tx,
      { ...owner, projectId: null, source: FLUSH_SOURCE },
      'update_memory',
      {
        scope: 'team',
        file: MEMORY_INDEX_TITLE,
        baseVersion: memoryDocumentVersion(index),
        content: content
          .split('\n')
          .filter((line) => !retire.has(line))
          .join('\n'),
      },
    );
    return retire.size;
  });
}

export function applyFlush(
  db: FlushDb,
  scope: FlushScope,
  raw: string,
  numbered: readonly string[] = teamMemoryLines(
    existingScopes(db, scope.teamId).get(null)?.content ?? '',
  ),
): FlushResult {
  const result: FlushResult = { saved: 0, retired: 0, skipped: 0 };
  const agentId = coordinatorMemoryOwner(db, scope.teamId);
  if (agentId === undefined) return result;
  const projects = new Set(
    db
      .select({ id: project.id })
      .from(project)
      .where(listedProjects(scope.teamId))
      .all()
      .map((row) => row.id),
  );
  const entries = parseFlushOutput(raw);
  result.retired = curateTeamMemory(
    db,
    { agentId, teamId: scope.teamId },
    numbered,
    entries.flatMap((entry) => entry.replaces),
    flushJson(raw).used ?? [],
  );
  for (const entry of entries) {
    try {
      const named = entry.projectId ?? null;
      if (named !== null && !projects.has(named)) {
        result.skipped += 1;
        continue;
      }
      const projectId =
        named ?? mentionedProject(db, scope.teamId, `${entry.title} ${entry.content}`)?.id ?? null;
      const owner = {
        agentId,
        teamId: scope.teamId,
        projectId,
        source: FLUSH_SOURCE,
        sourceBuildId: scope.threadId,
      };
      if (appendMemoryIndex(db, owner, entry.title, entry.content)) result.saved++;
      else result.skipped++;
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      result.skipped += 1;
    }
  }
  return result;
}

function numberedTeamLines(content: string) {
  let entry = 0;
  return content
    .split('\n')
    .map((line) => (line.startsWith('- ') ? `${++entry}. ${line}` : line))
    .join('\n');
}

function existingLines(indexes: ReturnType<typeof existingScopes>): string {
  const selected: { header: string; content: string }[] = [];
  const noteBudget = `\n(${indexes.size} additional scopes omitted from this excerpt.)`.length;
  let reserved = noteBudget;
  for (const [projectId, index] of indexes) {
    const header = `${projectId ?? 'team'} | MEMORY.md${index.version ? ` | ${index.version}` : ''}`;
    const content = projectId === null ? numberedTeamLines(index.content) : index.content;
    const required = header.length + Math.min(256, content.length) + 3;
    if (reserved + required > EXISTING_MAX_CHARS) break;
    selected.push({ header, content });
    reserved += required;
  }
  const omitted = indexes.size - selected.length;
  const note = omitted > 0 ? `\n(${omitted} additional scopes omitted from this excerpt.)` : '';
  const remaining =
    EXISTING_MAX_CHARS -
    note.length -
    selected.map(({ header }) => header).join('\n\n').length -
    selected.length;
  const perIndex = Math.floor(remaining / Math.max(1, selected.length));
  return (
    selected.map(({ header, content }) => `${header}\n${content.slice(0, perIndex)}`).join('\n\n') +
    note
  );
}

export function flushPrompt(
  db: Db,
  scope: FlushScope,
  transcript: string,
  indexes = existingScopes(db, scope.teamId),
) {
  const projects = db
    .select({ id: project.id, name: project.name })
    .from(project)
    .where(listedProjects(scope.teamId))
    .all()
    .map((row) => `${row.id} | ${row.name.replace(/[\r\n]+/g, ' ')}`);
  const channel =
    scope.projectId == null
      ? ''
      : `\n\nConversation project: ${scope.projectId}. References such as “this project” mean this project; use its projectId for its facts. Use null for team-wide facts.`;
  return `${COORDINATOR_MEMORY_FLUSH_PROMPT_HEAD}\n\nExisting memories:\n${existingLines(indexes)}\n\nProjects:\n${projects.length > 0 ? projects.join('\n') : '(none)'}${channel}\n\nMessages:\n${transcript}`;
}

export function createMemoryFlush(
  db: Db,
  scope: FlushScope,
  report: (result: FlushResult) => void,
  commit: (apply: (db: FlushDb) => FlushResult) => FlushResult = (apply) => apply(db),
): MemoryFlush {
  return {
    run: async (transcript, summarize) => {
      if (transcript.trim() === '') return;
      const indexes = existingScopes(db, scope.teamId);
      const numbered = teamMemoryLines(indexes.get(null)?.content ?? '');
      const raw = await summarize(flushPrompt(db, scope, transcript, indexes));
      report(commit((target) => applyFlush(target, scope, raw, numbered)));
    },
  };
}
