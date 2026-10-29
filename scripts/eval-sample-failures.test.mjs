import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const cli = resolve('scripts/eval-sample-failures.mjs');

test('weekly CLI stratifies failures, blinds packs, preserves reviews and reports agreement', () => {
  const root = mkdtempSync(join(tmpdir(), 'eval-review-'));
  try {
    for (const flow of ['a', 'b']) {
      const dir = join(root, '.claude/hillclimb', flow, 'baseline');
      mkdirSync(join(dir, 'traces'), { recursive: true });
      writeFileSync(
        join(dir, 'results.jsonl'),
        `${JSON.stringify({ prompt_id: 'bad', rep: 0, grade: { ok: 0 } })}\n${JSON.stringify({ prompt_id: 'good', rep: 0, grade: { ok: 1 } })}\n`,
      );
      writeFileSync(join(dir, 'traces/bad_rep0.json'), '[{"content":"read me"}]');
      writeFileSync(
        join(dir, 'errors.jsonl'),
        `${JSON.stringify({ prompt_id: 'err', rep: 0, failure_class: 'timeout', error: 'timeout' })}\n`,
      );
    }
    const packs = Array.from({ length: 35 }, (_, i) => ({
      buildId: `build-${i}`,
      input: { spec: 'task' },
      outcome: { merged: false },
      process: { steps: [{ transcript: [{ content: 'trace' }] }] },
      attribution: {
        where: i % 2 ? 'runtime' : 'prompt',
        why: 'wrong_tool',
        labeler: 'secret-model',
      },
    }));
    writeFileSync(join(root, 'packs.jsonl'), packs.map((p) => JSON.stringify(p)).join('\n'));
    const flows = join(root, '.claude/hillclimb');
    const run = (...args) =>
      spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
    const sampled = run(
      '--week',
      '2026-11-16',
      '--flows',
      flows,
      '--packs',
      'packs.jsonl',
      '--count',
      '35',
    );
    assert.equal(sampled.status, 0, sampled.stderr);
    const path = join(root, '.claude/hillclimb/reviews/2026-11-16/review.json');
    const review = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(review.items.filter((r) => r.kind === 'trial').length, 4);
    assert.equal(review.items.filter((r) => r.kind === 'pack').length, 35);
    assert.ok(!JSON.stringify(review).includes('secret-model'));
    for (const item of review.items) {
      assert.ok(!readFileSync(join(root, item.transcript), 'utf8').includes('attribution'));
      item.verdict = 'agent_mistake';
      item.note = 'Read transcript';
      item.reviewer = 'ian';
      if (item.kind === 'pack')
        item.hand = {
          where: Number(item.sourceId.split('-')[1]) % 2 ? 'runtime' : 'prompt',
          why: 'wrong_tool',
        };
    }
    writeFileSync(path, JSON.stringify(review));
    assert.notEqual(
      run('--week', '2026-11-16', '--flows', flows, '--packs', 'packs.jsonl').status,
      0,
    );
    const report = run('--report', path);
    assert.equal(report.status, 0, report.stderr);
    const result = JSON.parse(report.stdout);
    assert.equal(result.where.n, 35);
    assert.equal(result.where.agreement, 1);
    assert.equal(result.where.kappa, 1);
    assert.equal(result.why.kappa, null);
    assert.equal(result.e3Eligible, true);
    assert.ok(result.where.interval95[0] > 0.8);
    review.items = review.items.filter((r) => r.kind === 'pack').slice(0, 29);
    writeFileSync(path, JSON.stringify(review));
    assert.equal(JSON.parse(run('--report', path).stdout).e3Eligible, false);
    review.items[0].verdict = 'grader_bug';
    writeFileSync(path, JSON.stringify(review));
    assert.notEqual(run('--report', path).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('default --flows without flag resolves against the repository root', () => {
  const repoRoot = resolve(import.meta.dirname, '..');
  const flow = `_cn91-mjs-${process.pid}`;
  const baseline = join(repoRoot, '.claude/hillclimb', flow, 'baseline');
  const scratch = mkdtempSync(join(tmpdir(), 'eval-sample-mjs-root-'));
  const out = join(scratch, 'review-out');
  try {
    mkdirSync(join(baseline, 'traces'), { recursive: true });
    writeFileSync(
      join(baseline, 'results.jsonl'),
      `${JSON.stringify({ prompt_id: 'root-fail', rep: 0, grade: { ok: 0 } })}\n`,
    );
    writeFileSync(join(baseline, 'traces/root-fail_rep0.json'), '[{"content":"root"}]');
    const run = spawnSync(
      process.execPath,
      [cli, '--week', '2026-11-16', '--out', out, '--count', '5'],
      { cwd: join(repoRoot, 'apps/server'), encoding: 'utf8' },
    );
    assert.equal(run.status, 0, run.stderr);
    const review = JSON.parse(readFileSync(join(out, 'review.json'), 'utf8'));
    assert.ok(
      review.items.some(
        (item) => item.kind === 'trial' && item.sourceId === 'root-fail:rep0' && item.flow === flow,
      ),
      JSON.stringify(review.items),
    );
  } finally {
    rmSync(join(repoRoot, '.claude/hillclimb', flow), { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('reports reject conflicting hand labels for a build across weekly reviews', () => {
  const root = mkdtempSync(join(tmpdir(), 'eval-review-conflict-'));
  try {
    const paths = [];
    for (const [week, where] of [
      ['first', 'runtime'],
      ['second', 'prompt'],
    ]) {
      const dir = join(root, week);
      mkdirSync(dir);
      const path = join(dir, 'review.json');
      paths.push(path);
      writeFileSync(
        path,
        JSON.stringify({
          items: [
            {
              id: 'item-1',
              sourceId: 'build-1',
              kind: 'pack',
              flow: 'builds',
              verdict: 'agent_mistake',
              reviewer: 'ian',
              note: 'Read transcript',
              hand: { where, why: 'wrong_tool' },
            },
          ],
        }),
      );
      writeFileSync(
        join(dir, 'answer-key.json'),
        JSON.stringify({
          'item-1': {
            identity: 'pack:build-1',
            sourceId: 'build-1',
            kind: 'pack',
            model: { where: 'runtime', why: 'wrong_tool' },
          },
        }),
      );
    }
    const result = spawnSync(process.execPath, [cli, '--report', paths[0], '--report', paths[1]], {
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Conflicting review.*build-1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
