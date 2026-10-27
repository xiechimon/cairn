import type { MergeGateRun } from '@cairn/shared';

export interface GateAuditIssuePort {
  readIssuePage(
    page: number,
  ): Promise<{ issues: { number: number; body: string }[]; hasMore: boolean }>;
  createIssue(input: { title: string; body: string }): Promise<number>;
}

export async function auditMergedGate(
  readRuns: (buildId: string) => MergeGateRun[],
  input: { buildId: string; prNumber: number; headSha: string; merged: boolean },
  port: GateAuditIssuePort,
): Promise<number | null> {
  if (!input.merged) return null;
  const previous = readRuns(input.buildId)
    .filter((run) => run.headSha === input.headSha && !run.merged)
    .at(-1);
  if (previous === undefined || previous.ready) return null;
  const marker = `<!-- cairn-gate-mismatch:${input.prNumber}:${input.headSha} -->`;
  for (let page = 1; page <= 10; page += 1) {
    const result = await port.readIssuePage(page);
    const existing = result.issues.find((issue) => issue.body.includes(marker));
    if (existing !== undefined) return existing.number;
    if (!result.hasMore) break;
    if (page === 10) throw new Error('Gate mismatch issue deduplication scan incomplete');
  }
  return port.createIssue({
    title: `gate mismatch: PR #${input.prNumber}`,
    body: [
      marker,
      `PR #${input.prNumber} merged at head ${input.headSha}, but its last in-product gate run was blocked.`,
      `Build: ${input.buildId}. Gate run: ${previous.id}. Patch digest: ${previous.patchDigest ?? 'unavailable'}.`,
      `Blockers: ${previous.blockerCodes.join(', ')}.`,
      'Compare the recorded reviewer output, parsed verdict, model and action before deciding on a follow-up review or revert.',
    ].join('\n\n'),
  });
}
