import type { Phase } from '@cairn/shared';
import {
  CHIEF_DISPATCH_BASELINE_DECISION_OK_CI_LOWER,
  type CompareFile,
  EVIDENCE_PREFIX,
  GATE_LIMITS,
  type HarnessRegressionResult,
  harnessRegressionResultSchema,
  MERGE_BLOCKERS,
  MERGE_GATE_STATUS_CONTEXT,
  type MergeBlocker,
  type MergeBlockerCode,
  type MergePolicy,
  type MergeReadiness,
  RECORDING_EXTENSION,
} from '@cairn/shared/merge-gate';
import { computePatchDigest } from './digest.js';
import { parseRawEvidenceLinks, qualifyingEvidenceLinks } from './evidence-link.js';
import { isLiveHarnessAttempt } from './harness-eval-route.js';
import { independenceVendorDetail, modelsAreIndependent } from './model-identity.js';
import { classifyPaths, touchesHarness } from './paths.js';

export interface GateVerdictView {
  kind: 'review' | 'verify' | 'decision';
  headSha?: string | null;
  reviewerId?: string | null;
  reviewerModel?: string | null;
  gateLoosening?: boolean | null;
  evalRulerChange?: boolean | null;
  perspective: string | null;
  patchDigest: string | null;
  outcome:
    | 'pass'
    | 'block'
    | 'extraction_failed'
    | 'step_failed'
    | 'tampered'
    | 'unbound'
    | 'evidence_invalid';
}

export interface GateCheckRun {
  name: string;
  headSha: string;
  status: string;
  conclusion: string | null;
}

export interface GateCommitStatus {
  context: string;
  state: string;
}

export interface GateCompareCommit {
  sha: string;
  parents: string[];
}

export interface GateInputs {
  author?: { id: string; model: string } | null;
  policy: { mergePolicy: MergePolicy; autonomyPaused: boolean; dailyCapReached: boolean };
  build: {
    isGithubPr: boolean;
    repoKind?: 'github' | 'local';
    isCurrent: boolean;
    phase: Phase;
    stepsInFlight: number;
  };
  repo: { owner: string; name: string; defaultBranch: string | null };
  ticketRef: string;
  issueNumber: number | null;
  pr: {
    state: 'open' | 'closed';
    merged: boolean;
    draft: boolean;
    mergeableState: string | null;
    headSha: string;
    baseRef: string;
    baseRepoFullName: string;
    headRepoFullName: string | null;
    body: string;
    changedFiles: number;
    baseBehindBy: number | null;
  } | null;
  checks: {
    headSha: string;
    statusSha: string;
    required: string[] | null;
    runs: GateCheckRun[];
    statuses: GateCommitStatus[];
    complete: boolean;
  } | null;
  compare:
    | { headSha: string; files: CompareFile[]; commits: GateCompareCommit[]; totalCommits: number }
    | 'unreadable'
    | 'malformed';
  evidence: { sha: string; path: string; present: boolean | null }[];
  verdicts: GateVerdictView[];
  round: {
    perspectives: string[];
    timedOut: string[];
    fixRoundsExhausted: boolean;
    fixNoChange: boolean;
    gateRoundsExhausted: boolean;
  } | null;
  availability: { reviewerPerspectives: string[]; verifier: boolean; decider: boolean };
  harnessEvalText?: string | null;
  harnessEval?: {
    attempt: {
      state: string;
      deadlineAt?: number;
      patchDigest?: string;
      workerId?: string;
      id?: string;
    } | null;
    now: number;
  } | null;
}

const PASSING_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);
const FULL_SHA = /^[0-9a-f]{40}$/;
export const isFullSha = (s: string) => FULL_SHA.test(s);

function compareHead(commits: GateCompareCommit[]): string | null {
  const parents = new Set(commits.flatMap((c) => c.parents));
  const tips = commits.filter((c) => !parents.has(c.sha));
  return tips.length === 1 ? (tips[0]?.sha ?? null) : null;
}
const ORDER = new Map<string, number>(MERGE_BLOCKERS.map((b, i) => [b.code, i]));
const META = new Map<string, (typeof MERGE_BLOCKERS)[number]>(
  MERGE_BLOCKERS.map((b) => [b.code, b]),
);

