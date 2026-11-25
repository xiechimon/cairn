import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  changedFilesForCommit,
  evaluateFixCommit,
  isFixSubject,
  isProductRuntimeFile,
  isVitestTestFile,
  materializeParentTree,
  regressionPlanForCommit,
} from './regression-inversion-gate.mjs';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

function fixture() {
  const root = makeTestTempDir('regression-inversion-');
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const write = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  const addCommit = (paths, message) => {
    git(['add', '--', ...paths]);
    git(['commit', '-m', message]);
    return git(['rev-parse', 'HEAD']);
  };
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  write('apps/server/src/thing.ts', 'export const thing = "parent";\n');
  write('apps/server/test/thing.test.ts', 'parent test\n');
  addCommit(['apps/server/src/thing.ts', 'apps/server/test/thing.test.ts'], 'base');
  return { root, git, write, addCommit };
}

test('fix subject and file classification stay narrow', () => {
  assert.equal(isFixSubject('fix(server): repair runner rows'), true);
  assert.equal(isFixSubject('fix: repair runner rows'), true);
  assert.equal(isFixSubject('fixup! fix(server): repair runner rows'), false);
  assert.equal(isFixSubject('web: repair runner rows'), false);
  assert.equal(isVitestTestFile('apps/server/test/machine.test.ts'), true);
  assert.equal(isVitestTestFile('apps/web/e2e/machine.spec.ts'), false);
  assert.equal(isProductRuntimeFile('apps/server/src/services/machines.ts'), true);
  assert.equal(isProductRuntimeFile('scripts/ops/push-queue.mjs'), false);
});

test('a fix whose changed tests pass on the parent is red; a parent-red test is green', (t) => {
  const { root, write, addCommit } = fixture();
  t.after(() => releaseTestTempDir(root));
  write('apps/server/src/thing.ts', 'export const thing = "fixed";\n');
  write('apps/server/test/thing.test.ts', 'assert fixed behavior\n');
  const commit = addCommit(
    ['apps/server/src/thing.ts', 'apps/server/test/thing.test.ts'],
    'fix(server): repair thing',
  );

  assert.deepEqual(
    changedFilesForCommit(root, commit).map((file) => [file.status, file.path]),
    [
      ['M', 'apps/server/src/thing.ts'],
      ['M', 'apps/server/test/thing.test.ts'],
    ],
  );
  const red = evaluateFixCommit(root, commit, 'light', () => ({ ran: true, passed: true }));
  assert.equal(red.ok, false);
  assert.equal(red.parentPassed, true);
  assert.match(red.reason, /pass on the parent/);

  const green = evaluateFixCommit(root, commit, 'light', () => ({ ran: true, passed: false }));
  assert.equal(green.ok, true);
  assert.equal(green.parentPassed, false);
});

test('a product fix without a changed test file is red, while a docs-only fix is out of scope', (t) => {
  const { root, write, addCommit } = fixture();
  t.after(() => releaseTestTempDir(root));
  write('apps/server/src/thing.ts', 'export const thing = "silent fix";\n');
  const silent = addCommit(['apps/server/src/thing.ts'], 'fix(server): silent thing');
  const result = evaluateFixCommit(root, silent, 'light', () => ({ ran: true, passed: false }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /no test file/);

  write('docs/thing.md', 'docs\n');
  const docs = addCommit(['docs/thing.md'], 'fix(docs): wording');
  assert.equal(evaluateFixCommit(root, docs, 'light').skipped, 'no product runtime change');
});

test('the parent tree keeps parent source and overlays only the commit test harness', (t) => {
  const { root, write, addCommit } = fixture();
  t.after(() => releaseTestTempDir(root));
  write('apps/server/src/thing.ts', 'export const thing = "fixed";\n');
  write('apps/server/test/thing.test.ts', 'assert fixed behavior\n');
  const commit = addCommit(
    ['apps/server/src/thing.ts', 'apps/server/test/thing.test.ts'],
    'fix(server): repair thing',
  );
  const tree = makeTestTempDir('regression-parent-tree-');
  t.after(() => releaseTestTempDir(tree));
  materializeParentTree(root, commit, tree);
  assert.match(readFileSync(join(tree, 'apps/server/src/thing.ts'), 'utf8'), /parent/);
  assert.match(
    readFileSync(join(tree, 'apps/server/test/thing.test.ts'), 'utf8'),
    /assert fixed behavior/,
  );
});

test('integration regression tests defer out of the light gate and are scoped in the integration gate', (t) => {
  const { root, write, addCommit } = fixture();
  t.after(() => releaseTestTempDir(root));
  write('apps/server/src/thing.ts', 'export const thing = "fixed";\n');
  write('integration/test/thing.test.ts', 'integration regression\n');
  const commit = addCommit(
    ['apps/server/src/thing.ts', 'integration/test/thing.test.ts'],
    'fix(server): repair integration path',
  );
  const plan = regressionPlanForCommit(root, commit, 'light');
  assert.equal(plan.delegated, true);
  assert.deepEqual(plan.vitestFiles, []);
  const integrationPlan = regressionPlanForCommit(root, commit, 'integration');
  assert.deepEqual(integrationPlan.vitestFiles, ['integration/test/thing.test.ts']);
  assert.equal(integrationPlan.delegated, false);
});
