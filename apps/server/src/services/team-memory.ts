import {
  TEAM_MEMORY_MAX_CHARS,
  TEAM_MEMORY_RETIRE_AFTER_DAYS,
  TEAM_MEMORY_RETIRE_MAX_SHARE,
} from '@cairn/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { project, teamMemoryEntry } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId } from '../lib/ids.js';
import { listedProjects } from './personal-space.js';
import { researchProjectId } from './projects.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type EntryRow = typeof teamMemoryEntry.$inferSelect;

const DAY_MS = 24 * 60 * 60 * 1000;

export function teamMemoryLines(content: string): string[] {
  return content.split('\n').filter((line) => line.startsWith('- '));
}

export function teamMemoryChars(content: string): number {
  return Array.from(content).length;
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function mentionedProject(db: Db | Tx, teamId: string, text: string) {
  const research = researchProjectId(teamId);
  return db
    .select()
    .from(project)
    .where(and(listedProjects(teamId), isNull(project.archivedAt)))
    .all()
    .find((row) => {
      if (row.id === research) return false;
      if (text.includes(row.id)) return true;
      const name = row.name.trim();
      if (Array.from(name).length < 2) return false;
      if (!/^[\x20-\x7e]+$/.test(name)) return text.includes(name);
      return new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(name)}(?![A-Za-z0-9])`, 'i').test(text);
    });
}

export function guardTeamMemory(tx: Db | Tx, teamId: string, before: string, after: string) {
  const length = teamMemoryChars(after);
  if (length > TEAM_MEMORY_MAX_CHARS && length > teamMemoryChars(before))
    throw new HttpError(
      400,
      `团队偏好总长 ${length} 字，超过 ${TEAM_MEMORY_MAX_CHARS.toLocaleString('en-US')} 字上限：先合并或删掉旧条目，再写新的。`,
    );
  const previous = new Set(teamMemoryLines(before));
  for (const line of teamMemoryLines(after)) {
    if (previous.has(line)) continue;
    const owner = mentionedProject(tx, teamId, line);
    if (owner)
      throw new HttpError(
        400,
        `这一条提到了项目「${owner.name}」，属于项目的事写进项目记忆：scope 填 ${owner.id}。确实跨项目的偏好，改成不提项目名的说法。`,
      );
  }
}

export function syncTeamMemoryEntries(
  tx: Db | Tx,
  teamId: string,
  content: string,
  meta: { now: number; source?: string | null; sourceMessageId?: string | null },
): EntryRow[] {
  const lines = teamMemoryLines(content);
  const existing = tx
    .select()
    .from(teamMemoryEntry)
    .where(eq(teamMemoryEntry.teamId, teamId))
    .all();
  const live = new Set(lines);
  const gone = existing.filter((row) => !live.has(row.line)).map((row) => row.id);
  if (gone.length > 0) tx.delete(teamMemoryEntry).where(inArray(teamMemoryEntry.id, gone)).run();
  const known = new Set(existing.map((row) => row.line));
  for (const line of new Set(lines)) {
    if (known.has(line)) continue;
    tx.insert(teamMemoryEntry)
      .values({
        id: newRecordId(),
        teamId,
        line,
        source: meta.source ?? null,
        sourceMessageId: meta.sourceMessageId ?? null,
        writtenAt: meta.now,
        lastUsedAt: meta.now,
      })
      .run();
  }
  const byLine = new Map(
    tx
      .select()
      .from(teamMemoryEntry)
      .where(eq(teamMemoryEntry.teamId, teamId))
      .all()
      .map((row) => [row.line, row]),
  );
  return lines.flatMap((line) => byLine.get(line) ?? []);
}

export function markTeamMemoryUsed(tx: Db | Tx, teamId: string, lines: string[], now: number) {
  if (lines.length === 0) return;
  tx.update(teamMemoryEntry)
    .set({ lastUsedAt: now })
    .where(and(eq(teamMemoryEntry.teamId, teamId), inArray(teamMemoryEntry.line, lines)))
    .run();
}

export function retirementPlan(
  entries: readonly Pick<EntryRow, 'line' | 'lastUsedAt'>[],
  replaced: ReadonlySet<string>,
  used: ReadonlySet<string>,
  now: number,
): string[] {
  const cutoff = now - TEAM_MEMORY_RETIRE_AFTER_DAYS * DAY_MS;
  const limit = Math.floor(entries.length * TEAM_MEMORY_RETIRE_MAX_SHARE);
  const conflicts = entries.filter((entry) => replaced.has(entry.line));
  const stale = entries
    .filter((entry) => !replaced.has(entry.line) && !used.has(entry.line))
    .filter((entry) => entry.lastUsedAt < cutoff)
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  return [...conflicts, ...stale].slice(0, limit).map((entry) => entry.line);
}