const DETAIL_NAMES = 10;
const DETAIL_NAME_CHARS = 120;
const UNSAFE_CHAR = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

function escapeChar(ch: string): string {
  const json = JSON.stringify(ch).slice(1, -1);
  if (json !== ch || !UNSAFE_CHAR.test(ch)) return json;
  return Array.from(
    { length: ch.length },
    (_, k) => `\\u${ch.charCodeAt(k).toString(16).padStart(4, '0')}`,
  ).join('');
}

function quoted(name: string): string {
  let body = '';
  for (const ch of name) {
    const esc = escapeChar(ch);
    if (body.length + esc.length > DETAIL_NAME_CHARS) return `"${body}"…`;
    body += esc;
  }
  return `"${body}"`;
}

function names(list: readonly string[]): string[] {
  const shown = list.slice(0, DETAIL_NAMES).map(quoted);
  return list.length > DETAIL_NAMES ? [...shown, `+${list.length - DETAIL_NAMES} more`] : shown;
}

const runPasses = (r: GateCheckRun) =>
  r.status === 'completed' && r.conclusion !== null && PASSING_CONCLUSIONS.has(r.conclusion);
const isOwnStatus = (s: GateCommitStatus) => s.context.toLowerCase() === MERGE_GATE_STATUS_CONTEXT;
const checkName = (x: GateCheckRun | GateCommitStatus) => ('name' in x ? x.name : x.context);

