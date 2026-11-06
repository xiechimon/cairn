import type { MergeReadiness } from '@cairn/shared';

export type PrCardState =
  | 'open'
  | 'conflicts'
  | 'checks-running'
  | 'checks-failed'
  | 'review-pending'
  | 'review-block'
  | 'review-pass'
  | 'queued'
  | 'merged'
  | 'closed'
  | 'draft'
  | 'behind'
  | 'merge-blocked'
  | 'owner-route';

export type PrCardResult = 'pass' | 'block' | 'pending';

export interface PrCardLens {
  name: string;
  result: PrCardResult;
}

export interface PrCardVerdict {
  result: 'pass' | 'block';
  judgedHead: string;
  lenses?: PrCardLens[];
}

export interface PrCardChecks {
  passed: number;
  failed: number;
  running: number;
  total: number;
  failedNames?: string[];
}

export interface PrCardModel {
  number: number;
  title: string;
  branch?: string;
  base?: string;
  repo?: string;
  additions?: number;
  deletions?: number;
  readAgoMinutes?: number;
  state: PrCardState;
  checks: PrCardChecks;
  verdict: PrCardVerdict | null;
  currentHead: string;
  blockers?: string[];
  queuePosition?: number;
  ownerRoute?: string;
}

export interface PrCardFacts {
  number: number;
  title: string;
  branch: string;
  currentHead: string;
  merged: boolean;
  conflicts: boolean;
  checks: PrCardChecks;
  queuePosition?: number | null;
  lenses?: PrCardLens[];
}

const SHORT_HEAD_LENGTH = 7;

const REVIEW_BLOCK_CODES: ReadonlySet<string> = new Set([
  'review-blocking',
  'decision-no-go',
  'verify-failed',
]);

const REVIEW_PENDING_CODES: ReadonlySet<string> = new Set([
  'review-missing',
  'independent-review-missing',
  'decision-missing',
  'verify-missing',
]);

export function shortHead(sha: string): string {
  return sha.slice(0, SHORT_HEAD_LENGTH);
}

export function isVerdictStale(
  pr: Pick<PrCardModel, 'verdict' | 'currentHead' | 'state'>,
): boolean {
  if (pr.state === 'merged' || pr.state === 'closed') return false;
  return pr.verdict != null && pr.verdict.judgedHead !== pr.currentHead;
}

function verdictOf(facts: PrCardFacts, readiness: MergeReadiness | null): PrCardVerdict | null {
  if (readiness?.headSha == null) return null;
  const codes = readiness.blockers.map((blocker) => blocker.code as string);
  const base = { judgedHead: shortHead(readiness.headSha), lenses: facts.lenses };
  if (codes.some((code) => REVIEW_BLOCK_CODES.has(code))) return { ...base, result: 'block' };
  if (readiness.ready) return { ...base, result: 'pass' };
  if (codes.some((code) => REVIEW_PENDING_CODES.has(code))) return null;
  return { ...base, result: 'pass' };
}

function stateOf(
  facts: PrCardFacts,
  verdict: PrCardVerdict | null,
  hasHumanBlocker: boolean,
): PrCardState {
  if (facts.merged) return 'merged';
  if (facts.queuePosition != null) return 'queued';
  if (facts.conflicts) return 'conflicts';
  if (facts.checks.failed > 0) return 'checks-failed';
  if (facts.checks.running > 0) return 'checks-running';
  if (hasHumanBlocker) return 'owner-route';
  if (verdict?.result === 'block') return 'review-block';
  if (verdict?.result === 'pass') return 'review-pass';
  return 'open';
}

export function prCardModel(facts: PrCardFacts, readiness: MergeReadiness | null): PrCardModel {
  const verdict = verdictOf(facts, readiness);
  const blockers = readiness?.blockers ?? [];
  const humanBlockers = blockers.filter((blocker) => blocker.class === 'human');
  const state = stateOf(facts, verdict, humanBlockers.length > 0);
  const showBlockers = blockers.length > 0 && state !== 'merged' && state !== 'queued';
  return {
    number: facts.number,
    title: facts.title,
    branch: facts.branch,
    state,
    checks: facts.checks,
    verdict,
    currentHead: shortHead(facts.currentHead),
    blockers: showBlockers ? blockers.map((blocker) => blocker.label) : undefined,
    queuePosition: state === 'queued' ? (facts.queuePosition ?? undefined) : undefined,
    ownerRoute:
      state === 'owner-route'
        ? humanBlockers.map((blocker) => blocker.label).join('；')
        : undefined,
  };
}
