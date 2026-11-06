import {
  type PrMergeState,
  type PrPanelRow,
  type PrPanelState,
  prPanelRowSchema,
} from '@cairn/shared';
import { and, desc, eq, isNull, notInArray, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { threadPr, todo } from '../db/schema.js';
import type { GithubCheckRun } from '../lib/github.js';

const MERGE_STATE_BY_GITHUB: Record<string, PrMergeState> = {
  clean: 'clean',
  has_hooks: 'clean',
  behind: 'behind',
  dirty: 'dirty',
  blocked: 'blocked',
  unstable: 'unstable',
};

const PASSING_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);

export const FINISHED_PR_STATES: readonly PrPanelState[] = ['merged', 'closed'];

export interface CheckTally {
  passed: number;
  failed: number;
  running: number;
  total: number;
  failedNames: string[];
}

export function mergeStateOf(mergeableState: string | null): PrMergeState {
  return MERGE_STATE_BY_GITHUB[mergeableState ?? ''] ?? 'unknown';
}

export function checkTallyOf(runs: readonly GithubCheckRun[]): CheckTally {
  const tally: CheckTally = {
    passed: 0,
    failed: 0,
    running: 0,
    total: runs.length,
    failedNames: [],
  };
  for (const run of runs) {
    if (run.status !== 'completed') tally.running += 1;
    else if (PASSING_CONCLUSIONS.has(run.conclusion ?? '')) tally.passed += 1;
    else {
      tally.failed += 1;
      if (!tally.failedNames.includes(run.name)) tally.failedNames.push(run.name);
    }
  }
  return tally;
}

export function toPrPanelRow(row: typeof threadPr.$inferSelect): PrPanelRow {
  return prPanelRowSchema.parse({
    buildId: row.buildId,
    threadId: row.threadId,
    repo: row.repo,
    number: row.number,
    title: row.title,
    url: row.url,
    state: row.state,
    mergeState: row.mergeState,
    additions: row.additions,
    deletions: row.deletions,
    checks: {
      passed: row.checksPassed,
      failed: row.checksFailed,
      running: row.checksRunning,
      total: row.checksTotal,
      failedNames: JSON.parse(row.checksFailedNames) as string[],
    },
    branch: row.headRef,
    base: row.baseRef,
    head: row.head,
    checksReadFor: row.checksReadFor,
    verdict:
      row.verdictResult !== null && row.verdictHead !== null
        ? { result: row.verdictResult, judgedHead: row.verdictHead }
        : null,
    autoFix: row.autoFix,
    mergeWhenReady: row.mergeWhenReady,
    autoArchive: row.autoArchive,
    dismissed: row.dismissed,
    blockedSince: row.blockedSince,
    wakeRounds: row.wakeRounds,
    lastReadAt: row.lastReadAt,
  });
}

export function listThreadPrs(db: Db, query: { teamId: string; threadId?: string }): PrPanelRow[] {
  const rows = db
    .select({ row: threadPr })
    .from(threadPr)
    .innerJoin(todo, eq(todo.id, threadPr.threadId))
    .where(
      and(
        eq(threadPr.teamId, query.teamId),
        eq(todo.teamId, query.teamId),
        eq(threadPr.dismissed, false),
        query.threadId !== undefined
          ? eq(threadPr.threadId, query.threadId)
          : or(isNull(todo.archivedAt), notInArray(threadPr.state, [...FINISHED_PR_STATES])),
      ),
    )
    .orderBy(desc(threadPr.updatedAt), desc(threadPr.id))
    .all();
  return rows.map(({ row }) => toPrPanelRow(row));
}
