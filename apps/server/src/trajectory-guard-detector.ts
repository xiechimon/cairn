import { type TrajectoryPack, trajectoryPackSchema } from '@cairn/shared';

export type GuardCandidateCategory =
  | 'ci-fix-green'
  | 'review-blocking'
  | 'plan-revision'
  | 'diff-restart'
  | 'post-merge-revert'
  | 'merge-conflict';

export interface GuardCandidate {
  category: GuardCandidateCategory;
  buildId: string;
  negativeControl: string;
  draft: string;
}

export function detectCategories(pack: TrajectoryPack): GuardCandidateCategory[] {
  const out: GuardCandidateCategory[] = [];
  if (pack.judgments.ciFixRounds > 0 && pack.outcome?.merged === true) out.push('ci-fix-green');
  if (pack.judgments.diff.some((d) => d.action === 'restart')) out.push('diff-restart');
  if (pack.judgments.plan.some((p) => p.action === 'revision')) out.push('plan-revision');
  if (pack.judgments.diff.some((d) => d.action === 'revision')) out.push('review-blocking');
  if (pack.outcome?.revertedWithin7d === true) out.push('post-merge-revert');
  return out;
}

export function detectCandidates(packs: TrajectoryPack[]): GuardCandidate[] {
  const seen = new Set<string>();
  const result: GuardCandidate[] = [];
  for (const pack of packs) {
    for (const category of detectCategories(pack)) {
      const key = `${pack.input.agentId ?? ''}:${category}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        category,
        buildId: pack.buildId,
        negativeControl: `reproduce ${category} on ${pack.buildId}`,
        draft: `candidate protection for ${category}`,
      });
    }
  }
  return result;
}

export { trajectoryPackSchema };