export function mergeReadiness(i: GateInputs): MergeReadiness {
  const found = new Map<MergeBlockerCode, string[]>();
  const block = (code: MergeBlockerCode, ...detail: string[]) => {
    found.set(code, [...(found.get(code) ?? []), ...detail]);
  };

  const isLocal = i.build.repoKind === 'local';

  if (i.policy.mergePolicy === 'human') block('policy-human');
  if (i.policy.autonomyPaused) block('autonomy-paused');
  if (i.policy.dailyCapReached) block('daily-cap');
  if (!i.build.isGithubPr && !isLocal) block('not-applicable');
  if (!i.build.isCurrent) block('not-current-build');
  if (i.build.phase !== 'review') block('phase-not-review', i.build.phase);
  if (i.build.stepsInFlight > 0) block('work-in-flight', `${i.build.stepsInFlight} step(s)`);

  const pr = i.pr;
  const localCompare = typeof i.compare === 'object' ? i.compare : null;
  const head =
    pr !== null && isFullSha(pr.headSha)
      ? pr.headSha
      : isLocal && localCompare !== null && isFullSha(localCompare.headSha)
        ? localCompare.headSha
        : null;
  if (pr === null && !isLocal) {
    block('pr-unreadable');
  } else if (pr !== null) {
    if (head === null) block('pr-unreadable', 'head SHA not 40 lowercase hex');
    if (pr.state !== 'open' || pr.merged) block('pr-not-open', pr.merged ? 'merged' : pr.state);
    if (pr.draft) block('pr-draft');
    if (
      pr.headRepoFullName === null ||
      pr.headRepoFullName.toLowerCase() !== pr.baseRepoFullName.toLowerCase()
    ) {
      block(
        'pr-from-fork',
        pr.headRepoFullName === null ? 'head repository deleted' : quoted(pr.headRepoFullName),
      );
    }
    if (i.repo.defaultBranch === null) block('pr-unreadable', 'default branch unreadable');
    else if (pr.baseRef !== i.repo.defaultBranch)
      block('base-not-default', `${quoted(pr.baseRef)} → ${quoted(i.repo.defaultBranch)}`);
  }

  let checks = i.checks;
  const checkShas =
    checks === null ? [] : [checks.headSha, checks.statusSha, ...checks.runs.map((r) => r.headSha)];
  if (checks !== null && !checkShas.every(isFullSha)) {
    block('required-checks-unreadable', 'check SHA not 40 lowercase hex');
    checks = null;
  } else if (checks !== null && head !== null && checkShas.some((s) => s !== head)) {
    block('required-checks-unreadable', 'checks not read at the PR head');
    checks = null;
  } else if (checks !== null && !checks.complete) {
    block('required-checks-unreadable', 'check list incomplete');
    checks = null;
  }
  const judged = new Set<GateCheckRun | GateCommitStatus>();
  if (checks === null || checks.required === null) {
    block('required-checks-unreadable');
  } else {
    const required = checks.required;
    if (required.length === 0) block('required-checks-none');
    for (const name of required) {
      if (name.toLowerCase() === MERGE_GATE_STATUS_CONTEXT) {
        block('self-required');
        continue;
      }
      const run = checks.runs.find((r) => r.name === name);
      const status = checks.statuses.find((s) => s.context.toLowerCase() === name.toLowerCase());
      if (run !== undefined) {
        judged.add(run);
        if (run.status !== 'completed') block('required-check-pending', quoted(name));
        else if (!runPasses(run))
          block('required-check-failed', `${quoted(name)}: ${run.conclusion ?? 'none'}`);
      } else if (status !== undefined) {
        judged.add(status);
        if (status.state === 'pending') block('required-check-pending', quoted(name));
        else if (status.state !== 'success')
          block('required-check-failed', `${quoted(name)}: ${status.state}`);
      } else {
        block('required-check-missing', quoted(name));
      }
    }
  }
  if (checks !== null) {
    const evidence = checks.runs.find((r) => r.name === 'pr-evidence');
    if (evidence !== undefined) judged.add(evidence);
    if (
      evidence === undefined ||
      evidence.status !== 'completed' ||
      evidence.conclusion !== 'success'
    ) {
      block(
        'pr-evidence-not-green',
        evidence === undefined ? 'missing' : `${evidence.status}/${evidence.conclusion ?? 'none'}`,
      );
    }
  }

  const notPassing =
    checks === null
      ? null
      : [
          ...checks.runs.filter((r) => !runPasses(r)),
          ...checks.statuses.filter((s) => s.state !== 'success' && !isOwnStatus(s)),
        ];
  const ownNotPassing =
    checks?.statuses.some((s) => s.state !== 'success' && isOwnStatus(s)) ?? false;
  if (pr !== null && !isLocal) {
    const state = pr.mergeableState;
    if (state === null || state === 'unknown') {
      block('mergeable-state', 'GitHub still computing');
    } else if (state === 'unstable') {
      if (notPassing === null) block('mergeable-state', 'unstable, checks unreadable');
      else if (notPassing.length > 0)
        block('mergeable-state', `unstable: ${names(notPassing.map(checkName)).join(', ')}`);
      else if (!ownNotPassing) block('mergeable-state', 'unstable, no failing check visible');
    } else if (state === 'clean' || state === 'has_hooks') {
      const foreign = (notPassing ?? []).filter((x) => !judged.has(x));
      if (foreign.length > 0)
        block(
          'mergeable-state',
          `${state}, not passing: ${names(foreign.map(checkName)).join(', ')}`,
        );
    } else {
      block('mergeable-state', state);
    }
  }

  let compare = typeof i.compare === 'string' ? null : i.compare;
  if (i.compare === 'unreadable') block('patch-unavailable', 'compare unreadable');
  if (i.compare === 'malformed') block('compare-malformed');
  if (
    compare !== null &&
    ![compare.headSha, ...compare.commits.flatMap((c) => [c.sha, ...c.parents])].every(isFullSha)
  ) {
    block('compare-malformed', 'compare SHA not 40 lowercase hex');
    compare = null;
  } else if (
    compare !== null &&
    (compare.commits.length !== compare.totalCommits ||
      new Set(compare.commits.map((c) => c.sha)).size !== compare.commits.length)
  ) {
    block('patch-unavailable', 'compare commit list incomplete');
    compare = null;
  } else if (
    compare !== null &&
    head !== null &&
    (compare.headSha !== head || compareHead(compare.commits) !== head)
  ) {
    block('patch-unavailable', 'compare not read at the PR head');
    compare = null;
  }
  if (pr !== null && (pr.baseBehindBy === null ? compare !== null : pr.baseBehindBy !== 0)) {
    block('pr-behind-base');
  }
  let D: string | null = null;
  if (compare !== null) {
    const digest = computePatchDigest(compare.files, {
      expectedFileCount: pr !== null && head !== null ? pr.changedFiles : null,
    });
    D = digest.patchDigest;
    if (digest.unavailable === 'truncated' || digest.unavailable === 'count-mismatch') {
      block('compare-truncated', digest.unavailable);
    } else if (digest.unavailable !== null) {
      block('patch-unbindable', digest.unavailable);
    }
    if (digest.countedLines > GATE_LIMITS.maxLines || digest.countedFiles > GATE_LIMITS.maxFiles) {
      block('size-cap', `${digest.countedLines} lines, ${digest.countedFiles} files`);
    }
    const paths = classifyPaths(compare.files, i.ticketRef);
    const reviewRequired = [...paths.protected, ...paths.deletedTests];
    if (reviewRequired.length > 0) {
      const author = i.author;
      const bound = i.verdicts.filter(
        (v) =>
          v.kind === 'review' &&
          head !== null &&
          v.headSha === head &&
          D !== null &&
          v.patchDigest === D &&
          author?.id.trim() &&
          author.model.trim() &&
          v.reviewerId?.trim() &&
          v.reviewerId !== author.id &&
          v.reviewerModel?.trim() &&
          typeof v.gateLoosening === 'boolean' &&
          typeof v.evalRulerChange === 'boolean' &&
          (v.outcome === 'pass' || v.outcome === 'block'),
      );
      const independent = bound.filter(
        (v) =>
          v.reviewerModel != null && modelsAreIndependent(author?.model ?? '', v.reviewerModel),
      );
      if (!independent.some((v) => v.outcome === 'pass')) {
        const vendorDetail = [
          ...new Set(
            bound.flatMap((v) =>
              v.reviewerModel == null
                ? []
                : independenceVendorDetail(author?.model ?? '', v.reviewerModel),
            ),
          ),
        ];
        block('independent-review-missing', ...names(reviewRequired), ...vendorDetail);
      }
      if (independent.some((v) => v.gateLoosening || v.evalRulerChange)) {
        block('review-blocking', 'Independent review reports gate loosening or eval ruler change');
      }
    }
    if (paths.outsideAutoMerge.length > 0)
      block('outside-auto-merge', ...names(paths.outsideAutoMerge));
    if (paths.opaque.length > 0) block('opaque-file', ...names(paths.opaque));
    if (paths.otherTicketEvidence.length > 0)
      block('evidence-outside-ticket', ...names(paths.otherTicketEvidence));
    if (paths.executableEvidence.length > 0)
      block('evidence-executable', ...names(paths.executableEvidence));
    if (D !== null && touchesHarness(compare.files)) {
      let parsed: HarnessRegressionResult | null = null;
      if (i.harnessEvalText != null && i.harnessEvalText !== '') {
        try {
          const raw: unknown = JSON.parse(i.harnessEvalText);
          const r = harnessRegressionResultSchema.safeParse(raw);
          if (r.success) parsed = r.data;
        } catch {
          parsed = null;
        }
      }
      if (parsed !== null && parsed.patchDigest === D) {
        if (parsed.decision_ok < CHIEF_DISPATCH_BASELINE_DECISION_OK_CI_LOWER) {
          block('harness-regression-below-threshold', String(parsed.decision_ok));
        }
      } else if (
        i.harnessEval != null &&
        isLiveHarnessAttempt(i.harnessEval.attempt, {
          now: i.harnessEval.now,
          patchDigest: D,
        })
      ) {
        block('harness-regression-evaluating');
      } else if (parsed === null) {
        block('harness-regression-missing');
      } else {
        block('harness-regression-stale');
      }
    }
  }

  if (i.issueNumber === null) block('issue-ref-missing');
  if (!isLocal && pr !== null && head !== null && compare !== null) {
    const args = { owner: i.repo.owner, repo: i.repo.name, ticketRef: i.ticketRef };
    const qualifying = qualifyingEvidenceLinks(pr.body, args, compare);
    const presence = qualifying.map((l): boolean | null => {
      const e = i.evidence.find((x) => x.sha === l.sha && x.path === l.path);
      return e === undefined ? false : e.present;
    });
    if (
      compare.files.some((f) => f.recordingRequired) &&
      !qualifying.some((l, index) => RECORDING_EXTENSION.test(l.path) && presence[index] === true)
    ) {
      block(
        'recording-missing',
        'Link a present .gif, .webm or .mp4 of at most 5 MiB under this ticket evidence directory',
      );
    }
    if (qualifying.length === 0) {
      const { links } = parseRawEvidenceLinks(pr.body, args);
      block(
        'evidence-link-missing',
        `${links.length} link(s) to ${EVIDENCE_PREFIX}${i.ticketRef}/, none at a commit of this PR to a file it adds or changes`,
      );
    } else if (!presence.includes(true)) {
      block(
        'evidence-link-missing',
        `${qualifying.length} link(s) at a commit of this PR to a file it adds or changes, ${
          presence.includes(null) ? 'presence unreadable' : 'none present at its commit'
        }`,
      );
    }
  }

  if (i.verdicts.some((x) => x.kind === 'verify' && x.outcome === 'tampered'))
    block('verify-tampered');
  const perspectives = i.round?.perspectives ?? i.availability.reviewerPerspectives;
  if (D !== null) {
    const at = (kind: GateVerdictView['kind'], perspective?: string) =>
      i.verdicts.filter(
        (x) =>
          x.kind === kind &&
          x.patchDigest === D &&
          (perspective === undefined || x.perspective === perspective),
      );
    const has = (xs: GateVerdictView[], outcome: GateVerdictView['outcome']) =>
      xs.some((x) => x.outcome === outcome);

    const verify = at('verify');
    if (has(verify, 'block')) block('verify-failed');
    if (!has(verify, 'pass') && has(verify, 'evidence_invalid')) block('verify-evidence-invalid');
    if (!has(verify, 'pass') && has(verify, 'extraction_failed')) block('verify-extraction-failed');
    if (
      !verify.some((x) =>
        ['pass', 'block', 'evidence_invalid', 'extraction_failed'].includes(x.outcome),
      )
    ) {
      const elsewhere = i.verdicts.filter((x) => x.kind === 'verify' && x.patchDigest !== D);
      const stepFailed = verify.filter((x) => x.outcome === 'step_failed');
      block(
        'verify-missing',
        ...(elsewhere.length > 0
          ? [`${elsewhere.length} verdict(s) on another patch or unbound`]
          : []),
        ...(stepFailed.length > 0
          ? [`${stepFailed.length} verify step(s) failed on this patch`]
          : []),
      );
    }

    const blocking = at('review').filter((x) => x.outcome === 'block');
    if (blocking.length > 0)
      block('review-blocking', ...new Set(blocking.map((x) => x.perspective ?? 'review')));
    for (const p of perspectives) {
      const mine = at('review', p);
      if (has(mine, 'pass') || has(mine, 'block')) continue;
      if (has(mine, 'extraction_failed')) block('review-extraction-failed', p);
      else block('review-missing', p);
    }

    const decision = at('decision');
    if (has(decision, 'block')) block('decision-no-go');
    else if (!has(decision, 'pass')) {
      if (has(decision, 'extraction_failed')) block('decision-extraction-failed');
      else block('decision-missing');
    }
  }
  if (i.round !== null && i.round.timedOut.length > 0)
    block('perspective-timed-out', ...i.round.timedOut);

  if (i.round?.fixRoundsExhausted) block('fix-rounds-exhausted');
  if (i.round?.fixNoChange) block('fix-no-change');
  if (i.round?.gateRoundsExhausted) block('gate-rounds-exhausted');
  if (perspectives.length === 0) block('no-reviewers');
  if (!i.availability.verifier) block('no-verifier');
  if (!i.availability.decider) block('no-decider');

  const blockers: MergeBlocker[] = [...found.entries()]
    .sort(([a], [b]) => (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0))
    .map(([code, detail]) => {
      const meta = META.get(code);
      return { code, class: meta?.class ?? 'human', label: meta?.label ?? code, detail };
    });
  return {
    ready: blockers.length === 0,
    headSha: head,
    patchDigest: head === null ? null : D,
    policy: i.policy.mergePolicy,
    blockers,
  };
}
