import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BuildEvidence,
  type ExperienceCandidate,
  experienceCandidateSchema,
  type GuardCandidate,
  guardCandidateSchema,
  ISSUE_FENCE_OPEN,
  PROMOTION_MIN_BUILDS,
  SKILL_ENTRY_FILE,
  type SkillDraft,
  skillDraftSchema,
} from '@cairn/shared';
import { createTwoFilesPatch } from 'diff';
import { and, eq } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { build, memoryCandidate, todo } from './db/schema.js';
import { HttpError } from './lib/errors.js';
import { newRecordId, nowMs } from './lib/ids.js';
import { memoriesInScope, overlaps, saveMemoryEntry } from './services/memory.js';
import { resolveLocalSkill } from './services/skills.js';

export class CurateError extends Error {}

export const GUARD_CANDIDATES_FILE = 'guard-candidates.jsonl';
export const SKILL_DRAFTS_FILE = 'skill-drafts.jsonl';
export const SKILL_DRAFT_PATCH_DIR = 'skill-drafts';

type CandidateRow = typeof memoryCandidate.$inferSelect;

const STATUS_REFUSAL = { promoted: 'was already promoted', dismissed: 'is dismissed' } as const;

interface Placement {
  teamId: string;
  projectId: string;
}

const sameLesson = (a: { title: string; content: string }, b: { title: string; content: string }) =>
  overlaps(a.title, b.title) && overlaps(a.content, b.content);

function mergeEvidence(
  into: { buildIds: string[]; evidence: BuildEvidence[] },
  candidate: ExperienceCandidate,
): { buildIds: string[]; evidence: BuildEvidence[] } {
  const key = (e: BuildEvidence) => `${e.buildId}\0${e.stepId}\0${e.messageIndex}`;
  const known = new Set(into.evidence.map(key));
  const fresh = candidate.evidence
    .map((ref) => ({ buildId: candidate.buildId, ...ref }))
    .filter((e) => !known.has(key(e)));
  return {
    buildIds: into.buildIds.includes(candidate.buildId)
      ? into.buildIds
      : [...into.buildIds, candidate.buildId],
    evidence: [...into.evidence, ...fresh],
  };
}

function readJsonl<T>(path: string, parse: (value: unknown) => T): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => parse(JSON.parse(line)));
}

function writeJsonlAtomic(path: string, rows: unknown[]) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, rows.map((row) => `${JSON.stringify(row)}\n`).join(''), {
    flag: 'wx',
    mode: 0o600,
  });
  renameSync(temporary, path);
}

function promote(
  db: Db,
  row: CandidateRow,
  sourceBuildId: string,
  force: boolean,
): { promoted: true; memoryId: string } | { promoted: false; conflictIds: string[] } {
  const source = db.select().from(build).where(eq(build.id, sourceBuildId)).get();
  const saved = saveMemoryEntry(db, {
    agentId: row.agentId,
    teamId: row.teamId,
    projectId: row.projectId,
    title: row.title,
    content: row.content,
    sourceTodoId: source?.todoId ?? null,
    sourceBuildId,
    force,
  });
  if ('status' in saved) {
    const conflictIds = saved.candidates.map((memory) => memory.id);
    db.update(memoryCandidate)
      .set({ conflictIds, updatedAt: nowMs() })
      .where(eq(memoryCandidate.id, row.id))
      .run();
    return { promoted: false, conflictIds };
  }
  db.update(memoryCandidate)
    .set({ status: 'promoted', memoryId: saved.id, updatedAt: nowMs() })
    .where(eq(memoryCandidate.id, row.id))
    .run();
  return { promoted: true, memoryId: saved.id };
}

