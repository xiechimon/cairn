import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const GATE = resolve(import.meta.dirname, 'ui-debt-gate.mjs');

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'ui-debt-gate-'));
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'apps/web/src'), { recursive: true });
  copyFileSync(GATE, join(dir, 'scripts/ui-debt-gate.mjs'));
  mkdirSync(join(dir, 'apps/web/src/styles'));
  for (const name of ['app.css', 'fonts.css', 'motion.css', 'shadcn.css'])
    writeFileSync(join(dir, 'apps/web/src/styles', name), ':root {}\n');
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'gate@test.invalid');
  git('config', 'user.name', 'gate test');
  const source = (sizes) =>
    writeFileSync(
      join(dir, 'apps/web/src/view.tsx'),
      `export const V = () => <p className="${sizes.map((s) => `text-[${s}px]`).join(' ')}" />;\n`,
    );
  const gate = (args = [], env = {}) =>
    spawnSync('node', ['scripts/ui-debt-gate.mjs', ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, UI_DEBT_BASE_SHA: '', ...env },
    });
  const baseline = () =>
    JSON.parse(readFileSync(join(dir, 'scripts/ui-debt-baseline.json'), 'utf8'));
  const commitAsMain = () => {
    git('add', '-A');
    git('commit', '-q', '-m', 'state');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  };
  return { dir, git, source, gate, baseline, commitAsMain };
}

test('--write refuses to raise the ledger above main and names the file that grew', () => {
  const s = sandbox();
  s.source([11, 12]);
  assert.equal(s.gate(['--write']).status, 0);
  s.commitAsMain();
  s.git('switch', '-q', '-c', 'feature');
  s.source([11, 12, 13]);
  const r = s.gate(['--write']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /apps\/web\/src\/view\.tsx|view\.tsx/);
  assert.equal(s.baseline().arbitraryValues.textTotal, 2);
});

test('--write still lowers the ledger below main', () => {
  const s = sandbox();
  s.source([11, 12]);
  assert.equal(s.gate(['--write']).status, 0);
  s.commitAsMain();
  s.git('switch', '-q', '-c', 'feature');
  s.source([11]);
  assert.equal(s.gate(['--write']).status, 0);
  assert.equal(s.baseline().arbitraryValues.textTotal, 1);
});

test('a plain check compares against main by default, so a raised in-tree ledger fails locally', () => {
  const s = sandbox();
  s.source([11, 12]);
  assert.equal(s.gate(['--write']).status, 0);
  s.commitAsMain();
  s.git('switch', '-q', '-c', 'feature');
  s.source([11, 12, 13]);
  const raised = s.baseline();
  raised.arbitraryValues.textTotal = 3;
  raised.arbitraryValues.files['view.tsx'] = { text: 3, spacing: 0 };
  writeFileSync(
    join(s.dir, 'scripts/ui-debt-baseline.json'),
    `${JSON.stringify(raised, null, 2)}\n`,
  );
  const r = s.gate();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /raised vs base: 2 -> 3/);
});

test('without an origin/main ref the gate keeps the in-tree baseline', () => {
  const s = sandbox();
  s.source([11]);
  assert.equal(s.gate(['--write']).status, 0);
  const r = s.gate();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /in-tree only/);
});
