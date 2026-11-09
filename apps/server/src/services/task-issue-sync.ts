import { type GithubRepoRef, parseGithubIssueSourceRef } from '@cairn/shared';
import { and, asc, eq, isNotNull, isNull, notInArray, or } from 'drizzle-orm';
import { taskIssueClose, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import {
  type FetchLike,
  githubCloseIssue,
  githubIssueState,
  githubReopenIssue,
} from '../lib/github.js';
import { githubRepoOfProject, projectOfTodo } from './git.js';
import { autonomousToken } from './github-autonomous-token.js';
import type { TodoDeps } from './todos.js';

type TodoRow = typeof todo.$inferSelect;

export const TASK_ISSUE_WRITES_PER_SWEEP = 20;

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

const isGone = (error: unknown) => error instanceof HttpError && error.status === 404;

export function createTaskIssueSync(deps: TodoDeps, run: { githubFetch: FetchLike }) {
  let sweeping = false;

  async function settle(
    teamId: string,
    sourceRef: string,
    desired: DesiredIssue,
  ): Promise<'written' | 'recorded' | 'deferred'> {
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
    async sweep(): Promise<TaskIssueSyncTally> {
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
        const budget = () => tally.written + tally.recorded < TASK_ISSUE_WRITES_PER_SWEEP;
        const tombstones = deps.db
          .select()
          .from(taskIssueClose)
          .orderBy(asc(taskIssueClose.createdAt))
          .all();
        for (const tomb of tombstones) {
          if (!budget()) break;
          tally.tombstones += 1;
          try {
            const outcome = await settle(tomb.teamId, tomb.sourceRef, {
              state: 'closed',
              stateReason: 'not_planned',
              comment: tomb.comment,
            });
            tally[outcome] += 1;
            if (outcome !== 'deferred') {
              deps.db.delete(taskIssueClose).where(eq(taskIssueClose.id, tomb.id)).run();
            }
          } catch (error) {
            tally.deferred += 1;
            console.warn(`task issue sync: closing ${tomb.sourceRef} deferred`, error);
          }
        }
        for (const row of divergentRows(deps)) {
          if (!budget()) break;
          const desired = desiredIssue(deps, row);
          if (desired === null || desired === 'wait' || row.sourceRef === null) continue;
          tally.rows += 1;
          try {
            const outcome = await settle(row.teamId, row.sourceRef, desired);
            tally[outcome] += 1;
            if (outcome === 'deferred') continue;
            deps.db
              .update(todo)
              .set({ issueState: desired.state })
              .where(and(eq(todo.id, row.id), eq(todo.sourceRef, row.sourceRef)))
              .run();
          } catch (error) {
            tally.deferred += 1;
            console.warn(`task issue sync: settling ${row.sourceRef} deferred`, error);
          }
        }
      } finally {
        sweeping = false;
      }
      return tally;
    },
  };
}