export function curateCandidates(
  db: Db,
  lines: string[],
  options: { skillsDir: string; outDir: string },
) {
  const candidates = lines.map((line) => experienceCandidateSchema.parse(JSON.parse(line)));
  const summary = {
    memoryPending: 0,
    memoryMerged: 0,
    memoryKnown: 0,
    memoryPromoted: 0,
    guardNew: 0,
    guardMerged: 0,
    skillNew: 0,
    skillMerged: 0,
    rejected: 0,
    buildMissing: 0,
  };
  const guardsPath = join(options.outDir, GUARD_CANDIDATES_FILE);
  const draftsPath = join(options.outDir, SKILL_DRAFTS_FILE);
  const guards = readJsonl(guardsPath, (value) => guardCandidateSchema.parse(value));
  const drafts = readJsonl(draftsPath, (value) => skillDraftSchema.parse(value));
  const patches = new Map<string, string>();
  const placements = new Map<string, Placement | null>();

  db.transaction((tx) => {
    for (const candidate of candidates) {
      if (`${candidate.title}\n${candidate.content}`.includes(ISSUE_FENCE_OPEN)) {
        summary.rejected++;
        continue;
      }
      if (!placements.has(candidate.buildId))
        placements.set(
          candidate.buildId,
          tx
            .select({ teamId: todo.teamId, projectId: todo.projectId })
            .from(build)
            .innerJoin(todo, eq(todo.id, build.todoId))
            .where(eq(build.id, candidate.buildId))
            .get() ?? null,
        );
      const placement = placements.get(candidate.buildId) ?? null;
      if (placement === null) {
        summary.buildMissing++;
        continue;
      }
      const now = nowMs();
      const scope = { agentId: candidate.agentId, teamId: placement.teamId };
      if (candidate.kind === 'guard' || candidate.kind === 'skill') {
        const pool: (GuardCandidate | SkillDraft)[] = candidate.kind === 'guard' ? guards : drafts;
        const match = pool.find(
          (entry) =>
            entry.agentId === scope.agentId &&
            entry.teamId === scope.teamId &&
            entry.project === placement.projectId &&
            (candidate.kind === 'guard' || ('skill' in entry && entry.skill === candidate.skill)) &&
            sameLesson(entry, candidate),
        );
        if (match) {
          Object.assign(match, mergeEvidence(match, candidate), { updatedAt: now });
          if (candidate.kind === 'guard') summary.guardMerged++;
          else summary.skillMerged++;
          continue;
        }
        const guard: GuardCandidate = {
          id: newRecordId(),
          teamId: scope.teamId,
          project: placement.projectId,
          agentId: scope.agentId,
          title: candidate.title,
          content: candidate.content,
          ...mergeEvidence({ buildIds: [], evidence: [] }, candidate),
          createdAt: now,
          updatedAt: now,
        };
        if (candidate.kind === 'guard') {
          guards.push(guard);
          summary.guardNew++;
          continue;
        }
        const skill = candidate.skill as string;
        const resolved = resolveLocalSkill(options.skillsDir, skill);
        const entryPath = resolved ? join(resolved.dir, SKILL_ENTRY_FILE) : null;
        const current = entryPath ? readFileSync(entryPath, 'utf8') : '';
        const section = `## ${candidate.title}\n\n${candidate.content}\n`;
        const next = resolved
          ? `${current}${current === '' || current.endsWith('\n') ? '' : '\n'}\n${section}`
          : `---\nname: ${skill}\ndescription: ${candidate.title.replace(/\s+/g, ' ')}\n---\n\n${section}`;
        const patch = createTwoFilesPatch(
          resolved ? `a/${resolved.skill.dirName}/${SKILL_ENTRY_FILE}` : '/dev/null',
          `b/${resolved?.skill.dirName ?? skill}/${SKILL_ENTRY_FILE}`,
          current,
          next,
        );
        const patchPath = join(SKILL_DRAFT_PATCH_DIR, `${guard.id}.patch`);
        patches.set(patchPath, patch);
        drafts.push({ ...guard, skill, patch: patchPath });
        summary.skillNew++;
        continue;
      }
      const memoryScope = { ...scope, projectId: placement.projectId };
      const memories = memoriesInScope(tx, memoryScope);
      if (memories.some((memory) => memory.content === candidate.content)) {
        summary.memoryKnown++;
        continue;
      }
      const existing = tx
        .select()
        .from(memoryCandidate)
        .where(
          and(
            eq(memoryCandidate.agentId, memoryScope.agentId),
            eq(memoryCandidate.teamId, memoryScope.teamId),
            eq(memoryCandidate.projectId, memoryScope.projectId),
          ),
        )
        .all()
        .find((row) => sameLesson(row, candidate));
      if (existing === undefined) {
        const merged = mergeEvidence({ buildIds: [], evidence: [] }, candidate);
        tx.insert(memoryCandidate)
          .values({
            id: newRecordId(),
            ...memoryScope,
            title: candidate.title,
            content: candidate.content,
            buildIds: merged.buildIds,
            evidence: merged.evidence,
            conflictIds: memories
              .filter(
                (memory) =>
                  overlaps(memory.title, candidate.title) ||
                  overlaps(memory.content, candidate.content),
              )
              .map((memory) => memory.id),
            createdAt: now,
            updatedAt: now,
          })
          .run();
        summary.memoryPending++;
        continue;
      }
      const newBuild = !existing.buildIds.includes(candidate.buildId);
      const merged = mergeEvidence(existing, candidate);
      tx.update(memoryCandidate)
        .set({ ...merged, updatedAt: now })
        .where(eq(memoryCandidate.id, existing.id))
        .run();
      summary.memoryMerged++;
      if (
        existing.status === 'pending' &&
        newBuild &&
        candidate.buildSucceeded &&
        merged.buildIds.length >= PROMOTION_MIN_BUILDS
      ) {
        try {
          const result = promote(db, { ...existing, ...merged }, candidate.buildId, false);
          if (result.promoted) summary.memoryPromoted++;
        } catch (error) {
          if (!(error instanceof HttpError)) throw error;
        }
      }
    }
  });

  mkdirSync(join(options.outDir, SKILL_DRAFT_PATCH_DIR), { recursive: true });
  for (const [path, patch] of patches)
    writeFileSync(join(options.outDir, path), patch, { flag: 'wx', mode: 0o600 });
  writeJsonlAtomic(guardsPath, guards);
  writeJsonlAtomic(draftsPath, drafts);
  return summary;
}

