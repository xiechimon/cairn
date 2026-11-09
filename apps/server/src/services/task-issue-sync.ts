import { type GithubRepoRef, parseGithubIssueSourceRef } from '@cairn/shared';
import { and, asc, eq, isNotNull, isNull, notInArray, or } from 'drizzle-orm';
import { taskIssueClose, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import {
  type FetchLike,
  GithubRateLimitedError,
  githubCloseIssue,
  githubIssueState,
  githubReopenIssue,
} from '../lib/github.js';
import { githubRepoOfProject, projectOfTodo } from './git.js';
import { autonomousToken } from './github-autonomous-token.js';
import type { TodoDeps } from './todos.js';

type TodoRow = typeof todo.$inferSelect;

export const TASK_ISSUE_WRITES_PER_SWEEP = 20;

export const TASK_ISSUE_RETRY_MS = 60_000;

const TASK_ISSUE_RETRY_MAX_MS = 3_600_000;

export type DesiredIssue =
  | { state: 'open'; comment: string }
  | { state: 'closed'; stateReason: 'completed' | 'not_planned'; comment: string };

export interface TaskIssueSyncTally {
  tombstones: number;
  rows: number;
  written: number;
  recorded: number;
  deferred: number;
}

const REOPENED = 'Cairn：这个任务重新打开，这里的 issue 也重新打开。';

function issueText(ref: string | null, repo: GithubRepoRef | null): string | null {
  const parsed = ref === null ? null : parseGithubIssueSourceRef(ref);
  if (parsed === null) return null;
  const sameRepo =
    repo !== null &&
    `${parsed.owner}/${parsed.repo}`.toLowerCase() === `${repo.owner}/${repo.repo}`.toLowerCase();
  return sameRepo
    ? `#${parsed.issueNumber}`
    : `${parsed.owner}/${parsed.repo}#${parsed.issueNumber}`;
}

export function desiredIssue(
  deps: Pick<TodoDeps, 'db'>,
  row: TodoRow,
): DesiredIssue | 'wait' | null {
  const archived = row.archivedAt !== null;
  if (row.phase === 'done' && !archived) return null;
  if (row.phase === 'done') {
    return {
      state: 'closed',
      stateReason: 'completed',
      comment: 'Cairn：这个任务已完成并归档，这里的 issue 关闭。',
    };
  }
  if (row.phase !== 'closed' && !archived) return { state: 'open', comment: REOPENED };
  if (row.supersededBy !== null) {
    const successor = deps.db.select().from(todo).where(eq(todo.id, row.supersededBy)).get();
    if (successor?.sourceKind === 'github-issue-self' && successor.sourceRef === null)
      return 'wait';
    const repo = githubRepoOfProject(projectOfTodo(deps.db, row));
    const ref =
      issueText(successor?.sourceRef ?? null, repo) ??
      (successor !== undefined ? `任务「${successor.title}」` : '另一个任务');
    return {
      state: 'closed',
      stateReason: 'not_planned',
      comment: `Cairn：这个任务被 ${ref} 取代，这里的 issue 关闭（未计划）。`,
    };
  }
  return {
    state: 'closed',
    stateReason: 'not_planned',
    comment:
      row.phase === 'closed'
        ? 'Cairn：这个任务已取消，这里的 issue 关闭（未计划）。'
        : 'Cairn：这个任务已归档，这里的 issue 关闭（未计划）。',
  };
}

function divergentRows(deps: Pick<TodoDeps, 'db'>): TodoRow[] {
  const shelved = or(eq(todo.phase, 'closed'), isNotNull(todo.archivedAt));
  const recordedOpen = or(isNull(todo.issueState), eq(todo.issueState, 'open'));
  const recordedClosed = or(isNull(todo.issueState), eq(todo.issueState, 'closed'));
  const active = and(notInArray(todo.phase, ['closed', 'done']), isNull(todo.archivedAt));
  return deps.db
    .select()
    .from(todo)
    .where(
      and(
        eq(todo.sourceKind, 'github-issue-self'),
        isNotNull(todo.sourceRef),
        or(and(shelved, recordedOpen), and(active, recordedClosed)),
      ),
    )
    .orderBy(asc(todo.phaseAt))
    .all();
}

const isGone = (error: unknown) =>
  error instanceof HttpError && (error.status === 404 || error.status === 410);

const isRateLimited = (error: unknown) =>
  error instanceof GithubRateLimitedError || (error instanceof HttpError && error.status === 429);

function forgetLandedStates(deps: Pick<TodoDeps, 'db'>): void {
  deps.db
    .update(todo)
    .set({ issueState: null })
    .where(
      and(
        eq(todo.sourceKind, 'github-issue-self'),
        eq(todo.phase, 'done'),
        isNull(todo.archivedAt),
        isNotNull(todo.issueState),
      ),
    )
    .run();
}

type Outcome = 'written' | 'recorded' | 'deferred';

export function createTaskIssueSync(deps: TodoDeps, run: { githubFetch: FetchLike }) {
  let sweeping = false;
  const retries = new Map<string, { failures: number; until: number }>();

  function backOff(key: string, now: number): void {
    const failures = (retries.get(key)?.failures ?? 0) + 1;
    const delay = Math.min(TASK_ISSUE_RETRY_MS * 2 ** (failures - 1), TASK_ISSUE_RETRY_MAX_MS);
    retries.set(key, { failures, until: now + delay });
  }

  async function settle(
    teamId: string,
    sourceRef: string,
    desired: DesiredIssue,
  ): Promise<Outcome> {
    const parsed = parseGithubIssueSourceRef(sourceRef);
    if (parsed === null) return 'recorded';
    const token = await autonomousToken({ ...deps, githubFetch: run.githubFetch }, teamId, parsed);
    if (token === null) return 'deferred';
    const { owner, repo, issueNumber } = parsed;
    try {
      const read = await githubIssueState(run.githubFetch, token, owner, repo, issueNumber);
      if (read !== null && !read.notModified && read.data.state === desired.state)
        return 'recorded';
      if (desired.state === 'open') {
        await githubReopenIssue(run.githubFetch, token, owner, repo, issueNumber, desired.comment);
      } else {
        await githubCloseIssue(run.githubFetch, token, owner, repo, issueNumber, desired);
      }
      return 'written';
    } catch (error) {
      if (isGone(error)) return 'recorded';
      throw error;
    }
  }

  return {
    async sweep(now = Date.now()): Promise<TaskIssueSyncTally> {
      const tally: TaskIssueSyncTally = {
        tombstones: 0,
        rows: 0,
        written: 0,
        recorded: 0,
        deferred: 0,
      };
      if (sweeping) return tally;
      sweeping = true;
      try {
        forgetLandedStates(deps);
        let attempts = 0;
        const items: { key: string; label: string; run: () => Promise<Outcome> }[] = [];
        const tombstones = deps.db
          .select()
          .from(taskIssueClose)
          .orderBy(asc(taskIssueClose.createdAt))
          .all();
        for (const tomb of tombstones) {
          items.push({
            key: `tomb:${tomb.id}`,
            label: `closing ${tomb.sourceRef}`,
            run: async () => {
              tally.tombstones += 1;
              const outcome = await settle(tomb.teamId, tomb.sourceRef, {
                state: 'closed',
                stateReason: 'not_planned',
                comment: tomb.comment,
              });
              if (outcome !== 'deferred') {
                deps.db.delete(taskIssueClose).where(eq(taskIssueClose.id, tomb.id)).run();
              }
              return outcome;
            },
          });
        }
        for (const row of divergentRows(deps)) {
          const desired = desiredIssue(deps, row);
          const sourceRef = row.sourceRef;
          if (desired === null || desired === 'wait' || sourceRef === null) continue;
          items.push({
            key: `todo:${row.id}:${desired.state}`,
            label: `settling ${sourceRef}`,
            run: async () => {
              tally.rows += 1;
              const outcome = await settle(row.teamId, sourceRef, desired);
              if (outcome !== 'deferred') {
                deps.db
                  .update(todo)
                  .set({ issueState: desired.state })
                  .where(and(eq(todo.id, row.id), eq(todo.sourceRef, sourceRef)))
                  .run();
              }
              return outcome;
            },
          });
        }
        for (const item of items) {
          if (attempts >= TASK_ISSUE_WRITES_PER_SWEEP) break;
          if (now < (retries.get(item.key)?.until ?? 0)) continue;
          try {
            const outcome = await item.run();
            tally[outcome] += 1;
            if (outcome === 'deferred') {
              backOff(item.key, now);
              continue;
            }
            attempts += 1;
            retries.delete(item.key);
          } catch (error) {
            attempts += 1;
            tally.deferred += 1;
            backOff(item.key, now);
            console.warn(`task issue sync: ${item.label} deferred`, error);
            if (isRateLimited(error)) break;
          }
        }
      } finally {
        sweeping = false;
      }
      return tally;
    },
  };
}
