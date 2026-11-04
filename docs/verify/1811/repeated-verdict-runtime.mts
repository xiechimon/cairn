import assert from 'node:assert/strict';
import {
  mergeReadiness,
  type GateInputs,
} from '../../../apps/server/src/services/merge-gate/readiness.ts';
import { computePatchDigest } from '../../../apps/server/src/services/merge-gate/digest.ts';

const head = 'a'.repeat(40);
const files: Exclude<GateInputs['compare'], string>['files'] = [
  {
    filename: 'docs/probe.md',
    status: 'modified',
    previousFilename: null,
    sha: '1'.repeat(40),
    additions: 1,
    deletions: 1,
    patchSha: 'c'.repeat(64),
  },
];
const digest = computePatchDigest(files).patchDigest;
const events = [
  { kind: 'verify', outcome: 'block' },
  { kind: 'verify', outcome: 'pass' },
  { kind: 'review', outcome: 'pass' },
  { kind: 'decision', outcome: 'pass' },
] as const;
const input: GateInputs = {
  policy: { mergePolicy: 'autonomous', autonomyPaused: false, dailyCapReached: false },
  build: { isGithubPr: true, isCurrent: true, phase: 'review', stepsInFlight: 0 },
  repo: { owner: 'xiechimon', name: 'cairn', defaultBranch: 'main' },
  ticketRef: '1811',
  issueNumber: 1811,
  pr: {
    state: 'open',
    merged: false,
    draft: false,
    mergeableState: 'clean',
    headSha: head,
    baseRef: 'main',
    baseRepoFullName: 'xiechimon/cairn',
    headRepoFullName: 'xiechimon/cairn',
    body: '',
    changedFiles: 1,
    baseBehindBy: 0,
  },
  checks: null,
  compare: {
    headSha: head,
    files,
    commits: [{ sha: head, parents: ['f'.repeat(40)] }],
    totalCommits: 1,
  },
  evidence: [],
  verdicts: events.map((v) => ({ ...v, patchDigest: digest, perspective: 'correctness' })),
  round: null,
  availability: { reviewerPerspectives: ['correctness'], verifier: true, decider: true },
};
const real = mergeReadiness(input);
assert(real.blockers.some((b) => b.code === 'verify-failed'));
const slots: Partial<Record<GateInputs['verdicts'][number]['kind'], string>> = {};
for (const event of events) slots[event.kind] = event.outcome;
assert(Object.values(slots).every((outcome) => outcome === 'pass'));
console.log(
  JSON.stringify(
    {
      sequence: events,
      realVerifyBlockRetained: true,
      originalSingleSlotProjection: slots,
      originalProjectionAllowsReadiness: true,
    },
    null,
    2,
  ),
);
