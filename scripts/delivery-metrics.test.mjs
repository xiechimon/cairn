import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  computeMetrics,
  fetchMainRuns,
  fetchPrs,
  isBot,
  isoWeek,
  renderReport,
  stripAnsi,
} from './delivery-metrics.mjs';

const script = resolve(import.meta.dirname, 'delivery-metrics.mjs');
const NOW = new Date('2026-10-26T12:00:00Z');

const pr = (number, fields) => ({
  number,
  title: `change ${number}`,
  author: { login: 'cairnwright[bot]' },
  mergedBy: { login: 'cairnwright[bot]' },
  autoMerge: false,
  commitAuthors: [{ login: 'claude' }],
  reviews: [],
  ...fields,
});

const run = (startedAt, completedAt, conclusion) => ({ conclusion, startedAt, completedAt });

const FIXTURE = {
  prs: [
    pr(101, {
      createdAt: '2026-10-20T00:00:00Z',
      mergedAt: '2026-10-20T01:00:00Z',
      autoMerge: true,
    }),
    pr(102, {
      createdAt: '2026-10-21T00:00:00Z',
      mergedAt: '2026-10-21T03:00:00Z',
      mergedBy: { login: 'xiechimon' },
      autoMerge: true,
    }),
    pr(103, {
      createdAt: '2026-10-22T00:00:00Z',
      mergedAt: '2026-10-22T00:30:00Z',
      commitAuthors: [{ login: 'claude' }, { login: 'xiechimon' }],
    }),
    pr(104, {
      createdAt: '2026-10-23T00:00:00Z',
      mergedAt: '2026-10-23T10:00:00Z',
      author: { login: 'ian' },
      mergedBy: { login: 'ian' },
      commitAuthors: [{ login: 'ian' }],
      reviews: [
        { state: 'CHANGES_REQUESTED', author: { login: 'alice' } },
        { state: 'CHANGES_REQUESTED', author: { login: 'github-actions[bot]' } },
      ],
    }),
    pr(90, { createdAt: '2026-10-14T00:00:00Z', mergedAt: '2026-10-14T01:00:00Z' }),
    pr(91, { createdAt: '2026-10-15T00:00:00Z', mergedAt: '2026-10-15T01:00:00Z' }),
    pr(92, { createdAt: '2026-10-16T00:00:00Z', mergedAt: '2026-10-16T01:00:00Z' }),
    pr(80, { createdAt: '2026-10-01T00:00:00Z', mergedAt: '2026-10-01T01:00:00Z' }),
    pr(106, { createdAt: '2026-10-24T00:00:00Z', mergedAt: null }),
  ],
  runs: [
    run('2026-10-25T22:00:00Z', '2026-10-25T22:10:00Z', 'failure'),
    run('2026-10-18T00:00:00Z', '2026-10-18T00:10:00Z', 'success'),
    run('2026-10-19T10:00:00Z', '2026-10-19T10:10:00Z', 'failure'),
    run('2026-10-19T14:00:00Z', '2026-10-19T14:10:00Z', 'success'),
    run('2026-10-22T00:00:00Z', '2026-10-22T00:10:00Z', 'failure'),
    run('2026-10-22T00:20:00Z', '2026-10-22T00:30:00Z', 'failure'),
    run('2026-10-22T02:00:00Z', '2026-10-22T02:10:00Z', 'success'),
    run('2026-10-24T00:00:00Z', '2026-10-24T00:05:00Z', 'cancelled'),
  ],
  ledger: {
    101: { revertedWithin7d: false, fixedByLaterPr: false, tokens: 1000, costUsd: 0.5 },
    102: { revertedWithin7d: true, fixedByLaterPr: false, tokens: 3000, costUsd: 1.5 },
    90: { revertedWithin7d: false, fixedByLaterPr: false },
    91: { revertedWithin7d: true, fixedByLaterPr: false },
  },
};

