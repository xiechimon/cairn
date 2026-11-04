import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as ratchet from './gardener-ratchet.mjs';

const { ratchetLintBaseline } = ratchet;

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
      if (command === 'gh') return { status: null, error: { code: 'ENOENT' } };
      assert.equal(command, 'pnpm');
      assert.deepEqual(args, ['exec', 'biome', 'ci', '.']);
      assert.equal(options.cwd, repo);
      return { status, stdout, stderr: '' };
    };
    assert.deepEqual(
      ratchetLintBaseline(repo, run(0, 'Checked 42 files. Found 3 warnings.'), { log() {} }),
      {
        before: 12,
        after: 11,
        measured: 3,
      },
    );
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

test('tightenBaseline drops the baseline by exactly one step only with measured headroom', () => {
  assert.equal(ratchet.tightenBaseline(12, 3), 11);
  assert.equal(ratchet.tightenBaseline(12, 11), 11);
  assert.equal(ratchet.tightenBaseline(12, 12), 12);
  assert.equal(ratchet.tightenBaseline(12, 15), 12);
  assert.equal(ratchet.tightenBaseline(0, 0), 0);
  for (const value of [-1, 0.5, null]) {
    assert.throws(() => ratchet.tightenBaseline(value, 0));
    assert.throws(() => ratchet.tightenBaseline(12, value));
  }
});

test('headroom creates a committed ratchet branch and PR without editing the shared checkout', () => {
  const repo = mkdtempSync(join(tmpdir(), 'gardener-ratchet-'));
  const calls = [];
  let worktree;
  try {
    mkdirSync(join(repo, 'scripts'));
    const original = JSON.stringify({ maxWarnings: 12, scope: 'lint' });
    writeFileSync(join(repo, 'scripts/lint-warning-baseline.json'), original);
    const run = (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      if (command === 'pnpm') return { status: 0, stdout: 'Checked 42 files. Found 3 warnings.' };
      if (command === 'git' && args[0] === 'worktree' && args[1] === 'add') {
        worktree = args.at(-2);
        mkdirSync(join(worktree, 'scripts'), { recursive: true });
        writeFileSync(join(worktree, 'scripts/lint-warning-baseline.json'), original);
      }
      if (command === 'git' && args[0] === 'commit') {
        assert.deepEqual(
          JSON.parse(readFileSync(join(options.cwd, 'scripts/lint-warning-baseline.json'), 'utf8')),
          {
            maxWarnings: 11,
            scope: 'lint',
          },
        );
      }
      return { status: 0, stdout: '' };
    };
    assert.deepEqual(ratchetLintBaseline(repo, run, { now: new Date('2026-10-31T00:00:00Z') }), {
      before: 12,
      after: 11,
      measured: 3,
    });
    assert.equal(readFileSync(join(repo, 'scripts/lint-warning-baseline.json'), 'utf8'), original);
    assert.ok(
      calls.some(
        ({ command, args }) =>
          command === 'git' &&
          args.join(' ').includes('worktree add -b gardener/ratchet-2026-10-31'),
      ),
    );
    assert.ok(
      calls.some(
        ({ command, args, cwd }) => command === 'git' && args[0] === 'commit' && cwd === worktree,
      ),
    );
    assert.ok(
      calls.some(
        ({ command, args, cwd }) =>
          command === 'git' &&
          args.join(' ') === 'push -u origin gardener/ratchet-2026-10-31' &&
          cwd === worktree,
      ),
    );
    assert.ok(
      calls.some(
        ({ command, args, cwd }) =>
          command === 'gh' &&
          args[0] === 'pr' &&
          args[1] === 'create' &&
          args.includes('gardener/ratchet-2026-10-31') &&
          cwd === worktree,
      ),
    );
    assert.ok(
      calls.some(
        ({ command, args }) => command === 'git' && args[0] === 'worktree' && args[1] === 'remove',
      ),
    );
    assert.equal(calls.filter(({ command }) => command === 'gh').length, 2);
  } finally {
    if (worktree) rmSync(worktree, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test('without gh the job prints the proposed change and performs no git writes', () => {
  const repo = mkdtempSync(join(tmpdir(), 'gardener-ratchet-'));
  try {
    mkdirSync(join(repo, 'scripts'));
    const path = join(repo, 'scripts/lint-warning-baseline.json');
    const original = JSON.stringify({ maxWarnings: 12 });
    writeFileSync(path, original);
    const output = [];
    const run = (command) => {
      if (command === 'pnpm') return { status: 0, stdout: 'Checked 42 files. Found 3 warnings.' };
      assert.equal(command, 'gh');
      return { status: null, error: { code: 'ENOENT' } };
    };
    assert.equal(ratchetLintBaseline(repo, run, { log: (line) => output.push(line) }).after, 11);
    assert.match(output.join('\n'), /12.*11/);
    assert.equal(readFileSync(path, 'utf8'), original);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('a failed ratchet commit stops publication and cleans up only its own temporary checkout', () => {
  const repo = mkdtempSync(join(tmpdir(), 'gardener-ratchet-'));
  const calls = [];
  let worktree;
  try {
    mkdirSync(join(repo, 'scripts'));
    const original = JSON.stringify({ maxWarnings: 12 });
    writeFileSync(join(repo, 'scripts/lint-warning-baseline.json'), original);
    const run = (command, args) => {
      calls.push([command, ...args]);
      if (command === 'pnpm') return { status: 0, stdout: 'Checked 42 files. Found 3 warnings.' };
      if (command === 'git' && args[0] === 'worktree' && args[1] === 'add') {
        worktree = args.at(-2);
        mkdirSync(join(worktree, 'scripts'), { recursive: true });
        writeFileSync(join(worktree, 'scripts/lint-warning-baseline.json'), original);
      }
      return {
        status: command === 'git' && args[0] === 'commit' ? 1 : 0,
        stdout: '',
        stderr: 'commit refused',
      };
    };
    assert.throws(() => ratchetLintBaseline(repo, run), /commit.*failed/);
    assert.ok(!calls.some(([command, action]) => command === 'git' && action === 'push'));
    assert.ok(!calls.some(([command, action]) => command === 'gh' && action === 'pr'));
    assert.ok(
      calls.some(
        ([command, action, operation, path]) =>
          command === 'git' && action === 'worktree' && operation === 'remove' && path === worktree,
      ),
    );
    assert.equal(readFileSync(join(repo, 'scripts/lint-warning-baseline.json'), 'utf8'), original);
  } finally {
    if (worktree) rmSync(worktree, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});
