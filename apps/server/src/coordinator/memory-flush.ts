import { COORDINATOR_MEMORY_FLUSH_MAX, COORDINATOR_MEMORY_FLUSH_PROMPT_HEAD } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { project } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { ensureMemoryIndex, listStoredMemoryEntries, memoryIndexText } from '../services/memory.js';
import { appendMemoryIndex, memoryDocumentVersion } from '../services/memory-documents.js';
import { coordinatorProfile } from '../services/routing-rules.js';
import type { MemoryFlush } from './runtime/compaction.js';

const EXISTING_MAX_CHARS = 8_000;
export const FLUSH_SOURCE = 'compaction-flush';

const candidateSchema = z.object({
  title: z.string(),
  content: z.string(),
  projectId: z.string().nullish(),
});
const outputSchema = z.object({ memories: z.array(z.unknown()) });

export interface FlushResult {
  saved: number;
  updated: number;
  skipped: number;
}

export function parseFlushOutput(raw: string) {
  const fenced = /^```\w*\n([\s\S]*?)\n```$/.exec(raw.trim());
  let json: unknown;
  try {
    json = JSON.parse((fenced?.[1] ?? raw).trim());
  } catch {
    throw new Error('memory flush output is not JSON');
  }
  const outer = outputSchema.safeParse(json);
  if (!outer.success) throw new Error('memory flush output has no memories array');
  return outer.data.memories
    .flatMap((entry) => {
      const parsed = candidateSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    })
    .map((entry) => ({
      ...entry,
      title: entry.title.trim(),
      content: entry.content.trim(),
    }))
    .filter((entry) => entry.title !== '' && entry.content !== '')
    .slice(0, COORDINATOR_MEMORY_FLUSH_MAX);
}

export function applyFlush(
  db: Db,
  scope: { teamId: string; threadId: string },
  raw: string,
): FlushResult {
  const result: FlushResult = { saved: 0, updated: 0, skipped: 0 };
  const agentId = coordinatorProfile(db, scope.teamId)?.id;
  if (agentId === undefined) return result;
  const projects = new Set(
    db
      .select({ id: project.id })
      .from(project)
      .where(eq(project.teamId, scope.teamId))
      .all()
      .map((row) => row.id),
  );
  for (const entry of parseFlushOutput(raw)) {
    try {
      const projectId = entry.projectId ?? null;
      if (projectId !== null && !projects.has(projectId)) {
        result.skipped += 1;
        continue;
      }
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

function existingLines(db: Db, scope: { teamId: string; threadId: string }): string {
  const agentId = coordinatorProfile(db, scope.teamId)?.id;
  if (agentId === undefined) return '(none)';
  const owner = { agentId, teamId: scope.teamId };
  const scopes = new Set([null, ...listStoredMemoryEntries(db, owner).map((row) => row.projectId)]);
  const indexes = [...scopes].map((projectId) => ensureMemoryIndex(db, { ...owner, projectId }));
  const selected: { header: string; content: string }[] = [];
  const noteBudget = `\n(${indexes.length} additional scopes omitted from this excerpt.)`.length;
  let reserved = noteBudget;
  for (const index of indexes) {
    const header = `${index.projectId ?? 'team'} | MEMORY.md | ${memoryDocumentVersion(index)}`;
    const content = memoryIndexText(index);
    const required = header.length + Math.min(256, content.length) + 3;
    if (reserved + required > EXISTING_MAX_CHARS) break;
    selected.push({ header, content });
    reserved += required;
  }
  const omitted = indexes.length - selected.length;
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
  scope: { teamId: string; threadId: string },
  transcript: string,
) {
  const projects = db
    .select({ id: project.id, name: project.name })
    .from(project)
    .where(eq(project.teamId, scope.teamId))
    .all()
    .map((row) => `${row.id} | ${row.name.replace(/[\r\n]+/g, ' ')}`);
  return `${COORDINATOR_MEMORY_FLUSH_PROMPT_HEAD}\n\nExisting memories:\n${existingLines(db, scope)}\n\nProjects:\n${projects.length > 0 ? projects.join('\n') : '(none)'}\n\nMessages:\n${transcript}`;
}

export function createMemoryFlush(
  db: Db,
  scope: { teamId: string; threadId: string },
  report: (result: FlushResult) => void,
): MemoryFlush {
  return {
    run: async (transcript, summarize) => {
      if (transcript.trim() === '') return;
      const raw = await summarize(flushPrompt(db, scope, transcript));
      report(applyFlush(db, scope, raw));
    },
  };
}
