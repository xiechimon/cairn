import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baselineOwnerFailures, closingIssues } from './baseline-owner-gate.mjs';

for (const file of [
  'scripts/prepush-known-red.json',
  'scripts/lint-warning-baseline.json',
  'scripts/comment-discipline-allowlist.json',
]) {
  test(`rejects unowned changes to ${file}`, () => {
    assert.deepEqual(baselineOwnerFailures([file], [2005], { 2005: [] }), [file]);
  });
  test(`accepts main-red ownership of ${file}`, () => {
    assert.deepEqual(baselineOwnerFailures([file], [2005], { 2005: ['main-red'] }), []);
  });
}

test('ordinary files need no issue ownership', () => {
  assert.deepEqual(
    baselineOwnerFailures(
      [
        'apps/server/src/index.ts',
        'scripts/nested/x-baseline.json',
        'scripts/baseline-owner-gate.mjs',
      ],
      [],
      {},
    ),
    [],
  );
});

test('the CI job structure pin is not a tunable baseline', () => {
  assert.deepEqual(
    baselineOwnerFailures(['scripts/ci-job-structure-baseline.json'], [2005], {
      2005: ['ready-for-agent'],
    }),
    [],
  );
  assert.deepEqual(baselineOwnerFailures(['scripts/ci-job-structure-baseline.json'], [], {}), []);
});

test('registering a new CI job needs no main-red ownership', () => {
  assert.deepEqual(
    baselineOwnerFailures(
      ['.github/workflows/ci.yml', 'scripts/ci-job-structure-baseline.json'],
      [2005],
      { 2005: [] },
    ),
    [],
  );
});

test('tunable baselines listed in the ledger stay protected', () => {
  for (const file of [
    'scripts/lint-warning-baseline.json',
    'scripts/ui-debt-baseline.json',
    'scripts/feature-map-staleness-baseline.json',
  ])
    assert.deepEqual(baselineOwnerFailures([file], [], {}), [file]);
});

test('protected changes require at least one closing issue', () => {
  assert.deepEqual(baselineOwnerFailures(['scripts/prepush-known-red.json'], [], {}), [
    'scripts/prepush-known-red.json',
  ]);
});

test('every closing issue must have the exact main-red label', () => {
  const files = ['scripts/lint-warning-baseline.json'];
  assert.deepEqual(baselineOwnerFailures(files, [1, 2], { 1: ['main-red'], 2: ['main-red'] }), []);
  assert.deepEqual(
    baselineOwnerFailures(files, [1, 2], { 1: ['main-red'], 2: ['main-red-extra'] }),
    files,
  );
  assert.deepEqual(baselineOwnerFailures(files, [1, 2], { 1: ['main-red'] }), files);
});

test('collects distinct closing issue lines including comma-separated declarations', () => {
  assert.deepEqual(
    closingIssues('Closes #1\ncloses #2, closes #3\nCloses #1\nUnrelated #4\nNo Closes #5'),
    [1, 2, 3],
  );
  assert.deepEqual(closingIssues(null), []);
});
