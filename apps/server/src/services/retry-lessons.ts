import {
  buildRetryLessonsSection,
  planVerificationItems,
  REVIEW_VERDICT_KIND,
  type ReviewVerdict,
  reviewVerdictSchema,
  VERIFY_VERDICT_KIND,
  type VerifyVerdict,
  verifyVerdictSchema,
} from '@cairn/shared';
import { and, desc, eq, gte, like } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  build,
  buildFeedback,
  gateDigest,
  gateState,
  gateVerdict,
  message,
  plan,
  step,
} from '../db/schema.js';
import { CI_FIX_GREEN_EVENT } from './ci-corrections.js';

export const CI_FIX_PROMPT_HEAD = '[ci-fix]';
export const CI_FIX_FAILURES_HEAD = '失败的检查：';
export const CI_FIX_PUSH_RULE =
  '请修复以上检查，并在同一分支上推送（不要新开分支、不要合并 PR）；推送后 CI 会重跑，系统会继续轮询直到检查通过。';

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
  const roundStart =
    db
      .select({ at: buildFeedback.createdAt })
      .from(buildFeedback)
      .where(and(eq(buildFeedback.buildId, buildId), eq(buildFeedback.kind, 'restart')))
      .orderBy(desc(buildFeedback.createdAt))
      .get()?.at ?? 0;

  const lastCiFix = db
    .select({ prompt: step.prompt, at: step.createdAt })
    .from(step)
    .where(
      and(
        eq(step.buildId, buildId),
        eq(step.kind, 'build'),
        like(step.prompt, `${CI_FIX_PROMPT_HEAD}%`),
        gte(step.createdAt, roundStart),
      ),
    )
    .orderBy(desc(step.createdAt))
    .get();
  const promptText = lastCiFix?.prompt ?? '';
  const failuresStart = promptText.indexOf(`\n${CI_FIX_FAILURES_HEAD}\n`);
  const failuresEnd = promptText.lastIndexOf(`\n\n${CI_FIX_PUSH_RULE}`);
  const failedChecks =
    failuresStart === -1 || failuresEnd < failuresStart
      ? ''
      : promptText.slice(failuresStart + CI_FIX_FAILURES_HEAD.length + 2, failuresEnd).trim();
  const turnedGreenAfter =
    lastCiFix !== undefined &&
    db
      .select({ id: message.id })
      .from(message)
      .where(
        and(
          eq(message.conversationId, buildId),
          eq(message.role, 'system'),
          eq(message.content, CI_FIX_GREEN_EVENT),
          gte(message.createdAt, lastCiFix.at),
        ),
      )
      .get() !== undefined;
  if (lastCiFix !== undefined && failedChecks !== '' && !turnedGreenAfter) {
    dated.push({ at: lastCiFix.at, text: `最后一轮 CI 失败的检查：\n${failedChecks}` });
  }

  for (const row of db
    .select()
    .from(buildFeedback)
    .where(and(eq(buildFeedback.buildId, buildId), gte(buildFeedback.createdAt, roundStart)))
    .all()) {
    dated.push({
      at: row.createdAt,
      text: `${FEEDBACK_LABELS[`${row.kind}:${row.side}`]}：${row.feedback}`,
    });
  }

  const verifyFound: { at: number; verdict: VerifyVerdict }[] = [];
  const reviewFound: { at: number; verdict: ReviewVerdict }[] = [];
  for (const row of db
    .select({ content: message.content, at: message.createdAt })
    .from(message)
    .where(
      and(
        eq(message.conversationId, buildId),
        eq(message.role, 'system'),
        gte(message.createdAt, roundStart),
      ),
    )
    .all()) {
    if (typeof row.content !== 'string') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.content);
    } catch {
      continue;
    }
    const kind = (parsed as { kind?: unknown } | null)?.kind;
    if (kind === VERIFY_VERDICT_KIND) {
      const verdict = verifyVerdictSchema.safeParse((parsed as { verdict?: unknown }).verdict);
      if (verdict.success) verifyFound.push({ at: row.at, verdict: verdict.data });
      continue;
    }
    if (kind !== REVIEW_VERDICT_KIND) continue;
    const verdict = reviewVerdictSchema.safeParse((parsed as { verdict?: unknown }).verdict);
    if (!verdict.success) continue;
    reviewFound.push({ at: row.at, verdict: verdict.data });
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

  const gates = db
    .select()
    .from(gateVerdict)
    .where(and(eq(gateVerdict.buildId, buildId), gte(gateVerdict.createdAt, roundStart)))
    .all();
  const digestAt: { at: number; digest: string }[] = [];
  for (const row of gates) {
    if (row.patchDigest !== null) digestAt.push({ at: row.createdAt, digest: row.patchDigest });
  }
  for (const row of db
    .select({ at: gateDigest.createdAt, digest: gateDigest.patchDigest })
    .from(gateDigest)
    .where(and(eq(gateDigest.buildId, buildId), gte(gateDigest.createdAt, roundStart)))
    .all()) {
    digestAt.push(row);
  }
  const state = db.select().from(gateState).where(eq(gateState.buildId, buildId)).get();
  if (state?.patchDigest != null && state.patchDigest !== '' && state.evaluatedAt >= roundStart) {
    digestAt.push({ at: state.evaluatedAt, digest: state.patchDigest });
  }
  digestAt.sort((a, b) => b.at - a.at);
  const latestDigest = digestAt[0]?.digest ?? null;
  const verifyItems = planVerificationItems(
    db
      .select({ content: plan.content })
      .from(plan)
      .where(eq(plan.buildId, buildId))
      .orderBy(desc(plan.version))
      .get()?.content ?? '',
  );
  const evidencePlace = (ev: VerifyVerdict['evidence'][number]): string => {
    const label = (ev.item !== undefined ? verifyItems[ev.item - 1] : undefined)
      ?.replace(/\s+/g, ' ')
      .trim();
    const head =
      ev.item === undefined
        ? ''
        : `item ${ev.item}${label !== undefined && label !== '' ? ` ${label}` : ''}`;
    const place = head === '' ? ev.path : `${head} (${ev.path})`;
    const note = ev.note !== undefined && ev.note.trim() !== '' ? `: ${ev.note.trim()}` : '';
    return `${place}${note}`;
  };
  const claimClosest = <T extends { at: number }, G extends { createdAt: number }>(
    messages: readonly T[],
    rows: readonly G[],
  ): Map<G, T> => {
    const remaining = [...messages].sort((a, b) => a.at - b.at);
    const ordered = [...rows].sort((a, b) => a.createdAt - b.createdAt);
    const claimed = new Map<G, T>();
    for (const [index, row] of ordered.entries()) {
      const next = ordered[index + 1];
      let best: T | undefined;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const candidate of remaining) {
        const dist = Math.abs(candidate.at - row.createdAt);
        const nextDist =
          next === undefined ? Number.POSITIVE_INFINITY : Math.abs(candidate.at - next.createdAt);
        if (nextDist < dist) continue;
        if (dist < bestDist) {
          best = candidate;
          bestDist = dist;
        }
      }
      if (best === undefined) continue;
      remaining.splice(remaining.indexOf(best), 1);
      claimed.set(row, best);
    }
    return claimed;
  };
  const verifyByGate = claimClosest(
    verifyFound,
    gates.filter((row) => row.kind === 'verify'),
  );
  const reviewByGate = claimClosest(
    reviewFound,
    gates.filter((row) => row.kind === 'review'),
  );
  const latestVerify = gates
    .filter(
      (row) => row.kind === 'verify' && latestDigest !== null && row.patchDigest === latestDigest,
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  const keepParts: string[] = [];
  if (latestVerify !== undefined) {
    const found = verifyByGate.get(latestVerify);
    if (found === undefined) {
      if (latestVerify.outcome === 'block') {
        const perspective =
          latestVerify.perspective !== null ? `（${latestVerify.perspective} 视角）` : '';
        dated.push({
          at: latestVerify.createdAt,
          text: `合并闸的 verify 判定为 block${perspective}`,
        });
      }
    } else if (found.verdict.passed) {
      for (const ev of found.verdict.evidence) keepParts.push(evidencePlace(ev));
    } else {
      const lines = [`Verifier conclusion: ${found.verdict.conclusion}`];
      for (const ev of found.verdict.evidence) lines.push(`Failed: ${evidencePlace(ev)}`);
      dated.push({ at: latestVerify.createdAt, text: lines.join('\n') });
    }
  }
  const seenKeep = new Set<string>();
  for (const row of gates
    .filter(
      (gate) =>
        gate.kind === 'review' &&
        gate.outcome === 'pass' &&
        latestDigest !== null &&
        gate.patchDigest === latestDigest,
    )
    .sort((a, b) => a.createdAt - b.createdAt)) {
    const found = reviewByGate.get(row);
    if (found === undefined) continue;
    if (found.verdict.findings.some((f) => f.severity === 'blocking')) continue;
    const part = `${row.perspective ?? 'review'} review`;
    if (seenKeep.has(part)) continue;
    seenKeep.add(part);
    keepParts.push(part);
  }
  for (const row of gates) {
    if (row.outcome !== 'block') continue;
    if (row.kind === 'verify' && row.patchDigest !== null) continue;
    const perspective = row.perspective !== null ? `（${row.perspective} 视角）` : '';
    dated.push({ at: row.createdAt, text: `合并闸的 ${row.kind} 判定为 block${perspective}` });
  }

  const newestFirst = dated.sort((a, b) => b.at - a.at).map((d) => d.text);
  if (keepParts.length > 0) {
    newestFirst.push(`Verified on the previous patch, keep working: ${keepParts.join('; ')}`);
  }
  if (newestFirst.length > 0 && buildRow.errorMessage !== null) {
    newestFirst.unshift(`失败原因：${buildRow.errorMessage}`);
  }
  return buildRetryLessonsSection(newestFirst);
}
