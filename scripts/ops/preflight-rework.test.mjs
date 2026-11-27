import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyExtraPreflightRound,
  extractPreflightReason,
  subjectsMatch,
  summarizeRework,
} from './preflight-rework.mjs';

test('classifyExtraPreflightRound distinguishes red, rebase-only, and review-fix reruns', () => {
  assert.equal(
    classifyExtraPreflightRound({
      prev: { conclusion: 'failure', patchKey: 'p1' },
      cur: { conclusion: 'success', patchKey: 'p1' },
    }),
    'red',
  );
  assert.equal(
    classifyExtraPreflightRound({
      prev: { conclusion: 'cancelled', patchKey: 'p1' },
      cur: { conclusion: 'success', patchKey: 'p2' },
    }),
    'red',
  );
  assert.equal(
    classifyExtraPreflightRound({
      prev: { conclusion: 'success', patchKey: 'same-hash' },
      cur: { conclusion: 'success', patchKey: 'same-hash' },
    }),
    'rebase-only',
  );
  assert.equal(
    classifyExtraPreflightRound({
      prev: { conclusion: 'success', patchKey: 'before-review' },
      cur: { conclusion: 'success', patchKey: 'after-review-fix' },
    }),
    'review-fix',
  );
});

test('summarizeRework aggregates per-landing round percentiles and extra-round breakdown', () => {
  const summary = summarizeRework([
    {
      sha: 'aaa111',
      lane: 'm-1/lane-a',
      subject: 'feat(a): one',
      runs: [
        { conclusion: 'failure', patchKey: 'p1', durationMinutes: 5 },
        { conclusion: 'success', patchKey: 'p1', durationMinutes: 6 },
        { conclusion: 'success', patchKey: 'p1', durationMinutes: 4 },
        { conclusion: 'success', patchKey: 'p2', durationMinutes: 5 },
      ],
    },
    {
      sha: 'bbb222',
      lane: 'm-1/lane-b',
      subject: 'feat(b): two',
      runs: [{ conclusion: 'success', patchKey: 'q1', durationMinutes: 5 }],
    },
    {
      sha: 'ccc333',
      lane: 'm-1/lane-b',
      subject: 'feat(c): three',
      runs: [
        { conclusion: 'success', patchKey: 'r1', durationMinutes: 7 },
        { conclusion: 'success', patchKey: 'r2', durationMinutes: 5 },
      ],
    },
  ]);

  assert.equal(summary.landingCount, 3);
  assert.equal(summary.matchedLandings, 3);
  assert.equal(summary.totalPreflightRuns, 7);
  assert.equal(summary.roundsP50, 2);
  assert.equal(summary.roundsP90, 4);
  assert.equal(summary.roundsMax, 4);
  assert.equal(summary.extraRounds, 4);
  assert.deepEqual(summary.causes, {
    red: { count: 1, pct: 25, wastedMinutes: 5 },
    'rebase-only': { count: 1, pct: 25, wastedMinutes: 4 },
    'review-fix': { count: 2, pct: 50, wastedMinutes: 10 },
  });
  assert.equal(summary.topLanes[0].lane, 'm-1/lane-a');
  assert.equal(summary.topLanes[0].totalRuns, 4);
});

test('subjectsMatch and extractPreflightReason handle flattened Preflight-Reason run titles', () => {
  const title = 'fix(a): one Lane: m-1/wt Preflight-Reason: batch review';
  assert.equal(subjectsMatch('fix(a): one', title), true);
  assert.equal(subjectsMatch('fix(b): two', title), false);
  assert.equal(extractPreflightReason(title), 'batch review');
  assert.equal(extractPreflightReason('fix(a): plain title'), null);
});
