import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  loadEvalCoverage,
  loadRepoEvalCoverage,
  renderEvalCoverage,
  staleScoredFlows,
} from './eval-coverage.mjs';

const repo = 'xiechimon/cairn';

function addDays(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function writeFlow(root, name, { cases, state, variants }) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'cases.json'), JSON.stringify({ cases: cases.map((id) => ({ id })) }));
  if (state) writeFileSync(join(dir, '_state.json'), JSON.stringify(state));
  for (const variant of variants ?? []) {
    const variantDir = join(dir, variant.name);
    mkdirSync(variantDir, { recursive: true });
    writeFileSync(
      join(variantDir, 'results.jsonl'),
      variant.rows.map((row) => JSON.stringify(row)).join('\n'),
    );
  }
}

function coverage(root, capabilities, dates) {
  return loadEvalCoverage({
    capabilities,
    hillclimbDir: root,
    dateOf: (file) => dates[file] ?? '',
  });
}

test('a hillclimb flow with no capability row fails the coverage check', () => {
  const root = mkdtempSync(join(tmpdir(), 'eval-coverage-'));
  try {
    writeFlow(root, 'chief-dispatch', {
      cases: ['d01'],
      variants: [{ name: 'baseline', rows: [{ model: 'glm-5.3', grade: { decision_ok: 1 } }] }],
    });
    writeFlow(root, 'orphan-flow', { cases: ['o01'], variants: [] });
    const result = coverage(root, [{ capability: 'dispatch', flow: 'chief-dispatch' }], {});
    assert.deepEqual(result.unlisted, ['orphan-flow']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('coverage rows report scored, built-not-run, none, and tests only', () => {
  const root = mkdtempSync(join(tmpdir(), 'eval-coverage-'));
  try {
    writeFlow(root, 'chief-dispatch', {
      cases: ['d01', 'd02', 'd03'],
      state: { metrics: [{ id: 'decision_ok' }] },
      variants: [
        {
          name: 'baseline',
          rows: [
            { model: 'glm-5.3', grade: { decision_ok: 0, receipt_ok: 1 } },
            { model: 'glm-5.3', grade: { decision_ok: 1, receipt_ok: 1 } },
          ],
        },
        {
          name: 'v1',
          rows: [{ model: 'kimi-k3', grade: { decision_ok: 1 } }],
        },
      ],
    });
    writeFlow(root, 'memory-regression', { cases: ['c01', 'c02'], variants: [] });
    const dates = {
      [join(root, 'chief-dispatch', 'baseline', 'results.jsonl')]: '2026-09-01',
      [join(root, 'chief-dispatch', 'v1', 'results.jsonl')]: '2026-10-01',
    };
    const capabilities = [
      { capability: 'dispatch', flow: 'chief-dispatch' },
      { capability: 'memory use', flow: 'memory-regression' },
      { capability: 'learn from correction', ticket: 1778 },
      { capability: 'coding' },
      { capability: 'machine claim', testsOnly: true },
    ];
    const { rows, unlisted } = coverage(root, capabilities, dates);
    assert.deepEqual(unlisted, []);
    assert.deepEqual(
      rows.map((row) => ({
        capability: row.capability,
        flow: row.flow,
        cases: row.cases,
        score: row.score,
        date: row.date,
        model: row.model,
        status: row.status,
        ticket: row.ticket,
      })),
      [
        {
          capability: 'dispatch',
          flow: 'chief-dispatch',
          cases: '3',
          score: '1/1 (100.0%)',
          date: '2026-10-01',
          model: 'kimi-k3',
          status: 'scored',
          ticket: null,
        },
        {
          capability: 'memory use',
          flow: 'memory-regression',
          cases: '2',
          score: '',
          date: '',
          model: '',
          status: 'built-not-run',
          ticket: null,
        },
        {
          capability: 'learn from correction',
          flow: '',
          cases: '',
          score: '',
          date: '',
          model: '',
          status: 'none',
          ticket: 1778,
        },
        {
          capability: 'coding',
          flow: '',
          cases: '',
          score: '',
          date: '',
          model: '',
          status: 'none',
          ticket: null,
        },
        {
          capability: 'machine claim',
          flow: '',
          cases: '',
          score: '',
          date: '',
          model: '',
          status: 'tests only, no eval needed',
          ticket: null,
        },
      ],
    );
    const markdown = renderEvalCoverage(rows, repo);
    assert.match(markdown, /^## Eval coverage\n/);
    assert.match(
      markdown,
      /\| learn from correction \| {2}\| {2}\| {2}\| {2}\| {2}\| none \(\[#1778\]\(https:\/\/github\.com\/xiechimon\/cairn\/issues\/1778\)\) \|/,
    );
    assert.match(
      markdown,
      /\| machine claim \| {2}\| {2}\| {2}\| {2}\| {2}\| tests only, no eval needed \|/,
    );
    assert.deepEqual(staleScoredFlows(rows, '2026-10-31'), []);
    assert.deepEqual(
      staleScoredFlows(rows, '2026-11-01').map((row) => row.flow),
      ['chief-dispatch'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('every flow committed under .claude/hillclimb has a capability row', () => {
  const { unlisted } = loadRepoEvalCoverage(resolve(import.meta.dirname, '..'));
  assert.deepEqual(unlisted, []);
});

test('the staleness gate flags a scored flow older than 30 days', () => {
  const date = execFileSync(
    'git',
    ['log', '-1', '--format=%cs', '--', '.claude/hillclimb/chief-dispatch/baseline/results.jsonl'],
    { encoding: 'utf8' },
  ).trim();
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  const run = (today) =>
    spawnSync(process.execPath, ['scripts/feature-map-staleness-gate.mjs', '--today', today], {
      encoding: 'utf8',
    });
  const fresh = run(addDays(date, 30));
  assert.equal(fresh.status, 0, fresh.stdout + fresh.stderr);
  const stale = run(addDays(date, 31));
  assert.notEqual(stale.status, 0);
  assert.match(
    stale.stdout,
    new RegExp(`eval score for chief-dispatch is 31 days old \\(${date}\\)`),
  );
});
