import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  appendWeeklyRow,
  formatBaselineSection,
  harnessDigest,
  judgeBaselineHarness,
  recordWeekly,
  refuseBaselineRecord,
  summarizeBaseline,
  upsertResultsSection,
  wilsonInterval,
} from '../eval/chief-dispatch/baseline-record.mts';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

describe('wilsonInterval', () => {
  test('uses the Wilson score interval at z=1.96', () => {
    const interval = wilsonInterval(168, 176);
    expect(interval).toEqual({
      low: expect.closeTo(0.912881, 6),
      high: expect.closeTo(0.976791, 6),
    });
  });

  test('clamps a zero-success interval onto [0, 1]', () => {
    const interval = wilsonInterval(0, 5);
    expect(interval?.low).toBe(0);
    expect(interval?.high).toBeCloseTo(0.434491, 5);
  });

  test('returns null when nothing was scored', () => {
    expect(wilsonInterval(0, 0)).toBeNull();
  });
});

describe('summarizeBaseline', () => {
  test('keeps chain failures out of the score and reports them on their own', () => {
    const summary = summarizeBaseline({
      metricIds: ['decision_ok', 'receipt_ok'],
      rows: [
        { grade: { decision_ok: 1, receipt_ok: 1 }, cost_usd: 0.1, model: 'glm-5.3' },
        { grade: { decision_ok: 0, receipt_ok: 1 }, cost_usd: 0.2, model: 'glm-5.3' },
      ],
      chainFailures: 4,
      harnessSha: SHA_A,
      model: 'glm-5.3',
      recordedOn: '2026-10-26',
    });
    expect(summary.metrics.find((metric) => metric.id === 'decision_ok')).toMatchObject({
      successes: 1,
      total: 2,
    });
    expect(summary.chainFailures).toBe(4);
    expect(summary.costUsd).toBeCloseTo(0.3);
    expect(summary.ceiling).toBe(false);
    expect(summary.model).toBe('glm-5.3');
    expect(summary.recordedOn).toBe('2026-10-26');
    expect(summary.harnessSha).toBe(SHA_A);
  });

  test('counts a metric only on rows that carry it', () => {
    const summary = summarizeBaseline({
      metricIds: ['decision_ok', 'memory_write_ok'],
      rows: [
        { grade: { decision_ok: 1 }, cost_usd: 0.01 },
        { grade: { decision_ok: 1, memory_write_ok: 0 }, cost_usd: 0.02 },
      ],
      chainFailures: 0,
      harnessSha: SHA_A,
      model: 'glm-5.3',
      recordedOn: '2026-10-26',
    });
    expect(summary.metrics.find((metric) => metric.id === 'decision_ok')?.total).toBe(2);
    expect(summary.metrics.find((metric) => metric.id === 'memory_write_ok')).toMatchObject({
      successes: 0,
      total: 1,
    });
  });

  test('reports ceiling when every scored decision_ok passes', () => {
    const summary = summarizeBaseline({
      metricIds: ['decision_ok'],
      rows: [
        { grade: { decision_ok: 1 }, cost_usd: 0 },
        { grade: { decision_ok: 1 }, cost_usd: 0 },
      ],
      chainFailures: 2,
      harnessSha: SHA_A,
      model: 'glm-5.3',
      recordedOn: '2026-10-26',
    });
    expect(summary.ceiling).toBe(true);
    expect(summary.metrics[0]).toMatchObject({ successes: 2, total: 2 });
  });
});

describe('refuseBaselineRecord', () => {
  test('refuses a baseline whose harness sha is not main', () => {
    expect(
      refuseBaselineRecord({ variant: 'baseline', harnessSha: SHA_A, mainHarnessSha: SHA_B }),
    ).toEqual({ record: false, reason: 'harness_mismatch' });
  });

  test('refuses a baseline when main is unknown', () => {
    expect(
      refuseBaselineRecord({ variant: 'baseline', harnessSha: SHA_A, mainHarnessSha: null }),
    ).toEqual({ record: false, reason: 'unknown_harness' });
  });

  test('allows a baseline whose harness sha matches main', () => {
    expect(
      refuseBaselineRecord({ variant: 'baseline', harnessSha: SHA_A, mainHarnessSha: SHA_A }),
    ).toEqual({ record: true });
  });

  test('allows a non-baseline variant when the harness differs from main', () => {
    expect(
      refuseBaselineRecord({ variant: 'v1', harnessSha: SHA_A, mainHarnessSha: SHA_B }),
    ).toEqual({ record: true });
  });
});