test('colored gh JSON still parses', () => {
  const colored = '\u001b[1;37m{\u001b[m\u001b[1;34m"data"\u001b[m:1}';
  assert.deepEqual(JSON.parse(stripAnsi(colored)), { data: 1 });
});

test('isBot uses one allowlist for logins, app prefixes and bot suffixes', () => {
  assert.equal(isBot({ login: 'cairnwright[bot]' }), true);
  assert.equal(isBot({ login: 'app/cairnwright' }), true);
  assert.equal(isBot({ login: 'Claude' }), true);
  assert.equal(isBot({ login: null, name: 'Claude' }), true);
  assert.equal(isBot({ login: 'github-actions[bot]' }), true);
  assert.equal(isBot({ login: 'someone', type: 'Bot' }), true);
  assert.equal(isBot({ login: 'xiechimon' }), false);
  assert.equal(isBot(null), false);
});

test('isoWeek labels the week of a date', () => {
  assert.equal(isoWeek(NOW), '2026-W44');
  assert.equal(isoWeek(new Date('2027-01-03T00:00:00Z')), '2026-W53');
  assert.equal(isoWeek(new Date('2027-01-04T00:00:00Z')), '2027-W01');
});

test('fixture metrics match the hand-computed table', () => {
  const metrics = computeMetrics({ ...FIXTURE, now: NOW });
  assert.equal(metrics.week, '2026-W44');
  assert.deepEqual(metrics.throughput, { merged: 4, autonomous: 3, human: 1 });
  assert.deepEqual(metrics.leadTime, { sample: 4, medianMinutes: 120 });
  assert.deepEqual(metrics.changeFailure, {
    cohortStart: '2026-10-12T12:00:00.000Z',
    cohortEnd: '2026-10-19T12:00:00.000Z',
    cohort: 3,
    known: 2,
    missing: 1,
    failed: 1,
    rate: 0.5,
  });
  assert.deepEqual(metrics.mainRed, {
    minutes: 1100,
    intervals: 3,
    recovered: 2,
    medianRecoveryMinutes: 190,
    stillRed: true,
  });
  assert.deepEqual(metrics.humanIntervention, {
    prs: 4,
    intervened: 2,
    rate: 0.5,
    byHumanCommit: 2,
    byChangesRequested: 1,
    byHumanMerge: 1,
  });
  assert.deepEqual(metrics.tokens, { prs: 4, known: 2, missing: 2, total: 4000, mean: 2000 });
  assert.deepEqual(metrics.costUsd, { prs: 4, known: 2, missing: 2, total: 2, mean: 1 });
  assert.equal(metrics.complete, true);
  assert.deepEqual(metrics.incompleteReasons, []);
});

test('missing token data is counted separately instead of becoming zero', () => {
  const metrics = computeMetrics({ ...FIXTURE, ledger: {}, now: NOW });
  assert.deepEqual(metrics.tokens, { prs: 4, known: 0, missing: 4, total: 0, mean: null });
  assert.deepEqual(metrics.costUsd, { prs: 4, known: 0, missing: 4, total: 0, mean: null });
  assert.equal(metrics.changeFailure.rate, null);
  assert.equal(metrics.changeFailure.missing, 3);
  assert.match(renderReport(metrics), /missing data/);
});

test('an empty week yields an empty table without errors or division by zero', () => {
  const metrics = computeMetrics({ prs: [], runs: [], now: NOW });
  assert.deepEqual(metrics.throughput, { merged: 0, autonomous: 0, human: 0 });
  assert.deepEqual(metrics.leadTime, { sample: 0, medianMinutes: null });
  assert.equal(metrics.changeFailure.rate, null);
  assert.equal(metrics.humanIntervention.rate, null);
  assert.deepEqual(metrics.mainRed, {
    minutes: 0,
    intervals: 0,
    recovered: 0,
    medianRecoveryMinutes: null,
    stillRed: false,
  });
  assert.equal(metrics.tokens.mean, null);
  const report = renderReport(metrics);
  assert.doesNotMatch(report, /NaN|Infinity|undefined/);
});

