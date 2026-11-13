import { and, desc, eq, isNotNull, ne, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { githubPullState } from '../lib/github.js';
import type { BuildDeps } from './builds.js';
import { githubRepoOfProject, projectOfTodo } from './git.js';
import { githubReadToken } from './github-autonomous-token.js';

type BuildRow = typeof build.$inferSelect;

export function latestPrBuild(db: Db, todoId: string): BuildRow | null {
  return (
    db
      .select()
      .from(build)
      .where(and(eq(build.todoId, todoId), or(isNotNull(build.prUrl), isNotNull(build.prNumber))))
      .orderBy(desc(build.createdAt))
      .all()
      .at(0) ?? null
  );
}

async function probePullState(
  deps: BuildDeps,
  teamId: string,
  projectId: string,
  prNumber: number,
  timeoutMs?: number,
): Promise<{ state: 'open' | 'closed'; merged: boolean } | null> {
  const projRow = projectOfTodo(deps.db, { projectId, teamId });
  const repoRef = githubRepoOfProject(projRow);
  if (repoRef === null) return null;
  const { owner, repo } = repoRef;
  const token = await githubReadToken(deps, teamId, repoRef);
  return githubPullState(deps.githubFetch ?? fetch, token, owner, repo, prNumber, timeoutMs);
}

export async function probeReworkTargetPr(
  deps: BuildDeps,
  target: BuildRow,
  todo: { projectId: string; teamId: string },
  requireReadable = false,
): Promise<'merged' | 'closed' | null> {
  if (target.prNumber === null) return null;
  const state = await probePullState(deps, todo.teamId, todo.projectId, target.prNumber);
  if (state === null && requireReadable) {
    throw new HttpError(
      409,
      `Could not read PR #${target.prNumber}. Please retry before continuing this task.`,
    );
  }
  if (state === null || state.state === 'open') return null;
  return state.merged ? 'merged' : 'closed';
}

const MERGED_PR_GUARD_PROBE_TIMEOUT_MS = 5_000;

export async function mergedPrElsewhere(
  deps: BuildDeps,
  todoId: string,
  excludeBuildId: string,
): Promise<{ prNumber: number; prUrl: string | null } | null> {
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, todoId)).get();
  if (todoRow === undefined) return null;
  const prior = deps.db
    .select()
    .from(build)
    .where(
      and(
        eq(build.todoId, todoId),
        ne(build.id, excludeBuildId),
        or(isNotNull(build.prUrl), isNotNull(build.prNumber)),
      ),
    )
    .orderBy(desc(build.createdAt))
    .all();
  for (const row of prior) {
    if (row.prNumber === null) continue;
    const state = await probePullState(
      deps,
      todoRow.teamId,
      todoRow.projectId,
      row.prNumber,
      MERGED_PR_GUARD_PROBE_TIMEOUT_MS,
    );
    if (state?.merged) return { prNumber: row.prNumber, prUrl: row.prUrl };
  }
  return null;
}

export async function assertNoMergedPrElsewhere(
  deps: BuildDeps,
  row: BuildRow,
  prNumber: number,
): Promise<void> {
  const priorMerged = await mergedPrElsewhere(deps, row.todoId, row.id);
  if (priorMerged !== null) {
    throw new HttpError(
      409,
      `本任务已有已合并的 PR #${priorMerged.prNumber}，本 build 又开了 PR #${prNumber}——疑似重复交付，拒绝发起合并（请人工复核后处理）`,
    );
  }
}
