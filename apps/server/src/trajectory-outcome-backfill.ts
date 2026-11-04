import { existsSync } from 'node:fs';
import { asc, eq, isNotNull } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { build, buildOutcomeBackfill, todo } from './db/schema.js';
import { runGit } from './lib/git.js';
import { nowMs } from './lib/ids.js';
import { DONE_ROW } from './services/delivery-rows.js';
import { projectOfTodo, requireRepoReadDir } from './services/git.js';
import { latestDeliveryVerdict, REVERT_WINDOW_MS } from './trajectory-outcome.js';

export const OUTCOME_BACKFILL_INTERVAL_MS = 24 * 60 * 60 * 1000;

const REVERT_SUBJECT_PATTERN = /revert/i;

const PR_REF_PATTERN = /#\d+/;

const MERGE_TIME_SLACK_MS = 5 * 60 * 1000;

const GIT_TIMEOUT_MS = 60_000;

const MAX_LATER_COMMITS_PER_BUILD = 200;

export interface OutcomeBackfillLogger {
  info(obj: object, msg: string): void;
}

export interface OutcomeBackfillSummary {
  scanned: number;
  windowOpen: number;
  backfilled: number;
  skippedNoRepo: number;
  skippedNoMerge: number;
  failed: number;
}

interface MainCommit {
  sha: string;
  atMs: number;
  subject: string;
}

function prRefPattern(prNumber: number): RegExp {
  return new RegExp(`#${prNumber}\\b`);
}

async function headRefOf(dir: string): Promise<string> {
  const result = await runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], {
    cwd: dir,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  const name = result.code === 0 ? result.stdout.toString('utf8').trim() : '';
  return name === '' ? 'main' : name;
}

async function firstParentLog(dir: string, ref: string): Promise<MainCommit[]> {
  const result = await runGit(['log', '--first-parent', '--format=%H%x00%cI%x00%s', ref], {
    cwd: dir,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  if (result.code !== 0) return [];
  return result.stdout
    .toString('utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [sha, iso, subject] = line.split('\x00');
      return { sha: sha ?? '', atMs: Date.parse(iso ?? '') || 0, subject: subject ?? '' };
    });
}

export async function findPrMergeCommit(dir: string, prNumber: number): Promise<MainCommit | null> {
  const ref = await headRefOf(dir);
  const pattern = prRefPattern(prNumber);
  const matches = (await firstParentLog(dir, ref)).filter(
    (commit) => pattern.test(commit.subject) && !REVERT_SUBJECT_PATTERN.test(commit.subject),
  );
  if (matches.length === 0) return null;
  return matches.reduce((oldest, commit) => (commit.atMs < oldest.atMs ? commit : oldest));
}

export function detectRevertInWindow(
  log: MainCommit[],
  prNumber: number,
  merge: MainCommit,
  windowEndMs: number,
): boolean {
  const pattern = prRefPattern(prNumber);
  const shortSha = merge.sha.slice(0, 7);
  return log.some(
    (commit) =>
      REVERT_SUBJECT_PATTERN.test(commit.subject) &&
      commit.atMs >= merge.atMs - MERGE_TIME_SLACK_MS &&
      commit.atMs <= windowEndMs &&
      (pattern.test(commit.subject) || commit.subject.includes(shortSha)),
  );
}

function parseDiffSides(diffText: string): {
  added: Map<string, Set<string>>;
  removed: Map<string, Set<string>>;
  deletedFiles: Set<string>;
} {
  const added = new Map<string, Set<string>>();
  const removed = new Map<string, Set<string>>();
  const deletedFiles = new Set<string>();
  let file: string | null = null;
  let inHunk = false;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = null;
      inHunk = false;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const target = line.slice(4);
      if (target === '/dev/null') {
        if (file !== null) deletedFiles.add(file);
        file = null;
      } else {
        file = target.replace(/^b\//, '');
      }
      inHunk = false;
      continue;
    }
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk || file === null) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      const lines = added.get(file) ?? new Set<string>();
      lines.add(line.slice(1));
      added.set(file, lines);
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      const lines = removed.get(file) ?? new Set<string>();
      lines.add(line.slice(1));
      removed.set(file, lines);
    } else if (line !== '\\ No newline at end of file') {
      inHunk = false;
    }
  }
  return { added, removed, deletedFiles };
}