test('duplicate pull requests from overlapping pages count once', () => {
  const metrics = computeMetrics({ prs: [FIXTURE.prs[0], FIXTURE.prs[0]], runs: [], now: NOW });
  assert.equal(metrics.throughput.merged, 1);
});

test('report states the week, the table and the incomplete reason', () => {
  const metrics = computeMetrics({
    ...FIXTURE,
    now: NOW,
    incompleteReasons: ['pull requests: API rate limit exceeded'],
  });
  assert.equal(metrics.complete, false);
  const report = renderReport(metrics);
  assert.match(report, /2026-W44/);
  assert.match(report, /Merged PRs \| 4 \(3 autonomous, 1 human\)/);
  assert.match(report, /Median PR open to merge \| 2\.0 h/);
  assert.match(report, /Change failure rate \| 50\.0% \(1 of 2 known, 1 missing\)/);
  assert.match(
    report,
    /Main red \| 18\.3 h over 3 intervals, median recovery 3\.2 h, still red at report time/,
  );
  assert.match(report, /Incomplete: pull requests: API rate limit exceeded/);
});

test('a bot-authored pull request merged by a person without auto-merge counts as human', () => {
  const metrics = computeMetrics({
    prs: [
      pr(110, {
        createdAt: '2026-10-20T00:00:00Z',
        mergedAt: '2026-10-20T04:00:00Z',
        author: { login: 'cairnwright[bot]' },
        mergedBy: { login: 'xiechimon' },
        autoMerge: false,
        commitAuthors: [{ login: 'cairnwright[bot]' }],
      }),
    ],
    runs: [],
    now: NOW,
  });
  assert.deepEqual(metrics.throughput, { merged: 1, autonomous: 0, human: 1 });
  assert.equal(metrics.humanIntervention.byHumanMerge, 1);
});

test('null backfill and null usage stay missing instead of counting as zero', () => {
  const metrics = computeMetrics({
    prs: [
      pr(101, { createdAt: '2026-10-20T00:00:00Z', mergedAt: '2026-10-20T02:00:00Z' }),
      pr(90, { createdAt: '2026-10-14T00:00:00Z', mergedAt: '2026-10-14T01:00:00Z' }),
    ],
    runs: [],
    ledger: {
      101: { tokens: null, costUsd: null },
      90: { revertedWithin7d: null, fixedByLaterPr: null },
    },
    now: NOW,
  });
  assert.deepEqual(metrics.tokens, { prs: 1, known: 0, missing: 1, total: 0, mean: null });
  assert.deepEqual(metrics.costUsd, { prs: 1, known: 0, missing: 1, total: 0, mean: null });
  assert.equal(metrics.changeFailure.known, 0);
  assert.equal(metrics.changeFailure.missing, 1);
  assert.equal(metrics.changeFailure.rate, null);
});

test('a recorded zero token count stays zero', () => {
  const metrics = computeMetrics({
    prs: [pr(101, { createdAt: '2026-10-20T00:00:00Z', mergedAt: '2026-10-20T02:00:00Z' })],
    runs: [],
    ledger: { 101: { tokens: 0, costUsd: 0 } },
    now: NOW,
  });
  assert.deepEqual(metrics.tokens, { prs: 1, known: 1, missing: 0, total: 0, mean: 0 });
  assert.deepEqual(metrics.costUsd, { prs: 1, known: 1, missing: 0, total: 0, mean: 0 });
});

const prNode = (number) => ({
  number,
  title: `change ${number}`,
  createdAt: '2026-10-20T00:00:00Z',
  mergedAt: '2026-10-20T01:00:00Z',
  author: { login: 'cairnwright', __typename: 'Bot' },
  mergedBy: { login: 'cairnwright', __typename: 'Bot' },
  autoMergeRequest: { enabledAt: '2026-10-20T00:30:00Z' },
  commits: { nodes: [{ commit: { authors: { nodes: [{ name: 'Claude', user: null }] } } }] },
  reviews: { nodes: [{ state: 'APPROVED', author: { login: 'alice', __typename: 'User' } }] },
});

