import {
  EVIDENCE_PREFIX,
  GATE_LIMITS,
  parseGithubIssueSourceRef,
  parseReviewPromptMeta,
  parseVerifyPromptMeta,
} from '@cairn/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { build, gateVerdict, type step, todo } from '../db/schema.js';
import { isFullSha } from '../lib/github.js';
import { nowMs } from '../lib/ids.js';
import type { BuildDeps } from './builds.js';
import { githubRepoOfProject, projectOfTodo } from './git.js';
import { githubReadToken } from './github-autonomous-token.js';
import { readCompareAt } from './merge-gate/github-facts.js';
import { bindGateVerdict } from './merge-gate/verdict.js';
import { githubGateReadPort } from './merge-gate-github.js';

export function ticketRefOf(todoRow: { sourceRef: string | null; seqNum: number }): string {
  const linked = todoRow.sourceRef !== null ? parseGithubIssueSourceRef(todoRow.sourceRef) : null;
  return String(linked?.issueNumber ?? todoRow.seqNum);
}

export interface VerdictReport {
  reportedHeadSha: string | null;
  driftedHeads: readonly string[];
}

function expectedHeadOf(stepRow: typeof step.$inferSelect): string | null {
  const expected =
    stepRow.kind === 'review'
      ? (parseReviewPromptMeta(stepRow.prompt)?.expectedHeadSha ?? null)
      : stepRow.kind === 'verify'
        ? (parseVerifyPromptMeta(stepRow.prompt)?.expectedHeadSha ?? null)
        : null;
  return expected !== null && isFullSha(expected) ? expected : null;
}

export function reportedVerdictHeads(
  stepRow: typeof step.$inferSelect,
  reported: { gateHeadSha?: string | undefined; commit?: string | null | undefined },
): VerdictReport {
  const candidates = [reported.gateHeadSha, reported.commit].filter(
    (sha): sha is string => typeof sha === 'string' && isFullSha(sha),
  );
  const expected = expectedHeadOf(stepRow);
  const driftedHeads = expected === null ? [] : candidates.filter((sha) => sha !== expected);
  const pick = stepRow.kind === 'verify' ? driftedHeads.at(-1) : driftedHeads[0];
  return { reportedHeadSha: pick ?? candidates[0] ?? null, driftedHeads };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const verdictDigestsInFlight = new Set<Promise<void>>();

export async function flushVerdictDigests(): Promise<void> {
  await Promise.all([...verdictDigestsInFlight]);
}

export function persistGateVerdict(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
  facts: { stepFailed: boolean; extracted: boolean; blocked: boolean; report: VerdictReport },
): void {
  if (stepRow.kind !== 'review' && stepRow.kind !== 'verify') return;
  const expectedHeadSha = expectedHeadOf(stepRow);
  if (expectedHeadSha === null) return;
  const bound = bindGateVerdict({
    kind: stepRow.kind,
    perspective: null,
    expectedHeadSha,
    reportedHeadSha: facts.report.reportedHeadSha,
    stepFailed: facts.stepFailed,
    extracted: facts.extracted,
    blocked: facts.blocked,
  });
  if (bound === null) return;
  const inserted = deps.db
    .insert(gateVerdict)
    .values({
      stepId: stepRow.id,
      buildId: stepRow.buildId,
      kind: bound.kind,
      perspective: bound.perspective,
      outcome: bound.outcome,
      patchDigest: null,
      headSha: bound.headSha,
      expectedHeadSha: bound.expectedHeadSha,
      createdAt: nowMs(),
    })
    .onConflictDoNothing({ target: gateVerdict.stepId })
    .run();
  if (inserted.changes === 0) return;
  const driftedHeads = facts.report.driftedHeads;
  const pending = (async (): Promise<void> => {
    const row = deps.db.select().from(gateVerdict).where(eq(gateVerdict.stepId, stepRow.id)).get();
    if (row === undefined || row.patchDigest !== null || row.headSha === null) return;
    const expected = row.expectedHeadSha;
    const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
    if (buildRow?.prNumber == null) return;
    const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
    if (todoRow === undefined) return;
    const repo = githubRepoOfProject(projectOfTodo(deps.db, todoRow));
    if (repo === null) return;
    const token = await githubReadToken(deps, todoRow.teamId, repo);
    if (token === null) return;
    const port = githubGateReadPort(
      deps.githubFetch ?? fetch,
      token,
      repo.owner,
      repo.repo,
      10_000,
    );
    let pathsAfterExpected: string[] | null = null;
    if (row.kind === 'verify' && driftedHeads.length > 0) {
      const names = new Set<string>();
      for (const head of driftedHeads) {
        const read = await readCompareAt(port, expected, head);
        const files = typeof read.compare === 'object' ? read.compare.files : null;
        if (files === null || files.length === 0 || files.length >= GATE_LIMITS.compareFileCap) {
          return;
        }
        for (const f of files) {
          names.add(f.filename);
          if (f.previousFilename !== null) names.add(f.previousFilename);
        }
      }
      pathsAfterExpected = [...names];
    } else if (row.headSha !== expected) {
      return;
    }
    let baseSha: string | null = null;
    const pull = await port.pull(buildRow.prNumber, { etag: null });
    const base = asRecord(pull.kind === 'ok' ? asRecord(pull.body)?.base : null);
    if (typeof base?.sha === 'string' && isFullSha(base.sha)) {
      baseSha = base.sha;
    } else if (typeof base?.ref === 'string' && base.ref !== '') {
      const branch = await port.branch(base.ref, { etag: null });
      const commit = asRecord(branch.kind === 'ok' ? asRecord(branch.body)?.commit : null);
      if (typeof commit?.sha === 'string' && isFullSha(commit.sha)) baseSha = commit.sha;
    }
    if (baseSha === null) return;
    const delivery = await readCompareAt(port, baseSha, expected);
    if (typeof delivery.compare !== 'object') return;
    const bound = bindGateVerdict({
      kind: row.kind,
      perspective: row.perspective,
      expectedHeadSha: expected,
      reportedHeadSha: row.headSha,
      stepFailed: false,
      extracted: true,
      blocked: false,
      compareFiles: delivery.compare.files,
      pathsAfterExpected,
      evidenceDir: `${EVIDENCE_PREFIX}${ticketRefOf(todoRow)}/`,
    });
    if (bound?.patchDigest == null) return;
    deps.db
      .update(gateVerdict)
      .set({ patchDigest: bound.patchDigest })
      .where(
        and(
          eq(gateVerdict.stepId, row.stepId),
          eq(gateVerdict.createdAt, row.createdAt),
          isNull(gateVerdict.patchDigest),
        ),
      )
      .run();
  })()
    .catch(() => undefined)
    .finally(() => verdictDigestsInFlight.delete(pending));
  verdictDigestsInFlight.add(pending);
}
