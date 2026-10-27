import { and, eq, like } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { step } from '../db/schema.js';
import { CI_FIX_FAILURES_HEAD, CI_FIX_PROMPT_HEAD, CI_FIX_PUSH_RULE } from './retry-lessons.js';

export { CI_FIX_PROMPT_HEAD } from './retry-lessons.js';

export const CI_FIX_ROUNDS_MAX = 3;
const CI_FIX_SUMMARY_MAX = 800;

export interface CiCheckFailure {
  name: string;
  conclusion: string;
  summary: string | null;
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
    .where(and(eq(step.buildId, buildId), eq(step.kind, 'build'), like(step.prompt, `${head}%`)))
    .all().length;
}

export function deadLoopMessage(rounds: number): string {
  return `CI 检查连续 ${rounds} 轮自动修复仍未通过（死循环闸：连续 ${CI_FIX_ROUNDS_MAX} 轮）——停止追加修复步，转人工处理。`;
}