const searchPage = (nodes, endCursor) => ({
  data: {
    search: {
      issueCount: nodes.length,
      pageInfo: { hasNextPage: endCursor !== null, endCursor },
      nodes,
    },
  },
});

test('fetchPrs pages through results and normalizes nodes', () => {
  const calls = [];
  const { prs, reasons } = fetchPrs({
    repo: 'o/r',
    now: NOW,
    gh(args) {
      calls.push(args);
      return JSON.stringify(
        args.some((a) => a === 'after=c1')
          ? searchPage([prNode(2)], null)
          : searchPage([prNode(1)], 'c1'),
      );
    },
  });
  assert.deepEqual(
    prs.map((p) => p.number),
    [1, 2],
  );
  assert.deepEqual(reasons, []);
  assert.equal(prs[0].autoMerge, true);
  assert.equal(prs[0].mergedBy.type, 'Bot');
  assert.deepEqual(prs[0].commitAuthors, [{ login: null, name: 'Claude' }]);
  assert.deepEqual(prs[0].reviews, [
    { state: 'APPROVED', author: { login: 'alice', type: 'User' } },
  ]);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].some((a) => a.includes('repo:o/r is:pr is:merged merged:>=2026-10-12')));
});

test('fetchPrs keeps earlier pages and reports a rate limit as incomplete', () => {
  let page = 0;
  const { prs, reasons } = fetchPrs({
    repo: 'o/r',
    now: NOW,
    gh() {
      page++;
      if (page === 2) throw new Error('gh: API rate limit exceeded for user (HTTP 403)');
      return JSON.stringify(searchPage([prNode(1)], 'c1'));
    },
  });
  assert.equal(prs.length, 1);
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /pull requests: .*rate limit/i);
});

test('fetchPrs rethrows errors that are not rate limits', () => {
  assert.throws(
    () =>
      fetchPrs({
        repo: 'o/r',
        now: NOW,
        gh() {
          throw new Error('gh: HTTP 500');
        },
      }),
    /HTTP 500/,
  );
});

test('fetchPrs marks the week incomplete when more pages remain after the cap', () => {
  let page = 0;
  const { prs, reasons } = fetchPrs({
    repo: 'o/r',
    now: NOW,
    gh() {
      page += 1;
      return JSON.stringify(searchPage([prNode(page)], `c${page}`));
    },
  });
  assert.equal(prs.length, 20);
  assert.match(reasons[0], /pull requests: stopped after 20 pages/);
});

const requiredGreen = (completedAt = '2026-10-20T00:10:00Z') => [
  {
    name: 'check',
    conclusion: 'success',
    started_at: '2026-10-20T00:00:00Z',
    completed_at: completedAt,
  },
  {
    name: 'pack-smoke',
    conclusion: 'success',
    started_at: '2026-10-20T00:00:00Z',
    completed_at: '2026-10-20T00:05:00Z',
  },
  {
    name: 'e2e-gate',
    conclusion: 'success',
    started_at: '2026-10-20T00:00:00Z',
    completed_at: '2026-10-20T00:08:00Z',
  },
];

