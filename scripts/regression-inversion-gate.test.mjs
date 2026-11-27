import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { computePlanHash } from './plan-spec.mjs';
import {
  changedFilesForCommit,
  evaluateFixCommit,
  evaluatePlanInversionCommit,
  evaluateRange,
  isFixSubject,
  isProductRuntimeFile,
  isVitestTestFile,
  linkDependencyDirs,
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

test('static mode refuses a fix without a test and never runs one', (t) => {
  const { root, write, addCommit } = fixture();
  t.after(() => releaseTestTempDir(root));
  const never = () => assert.fail('static mode ran a test');
  write('apps/server/src/thing.ts', 'export const thing = "silent fix";\n');
  const silent = addCommit(['apps/server/src/thing.ts'], 'fix(server): silent thing');
  const refused = evaluateFixCommit(root, silent, 'static', never);
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /no test file/);

  for (const testFile of ['apps/server/test/thing.test.ts', 'integration/test/thing.test.ts']) {
    write('apps/server/src/thing.ts', `export const thing = "fixed for ${testFile}";\n`);
    write(testFile, 'regression for the fix\n');
    const tested = addCommit(['apps/server/src/thing.ts', testFile], 'fix(server): repair thing');
    const accepted = evaluateFixCommit(root, tested, 'static', never);
    assert.equal(accepted.ok, true);
    assert.match(accepted.skipped, /ci/i);
  }
});

