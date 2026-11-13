import type { GithubRepoRef, ReviewGate, StepKind } from '@cairn/shared';
import type { BuildDeps } from './builds.js';
import { githubRepoOfProject, projectOfTodo } from './git.js';
import { resolveNamedPrompt } from './named-prompts.js';

export function reviewInstructionOf(
  deps: BuildDeps,
  teamId: string,
  gate: ReviewGate,
): string | undefined {
  if (gate !== 'review') return undefined;
  const prompt = resolveNamedPrompt(deps.db, teamId, 'review');
  return prompt.overridden ? prompt.text : undefined;
}

export const INFO_CARD_MERGE_REFUSAL =
  '信息卡的产出是报告附件，不进合并：要把内容落进仓库，请建下游代码卡走正常流程';

export function githubPrOf(
  deps: BuildDeps,
  todoRow: { projectId: string; teamId: string },
  prNumber: number | null,
): { repoRef: GithubRepoRef; prNumber: number } | null {
  if (prNumber === null) return null;
  const repoRef = githubRepoOfProject(projectOfTodo(deps.db, todoRow));
  return repoRef === null ? null : { repoRef, prNumber };
}

export const STEP_KIND_TEXT: Record<StepKind, string> = {
  plan: '规划',
  build: '执行',
  session: '会话',
  merge: '合并',
  chief: '编排',
  review: '审核',
  verify: '验证',
};