test('fetchMainRuns pages until a short page and normalizes runs', () => {
  const full = Array.from({ length: 100 }, (_, i) => ({
    id: i + 1,
    conclusion: 'success',
    run_started_at: '2026-10-20T00:00:00Z',
    created_at: '2026-10-20T00:00:00Z',
    updated_at: `2026-10-20T00:${String(i % 60).padStart(2, '0')}:00Z`,
  }));
  const calls = [];
  const { runs, reasons } = fetchMainRuns({
    repo: 'o/r',
    now: NOW,
    gh(args) {
      const url = args[1];
      calls.push(url);
      if (url.includes('/jobs')) return JSON.stringify({ jobs: requiredGreen() });
      const page = calls.filter((item) => item.includes('/runs?')).length;
      const source = page === 1 ? full : full.slice(0, 3);
      return JSON.stringify({
        workflow_runs: source.map((run, index) => ({ ...run, id: page * 1000 + index })),
      });
    },
  });
  assert.equal(runs.length, 103);
  assert.deepEqual(reasons, []);
  assert.equal(calls.filter((url) => url.includes('/runs?')).length, 2);
  assert.match(calls[0], /workflows\/ci\.yml\/runs\?branch=main&event=push/);
  assert.deepEqual(Object.keys(runs[0]).sort(), ['completedAt', 'conclusion', 'startedAt']);
});

test('fetchMainRuns counts a main run as red only when a required check fails', () => {
  const { runs, reasons } = fetchMainRuns({
    repo: 'o/r',
    now: NOW,
    gh(args) {
      const url = args[1];
      if (url.includes('/runs/1/jobs')) {
        return JSON.stringify({
          jobs: [
            ...requiredGreen('2026-10-20T00:40:00Z'),
            {
              name: 'feature-map-gate',
              conclusion: 'failure',
              started_at: '2026-10-20T00:00:00Z',
              completed_at: '2026-10-20T00:02:00Z',
            },
          ],
        });
      }
      if (url.includes('/runs/2/jobs')) {
        return JSON.stringify({
          jobs: [
            {
              name: 'check',
              conclusion: 'failure',
              started_at: '2026-10-21T01:00:00Z',
              completed_at: '2026-10-21T01:10:00Z',
            },
            {
              name: 'pack-smoke',
              conclusion: 'success',
              started_at: '2026-10-21T01:00:00Z',
              completed_at: '2026-10-21T01:04:00Z',
            },
            {
              name: 'e2e-gate',
              conclusion: 'success',
              started_at: '2026-10-21T01:00:00Z',
              completed_at: '2026-10-21T01:20:00Z',
            },
          ],
        });
      }
      return JSON.stringify({
        workflow_runs: [
          {
            id: 1,
            conclusion: 'failure',
            run_started_at: '2026-10-20T00:00:00Z',
            updated_at: '2026-10-20T00:40:00Z',
          },
          {
            id: 2,
            conclusion: 'failure',
            run_started_at: '2026-10-21T01:00:00Z',
            updated_at: '2026-10-21T01:20:00Z',
          },
        ],
      });
    },
  });
  assert.deepEqual(reasons, []);
  assert.deepEqual(
    runs.map((run) => ({
      conclusion: run.conclusion,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt.toISOString(),
    })),
    [
      {
        conclusion: 'success',
        startedAt: '2026-10-20T00:00:00.000Z',
        completedAt: '2026-10-20T00:40:00.000Z',
      },
      {
        conclusion: 'failure',
        startedAt: '2026-10-21T01:00:00.000Z',
        completedAt: '2026-10-21T01:10:00.000Z',
      },
    ],
  );
});

test('fetchMainRuns keeps earlier runs and reports a rate limit while reading jobs', () => {
  let jobs = 0;
  const { runs, reasons } = fetchMainRuns({
    repo: 'o/r',
    now: NOW,
    gh(args) {
      const url = args[1];
      if (url.includes('/jobs')) {
        jobs += 1;
        if (jobs === 2) throw new Error('gh: API rate limit exceeded for user (HTTP 403)');
        return JSON.stringify({ jobs: requiredGreen() });
      }
      return JSON.stringify({
        workflow_runs: [
          {
            id: 1,
            conclusion: 'success',
            run_started_at: '2026-10-20T00:00:00Z',
            updated_at: '2026-10-20T00:10:00Z',
          },
          {
            id: 2,
            conclusion: 'success',
            run_started_at: '2026-10-20T02:00:00Z',
            updated_at: '2026-10-20T02:10:00Z',
          },
        ],
      });
    },
  });
  assert.equal(runs.length, 1);
  assert.match(reasons[0], /main runs: .*rate limit/i);
});