describe('judgeBaselineHarness', () => {
  const file = (bytes: string, main: string | null) => ({
    path: 'apps/server/src/services/chief.ts',
    worktree: new TextEncoder().encode(bytes),
    main: main === null ? null : new TextEncoder().encode(main),
  });

  test('refuses a baseline when a harness file differs from main', () => {
    const verdict = judgeBaselineHarness({
      variant: 'baseline',
      files: [file('worktree', 'main')],
    });
    expect(verdict.record).toBe(false);
    if (!verdict.record) expect(verdict.reason).toBe('harness_mismatch');
  });

  test('refuses a baseline when main has no copy of a harness file', () => {
    const verdict = judgeBaselineHarness({ variant: 'baseline', files: [file('worktree', null)] });
    expect(verdict.record).toBe(false);
    if (!verdict.record) expect(verdict.reason).toBe('unknown_harness');
  });

  test('allows a baseline when every harness file matches main', () => {
    const verdict = judgeBaselineHarness({
      variant: 'baseline',
      files: [file('same', 'same')],
    });
    expect(verdict.record).toBe(true);
  });
});

describe('upsertResultsSection', () => {
  test('replaces an existing Results section and leaves the next section in place', () => {
    const next = upsertResultsSection(
      '# Rubric\n\n## Results\n\nold\n\n## How to run\n\nkeep\n',
      'new',
    );
    expect(next).toContain('## Results\n\nnew\n');
    expect(next).toContain('## How to run\n\nkeep\n');
    expect(next).not.toContain('old');
  });

  test('appends a Results section when the file has none', () => {
    const next = upsertResultsSection('# Rubric\n', 'new');
    expect(next).toContain('# Rubric\n');
    expect(next).toContain('## Results\n\nnew\n');
  });
});

describe('recordWeekly', () => {
  test('appends a table row and replaces the metrics Results section', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baseline-record-'));
    const resultsPath = join(dir, 'results.jsonl');
    const errorsPath = join(dir, 'errors.jsonl');
    const statePath = join(dir, '_state.json');
    const tablePath = join(dir, 'weekly.md');
    const metricsPath = join(dir, 'metrics.md');
    writeFileSync(
      resultsPath,
      `${JSON.stringify({ grade: { decision_ok: 1 }, cost_usd: 0.5, model: 'glm-5.3' })}\n`,
    );
    writeFileSync(errorsPath, `${JSON.stringify({ failure_class: 'harness_error' })}\n`);
    const runnerPath = 'integration/eval/chief-dispatch/run-eval.mts';
    mkdirSync(join(dir, 'integration/eval/chief-dispatch'), { recursive: true });
    writeFileSync(join(dir, runnerPath), 'fixture');
    execFileSync('git', ['init', '--quiet', dir]);
    execFileSync('git', ['add', runnerPath], { cwd: dir });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Eval Test',
        '-c',
        'user.email=eval@example.test',
        '-c',
        'core.hooksPath=/dev/null',
        'commit',
        '--quiet',
        '-m',
        'fixture',
      ],
      { cwd: dir },
    );
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: dir });
    writeFileSync(
      statePath,
      JSON.stringify({
        metrics: [{ id: 'decision_ok' }],
        harness_paths: [runnerPath],
        harness_sha: harnessDigest([
          { path: runnerPath, bytes: new TextEncoder().encode('fixture') },
        ]),
      }),
    );
    writeFileSync(metricsPath, '# Rubric\n\n## Results\n\nstale\n\n## How to run\n\nstay\n');
    recordWeekly({
      flow: 'memory-regression',
      resultsPath,
      errorsPath,
      statePath,
      tablePath,
      model: 'glm-5.3',
      recordedOn: '2026-10-26',
      metricsPath,
      repoRoot: dir,
    });
    const table = readFileSync(tablePath, 'utf8');
    const metrics = readFileSync(metricsPath, 'utf8');
    expect(table).toContain('memory-regression');
    expect(table).toContain('1/1');
    expect(table).toContain('1');
    expect(metrics).toContain('harness_sha');
    expect(metrics).toContain('## How to run');
    expect(metrics).not.toContain('stale');
    expect(metrics).toContain('at ceiling');
  });
});

