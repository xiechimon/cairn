import { buildRetryLessonsSection, REVIEW_VERDICT_KIND, reviewVerdictSchema } from '@cairn/shared';
import { and, desc, eq, like } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, buildFeedback, gateVerdict, message, step } from '../db/schema.js';

export const CI_FIX_PROMPT_HEAD = '[ci-fix]';
export const CI_FIX_FAILURES_HEAD = '失败的检查：';

const FEEDBACK_LABELS = {
  'revision:plan': '方案被驳回',
  'revision:build': '审核关口被打回',
  'restart:plan': '重启时的反馈',
  'restart:build': '重启时的反馈',
} as const;

export function retryLessonsOf(db: Db, buildId: string): string | null {
  const buildRow = db.select().from(build).where(eq(build.id, buildId)).get();
  if (buildRow === undefined) return null;
  const dated: { at: number; text: string }[] = [];

  const lastCiFix = db
    .select({ prompt: step.prompt, at: step.createdAt })
    .from(step)
    .where(
      and(
        eq(step.buildId, buildId),
        eq(step.kind, 'build'),
        like(step.prompt, `${CI_FIX_PROMPT_HEAD}%`),
      ),
    )
    .orderBy(desc(step.createdAt))
    .get();
  const failuresBlock = lastCiFix?.prompt?.split(`\n${CI_FIX_FAILURES_HEAD}\n`)[1];
  const failedChecks = failuresBlock?.split('\n\n')[0]?.trim() ?? '';
  if (lastCiFix !== undefined && failedChecks !== '') {
    dated.push({ at: lastCiFix.at, text: `最后一轮 CI 失败的检查：\n${failedChecks}` });
  }

  for (const row of db
    .select()
    .from(buildFeedback)
    .where(eq(buildFeedback.buildId, buildId))
    .all()) {
    dated.push({
      at: row.createdAt,
      text: `${FEEDBACK_LABELS[`${row.kind}:${row.side}`]}：${row.feedback}`,
    });
  }

  for (const row of db
    .select({ content: message.content, at: message.createdAt })
    .from(message)
    .where(and(eq(message.conversationId, buildId), eq(message.role, 'system')))
    .all()) {
    if (typeof row.content !== 'string' || !row.content.includes(REVIEW_VERDICT_KIND)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.content);
    } catch {
      continue;
    }
    if ((parsed as { kind?: unknown } | null)?.kind !== REVIEW_VERDICT_KIND) continue;
    const verdict = reviewVerdictSchema.safeParse((parsed as { verdict?: unknown }).verdict);
    if (!verdict.success) continue;
    const blocking = verdict.data.findings
      .filter((f) => f.severity === 'blocking')
      .map((f) => {
        const where =
          f.file !== undefined ? `（${f.file}${f.line !== undefined ? `:${f.line}` : ''}）` : '';
        return `- ${f.summary}${where}`;
      });
    if (blocking.length > 0) {
      dated.push({ at: row.at, text: `AI 审核的 blocking 发现：\n${blocking.join('\n')}` });
    }
  }

  for (const row of db
    .select()
    .from(gateVerdict)
    .where(and(eq(gateVerdict.buildId, buildId), eq(gateVerdict.outcome, 'block')))
    .all()) {
    const perspective = row.perspective !== null ? `（${row.perspective} 视角）` : '';
    dated.push({ at: row.createdAt, text: `合并闸的 ${row.kind} 判定为 block${perspective}` });
  }

  const newestFirst = dated.sort((a, b) => b.at - a.at).map((d) => d.text);
  if (buildRow.errorMessage !== null) newestFirst.unshift(`失败原因：${buildRow.errorMessage}`);
  return buildRetryLessonsSection(newestFirst);
}