export function confirmCandidate(db: Db, id: string, force: boolean) {
  const row = db.select().from(memoryCandidate).where(eq(memoryCandidate.id, id)).get();
  if (row === undefined) throw new CurateError(`Candidate ${id} not found`);
  if (row.status !== 'pending')
    throw new CurateError(`Candidate ${id} ${STATUS_REFUSAL[row.status]}`);
  if (row.buildIds.length < PROMOTION_MIN_BUILDS)
    throw new CurateError(
      `Candidate ${id} needs evidence from ${PROMOTION_MIN_BUILDS} different builds (has ${row.buildIds.length})`,
    );
  let result: ReturnType<typeof promote>;
  try {
    result = promote(db, row, row.buildIds.at(-1) as string, force);
  } catch (error) {
    if (error instanceof HttpError) throw new CurateError(`Candidate ${id}: ${error.message}`);
    throw error;
  }
  if (!result.promoted)
    throw new CurateError(
      `Candidate ${id} overlaps memories ${result.conflictIds.join(', ')}; update those or pass --force`,
    );
  return result.memoryId;
}

export function dismissCandidate(db: Db, id: string) {
  const row = db.select().from(memoryCandidate).where(eq(memoryCandidate.id, id)).get();
  if (row === undefined) throw new CurateError(`Candidate ${id} not found`);
  if (row.status !== 'pending')
    throw new CurateError(`Candidate ${id} ${STATUS_REFUSAL[row.status]}`);
  db.update(memoryCandidate)
    .set({ status: 'dismissed', updatedAt: nowMs() })
    .where(eq(memoryCandidate.id, id))
    .run();
}