describe('appendWeeklyRow', () => {
  test('writes the header once and then only the next row', () => {
    const row = {
      recordedOn: '2026-10-26',
      flow: 'chief-dispatch',
      model: 'glm-5.3',
      decisionOk: '1/2',
      wilson: '[9.5%, 90.5%]',
      costUsd: '1.75',
      chainFailures: '3',
      harnessSha: SHA_A,
      ceiling: '',
    };
    const once = appendWeeklyRow('', row);
    const twice = appendWeeklyRow(once, { ...row, recordedOn: '2026-11-02' });
    expect(once.match(/\| date \|/g)).toHaveLength(1);
    expect(twice.match(/\| date \|/g)).toHaveLength(1);
    expect(twice).toContain('2026-10-26');
    expect(twice).toContain('2026-11-02');
    expect(twice).toContain(SHA_A);
  });
});

describe('formatBaselineSection', () => {
  test('includes the Wilson interval, cost, chain failures, harness sha, model and date', () => {
    const summary = summarizeBaseline({
      metricIds: ['decision_ok'],
      rows: [
        { grade: { decision_ok: 1 }, cost_usd: 1.5, model: 'glm-5.3' },
        { grade: { decision_ok: 0 }, cost_usd: 0.25, model: 'glm-5.3' },
      ],
      chainFailures: 3,
      harnessSha: SHA_A,
      model: 'glm-5.3',
      recordedOn: '2026-10-26',
    });
    const text = formatBaselineSection(summary);
    expect(text).toContain('glm-5.3');
    expect(text).toContain('2026-10-26');
    expect(text).toContain(SHA_A);
    expect(text).toContain('1/2');
    expect(text).toContain('Wilson');
    expect(text).toContain('1.75');
    expect(text).toContain('3');
    expect(text).not.toContain('at ceiling');
  });

  test('says when decision_ok is at ceiling', () => {
    const summary = summarizeBaseline({
      metricIds: ['decision_ok'],
      rows: [{ grade: { decision_ok: 1 }, cost_usd: 0.5 }],
      chainFailures: 0,
      harnessSha: SHA_A,
      model: 'glm-5.3',
      recordedOn: '2026-10-26',
    });
    expect(formatBaselineSection(summary)).toContain('at ceiling');
  });
});

describe('record provenance', () => {
  test('refuses to publish a run without main harness provenance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baseline-provenance-'));
    const resultsPath = join(dir, 'results.jsonl');
    const errorsPath = join(dir, 'errors.jsonl');
    const statePath = join(dir, '_state.json');
    const tablePath = join(dir, 'weekly.md');
    writeFileSync(
      resultsPath,
      `${JSON.stringify({ model: 'glm-5.3', grade: { decision_ok: 1 } })}\n`,
    );
    writeFileSync(errorsPath, '');
    writeFileSync(
      statePath,
      JSON.stringify({ metrics: [{ id: 'decision_ok' }], harness_sha: SHA_A }),
    );
    expect(() =>
      recordWeekly({
        flow: 'memory-regression',
        resultsPath,
        errorsPath,
        statePath,
        tablePath,
        model: 'glm-5.3',
        recordedOn: '2026-10-26',
      }),
    ).toThrow(/provenance/);
  });
});

describe('baseline input validation', () => {
  test('refuses mixed-model scores instead of attributing them to the requested model', () => {
    expect(() =>
      summarizeBaseline({
        metricIds: ['decision_ok'],
        rows: [{ model: 'other', grade: { decision_ok: 1 } }],
        chainFailures: 0,
        harnessSha: SHA_A,
        model: 'glm-5.3',
        recordedOn: '2026-10-26',
      }),
    ).toThrow(/model/);
  });
});

describe('empty baseline rejection', () => {
  test('refuses an empty result set instead of publishing an unmeasured baseline', () => {
    expect(() =>
      summarizeBaseline({
        metricIds: ['decision_ok'],
        rows: [],
        chainFailures: 63,
        harnessSha: SHA_A,
        model: 'glm-5.3',
        recordedOn: '2026-10-26',
      }),
    ).toThrow(/empty/);
  });
});
