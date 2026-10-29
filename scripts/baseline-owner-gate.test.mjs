import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  baselineOwnerFailures,
  closingIssues,
  isCuratedMainRed,
  isProtectedPath,
} from './baseline-owner-gate.mjs';

const curated = {
  labels: ['main-red', 'batch:now', 'by:pi'],
  title: 'ci: restore lint warning baseline after main red',
};
const curatedCairn = {
  labels: ['main-red', 'batch:now', 'by:cairn'],
  title: 'ci: lower ui-debt baseline after main red',
};
const mainWatch = {
  labels: ['main-red', 'batch:now', 'by:pi'],
  title: 'main red: commit-author on abcdef12',
};
const mainRedOnly = { labels: ['main-red'], title: 'ci: restore lint warning baseline' };
const plain = { labels: ['ready-for-agent'], title: 'ci: tighten a gate' };

for (const file of [
  'scripts/prepush-known-red.json',
  'scripts/lint-warning-baseline.json',
  'scripts/comment-discipline-allowlist.json',
  'scripts/single-use-helper-allowlist.json',
  'scripts/ui-debt-baseline.json',
  'scripts/feature-map-staleness-baseline.json',
]) {
  test(`rejects unowned changes to ${file}`, () => {
    assert.deepEqual(baselineOwnerFailures([file], [2005], { 2005: plain }), [file]);
  });
  test(`accepts curated gardener main-red ownership of ${file}`, () => {
    assert.deepEqual(baselineOwnerFailures([file], [2005], { 2005: curated }), []);
  });
}

test('ordinary files need no issue ownership', () => {
  assert.deepEqual(
    baselineOwnerFailures(
      [
        'apps/server/src/index.ts',
        'scripts/nested/x-baseline.json',
        'scripts/baseline-owner-gate.mjs',
        'scripts/baseline-ratchet-gate.mjs',
      ],
      [],
      {},
    ),
    [],
  );
});

test('filename patterns match new baseline and allowlist files without a ledger entry', () => {
  assert.equal(isProtectedPath('scripts/new-metric-baseline.json'), true);
  assert.equal(isProtectedPath('scripts/new-helper-allowlist.json'), true);
  assert.deepEqual(baselineOwnerFailures(['scripts/new-metric-baseline.json'], [1], { 1: plain }), [
    'scripts/new-metric-baseline.json',
  ]);
});

test('the CI job structure pin is not a debt baseline', () => {
  assert.equal(isProtectedPath('scripts/ci-job-structure-baseline.json'), false);
  assert.deepEqual(
    baselineOwnerFailures(['scripts/ci-job-structure-baseline.json'], [2005], {
      2005: plain,
    }),
    [],
  );
  assert.deepEqual(baselineOwnerFailures(['scripts/ci-job-structure-baseline.json'], [], {}), []);
});

test('registering a CI structure pin change needs no main-red ownership', () => {
  assert.deepEqual(
    baselineOwnerFailures(
      ['.github/workflows/ci.yml', 'scripts/ci-job-structure-baseline.json'],
      [2005],
      { 2005: plain },
    ),
    [],
  );
});

test('protected changes require at least one closing issue', () => {
  assert.deepEqual(baselineOwnerFailures(['scripts/prepush-known-red.json'], [], {}), [
    'scripts/prepush-known-red.json',
  ]);
});

test('every closing issue must carry curated gardener main-red ownership', () => {
  const files = ['scripts/lint-warning-baseline.json'];
  assert.deepEqual(baselineOwnerFailures(files, [1, 2], { 1: curated, 2: curatedCairn }), []);
  assert.deepEqual(
    baselineOwnerFailures(files, [1, 2], {
      1: curated,
      2: { labels: ['main-red-extra', 'batch:now', 'by:pi'], title: curated.title },
    }),
    files,
  );
  assert.deepEqual(baselineOwnerFailures(files, [1, 2], { 1: curated }), files);
});

test('raw main-watch alerts do not authorize baseline edits', () => {
  const files = ['scripts/lint-warning-baseline.json'];
  assert.equal(isCuratedMainRed(mainWatch), false);
  assert.deepEqual(baselineOwnerFailures(files, [2136], { 2136: mainWatch }), files);
  assert.deepEqual(
    baselineOwnerFailures(files, [2136, 2005], { 2136: mainWatch, 2005: curated }),
    files,
  );
  assert.deepEqual(
    baselineOwnerFailures(files, [2005], {
      2005: {
        labels: ['main-red', 'batch:now', 'by:cairn'],
        title: 'Main red: release on deadbeef',
      },
    }),
    files,
  );
});

test('main-red alone is not curated ownership', () => {
  assert.equal(isCuratedMainRed(mainRedOnly), false);
  assert.deepEqual(
    baselineOwnerFailures(['scripts/lint-warning-baseline.json'], [99], { 99: mainRedOnly }),
    ['scripts/lint-warning-baseline.json'],
  );
});

test('curated ownership needs gardener batch and by labels plus a non-alert title', () => {
  assert.equal(isCuratedMainRed(curated), true);
  assert.equal(isCuratedMainRed(curatedCairn), true);
  assert.equal(
    isCuratedMainRed({
      labels: ['main-red', 'ready-for-agent'],
      title: 'ci: restore lint warning baseline',
    }),
    false,
  );
  assert.equal(
    isCuratedMainRed({
      labels: ['main-red', 'batch:now'],
      title: 'ci: restore lint warning baseline',
    }),
    false,
  );
});

test('collects distinct closing issue lines including comma-separated declarations', () => {
  assert.deepEqual(
    closingIssues('Closes #1\ncloses #2, closes #3\nCloses #1\nUnrelated #4\nNo Closes #5'),
    [1, 2, 3],
  );
  assert.deepEqual(closingIssues(null), []);
});
