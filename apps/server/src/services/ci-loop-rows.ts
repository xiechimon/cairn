import { and, desc, eq, isNotNull, ne } from 'drizzle-orm';
import { build, step, todo } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { emitRuntimeBuildSpan } from '../runtime-otel.js';
import { type BuildDeps, toBuildRecord } from './builds.js';
import { githubRepoOfProject, projectOfTodo } from './git.js';
import { setTodoPhase } from './todos.js';
import { insertMessageRow } from './transcript.js';

export const CI_EMPTY_CHECKS_GRACE_MS = 300_000;

export function failWithMessage(
  deps: BuildDeps,
  cand: { buildId: string; todoId: string },
  teamId: string,
  text: string,
) {
  deps.db.update(build).set({ errorMessage: text }).where(eq(build.id, cand.buildId)).run();
  const row = deps.db.select().from(build).where(eq(build.id, cand.buildId)).get();
  if (row) deps.hub.publishBuildDoc(teamId, toBuildRecord(row));
  setTodoPhase(deps, cand.todoId, 'failed');
  emitRuntimeBuildSpan(deps.db, cand.buildId, 'failed');
}

export function writeSystemRow(deps: BuildDeps, buildId: string, content: string): void {
  insertMessageRow(deps, buildId, {
    id: newRecordId(),
    role: 'system',
    content,
    createdAt: nowMs(),
  });
}

export function pushNotSeen(
  deps: BuildDeps,
  buildId: string,
  headSha: string | null,
  now: number,
): boolean {
  const last = deps.db
    .select({ sha: step.checkpointCommit, at: step.finishedAt })
    .from(step)
    .where(
      and(
        eq(step.buildId, buildId),
        eq(step.status, 'done'),
        ne(step.kind, 'review'),
        isNotNull(step.checkpointCommit),
        isNotNull(step.finishedAt),
      ),
    )
    .orderBy(desc(step.finishedAt))
    .get();
  return (
    last?.sha != null &&
    last.at != null &&
    last.sha !== headSha &&
    now - last.at < CI_EMPTY_CHECKS_GRACE_MS
  );
}

export function freshGrindRow(deps: BuildDeps, todoId: string) {
  const row = deps.db.select().from(todo).where(eq(todo.id, todoId)).get();
  return row !== undefined && row.archivedAt === null && row.phase === 'building' ? row : null;
}

export function freshReviewRow(deps: BuildDeps, todoId: string, buildId: string) {
  const row = deps.db.select().from(todo).where(eq(todo.id, todoId)).get();
  return row !== undefined && row.phase === 'review' && row.latestBuildId === buildId ? row : null;
}

export function githubTarget(deps: BuildDeps, todoRow: { projectId: string; teamId: string }) {
  const projRow = projectOfTodo(deps.db, todoRow);
  const ref = githubRepoOfProject(projRow);
  if (projRow === undefined || ref === null) return null;
  return {
    teamId: projRow.teamId,
    baseBranch: projRow.baseBranch,
    fullName: `${ref.owner}/${ref.repo}`,
    owner: ref.owner,
    repo: ref.repo,
  };
}
