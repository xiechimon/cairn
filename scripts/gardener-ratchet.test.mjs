import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ratchetLintBaseline, tightenBaseline } from './gardener-ratchet.mjs';

test('lowers the baseline by exactly one step with measured headroom', () => {
  assert.equal(tightenBaseline(12, 3), 11);
  assert.equal(tightenBaseline(1, 0), 0);
});

test('does nothing at or above the baseline or at zero', () => {
  assert.equal(tightenBaseline(12, 12), 12);
  assert.equal(tightenBaseline(12, 13), 12);
  assert.equal(tightenBaseline(0, 0), 0);
});

test('rejects invalid measurements instead of lowering a baseline', () => {
  for (const value of [-1, 0.5, NaN, Infinity, undefined]) {
    assert.throws(() => tightenBaseline(12, value));
    assert.throws(() => tightenBaseline(value, 0));
  }
});

test('the weekly timer runs the measured ratchet in the configured repository', () => {
  const unit = readFileSync(
    new URL('./ops/systemd/cairn-gardener-weekly.service', import.meta.url),
    'utf8',
  );
  const timer = readFileSync(
    new URL('./ops/systemd/cairn-gardener-weekly.timer', import.meta.url),
    'utf8',
  );
  assert.match(unit, /gardener-ratchet\.mjs/);
  assert.match(unit, /CAIRN_REPO/);
  assert.match(unit, /Environment=PATH=.*fnm\/aliases\/default\/bin/);
  assert.match(timer, /OnCalendar=weekly/);
  assert.match(timer, /Persistent=true/);
});

test('the job persists one step and preserves the file on no-op or failed measurement', () => {
  const repo = mkdtempSync(join(tmpdir(), 'gardener-ratchet-'));
  try {
    mkdirSync(join(repo, 'scripts'));
    const path = join(repo, 'scripts/lint-warning-baseline.json');
    const original = JSON.stringify({ maxWarnings: 12, scope: 'lint' });
    writeFileSync(path, original);
    const run = (status, stdout) => (command, args, options) => {
      assert.equal(command, 'pnpm');
      assert.deepEqual(args, ['exec', 'biome', 'ci', '.']);
      assert.equal(options.cwd, repo);
      return { status, stdout, stderr: '' };
    };
    assert.deepEqual(ratchetLintBaseline(repo, run(0, 'Checked 42 files. Found 3 warnings.')), {
      before: 12,
      after: 11,
      measured: 3,
    });
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { maxWarnings: 11, scope: 'lint' });
    writeFileSync(path, original);
    assert.equal(
      ratchetLintBaseline(repo, run(0, 'Checked 42 files. Found 12 warnings.')).after,
      12,
    );
    assert.equal(readFileSync(path, 'utf8'), original);
    assert.equal(
      ratchetLintBaseline(repo, run(0, 'Checked 42 files. Found 15 warnings.')).after,
      12,
    );
    assert.equal(readFileSync(path, 'utf8'), original);
    assert.throws(() => ratchetLintBaseline(repo, run(1, 'Checked 42 files. Found 3 warnings.')));
    assert.throws(() => ratchetLintBaseline(repo, run(0, 'unexpected output')));
    assert.throws(() =>
      ratchetLintBaseline(repo, run(0, 'Checked 42 files. Found unknown warnings.')),
    );
    const ansiEscape = String.fromCharCode(27);
    assert.equal(
      ratchetLintBaseline(
        repo,
        run(
          0,
          `Checked ${ansiEscape}[34m42${ansiEscape}[0m files. Found ${ansiEscape}[34m12${ansiEscape}[0m warnings.`,
        ),
      ).measured,
      12,
    );
    assert.equal(readFileSync(path, 'utf8'), original);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
