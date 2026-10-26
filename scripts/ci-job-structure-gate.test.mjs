import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

import { join, resolve } from 'node:path';
import test from 'node:test';
import { makeTestTempDir } from './test-tmpdir.mjs';

const gate = resolve(import.meta.dirname, 'ci-job-structure-gate.mjs');
const workflow = readFileSync(resolve(import.meta.dirname, '../.github/workflows/ci.yml'), 'utf8');
const baseline = readFileSync(
  resolve(import.meta.dirname, 'ci-job-structure-baseline.json'),
  'utf8',
);

const runGate = (workflowText, baselineText = baseline) => {
  const directory = makeTestTempDir('ci-job-structure-');
  try {
    writeFileSync(join(directory, 'ci.yml'), workflowText);
    writeFileSync(join(directory, 'baseline.json'), baselineText);
    return spawnSync(
      process.execPath,
      [gate, join(directory, 'ci.yml'), join(directory, 'baseline.json')],
      { encoding: 'utf8' },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const mutateWorkflow = (jobName, transform, text = workflow) =>
  text
    .split(/\n(?= {2}[a-z][\w-]*:)/)
    .map((chunk) => (chunk.startsWith(`  ${jobName}:`) ? transform(chunk) : chunk))
    .join('\n');

const freshnessStep = [
  '',
  '      - name: Feature map doc freshness check (#1527)',
  `        if: \${{ !cancelled() }}`,
  '        env:',
  `          GH_TOKEN: \${{ github.token }}`,
  '        run: node scripts/generate-feature-map.mjs --check',
].join('\n');

const stalenessStep = [
  '',
  '',
  '      - name: Feature map staleness gate (#1160)',
  '        run: node scripts/feature-map-staleness-gate.mjs',
].join('\n');

const labelStep = [
  '',
  '',
  '      - name: Issue label gate',
  '        env:',
  `          GH_TOKEN: \${{ github.token }}`,
  '        run: node scripts/issue-label-gate.mjs',
].join('\n');

test('committed ci.yml matches the pinned job structure', () => {
  const result = runGate(workflow);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /ci-job-structure: GREEN/);
});

test('PR #1540 misplaced freshness step goes red', () => {
  const result = runGate(
    mutateWorkflow('comment-discipline-gate', (chunk) => chunk + freshnessStep),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /step "Feature map doc freshness check \(#1527\)" in job "comment-discipline-gate" is not in the baseline/,
  );
});

test('a pinned step relocated to another job names both jobs', () => {
  const result = runGate(
    mutateWorkflow(
      'issue-label-gate',
      (chunk) => chunk + stalenessStep,
      mutateWorkflow('feature-map-gate', (chunk) => chunk.slice(0, -stalenessStep.length)),
    ),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /step "Feature map staleness gate \(#1160\)" is in job "issue-label-gate" but the baseline pins it to job "feature-map-gate"/,
  );
});

test('a pinned step deleted from ci.yml goes red', () => {
  const result = runGate(
    mutateWorkflow('feature-map-gate', (chunk) => chunk.slice(0, -stalenessStep.length)),
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /baseline expects step "Feature map staleness gate \(#1160\)" in job "feature-map-gate" but the job has no such step/,
  );
});

test('a step copied into another job while its pinned job keeps it goes red', () => {
  const result = runGate(mutateWorkflow('issue-label-gate', (chunk) => chunk + stalenessStep));
  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /step "Feature map staleness gate \(#1160\)" in job "issue-label-gate" duplicates the step pinned to job "feature-map-gate"/,
  );
});

test('a step pasted twice into one job goes red', () => {
  const result = runGate(mutateWorkflow('issue-label-gate', (chunk) => chunk + labelStep));
  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /job "issue-label-gate" lists step "Issue label gate" more than once/,
  );
});

test('a job absent from the baseline goes red', () => {
  const strayJob = [
    '  stray-gate:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: Stray gate',
    '        run: echo stray',
    '',
  ].join('\n');
  const result = runGate(`${workflow}${strayJob}`);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /job "stray-gate" is not in the baseline/);
});

test('a baseline job gone from ci.yml goes red', () => {
  const result = runGate(mutateWorkflow('closing-keyword-gate', () => ''));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /baseline job "closing-keyword-gate" is gone from the workflow/);
});
