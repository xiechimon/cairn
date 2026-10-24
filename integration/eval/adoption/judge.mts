export const MAX_INFRA_RETRIES = 2;
export const Z_THRESHOLD = 1.96;
export const MIN_PAIRS = 5;

export type InfraFailureReason =
  | 'timeout'
  | 'network'
  | 'provider_5xx'
  | 'sandbox_start'
  | 'exception';

export type TrialOutcome =
  | { kind: 'scored'; score: number; triggered: boolean }
  | { kind: 'infra_failure'; reason: InfraFailureReason; detail?: string };

export interface CasePair {
  caseId: string;
  before: TrialOutcome[];
  after: TrialOutcome[];
}

export interface CandidateChange {
  skills: string[];
  promptSections: string[];
  routeBranches: string[];
}

export interface RunTouchEvidence {
  injectedSkills: string[];
  contextSections: string[];
  routeBranches: string[];
}

export type AdoptionDecision =
  | 'accepted'
  | 'rejected_inert'
  | 'rejected_regression'
  | 'not_significant';

export interface PairedZ {
  n: number;
  meanDiff: number;
  sdDiff: number;
  z: number;
  meanSign: -1 | 0 | 1;
  degenerate: 'too_few_pairs' | 'zero_variance' | null;
}

export interface AdoptionVerdict {
  decision: AdoptionDecision;
  validity: {
    totalCases: number;
    validPairs: number;
    excludedInfra: number;
    excludedCaseIds: string[];
    retriedTrials: number;
  };
  effect: {
    triggeredPairs: number;
    untriggeredPairs: number;
    triggerRate: number;
  };
  significance: PairedZ & { threshold: number };
}

type ScoredTrial = Extract<TrialOutcome, { kind: 'scored' }>;

interface ResolvedSide {
  scored: ScoredTrial | null;
  reruns: number;
}

function assertFiniteScore(outcome: TrialOutcome, label: string): void {
  if (outcome.kind === 'scored' && !Number.isFinite(outcome.score)) {
    throw new Error(`non-finite score ${outcome.score} in ${label}`);
  }
}

function resolveSide(attempts: TrialOutcome[], caseId: string): ResolvedSide {
  const budget = attempts.slice(0, MAX_INFRA_RETRIES + 1);
  for (const outcome of budget) assertFiniteScore(outcome, `case ${caseId}`);
  const index = budget.findIndex((a) => a.kind === 'scored');
  if (index === -1) return { scored: null, reruns: Math.max(budget.length - 1, 0) };
  return { scored: budget[index] as ScoredTrial, reruns: index };
}

export async function collectTrial(run: () => Promise<TrialOutcome>): Promise<TrialOutcome[]> {
  const attempts: TrialOutcome[] = [];
  for (let attempt = 0; attempt <= MAX_INFRA_RETRIES; attempt++) {
    const outcome = await run().catch(
      (error: unknown): TrialOutcome => ({
        kind: 'infra_failure',
        reason: 'exception',
        detail: error instanceof Error ? error.message : String(error),
      }),
    );
    assertFiniteScore(outcome, 'trial');
    attempts.push(outcome);
    if (outcome.kind === 'scored') break;
  }
  return attempts;
}

export function wasTriggered(change: CandidateChange, evidence: RunTouchEvidence): boolean {
  const touches = (changed: string[], seen: string[]): boolean => {
    const seenSet = new Set(seen);
    return changed.some((item) => seenSet.has(item));
  };
  return (
    touches(change.skills, evidence.injectedSkills) ||
    touches(change.promptSections, evidence.contextSections) ||
    touches(change.routeBranches, evidence.routeBranches)
  );
}

export function pairedZ(diffs: number[]): PairedZ {
  const n = diffs.length;
  const meanDiff = n === 0 ? 0 : diffs.reduce((a, b) => a + b, 0) / n;
  const meanSign = meanDiff === 0 ? 0 : (Math.sign(meanDiff) as -1 | 1);
  if (n < MIN_PAIRS) return { n, meanDiff, sdDiff: 0, z: 0, meanSign, degenerate: 'too_few_pairs' };
  const sdDiff = Math.sqrt(diffs.reduce((acc, d) => acc + (d - meanDiff) ** 2, 0) / (n - 1));
  if (sdDiff === 0) return { n, meanDiff, sdDiff, z: 0, meanSign, degenerate: 'zero_variance' };
  return { n, meanDiff, sdDiff, z: meanDiff / (sdDiff / Math.sqrt(n)), meanSign, degenerate: null };
}

export function judgeAdoption(pairs: CasePair[]): AdoptionVerdict {
  const excludedCaseIds: string[] = [];
  const triggeredDiffs: number[] = [];
  let validPairs = 0;
  let untriggeredPairs = 0;
  let retriedTrials = 0;

  for (const pair of pairs) {
    const before = resolveSide(pair.before, pair.caseId);
    const after = resolveSide(pair.after, pair.caseId);
    retriedTrials += before.reruns + after.reruns;
    if (before.scored === null || after.scored === null) {
      excludedCaseIds.push(pair.caseId);
      continue;
    }
    validPairs++;
    if (after.scored.triggered) triggeredDiffs.push(after.scored.score - before.scored.score);
    else untriggeredPairs++;
  }

  const triggeredPairs = triggeredDiffs.length;
  const significance = { ...pairedZ(triggeredDiffs), threshold: Z_THRESHOLD };
  const decide = (): AdoptionDecision => {
    if (validPairs === 0) return 'not_significant';
    if (triggeredPairs === 0) return 'rejected_inert';
    const significantInDirection = (direction: 1 | -1): boolean =>
      significance.degenerate === 'zero_variance'
        ? significance.meanSign === direction
        : direction * significance.z >= Z_THRESHOLD;
    if (significantInDirection(1)) return 'accepted';
    if (significantInDirection(-1)) return 'rejected_regression';
    return 'not_significant';
  };

  return {
    decision: decide(),
    validity: {
      totalCases: pairs.length,
      validPairs,
      excludedInfra: excludedCaseIds.length,
      excludedCaseIds,
      retriedTrials,
    },
    effect: {
      triggeredPairs,
      untriggeredPairs,
      triggerRate: validPairs === 0 ? 0 : triggeredPairs / validPairs,
    },
    significance,
  };
}

export function generalizationReport(results: { caseId: string; score: number }[]): {
  n: number;
  meanScore: number;
} {
  const n = results.length;
  return { n, meanScore: n === 0 ? 0 : results.reduce((acc, r) => acc + r.score, 0) / n };
}