export async function detectFixedByLaterPr(
  dir: string,
  ref: string,
  merge: MainCommit,
): Promise<boolean> {
  const diff = await runGit(['diff', '-U0', `${merge.sha}^`, merge.sha], {
    cwd: dir,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  if (diff.code !== 0) return false;
  const our = parseDiffSides(diff.stdout.toString('utf8'));
  if (our.added.size === 0) return false;
  const log = await firstParentLog(dir, ref);
  const laterPrs = log.filter(
    (commit) =>
      commit.atMs > merge.atMs + MERGE_TIME_SLACK_MS &&
      PR_REF_PATTERN.test(commit.subject) &&
      commit.sha !== merge.sha &&
      !REVERT_SUBJECT_PATTERN.test(commit.subject),
  );
  for (const later of laterPrs.slice(0, MAX_LATER_COMMITS_PER_BUILD)) {
    const laterDiff = await runGit(['diff', '-U0', `${later.sha}^`, later.sha], {
      cwd: dir,
      timeoutMs: GIT_TIMEOUT_MS,
    });
    if (laterDiff.code !== 0) continue;
    const theirs = parseDiffSides(laterDiff.stdout.toString('utf8'));
    for (const [file, removedLines] of theirs.removed) {
      const ourAdded = our.added.get(file);
      if (ourAdded === undefined) continue;
      if ([...removedLines].some((content) => ourAdded.has(content))) return true;
    }
    for (const file of theirs.deletedFiles) {
      if (our.added.has(file)) return true;
    }
  }
  return false;
}

export interface OutcomeBackfillDeps {
  db: Db;
  reposDir: string;
  logger: OutcomeBackfillLogger;
}

export async function sweepOutcomeBackfill(
  deps: OutcomeBackfillDeps,
  now = nowMs(),
): Promise<OutcomeBackfillSummary> {
  const summary: OutcomeBackfillSummary = {
    scanned: 0,
    windowOpen: 0,
    backfilled: 0,
    skippedNoRepo: 0,
    skippedNoMerge: 0,
    failed: 0,
  };
  const candidates = deps.db
    .select()
    .from(build)
    .where(isNotNull(build.prNumber))
    .orderBy(asc(build.createdAt), asc(build.id))
    .all();
  for (const candidate of candidates) {
    try {
      const latest = latestDeliveryVerdict(deps.db, candidate);
      if (latest?.content !== DONE_ROW) continue;
      if (
        deps.db
          .select({ buildId: buildOutcomeBackfill.buildId })
          .from(buildOutcomeBackfill)
          .where(eq(buildOutcomeBackfill.buildId, candidate.id))
          .get() !== undefined
      )
        continue;
      summary.scanned++;
      if (now < latest.at + REVERT_WINDOW_MS) {
        summary.windowOpen++;
        continue;
      }
      const todoRow = deps.db.select().from(todo).where(eq(todo.id, candidate.todoId)).get();
      const projectRow = todoRow ? projectOfTodo(deps.db, todoRow) : undefined;
      if (projectRow === undefined) {
        summary.skippedNoRepo++;
        continue;
      }
      let repoDir: string;
      try {
        repoDir = await requireRepoReadDir({ db: deps.db, reposDir: deps.reposDir }, projectRow.id);
      } catch {
        summary.skippedNoRepo++;
        continue;
      }
      if (!existsSync(repoDir)) {
        summary.skippedNoRepo++;
        continue;
      }
      const merge = await findPrMergeCommit(repoDir, candidate.prNumber as number);
      if (merge === null) {
        summary.skippedNoMerge++;
        continue;
      }
      const ref = await headRefOf(repoDir);
      const log = await firstParentLog(repoDir, ref);
      const reverted = detectRevertInWindow(
        log,
        candidate.prNumber as number,
        merge,
        latest.at + REVERT_WINDOW_MS,
      );
      const fixed = await detectFixedByLaterPr(repoDir, ref, merge);
      deps.db
        .insert(buildOutcomeBackfill)
        .values({
          buildId: candidate.id,
          revertedWithin7d: reverted,
          fixedByLaterPr: fixed,
          mergeCommit: merge.sha,
          checkedAt: now,
        })
        .run();
      summary.backfilled++;
    } catch (error) {
      summary.failed++;
      deps.logger.info(
        {
          buildId: candidate.id,
          err: error instanceof Error ? error.message : String(error),
        },
        'trajectory outcome backfill failed for build (sweep continues)',
      );
    }
  }
  return summary;
}
