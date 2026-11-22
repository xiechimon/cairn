import { eq } from 'drizzle-orm';
import { build, type step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { systemGitOps } from '../lib/git.js';
import { projectOfTodo, repoDirFor } from './git.js';
import { parseHostedMergeInstruction } from './hosted-merge-instruction.js';
import type { MachineDeps } from './machine-deps.js';
import {
  isPersonalSpace,
  landSpaceCommit,
  SPACE_REFUSAL_TEXT,
  type SpaceLanding,
} from './personal-space.js';

export const MERGE_LANDING_SKIPPED = Symbol('merge-landing-skipped');

export const MERGE_NOT_LANDED_NOTE =
  '合并步完成时任务已归档或已挪回待开始，合并没有落地：默认分支保持不变';

export function mergeCardLeftReview(deps: MachineDeps, stepRow: typeof step.$inferSelect): boolean {
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  const todoRow = buildRow
    ? deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get()
    : undefined;
  return (
    todoRow === undefined ||
    todoRow.archivedAt !== null ||
    todoRow.latestBuildId !== stepRow.buildId ||
    todoRow.phase === 'closed' ||
    todoRow.phase === 'todo'
  );
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

export const SPACE_NO_COMMIT_TEXT =
  '任务没有交回提交，个人空间里没有存下任何文件。请重新运行任务。';
export const SPACE_NO_BASE_TEXT =
  '这次的改动和任务开始时的空间版本对不上，没有存进个人空间。请重新运行任务。';
export const SPACE_BASE_MOVED_TEXT =
  '这期间空间里的文件被别的任务改过，这次的改动没有存进去，原来的文件都还在。请重新运行任务。';

export type SpaceStepLanding = { error: string } | { note: string } | null;

export async function applySpaceLanding(
  deps: MachineDeps,
  stepRow: typeof step.$inferSelect,
  commit: string | null,
): Promise<SpaceStepLanding> {
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  const todoRow = buildRow
    ? deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get()
    : undefined;
  const space = todoRow ? projectOfTodo(deps.db, todoRow) : undefined;
  if (!buildRow || !todoRow || !space || !isPersonalSpace(space)) return null;
  if (mergeCardLeftReview(deps, stepRow)) return null;
  if (commit === null) return { error: SPACE_NO_COMMIT_TEXT };
  if (buildRow.baseSha === null) return { error: SPACE_NO_BASE_TEXT };
  let landing: SpaceLanding;
  try {
    landing = await landSpaceCommit(deps, space, {
      base: buildRow.baseSha,
      commit,
      message: todoRow.title,
    });
  } catch (error) {
    if (error instanceof HttpError && error.status === 409) return { error: SPACE_NO_BASE_TEXT };
    throw error;
  }
  if (landing.outcome === 'base-moved') return { error: SPACE_BASE_MOVED_TEXT };
  if (landing.outcome === 'refused') {
    return {
      error: [
        '这次的改动没有存进个人空间：',
        ...landing.refused.map(({ path, reason }) => `- ${path}：${SPACE_REFUSAL_TEXT[reason]}`),
      ].join('\n'),
    };
  }
  return {
    note:
      landing.files.length === 0
        ? '任务没有改动文件，个人空间保持不变。'
        : ['已存进我的空间：', ...landing.files.map((path) => `- ${path}`)].join('\n'),
  };
}
