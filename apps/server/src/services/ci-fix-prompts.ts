import { and, eq, inArray, like } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { step } from '../db/schema.js';
import type { CiCheckFailure } from './ci-check-verdict.js';
import { githubText } from './github-text.js';
import { CI_FIX_FAILURES_HEAD, CI_FIX_PROMPT_HEAD, CI_FIX_PUSH_RULE } from './retry-lessons.js';

export const CI_FIX_ROUNDS_MAX = 3;

export const CI_MERGE_CONFLICT_PROMPT_HEAD = '[merge-conflict]';

const CI_FIX_SUMMARY_MAX = 800;

export const CI_MERGE_CONFLICT_VERIFY_NOTE =
  '解冲突轮会把默认分支合进来、改动交付：之前的验证是冲突前的提交（还没人领的已停掉），检查通过、回到审核关口时重排一条验证步。';

export const CI_MERGE_CONFLICT_REVIEW_NOTE =
  '解冲突轮停掉了还没人领的 AI 审核步（它审的是冲突前的提交）；回到审核关口后如需审核，请重新发起。';

export function buildMergeConflictPrompt(args: {
  prNumber: number;
  prUrl: string | null;
  defaultBranch: string;
  round: number;
}): string {
  const quote = (v: string) => `'${v.replaceAll("'", `'\\''`)}'`;
  return [
    `${CI_MERGE_CONFLICT_PROMPT_HEAD} 解冲突轮（第 ${args.round} 轮）：PR #${args.prNumber}${args.prUrl ? `（${args.prUrl}）` : ''} 与默认分支「${githubText(args.defaultBranch)}」冲突，GitHub 合并不了。`,
    '',
    `请在本分支上执行 git fetch origin ${quote(args.defaultBranch)}，再 git merge ${quote(`origin/${args.defaultBranch}`)}，解决冲突后提交，并推送到同一分支。`,
    '不要 rebase、不要 force-push、不要新开分支或 PR；推送后 CI 会重跑，系统会继续轮询。',
  ].join('\n');
}

export function buildCiFixPrompt(args: {
  prNumber: number;
  prUrl: string | null;
  round: number;
  failures: CiCheckFailure[];
}): string {
  const failures = args.failures
    .map((f) => {
      const summary = f.summary !== null ? `：${f.summary.slice(0, CI_FIX_SUMMARY_MAX)}` : '';
      return `- ${f.name}（${f.conclusion}）${summary}`;
    })
    .join('\n');
  return [
    `${CI_FIX_PROMPT_HEAD} CI 修复轮（第 ${args.round} 轮）：PR #${args.prNumber}${args.prUrl ? `（${args.prUrl}）` : ''} 的 CI 检查未通过。`,
    '',
    CI_FIX_FAILURES_HEAD,
    failures,
    '',
    CI_FIX_PUSH_RULE,
  ].join('\n');
}

export function countMarkedRounds(db: Db, buildId: string, head: string): number {
  return db
    .select({ id: step.id })
    .from(step)
    .where(
      and(
        eq(step.buildId, buildId),
        inArray(step.kind, ['build', 'session']),
        like(step.prompt, `${head}%`),
      ),
    )
    .all().length;
}

export function deadLoopMessage(rounds: number): string {
  return `CI 检查连续 ${rounds} 轮自动修复仍未通过（死循环闸：连续 ${CI_FIX_ROUNDS_MAX} 轮）——停止追加修复步，转人工处理。`;
}
