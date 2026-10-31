import type { CompareFile } from '@cairn/shared';
import { expect, test } from 'vitest';
import { computePatchDigest } from '../src/services/merge-gate/digest.js';
import { type GateInputs, mergeReadiness } from '../src/services/merge-gate/readiness.js';

function input(path: string, additions = 1): GateInputs {
  const headSha = 'a'.repeat(40);
  const files: CompareFile[] = [
    {
      filename: path,
      status: additions === 0 ? 'removed' : 'added',
      previousFilename: null,
      additions,
      deletions: 0,
      sha: headSha,
      patchSha: 'b'.repeat(64),
    },
  ];
  const patchDigest = computePatchDigest(files).patchDigest;
  return {
    correction: true,
    policy: { mergePolicy: 'autonomous', autonomyPaused: false, dailyCapReached: false },
    build: {
      isGithubPr: false,
      repoKind: 'local',
      isCurrent: true,
      phase: 'review',
      stepsInFlight: 0,
    },
    repo: { owner: 'octo', name: 'demo', defaultBranch: 'main' },
    ticketRef: '7',
    issueNumber: 7,
    pr: null,
    checks: {
      headSha,
      statusSha: headSha,
      required: ['check'],
      runs: ['check', 'pr-evidence'].map((name) => ({
        name,
        headSha,
        status: 'completed',
        conclusion: 'success',
      })),
      statuses: [],
      complete: true,
    },
    compare: {
      headSha,
      files,
      commits: [{ sha: headSha, parents: ['c'.repeat(40)] }],
      totalCommits: 1,
    },
    evidence: [],
    verdicts: [
      { kind: 'verify', outcome: 'pass', perspective: null, patchDigest },
      { kind: 'review', outcome: 'pass', perspective: 'review', patchDigest },
      { kind: 'decision', outcome: 'pass', perspective: null, patchDigest },
    ],
    round: null,
    availability: { reviewerPerspectives: ['review'], verifier: true, decider: true },
  };
}

test('a correction cannot merge even with passing verdicts until the merge diff contains an executable guard', () => {
  const missing = mergeReadiness(input('apps/server/src/fix.ts'));
  expect(missing.ready).toBe(false);
  expect(missing.blockers).toEqual([
    expect.objectContaining({
      code: 'verify-missing',
      class: 'human',
      detail: [expect.stringMatching(/Correction.*test or gate/)],
    }),
  ]);
  expect(mergeReadiness(input('apps/server/test/fix.test.ts')).ready).toBe(true);
  const removed = mergeReadiness(input('apps/server/test/fix.test.ts', 0));
  expect(
    removed.blockers.some((blocker) =>
      blocker.detail.some((detail) => detail.includes('Correction')),
    ),
  ).toBe(true);
  const normal = input('apps/server/src/fix.ts');
  normal.correction = false;
  expect(mergeReadiness(normal).ready).toBe(true);
});

test('an unreadable correction diff stays a transient read failure', () => {
  const i = input('apps/server/src/fix.ts');
  i.compare = 'unreadable';
  const result = mergeReadiness(i);
  expect(result.blockers).toEqual([
    expect.objectContaining({ code: 'patch-unavailable', class: 'transient' }),
  ]);
});

test.each(['modified', 'renamed', 'removed'] as const)(
  'a %s test or workflow is not a newly added correction guard',
  (status) => {
    for (const path of [
      'apps/server/test/fix.test.ts',
      '.github/workflows/guard.yml',
      'scripts/check-gate.mjs',
    ]) {
      const i = input(path);
      if (typeof i.compare !== 'object') throw new Error('Missing compare fixture');
      i.compare.files[0]!.status = status;
      expect(mergeReadiness(i).blockers).toContainEqual(
        expect.objectContaining({
          detail: expect.arrayContaining([expect.stringMatching(/Correction/)]),
        }),
      );
    }
  },
);