const cli = (...args) =>
  spawnSync(process.execPath, [script, '--now', NOW.toISOString(), ...args], {
    encoding: 'utf8',
  });

test('CLI writes the weekly JSON and the markdown report from a fixture', () => {
  const dir = mkdtempSync(join(tmpdir(), 'delivery-metrics-'));
  const input = join(dir, 'input.json');
  writeFileSync(input, JSON.stringify(FIXTURE));
  const result = cli('--fixture', input, '--out', join(dir, 'metrics'));
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(readFileSync(join(dir, 'metrics', '2026-W44.json'), 'utf8'));
  assert.deepEqual(json, JSON.parse(JSON.stringify(computeMetrics({ ...FIXTURE, now: NOW }))));
  const markdown = readFileSync(join(dir, 'metrics', '2026-W44.md'), 'utf8');
  assert.equal(markdown, `${renderReport(json)}`);
  assert.equal(result.stdout, markdown);
});

test('CLI runs on an empty fixture', () => {
  const dir = mkdtempSync(join(tmpdir(), 'delivery-metrics-'));
  const input = join(dir, 'empty.json');
  writeFileSync(input, JSON.stringify({ prs: [], runs: [] }));
  const result = cli('--fixture', input, '--out', join(dir, 'metrics'));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Merged PRs \| 0 \(0 autonomous, 0 human\)/);
});

test('the weekly workflow runs delivery metrics and posts the report', () => {
  const workflow = readFileSync(
    resolve(import.meta.dirname, '../.github/workflows/gardener-weekly.yml'),
    'utf8',
  );
  assert.match(workflow, /delivery-metrics\.mjs/);
  assert.match(workflow, /--out docs\/metrics/);
  assert.match(workflow, /--comment/);
  assert.match(workflow, /issues: write/);
});

test('ci runs the delivery metrics self-test beside the gardener sweep', () => {
  const ci = readFileSync(resolve(import.meta.dirname, '../.github/workflows/ci.yml'), 'utf8');
  assert.match(ci, /scripts\/delivery-metrics\.test\.mjs/);
});

test('CLI reads a ledger file for outcomes and usage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'delivery-metrics-'));
  const input = join(dir, 'input.json');
  const ledger = join(dir, 'ledger.json');
  writeFileSync(input, JSON.stringify({ ...FIXTURE, ledger: undefined }));
  writeFileSync(ledger, JSON.stringify(FIXTURE.ledger));
  const result = cli('--fixture', input, '--ledger', ledger, '--out', join(dir, 'metrics'));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Change failure rate \| 50\.0%/);
});

for (const [name, signals, expected] of [
  [
    'one negative signal with the other unknown',
    { revertedWithin7d: false, fixedByLaterPr: null },
    { known: 0, missing: 1, failed: 0, rate: null },
  ],
  [
    'one positive signal with the other unknown',
    { revertedWithin7d: true, fixedByLaterPr: null },
    { known: 1, missing: 0, failed: 1, rate: 1 },
  ],
  [
    'both signals explicitly negative',
    { revertedWithin7d: false, fixedByLaterPr: false },
    { known: 1, missing: 0, failed: 0, rate: 0 },
  ],
]) {
  test(`change-failure coverage preserves ${name}`, () => {
    const metrics = computeMetrics({
      prs: [pr(90, { createdAt: '2026-10-14T00:00:00Z', mergedAt: '2026-10-14T01:00:00Z' })],
      runs: [],
      ledger: { 90: signals },
      now: NOW,
    });
    for (const [key, value] of Object.entries(expected)) {
      assert.equal(metrics.changeFailure[key], value, key);
    }
  });
}
