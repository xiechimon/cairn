import { COORDINATOR_MEMORY_FLUSH_MAX, COORDINATOR_MEMORY_FLUSH_PROMPT_HEAD } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { project } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import {
  isMemoryIndex,
  listMemoryEntries,
  saveMemoryEntry,
  updateMemoryEntry,
} from '../services/memory.js';
import { coordinatorProfile } from '../services/routing-rules.js';
import type { MemoryFlush } from './runtime/compaction.js';

const TITLE_MAX = 40;
const CONTENT_MAX = 500;
const EXISTING_MAX_CHARS = 8_000;
export const FLUSH_SOURCE = 'compaction-flush';

const candidateSchema = z.object({
  title: z.string(),
  content: z.string(),
  projectId: z.string().nullish(),
  replaces: z.string().nullish(),
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
      title: entry.title.trim().slice(0, TITLE_MAX),
      content: entry.content.trim().slice(0, CONTENT_MAX),
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
      if (entry.replaces != null && !isMemoryIndex(db, entry.replaces)) {
        updateMemoryEntry(db, {
          memoryId: entry.replaces,
          agentId,
          teamId: scope.teamId,
          threadId: scope.threadId,
          content: entry.content,
        });
        result.updated += 1;
        continue;
      }
      const projectId = entry.projectId ?? null;
      if (projectId !== null && !projects.has(projectId)) {
        result.skipped += 1;
        continue;
      }
      const saved = saveMemoryEntry(db, {
        agentId,
        teamId: scope.teamId,
        title: entry.title,
        content: entry.content,
        projectId,
        sourceTodoId: null,
        sourceBuildId: scope.threadId,
        source: FLUSH_SOURCE,
        force: true,
      });
      if ('status' in saved) result.skipped += 1;
      else result.saved += 1;
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
  const lines = listMemoryEntries(db, { agentId, teamId: scope.teamId, threadId: scope.threadId })
    .reverse()
    .map((m) => `${m.id} | ${m.title}: ${m.content}`);
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length > EXISTING_MAX_CHARS) break;
    kept.push(line);
    used += line.length + 1;
  }
  return kept.length > 0 ? kept.join('\n') : '(none)';
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
