import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ratchetLintBaseline } from './gardener-ratchet.mjs';

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

test('the weekly job reports measurements without editing the configured checkout', () => {
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
      after: 12,
      measured: 3,
    });
    assert.equal(readFileSync(path, 'utf8'), original);
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
    writeFileSync(path, JSON.stringify({ maxWarnings: 0 }));
    assert.deepEqual(ratchetLintBaseline(repo, run(0, 'Checked 42 files.')), {
      before: 0,
      after: 0,
      measured: 0,
    });
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { maxWarnings: 0 });
    for (const value of [-1, 0.5, null]) {
      writeFileSync(path, JSON.stringify({ maxWarnings: value }));
      assert.throws(() => ratchetLintBaseline(repo, run(0, 'Checked 42 files.')));
    }
    writeFileSync(path, original);
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
