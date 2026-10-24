import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { after, before } from 'node:test';

const gate = resolve(import.meta.dirname, 'baseline-ratchet-gate.mjs');
const repoRoot = resolve(import.meta.dirname, '..');
const realRepoScripts = () =>
  execFileSync('git', ['status', '--porcelain=v1', '--', 'scripts'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
let realRepoBefore;
before(() => {
  realRepoBefore = realRepoScripts();
});
after(() => {
  assert.equal(
    realRepoScripts(),
    realRepoBefore,
    'tests must only touch their own throwaway repos',
  );
});

const uiDebt = (rawControls, arbitraryText) => ({
  perFaceCss: { 'a.css': 10 },
  rawControls: { total: rawControls, files: {} },
  arbitraryValues: { textTotal: arbitraryText, spacingTotal: 1, files: {} },
});
const entries = (n) =>
  Array.from({ length: n }, (_, i) => ({ file: 'a.md', kind: 'class', symbol: `.c${i}` }));
const allowlist = (n) =>
  Array.from({ length: n }, (_, i) => ({ path: 'a.ts', line: `// ${i}`, reason: 'external' }));

const files = ({ warnings = 0, controls = 3, text = 5, staleness = 4, allowed = 2 } = {}) => ({
  'scripts/lint-warning-baseline.json': { maxWarnings: warnings },
  'scripts/ui-debt-baseline.json': uiDebt(controls, text),
  'scripts/feature-map-staleness-baseline.json': { entries: entries(staleness) },
  'scripts/comment-discipline-allowlist.json': allowlist(allowed),
  'scripts/single-use-helper-allowlist.json': allowlist(allowed),
});

const withRepo = (base, body) => {
  const cwd = mkdtempSync(join(tmpdir(), 'ratchet-gate-'));
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
  const write = (tree) => {
    for (const [path, json] of Object.entries(tree)) {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), JSON.stringify(json));
    }
  };
  const run = (env = {}) =>
    spawnSync(process.execPath, [gate], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, BASELINE_RATCHET_BASE_SHA: '', ...env },
    });
  try {
    git('init', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    write(base);
    git('add', '.');
    git('commit', '-m', 'base');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    body({ run, write, cwd });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
};

const raised = [
  ['lint-warning/warnings', { warnings: 1 }],
  ['ui-debt/bare-controls', { controls: 4 }],
  ['ui-debt/arbitrary-text', { text: 6 }],
  ['feature-map-staleness/entries', { staleness: 5 }],
];

for (const [metric, change] of raised) {
  test(`raising ${metric} against the base is rejected`, () => {
    withRepo(files(), ({ run, write }) => {
      assert.equal(run().status, 0);
      write(files(change));
      const result = run();
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, new RegExp(`${metric} raised vs base`));
    });
  });
}

test('holding or lowering every ratchet baseline passes', () => {
  withRepo(files(), ({ run, write }) => {
    write(files({ controls: 2, text: 5, staleness: 1 }));
    const result = run();
    assert.equal(result.status, 0, result.stderr);
  });
});

test('allowlist registrations stay allowed: they are the sanctioned exit of the comment and helper gates', () => {
  withRepo(files(), ({ run, write }) => {
    write(files({ allowed: 5 }));
    assert.equal(run().status, 0);
  });
});

test('a base without the baseline file is a bootstrap, not a violation', () => {
  withRepo({ 'scripts/unrelated.json': {} }, ({ run, write }) => {
    write(files());
    assert.equal(run().status, 0);
  });
});

test('deleting a ratchet baseline counts as lifting its ceiling', () => {
  withRepo(files(), ({ run, cwd }) => {
    rmSync(join(cwd, 'scripts/lint-warning-baseline.json'));
    const result = run();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /lint-warning-baseline\.json removed vs base/);
  });
});

test('an unresolvable base ref is an operational error, never a pass', () => {
  withRepo(files(), ({ run }) => {
    assert.equal(run({ BASELINE_RATCHET_BASE_SHA: 'does-not-exist' }).status, 2);
  });
});