test('static mode judges the commits since origin/main, and no base is red', (t) => {
  const { root, git, write, addCommit } = fixture();
  t.after(() => releaseTestTempDir(root));
  for (const file of ['regression-inversion-gate.mjs', 'plan-spec.mjs', 'diff-base.mjs'])
    write(`scripts/${file}`, readFileSync(join(import.meta.dirname, file), 'utf8'));
  const run = (env = {}) =>
    spawnSync(process.execPath, ['scripts/regression-inversion-gate.mjs', '--mode', 'static'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
  assert.equal(run().status, 2);

  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  assert.equal(run().status, 0);

  write('apps/server/src/thing.ts', 'export const thing = "silent fix";\n');
  const silent = addCommit(['apps/server/src/thing.ts'], 'fix(server): silent thing');
  const refused = run({ REGRESSION_INVERSION_BASE_SHA: silent, PREPUSH_BASE_SHA: silent });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /silent thing.*no test file/);
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

function writeSignedPlan(write, provingTest, integrationTest = null) {
  const rows = [
    `| Missing input | Shows error message | ${provingTest} | this change |`,
    integrationTest
      ? `| Integration path | Syncs cleanly | ${integrationTest} | this change |`
      : '| Future offline | Queues safely | apps/web/e2e/offline.spec.ts | later: slice 2 |',
  ].join('\n');
  const body = `# Plan Inversion — plan, 2026-11-27
## User scenario
A new user opens the view and triggers the new feature path without manual setup.
## Scope
1. Add the new feature behavior.
2. Keep existing views unchanged.
## Edge cases
| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
${rows}
## Out of scope
- Extra settings panels.`;
  const plan = `${body}\n\n## Review\n\n- Verdict: PASS\n- Plan-SHA256: ${computePlanHash(body)}\n- Author-Model: claude-opus-4-6\n- Reviewer: fresh-codex\n- Reviewer-Model: openai-codex/gpt-6.2-sol\n- Findings: 0 blocking\n`;
  write('docs/design/inversion.md', plan);
  return 'docs/design/inversion.md';
}

test('evaluatePlanInversionCommit checks proving test existence, light inversion, and integration delegation', (t) => {
  const { root, git, write, addCommit } = fixture();
  t.after(() => releaseTestTempDir(root));
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);

  writeSignedPlan(write, 'apps/server/test/missing-proving.test.ts');
  write('apps/server/src/thing.ts', 'export const thing = "feat-missing";\n');
  const missingSha = addCommit(
    ['docs/design/inversion.md', 'apps/server/src/thing.ts'],
    'feat(server): missing proving test\n\nPlan: docs/design/inversion.md',
  );
  const missingStatic = evaluatePlanInversionCommit(root, missingSha, 'static');
  assert.equal(missingStatic.ok, false);
  assert.match(missingStatic.reason, /apps\/server\/test\/missing-proving\.test\.ts/);

  writeSignedPlan(write, 'apps/server/test/thing.test.ts');
  write('apps/server/src/thing.ts', 'export const thing = "feat-untouched";\n');
  const untouchedSha = addCommit(
    ['docs/design/inversion.md', 'apps/server/src/thing.ts'],
    'feat(server): untouched proving test\n\nPlan: docs/design/inversion.md',
  );
  const untouchedStatic = evaluatePlanInversionCommit(root, untouchedSha, 'static');
  assert.equal(untouchedStatic.ok, false);
  assert.match(untouchedStatic.reason, /unmodified "this change" proving test file/);

  writeSignedPlan(write, 'apps/server/test/thing.test.ts');
  write('apps/server/src/thing.ts', 'export const thing = "feat-real";\n');
  write('apps/server/test/thing.test.ts', 'assert feat behavior\n');
  const realSha = addCommit(
    ['docs/design/inversion.md', 'apps/server/src/thing.ts', 'apps/server/test/thing.test.ts'],
    'feat(server): real proving test\n\nPlan: docs/design/inversion.md',
  );
  const staticOk = evaluatePlanInversionCommit(root, realSha, 'static', () =>
    assert.fail('static mode must not run tests'),
  );
  assert.equal(staticOk.ok, true);
  assert.match(staticOk.skipped, /ci/i);

  const parentPassed = evaluatePlanInversionCommit(root, realSha, 'light', () => ({
    ran: true,
    passed: true,
  }));
  assert.equal(parentPassed.ok, false);
  assert.match(parentPassed.reason, /pass on the parent/);

  const commitFailed = evaluatePlanInversionCommit(root, realSha, 'light', () => ({
    ran: true,
    passed: false,
  }));
  assert.equal(commitFailed.ok, false);
  assert.match(commitFailed.reason, /fail on the commit itself/);

  const parentFailed = evaluatePlanInversionCommit(
    root,
    realSha,
    'light',
    (_tree, _plan, _mode, phase) => ({
      ran: true,
      passed: phase === 'commit',
    }),
  );
  assert.equal(parentFailed.ok, true);

  writeSignedPlan(write, 'apps/server/test/thing.test.ts', 'apps/server/test/second.test.ts');
  write('apps/server/src/thing.ts', 'export const thing = "feat-two";\n');
  write('apps/server/test/thing.test.ts', 'assert first behavior\n');
  write('apps/server/test/second.test.ts', 'assert second behavior\n');
  const twoSha = addCommit(
    [
      'docs/design/inversion.md',
      'apps/server/src/thing.ts',
      'apps/server/test/thing.test.ts',
      'apps/server/test/second.test.ts',
    ],
    'feat(server): two proving tests\n\nPlan: docs/design/inversion.md',
  );
  const partialFail = evaluatePlanInversionCommit(
    root,
    twoSha,
    'light',
    (_tree, plan, _mode, phase) => ({
      ran: true,
      passed: phase === 'commit' || plan.vitestFiles.includes('apps/server/test/second.test.ts'),
    }),
  );
  assert.equal(partialFail.ok, false);
  assert.match(
    partialFail.reason,
    /pass on the parent source: apps\/server\/test\/second\.test\.ts/,
  );

  const partialCommitFail = evaluatePlanInversionCommit(
    root,
    twoSha,
    'light',
    (_tree, plan, _mode, phase) => ({
      ran: true,
      passed: phase === 'commit' && !plan.vitestFiles.includes('apps/server/test/second.test.ts'),
    }),
  );
  assert.equal(partialCommitFail.ok, false);
  assert.match(
    partialCommitFail.reason,
    /fail on the commit itself: apps\/server\/test\/second\.test\.ts/,
  );

  writeSignedPlan(write, 'integration/test/plan-int.test.ts');
  write('apps/server/src/thing.ts', 'export const thing = "feat-int";\n');
  write('integration/test/plan-int.test.ts', 'integration proving test\n');
  const intSha = addCommit(
    ['docs/design/inversion.md', 'apps/server/src/thing.ts', 'integration/test/plan-int.test.ts'],
    'feat(server): integration proving test\n\nPlan: docs/design/inversion.md',
  );
  assert.equal(
    evaluatePlanInversionCommit(root, intSha, 'light').skipped,
    'delegated to integration',
  );
  const intOk = evaluatePlanInversionCommit(
    root,
    intSha,
    'integration',
    (_tree, plan, _mode, phase) => {
      assert.deepEqual(plan.vitestFiles, ['integration/test/plan-int.test.ts']);
      return { ran: true, passed: phase === 'commit' };
    },
  );
  assert.equal(intOk.ok, true);
});

test('evaluateRange includes Tier 1 plan commits per-commit and skips docs/ops/chore commits', (t) => {
  const { root, git, write, addCommit } = fixture();
  t.after(() => releaseTestTempDir(root));
  const base = git(['rev-parse', 'HEAD']);

  write('docs/notes.md', 'hello\n');
  addCommit(['docs/notes.md'], 'docs: update notes');
  write('scripts/helper.mjs', 'export const h = 1;\n');
  addCommit(['scripts/helper.mjs'], 'ops: add helper');

  writeSignedPlan(write, 'apps/server/test/thing.test.ts');
  write('apps/server/src/thing.ts', 'export const thing = "feat-slice1";\n');
  write('apps/server/test/thing.test.ts', 'slice 1 proving test\n');
  const featSha1 = addCommit(
    ['docs/design/inversion.md', 'apps/server/src/thing.ts', 'apps/server/test/thing.test.ts'],
    'feat(server): slice 1\n\nPlan: docs/design/inversion.md',
  );

  writeSignedPlan(write, 'apps/server/test/thing.test.ts', 'apps/server/test/slice2.test.ts');
  write('apps/server/src/thing.ts', 'export const thing = "feat-slice2";\n');
  write('apps/server/test/thing.test.ts', 'slice 1+2 proving test\n');
  write('apps/server/test/slice2.test.ts', 'slice 2 proving test\n');
  const featSha2 = addCommit(
    [
      'docs/design/inversion.md',
      'apps/server/src/thing.ts',
      'apps/server/test/thing.test.ts',
      'apps/server/test/slice2.test.ts',
    ],
    'feat(server): slice 2\n\nPlan: docs/design/inversion.md',
  );

  const results = evaluateRange({
    cwd: root,
    base,
    head: featSha2,
    mode: 'light',
    execute: (_tree, _plan, _mode, phase) => ({ ran: true, passed: phase === 'commit' }),
  });
  assert.equal(results.length, 2);
  assert.equal(results[0].commit, featSha1);
  assert.equal(results[0].ok, true);
  assert.equal(results[1].commit, featSha2);
  assert.equal(results[1].ok, true);
});

test('linkDependencyDirs isolates workspace packages inside the materialized tree', (t) => {
  const cwd = makeTestTempDir('link-deps-cwd-');
  const tree = makeTestTempDir('link-deps-tree-');
  t.after(() => releaseTestTempDir(cwd));
  t.after(() => releaseTestTempDir(tree));

  const write = (base, rel, content) => {
    mkdirSync(dirname(join(base, rel)), { recursive: true });
    writeFileSync(join(base, rel), content);
  };
  write(cwd, 'packages/shared/package.json', '{"name":"@cairn/shared","main":"./src/index.mjs"}\n');
  write(cwd, 'packages/shared/src/index.mjs', 'export const ver = "cwd";\n');
  write(
    cwd,
    'node_modules/third-party/package.json',
    '{"name":"third-party","main":"./index.js"}\n',
  );
  write(cwd, 'node_modules/third-party/index.js', 'module.exports = 1;\n');
  mkdirSync(join(cwd, 'apps/server/node_modules/@cairn'), { recursive: true });
  symlinkSync('../../../../packages/shared', join(cwd, 'apps/server/node_modules/@cairn/shared'));
  symlinkSync(
    '../../../node_modules/third-party',
    join(cwd, 'apps/server/node_modules/third-party'),
  );

  write(
    tree,
    'packages/shared/package.json',
    '{"name":"@cairn/shared","main":"./src/index.mjs"}\n',
  );
  write(tree, 'packages/shared/src/index.mjs', 'export const ver = "archive";\n');
  write(tree, 'apps/server/src/probe.mjs', 'export {};\n');

  linkDependencyDirs(cwd, tree);

  const req = createRequire(pathToFileURL(join(tree, 'apps/server/src/probe.mjs')));
  const sharedResolved = req.resolve('@cairn/shared');
  const thirdPartyResolved = req.resolve('third-party');
  assert.equal(
    sharedResolved.startsWith(realpathSync(join(tree, 'packages/shared'))),
    true,
    sharedResolved,
  );
  assert.equal(
    thirdPartyResolved.startsWith(realpathSync(join(cwd, 'node_modules/third-party'))),
    true,
    thirdPartyResolved,
  );
});
