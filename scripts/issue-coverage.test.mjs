import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { evaluateCoverage, manifestIssues } from './issue-coverage.mjs';

const TODAY = '2026-11-10';
const open = (...numbers) => numbers.map((number) => ({ number, title: `issue ${number}` }));
const manifests = { B2: [2278, 2279], C1: [1909] };

test('manifestIssues reads items and the v1 issues array', () => {
  const read = manifestIssues({
    'B2.json': JSON.stringify({ epic: 'B2', items: [{ id: 'a', issue: 2278 }] }),
    'C1.json': JSON.stringify({ epic: 'C1', issues: [1909, 2374] }),
  });
  assert.deepEqual(read, { B2: [2278], C1: [1909, 2374] });
});

test('an open issue in a manifest is covered', () => {
  const report = evaluateCoverage({
    open: open(2278),
    manifests,
    coverage: {},
    today: TODAY,
  });
  assert.deepEqual(report.uncovered, []);
});

test('an open issue with no manifest and no coverage entry is reported', () => {
  const report = evaluateCoverage({
    open: open(2278, 2317),
    manifests,
    coverage: {},
    today: TODAY,
  });
  assert.deepEqual(
    report.uncovered.map((issue) => issue.number),
    [2317],
  );
  assert.equal(report.ok, false);
});

test('a coverage entry with an allowed destination covers the issue', () => {
  const coverage = {
    2317: { destination: 'phase-2' },
    2318: { destination: 'hold', reason: 'waits on D69' },
    2319: { destination: 'existing-executors' },
  };
  const report = evaluateCoverage({
    open: open(2317, 2318, 2319),
    manifests,
    coverage,
    today: TODAY,
  });
  assert.deepEqual(report.uncovered, []);
  assert.deepEqual(report.badDestination, []);
  assert.equal(report.ok, true);
});

test('an unknown destination is reported and does not cover', () => {
  const report = evaluateCoverage({
    open: open(2317),
    manifests,
    coverage: { 2317: { destination: 'someday' } },
    today: TODAY,
  });
  assert.deepEqual(
    report.badDestination.map((issue) => issue.number),
    [2317],
  );
  assert.equal(report.ok, false);
});

test('a close entry still open after seven days is reported, earlier it is not', () => {
  const coverage = (since) => ({ 2317: { destination: 'close', since } });
  const fresh = evaluateCoverage({
    open: open(2317),
    manifests,
    coverage: coverage('2026-11-04'),
    today: TODAY,
  });
  assert.deepEqual(fresh.staleClose, []);
  assert.equal(fresh.ok, true);
  const stale = evaluateCoverage({
    open: open(2317),
    manifests,
    coverage: coverage('2026-11-03'),
    today: TODAY,
  });
  assert.deepEqual(
    stale.staleClose.map((issue) => issue.number),
    [2317],
  );
  assert.equal(stale.ok, false);
});

test('a close entry without a since date counts as stale', () => {
  const report = evaluateCoverage({
    open: open(2317),
    manifests,
    coverage: { 2317: { destination: 'close' } },
    today: TODAY,
  });
  assert.equal(report.staleClose.length, 1);
});

test('entries for issues that are no longer open are listed as prunable, not failures', () => {
  const report = evaluateCoverage({
    open: open(2278),
    manifests,
    coverage: { 2500: { destination: 'phase-2' } },
    today: TODAY,
  });
  assert.deepEqual(report.prunable, [2500]);
  assert.equal(report.ok, true);
});

test('a coverage entry that names a batch with no manifest is reported', () => {
  const report = evaluateCoverage({
    open: open(2317),
    manifests,
    coverage: { 2317: { destination: 'batch:ZZ' } },
    today: TODAY,
  });
  assert.deepEqual(
    report.badDestination.map((issue) => issue.number),
    [2317],
  );
  const ok = evaluateCoverage({
    open: open(2317),
    manifests,
    coverage: { 2317: { destination: 'batch:B2' } },
    today: TODAY,
  });
  assert.equal(ok.ok, true);
});

test('the checked-in coverage file only uses valid destinations', () => {
  const root = resolve(import.meta.dirname, '..');
  const coverage = JSON.parse(readFileSync(join(root, 'docs/ops/issue-coverage.json'), 'utf8'));
  const epics = join(root, '.claude/epics');
  const files = {};
  for (const name of readdirSync(epics).filter((file) => file.endsWith('.json')))
    files[name] = readFileSync(join(epics, name), 'utf8');
  const report = evaluateCoverage({
    open: Object.keys(coverage.issues).map((number) => ({ number: Number(number), title: '' })),
    manifests: manifestIssues(files),
    coverage: coverage.issues,
    today: '2026-11-04',
  });
  assert.deepEqual(report.badDestination, []);
  assert.deepEqual(report.staleClose, []);
});
