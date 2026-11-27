import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  analyzeTestDiff,
  evaluateTestIntegrityCommit,
  isIntegrityTestFile,
} from './test-integrity-gate.mjs';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

function fixture(t) {
  const root = makeTestTempDir('test-integrity-');
  t.after(() => releaseTestTempDir(root));
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const write = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  const commit = (paths, message) => {
    git(['add', '--', ...paths]);
    git(['commit', '-m', message]);
    return git(['rev-parse', 'HEAD']);
  };
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  write(
    'apps/web/test/behavior.test.ts',
    "test('behavior', () => {\n  expect(value()).toBe('old');\n});\n",
  );
  commit(['apps/web/test/behavior.test.ts'], 'base');
  return { root, git, write, commit };
}

test('test file recognition covers vitest, node and playwright tests only', () => {
  assert.equal(isIntegrityTestFile('apps/web/test/a.test.ts'), true);
  assert.equal(isIntegrityTestFile('apps/web/e2e/a.spec.ts'), true);
  assert.equal(isIntegrityTestFile('scripts/a.test.mjs'), true);
  assert.equal(isIntegrityTestFile('apps/web/src/a.ts'), false);
  assert.equal(isIntegrityTestFile('docs/a.test.md'), false);
});

test('diff analysis counts assertion loss and visibility weakening', () => {
  const analysis = analyzeTestDiff(`
--- a/apps/web/test/a.test.ts
+++ b/apps/web/test/a.test.ts
@@ -1,2 +1,2 @@
-  expect(composer).toHaveValue('1. foo');
+  await expect(composer).toBeVisible();
 context();
`);
  assert.equal(analysis.netAssertionLoss, false);
  assert.equal(analysis.weakenedToVisibility, true);
  assert.equal(analysis.removedStrong, 1);
  assert.equal(analysis.addedWeak, 1);
  const loss = analyzeTestDiff('-expect(one()).toBe(1);\n');
  assert.equal(loss.netAssertionLoss, true);
});

test('removing assertions or deleting a test file is red without a reason and green with one', (t) => {
  const { root, write, commit } = fixture(t);
  write('apps/web/test/behavior.test.ts', "test('behavior', () => {\n  value();\n});\n");
  const weakened = commit(['apps/web/test/behavior.test.ts'], 'web: adjust behavior coverage');
  const red = evaluateTestIntegrityCommit(root, weakened);
  assert.equal(red.ok, false);
  assert.equal(red.violations[0].kind, 'assertions-removed');

  write(
    'apps/web/test/behavior.test.ts',
    "test('behavior', () => {\n  expect(value()).toBeDefined();\n});\n",
  );
  const strengthened = commit(['apps/web/test/behavior.test.ts'], 'web: restore behavior coverage');
  assert.equal(evaluateTestIntegrityCommit(root, strengthened).ok, true);

  write('apps/web/test/behavior.test.ts', "test('behavior', () => {\n  value();\n});\n");
  const explained = commit(
    ['apps/web/test/behavior.test.ts'],
    'web: replace duplicate coverage\n\ntest-weakening-reason: the removed assertion duplicated the stronger integration test',
  );
  assert.equal(evaluateTestIntegrityCommit(root, explained).ok, true);

  execFileSync('rm', [join(root, 'apps/web/test/behavior.test.ts')]);
  const deleted = commit(['apps/web/test/behavior.test.ts'], 'web: delete stale test');
  const deletion = evaluateTestIntegrityCommit(root, deleted);
  assert.equal(deletion.ok, false);
  assert.equal(deletion.violations[0].kind, 'deleted-test-file');
});

test('a strong assertion replaced by visibility in the same file is red', (t) => {
  const { root, write, commit } = fixture(t);
  write(
    'apps/web/test/behavior.test.ts',
    "test('behavior', () => {\n  expect(composerValue()).toBe('1. foo');\n});\n",
  );
  const setup = commit(['apps/web/test/behavior.test.ts'], 'web: strengthen baseline');
  assert.equal(evaluateTestIntegrityCommit(root, setup).ok, true);
  write(
    'apps/web/test/behavior.test.ts',
    "test('behavior', () => {\n  expect(composerVisible()).toBeVisible();\n});\n",
  );
  const sha = commit(['apps/web/test/behavior.test.ts'], 'web: narrow assertion');
  const result = evaluateTestIntegrityCommit(root, sha);
  assert.equal(result.ok, false);
  assert.equal(result.violations[0].kind, 'assertion-weakened-to-visibility');
});

test('the gate refuses to pass without a base and judges against origin/main when it has one', (t) => {
  const { root, git, write, commit } = fixture(t);
  const scripts = [
    'test-integrity-gate.mjs',
    'regression-inversion-gate.mjs',
    'plan-spec.mjs',
    'diff-base.mjs',
  ].map((name) => {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    copyFileSync(join(import.meta.dirname, name), join(root, 'scripts', name));
    return `scripts/${name}`;
  });
  commit(scripts, 'ops: add the gate');
  const run = (extra = {}) => {
    const env = { ...process.env, ...extra };
    if (!('PREPUSH_BASE_SHA' in extra)) delete env.PREPUSH_BASE_SHA;
    delete env.TEST_INTEGRITY_BASE_SHA;
    return spawnSync(process.execPath, ['scripts/test-integrity-gate.mjs'], {
      cwd: root,
      env,
      encoding: 'utf8',
    });
  };
  for (const missing of [{}, { PREPUSH_BASE_SHA: '0'.repeat(40) }]) {
    const result = run(missing);
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stderr, /no merge-base with origin\/main/);
  }
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  assert.equal(run().status, 0);
  write('apps/web/test/behavior.test.ts', "test('behavior', () => {\n  value();\n});\n");
  commit(['apps/web/test/behavior.test.ts'], 'web: drop the assertion');
  for (const missing of [{}, { PREPUSH_BASE_SHA: '0'.repeat(40) }])
    assert.equal(run(missing).status, 1);
});
