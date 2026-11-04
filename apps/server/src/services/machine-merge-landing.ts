import { eq } from 'drizzle-orm';
import { build, type step, todo } from '../db/schema.js';
import { systemGitOps } from '../lib/git.js';
import { projectOfTodo, repoDirFor } from './git.js';
import { parseHostedMergeInstruction } from './hosted-merge-instruction.js';
import type { MachineDeps } from './machine-deps.js';

export const MERGE_LANDING_SKIPPED = Symbol('merge-landing-skipped');

export const MERGE_NOT_LANDED_NOTE =
  '合并步跑完时任务已取消或已挪回待开始，合并没有落地：默认分支保持不变';

export function mergeCardLeftReview(deps: MachineDeps, stepRow: typeof step.$inferSelect): boolean {
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  const todoRow = buildRow
    ? deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get()
    : undefined;
  return todoRow?.phase === 'closed' || todoRow?.phase === 'todo';
}

export async function applyMergeLanding(
  deps: MachineDeps,
  stepRow: typeof step.$inferSelect,
  commit: string | null,
): Promise<string | null | typeof MERGE_LANDING_SKIPPED> {
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  const todoRow = buildRow
    ? deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get()
    : undefined;
  const projectRow = todoRow ? projectOfTodo(deps.db, todoRow) : undefined;
  if (!todoRow || projectRow?.repoKind !== 'hosted' || projectRow.repoName === null) {
    return null;
  }
  if (commit === null) return 'merge step reported no commit';
  const dir = repoDirFor(deps.reposDir, todoRow.teamId, projectRow.repoName);
  const { defaultBranch } = await systemGitOps.listBranches(dir);
  const target = parseHostedMergeInstruction(stepRow.prompt);
  if (target === null) return 'merge landing refused: pinned base missing — rerun the task';
  const branch = target.baseBranch;
  if (
    target.projectId !== projectRow.id ||
    target.repoName !== projectRow.repoName ||
    target.configuredBaseBranch !== projectRow.baseBranch ||
    branch !== (projectRow.baseBranch ?? defaultBranch ?? 'main')
  )
    return 'merge landing refused: project base changed — rerun the task';
  const tip = await systemGitOps.resolveCommit(dir, `refs/heads/${branch}`);
  if (tip === null) return `merge landing refused: ${branch} missing — rerun the task`;
  if (tip !== commit) {
    const ancestor = await systemGitOps.isAncestor(dir, tip, commit);
    if (!ancestor) {
      return `merge landing refused: ${branch} moved (non-fast-forward) — rerun the task`;
    }
  }
  if (mergeCardLeftReview(deps, stepRow)) return MERGE_LANDING_SKIPPED;
  const current = projectOfTodo(deps.db, todoRow);
  if (
    current?.id !== target.projectId ||
    current.repoName !== target.repoName ||
    current.baseBranch !== target.configuredBaseBranch
  )
    return 'merge landing refused: project base changed — rerun the task';
  await systemGitOps.updateBranchRef(dir, branch, commit);
  return null;
}
