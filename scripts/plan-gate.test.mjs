import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  classifyCommit,
  computePlanHash,
  evaluatePlanCommit,
  evaluatePlanRange,
  extractProvingTestPaths,
  isValidPlanPath,
  normalizeModelId,
  parseSliceStatus,
  validatePlanContent,
} from './plan-gate.mjs';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

const REPO = join(import.meta.dirname, '..');
const CLI = join(import.meta.dirname, 'plan-gate.mjs');
const BODY = `# Sample — plan, 2026-11-27
## User scenario
A new user opens the task panel, picks a computer, and sees tasks wait for it.
## Scope
1. Show the computer chip when two or more computers are online.
2. Keep the single-computer row unchanged.
## Edge cases
| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Selected offline | Chip keeps offline dot and queued label | apps/web/e2e/add.spec.ts | later: slice 2 |
| Unknown machine | Error toast keeps text | apps/server/test/todo.test.ts | this change |
## Out of scope
- Adding a machine selector to the Coordinator chat composer.`;
const sign = (
  body = BODY,
  {
    authorModel = 'claude-opus-4-6',
    reviewerModel = 'openai-codex/gpt-6.2-sol',
    reviewer = 'fresh-codex',
  } = {},
) =>
  `${body}\n\n## Review\n\n- Verdict: PASS\n- Plan-SHA256: ${computePlanHash(body)}\n- Author-Model: ${authorModel}\n- Reviewer: ${reviewer}\n- Reviewer-Model: ${reviewerModel}\n- Findings: 0 blocking\n`;

const reviewWith = (verdict, fixCheck = '') =>
  sign().replace('- Verdict: PASS', `- Verdict: ${verdict}${fixCheck}`);
const currentFixCheck = `\n- Fix-check: PASS\n- Fix-check-Plan-SHA256: ${computePlanHash(BODY)}`;
const expectReview = (plan, ok, label) => {
  const result = validatePlanContent(plan);
  assert.equal(result.ok, ok, `${label}: ${result.errors.join('; ') || 'unexpectedly accepted'}`);
};

test('PASS accepts legacy bare fix-check only with current ordinary hash', () => {
  expectReview(reviewWith('PASS', '\n- Fix-check: PASS'), true, 'legacy bare fix-check');
  expectReview(
    reviewWith('PASS', '\n- Fix-check: PASS').replace(computePlanHash(BODY), 'a'.repeat(64)),
    false,
    'legacy bare fix-check with stale ordinary hash',
  );
  expectReview(reviewWith('PASS', '\n- Fix-check: FAIL'), false, 'failed fix-check');
  expectReview(
    reviewWith('PASS', currentFixCheck.replace('\n- Fix-check: PASS', '')),
    false,
    'fix hash without fix-check',
  );
  expectReview(
    reviewWith('PASS', currentFixCheck.replace(computePlanHash(BODY), 'a'.repeat(64))),
    false,
    'stale fix hash',
  );
  expectReview(reviewWith('PASS', currentFixCheck), true, 'current fix-check');
});

test('ordinary separators and Review text retain the parent ATX hash', () => {
  const body = `---\ntitle: example\n---\nReview\n------\n\n${BODY}`;
  assert.equal(
    computePlanHash(body),
    'c2e4fd2d857e60134cd02c79db33529c4d444f139c5607fe2abfeaca23f086ed',
  );
  expectReview(sign(body), true, 'ATX plan with front matter and separator');
});

test('CONCERNS with a passing fix-check bound to the current plan is accepted', () => {
  expectReview(reviewWith('CONCERNS', currentFixCheck), true, 'current CONCERNS fix-check');
});

test('a second Verdict is rejected even when unbulleted and the first is valid', () => {
  for (const second of ['Verdict: BLOCK', '- Verdict: BLOCK', 'Verdict:']) {
    expectReview(sign().replace('- Verdict: PASS', `- Verdict: PASS\n${second}`), false, second);
  }
});

test('BLOCK and legacy FAIL need a current passing fix-check', () => {
  for (const verdict of ['BLOCK', 'FAIL']) {
    expectReview(reviewWith(verdict), false, `${verdict}: missing fix-check`);
    expectReview(reviewWith(verdict, '\n- Fix-check: PASS'), false, `${verdict}: missing fix hash`);
    expectReview(
      reviewWith(verdict, currentFixCheck.replace('Fix-check: PASS', 'Fix-check: FAIL')),
      false,
      `${verdict}: failed fix-check`,
    );
    expectReview(reviewWith(verdict, currentFixCheck), true, `${verdict}: current fix-check`);
  }
});

test('refreshing the ordinary plan hash does not refresh a stale fix-check', () => {
  const editedBody = BODY.replace('Unknown machine', 'Unrecognized machine');
  const plan = sign(editedBody).replace('- Verdict: PASS', `- Verdict: CONCERNS${currentFixCheck}`);
  expectReview(plan, false, 'stale fix-check after body edit and Plan-SHA256 refresh');
});

test('CONCERNS preserves the historical review hash while checking the edited body', () => {
  const editedBody = BODY.replace('Unknown machine', 'Unrecognized machine');
  const historical = sign(editedBody)
    .replace(computePlanHash(editedBody), computePlanHash(BODY))
    .replace('- Verdict: PASS', '- Verdict: CONCERNS');
  const fix = (hash) => `\n- Fix-check: PASS\n- Fix-check-Plan-SHA256: ${hash}`;
  expectReview(
    historical.replace(
      '- Verdict: CONCERNS',
      `- Verdict: CONCERNS${fix(computePlanHash(editedBody))}`,
    ),
    true,
    'current fix hash',
  );
  expectReview(
    historical.replace('- Verdict: CONCERNS', `- Verdict: CONCERNS${fix(computePlanHash(BODY))}`),
    false,
    'stale fix hash',
  );
  expectReview(
    historical.replace('- Verdict: CONCERNS', '- Verdict: CONCERNS\n- Fix-check: PASS'),
    false,
    'missing fix hash',
  );
});

for (const field of [
  'Plan-SHA256',
  'Author-Model',
  'Reviewer',
  'Reviewer-Model',
  'Findings',
  'Fix-check',
  'Fix-check-Plan-SHA256',
]) {
  test(`duplicate ${field} metadata is rejected`, () => {
    const plan = reviewWith('PASS', currentFixCheck);
    const line = plan.split('\n').find((entry) => entry.startsWith(`- ${field}:`));
    expectReview(`${plan}${line}\n`, false, `duplicate ${field}`);
  });
}

for (const heading of ['User scenario', 'Scope', 'Edge cases', 'Out of scope']) {
  test(`duplicate ${heading} heading is rejected`, () => {
    const section = BODY.split(`## ${heading}\n`)[1].split('\n## ')[0];
    const body = `${BODY}\n\n## ${heading}\n${section}`;
    expectReview(sign(body), false, `duplicate ${heading}`);
  });
}

test('a level-two section after Review is rejected', () => {
  expectReview(`${sign()}\n## Appendix\nUnhashed content.\n`, false, 'unhashed suffix');
  expectReview(`${sign()}\nAppendix\n--------\nText.\n`, true, 'setext is ordinary review text');
});

test('PASS stays valid; unknown and empty verdicts are rejected', () => {
  expectReview(sign(), true, 'legacy PASS');
  for (const verdict of ['MAYBE', ''])
    expectReview(reviewWith(verdict), false, `verdict ${JSON.stringify(verdict)}`);
});

test('duplicate Review headings are rejected', () => {
  expectReview(`${sign()}\n## Review\n\n- Verdict: PASS\n`, false, 'duplicate Review section');
});

test('fenced examples neither supply nor duplicate review metadata', () => {
  const example = '```markdown\n- Verdict: PASS\n```';
  expectReview(sign().replace('- Verdict: PASS', example), false, 'only fenced verdict');
  expectReview(
    sign().replace('- Verdict: PASS', `- Verdict: PASS\n${example}`),
    true,
    'fenced example after verdict',
  );
});

test('tilde and unclosed fences cannot supply metadata; inline prose is ignored', () => {
  for (const fence of [
    '~~~markdown\n- Verdict: PASS\n~~~',
    '```markdown\n- Verdict: PASS',
    '~~~markdown\n- Verdict: PASS',
  ]) {
    expectReview(sign().replace('- Verdict: PASS', fence), false, fence);
  }
  expectReview(
    sign().replace('- Verdict: PASS', '- Verdict: PASS\nAn example says Verdict: BLOCK in prose.'),
    true,
    'inline prose',
  );
  expectReview(
    sign().replace('- Verdict: PASS', '- Verdict: PASS\n~~~markdown\n- Verdict: BLOCK\n~~~'),
    true,
    'tilde example',
  );
});

test('lowercase statuses and BOM/CRLF are accepted', () => {
  const body = `\uFEFF${BODY.replaceAll('\n', '\r\n')}`;
  const hash = computePlanHash(body);
  const plan = sign(body).replace(
    '- Verdict: PASS',
    `- Verdict: concerns\n- Fix-check: pass\n- Fix-check-Plan-SHA256: ${hash}`,
  );
  expectReview(plan.replace(/(?<!\r)\n/g, '\r\n'), true, 'BOM CRLF lowercase');
});

test('status tokens reject trailing text', () => {
  expectReview(
    sign().replace('Verdict: PASS', 'Verdict: PASS trailing'),
    false,
    'verdict trailing text',
  );
  expectReview(
    reviewWith('PASS', currentFixCheck.replace('Fix-check: PASS', 'Fix-check: PASS trailing')),
    false,
    'fix-check trailing text',
  );
});

function initTempRepo(t) {
  const dir = makeTestTempDir('plan-gate-');
  t.after(() => releaseTestTempDir(dir));
  const git = (args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@e', ...args], {
      cwd: dir,
      encoding: 'utf8',
    }).trim();
  const write = (rel, content) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  git(['init', '-b', 'main']);
  write('README.md', 'init\n');
  git(['add', 'README.md']);
  git(['commit', '-m', 'init']);
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  return { dir, git, write };
}

test('red-first replay: missed-edge feat fails without plan; docs-only control passes', () => {
  const missed = evaluatePlanCommit(REPO, '8714d08efd3f1170577fd14777d73d558e728c29');
  assert.equal(missed.ok, false);
  assert.match(missed.reason, /Plan: docs\/design\/<slug>\.md/);
  const clean = evaluatePlanCommit(REPO, '596034c5f2a385b6fbaa9ddfcc786e378050e92f');
  assert.equal(clean.ok, true);
  assert.equal(clean.skipped, 'no product runtime change');
});

test('temp repo passes with hash-verified plan and fails when edited without re-review', (t) => {
  const { dir, git, write } = initTempRepo(t);
  const run = (a) => spawnSync(process.execPath, [CLI, ...a], { cwd: dir, encoding: 'utf8' });
  const plan = sign();
  assert.equal(computePlanHash(plan), computePlanHash(BODY));
  write('docs/design/sample.md', plan);
  write('apps/web/src/sample.ts', 'export const s = 1;\n');
  write('apps/server/test/todo.test.ts', 'export const ok = true;\n');
  git(['add', 'docs/design/sample.md', 'apps/web/src/sample.ts', 'apps/server/test/todo.test.ts']);
  git(['commit', '-m', 'feat(sample): add behavior', '-m', 'Plan: docs/design/sample.md']);
  assert.equal(run([]).status, 0);
  assert.equal(run(['--hash', 'docs/design/sample.md']).stdout.trim(), computePlanHash(BODY));
  assert.equal(run(['--check-file', 'docs/design/sample.md']).status, 0);
  const edit = plan.replace('Unknown machine', 'Edited edge');
  write('docs/design/sample.md', edit);
  git(['add', 'docs/design/sample.md']);
  git(['commit', '-m', 'docs(sample): edit without re-hash']);
  const tampered = run([]);
  assert.equal(tampered.status, 1);
  assert.match(tampered.stderr, /Plan-SHA256 mismatch/);
});

test('file, commit and range check original and later fix-checks independently', (t) => {
  const { dir, git, write } = initTempRepo(t);
  const run = (...args) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8' });
  const path = 'docs/design/sample.md';
  const plan = reviewWith('CONCERNS', currentFixCheck);
  write(path, plan);
  write('apps/web/src/sample.ts', 'export const s = 1;\n');
  write('apps/server/test/todo.test.ts', 'export const ok = true;\n');
  git(['add', path, 'apps/web/src/sample.ts', 'apps/server/test/todo.test.ts']);
  git(['commit', '-m', 'feat(sample): launch', '-m', `Plan: ${path}`]);
  const launch = git(['rev-parse', 'HEAD']);
  assert.equal(run('--check-file', path).status, 0);
  assert.equal(run('--commit', launch).status, 0);
  assert.equal(evaluatePlanCommit(dir, launch).ok, true);
  assert.equal(run().status, 0);

  const editedBody = BODY.replace('Unknown machine', 'Unrecognized machine');
  const updated = plan
    .replace(BODY, editedBody)
    .replace(
      `Fix-check-Plan-SHA256: ${computePlanHash(BODY)}`,
      `Fix-check-Plan-SHA256: ${computePlanHash(editedBody)}`,
    );
  write(path, updated);
  git(['add', path]);
  git(['commit', '-m', 'docs: update checked plan']);
  assert.equal(run('--check-file', path).status, 0);
  assert.equal(run().status, 0);
  write(path, `${updated}- Verdict: BLOCK\n`);
  git(['add', path]);
  git(['commit', '--amend', '--no-edit']);
  assert.equal(run().status, 1);
});

test('a later valid fix-check cannot repair an invalid launch commit', (t) => {
  const { dir, git, write } = initTempRepo(t);
  const path = 'docs/design/sample.md';
  write(path, reviewWith('CONCERNS'));
  write('apps/web/src/sample.ts', 'export const s = 1;\n');
  write('apps/server/test/todo.test.ts', 'export const ok = true;\n');
  git(['add', path, 'apps/web/src/sample.ts', 'apps/server/test/todo.test.ts']);
  git(['commit', '-m', 'feat(sample): launch', '-m', `Plan: ${path}`]);
  write(path, reviewWith('CONCERNS', currentFixCheck));
  git(['add', path]);
  git(['commit', '-m', 'docs: confirm plan']);
  assert.equal(spawnSync(process.execPath, [CLI, '--check-file', path], { cwd: dir }).status, 0);
  assert.equal(spawnSync(process.execPath, [CLI], { cwd: dir }).status, 1);
});

test('hollow satisfiers, invalid paths, classifier tiers, and missing merge-base fail closed', (t) => {
  const valid = sign();
  assert.equal(validatePlanContent(valid).ok, true);
  const bad = [
    ['A new user opens the task panel, picks a computer, and sees tasks wait for it.', 'TODO'],
    ['1. Show', '- Show'],
    [
      '| Unknown machine | Error toast keeps text | apps/server/test/todo.test.ts | this change |',
      '',
    ],
    ['Unknown machine', 'TBD'],
    ['- Adding a machine selector to the Coordinator chat composer.', ''],
    ['Verdict: PASS', 'Verdict: FAIL'],
    ['fresh-codex', '<reviewer>'],
  ];
  for (const [from, to] of bad)
    assert.equal(validatePlanContent(valid.replace(from, to)).ok, false, from);
  assert.equal(isValidPlanPath('docs/design/pin.md'), true);
  for (const p of ['docs/design/README.md', 'docs/design/../x.md', 'README.md'])
    assert.equal(isValidPlanPath(p), false, p);
  const proto = 'packages/shared/src/protocol';
  for (const [s, p, ok] of [
    ['fix(proto): x', `${proto}/rest.ts`, false],
    ['docs(feat): x', 'docs/a.md', false],
    ['feat(web): x', 'apps/web/src/a.tsx', true],
    ['shared(retry): x', `${proto}/machine-wire.ts`, true],
    ['server(mem): x', 'apps/server/src/db/schema.ts', true],
  ])
    assert.equal(classifyCommit(s, [{ path: p }]).required, ok, s);
  const dir = makeTestTempDir('plan-gate-nobase-');
  t.after(() => releaseTestTempDir(dir));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  assert.equal(spawnSync(process.execPath, [CLI], { cwd: dir }).status, 2);
});

test('Slice/Status, Proving test path extraction, and Author-Model vs Reviewer-Model rules', () => {
  assert.equal(parseSliceStatus('this change').kind, 'this-change');
  assert.deepEqual(parseSliceStatus('later: #1234'), { kind: 'later', target: '#1234' });
  assert.deepEqual(parseSliceStatus('`later: slice 2`'), { kind: 'later', target: 'slice 2' });
  for (const badStatus of ['', 'TBD', 'later', 'later:', 'later: TBD', 'later: <ticket>', 'done'])
    assert.notEqual(parseSliceStatus(badStatus).kind, 'this-change', badStatus);
  assert.notEqual(parseSliceStatus('later: TBD').kind, 'later');

  assert.deepEqual(extractProvingTestPaths('apps/server/src/app.ts'), []);
  assert.deepEqual(extractProvingTestPaths('manual test'), []);
  assert.deepEqual(
    extractProvingTestPaths(
      '`packages/shared/test/acceptance.test.ts` + `apps/server/test/acceptance-gate.test.ts`',
    ),
    ['packages/shared/test/acceptance.test.ts', 'apps/server/test/acceptance-gate.test.ts'],
  );
  assert.deepEqual(extractProvingTestPaths('`eval/lane-harness.test.ts`'), [
    'eval/lane-harness.test.ts',
  ]);

  for (const badProving of ['apps/server/src/app.ts', 'manual check in browser']) {
    const plan = sign(BODY.replace('apps/server/test/todo.test.ts', badProving));
    assert.equal(validatePlanContent(plan).ok, false, badProving);
  }
  for (const badSlice of ['TBD', 'later', 'later: TBD', 'done']) {
    const plan = sign(BODY.replace('this change', badSlice));
    assert.equal(validatePlanContent(plan).ok, false, badSlice);
  }

  for (const hollowModel of ['', 'subagent', 'fresh-context subagent', 'same', '<model>']) {
    assert.equal(normalizeModelId(hollowModel), '', hollowModel);
    const badAuthor = sign(BODY, { authorModel: hollowModel });
    assert.equal(validatePlanContent(badAuthor).ok, false, `author:${hollowModel}`);
    const badReviewer = sign(BODY, { reviewerModel: hollowModel });
    assert.equal(validatePlanContent(badReviewer).ok, false, `reviewer:${hollowModel}`);
  }

  for (const sameAlias of [
    'claude-opus-4-6',
    'anthropic/claude-opus-4-6',
    'Claude Opus 4.6',
    'claude-opus-4-6-20260514',
    'claude-opus-4-6 (via subagent)',
  ]) {
    const res = validatePlanContent(
      sign(BODY, { authorModel: 'claude-opus-4-6', reviewerModel: sameAlias }),
    );
    assert.equal(res.ok, false, sameAlias);
    assert.match(res.errors.join('; '), /must differ from Author-Model/);
  }

  for (const distinct of ['openai-codex/gpt-6.2-sol', 'claude-sonnet-4-6']) {
    assert.equal(
      validatePlanContent(sign(BODY, { authorModel: 'claude-opus-4-6', reviewerModel: distinct }))
        .ok,
      true,
      distinct,
    );
  }
});

test('negative control: 3-column task-guidance-like plan with missing tests and same-model subagent fails', (t) => {
  const { dir, git, write } = initTempRepo(t);
  const legacyBody = `# Task Execution Guidance Plan (2026-11-27)
## User scenario
A new user opens Cairn and creates a task in plain words; small fixes verify before finishing.
## Scope
1. Require edge cases before the first edit.
2. Require acceptance verification before marking a task done.
## Edge cases
| Edge case | User behavior | Proving test |
|---|---|---|
| UI file edited with zero screenshots | Retries once asking for attach_file | \`packages/shared/test/acceptance.test.ts\` + \`apps/server/test/acceptance-gate.test.ts\` |
| Agent ignores first nudge | Stops after 1 nudge in needs_input | \`apps/server/test/acceptance-gate.test.ts\` |
## Out of scope
- Any new status badge on the board.`;
  const legacyPlan = `${legacyBody}\n\n## Review\n\n- Verdict: PASS\n- Plan-SHA256: ${computePlanHash(legacyBody)}\n- Reviewer: Plan Gate Reviewer (fresh-context subagent)\n- Findings: 0 blocking\n`;
  write('docs/design/task-guidance-plan.md', legacyPlan);
  write('packages/shared/src/prompts.ts', 'export const p = "new";\n');
  git(['add', 'docs/design/task-guidance-plan.md', 'packages/shared/src/prompts.ts']);
  git([
    'commit',
    '-m',
    'feat(guidance): tiered task guidance',
    '-m',
    'Plan: docs/design/task-guidance-plan.md',
  ]);
  const sha = git(['rev-parse', 'HEAD']);
  const res = evaluatePlanCommit(dir, sha);
  assert.equal(res.ok, false);
  assert.match(res.reason, /packages\/shared\/test\/acceptance\.test\.ts/);
  assert.match(res.reason, /apps\/server\/test\/acceptance-gate\.test\.ts/);
  assert.match(res.reason, /Slice\/Status/);
  assert.match(res.reason, /Author-Model/);
  assert.match(res.reason, /Reviewer-Model/);
});

test('this-change rows require committed runnable tests; later rows do not fail for missing future files', (t) => {
  const { dir, git, write } = initTempRepo(t);
  write('apps/server/test/existing.test.ts', 'export const existing = true;\n');
  git(['add', 'apps/server/test/existing.test.ts']);
  git(['commit', '-m', 'test: add existing test']);

  const laterOnlyBody = BODY.replace(
    '| Unknown machine | Error toast keeps text | apps/server/test/todo.test.ts | this change |',
    '| Unknown machine | Error toast keeps text | apps/server/test/future.test.ts | later: #999 |',
  );
  write('docs/design/later-only.md', sign(laterOnlyBody));
  write('apps/web/src/a.ts', 'export const a = 1;\n');
  git(['add', 'docs/design/later-only.md', 'apps/web/src/a.ts']);
  git(['commit', '-m', 'feat(a): later only', '-m', 'Plan: docs/design/later-only.md']);
  const laterOnlyRes = evaluatePlanCommit(dir, git(['rev-parse', 'HEAD']));
  assert.equal(laterOnlyRes.ok, false);
  assert.match(laterOnlyRes.reason, /at least one Edge cases row must be marked "this change"/);

  const untouchedTestBody = BODY.replace(
    'apps/server/test/todo.test.ts',
    'apps/server/test/existing.test.ts',
  );
  write('docs/design/untouched.md', sign(untouchedTestBody));
  write('apps/web/src/b.ts', 'export const b = 1;\n');
  git(['add', 'docs/design/untouched.md', 'apps/web/src/b.ts']);
  git(['commit', '-m', 'feat(b): untouched test', '-m', 'Plan: docs/design/untouched.md']);
  const untouchedRes = evaluatePlanCommit(dir, git(['rev-parse', 'HEAD']));
  assert.equal(untouchedRes.ok, false);
  assert.match(untouchedRes.reason, /unmodified "this change" proving test file/);

  const specOnlyBody = BODY.replace('apps/server/test/todo.test.ts', 'apps/web/e2e/only.spec.ts');
  write('docs/design/spec-only.md', sign(specOnlyBody));
  write('apps/web/e2e/only.spec.ts', 'export const spec = true;\n');
  write('apps/web/src/c.ts', 'export const c = 1;\n');
  git(['add', 'docs/design/spec-only.md', 'apps/web/e2e/only.spec.ts', 'apps/web/src/c.ts']);
  git(['commit', '-m', 'feat(c): spec only', '-m', 'Plan: docs/design/spec-only.md']);
  const specOnlyRes = evaluatePlanCommit(dir, git(['rev-parse', 'HEAD']));
  assert.equal(specOnlyRes.ok, false);
  assert.match(specOnlyRes.reason, /no added or modified runnable proving test/);

  const mixedBody = BODY.replace(
    'apps/web/e2e/add.spec.ts',
    'apps/server/test/future-later.test.ts',
  );
  write('docs/design/mixed.md', sign(mixedBody));
  write('apps/server/test/todo.test.ts', 'export const added = true;\n');
  write('apps/web/src/d.ts', 'export const d = 1;\n');
  git(['add', 'docs/design/mixed.md', 'apps/server/test/todo.test.ts', 'apps/web/src/d.ts']);
  git(['commit', '-m', 'feat(d): mixed later and this change', '-m', 'Plan: docs/design/mixed.md']);
  const mixedRes = evaluatePlanCommit(dir, git(['rev-parse', 'HEAD']));
  assert.equal(mixedRes.ok, true);
});

test('light mode runs proving tests against parent tree and fails if proving test passes on parent', (t) => {
  const { dir, git, write } = initTempRepo(t);
  write('apps/server/src/feature.mjs', 'export const value = "old";\n');
  write(
    'scripts/unrelated.test.mjs',
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\ntest('unrelated fails on parent', () => { assert.equal(1, 2); });\n",
  );
  git(['add', 'apps/server/src/feature.mjs', 'scripts/unrelated.test.mjs']);
  git(['commit', '-m', 'base product']);

  const planBody = `# Node Proving Test — plan, 2026-11-27
## User scenario
A new user checks the feature output and receives the updated value when enabled.
## Scope
1. Update the feature output value to "new".
2. Keep unrelated behavior unchanged.
## Edge cases
| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Unrelated future check | Deferred cleanly | scripts/future-edge.test.mjs | later: slice 2 |
| Feature returns updated value | User receives "new" | scripts/sample-feature.test.mjs | this change |
## Out of scope
- Changing any other endpoint.`;
  write('docs/design/node-proving.md', sign(planBody));
  write('apps/server/src/feature.mjs', 'export const value = "new";\n');
  write(
    'scripts/sample-feature.test.mjs',
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { value } from '../apps/server/src/feature.mjs';\ntest('tautology passes on parent too', () => { assert.ok(typeof value === 'string'); });\n",
  );
  write(
    'scripts/unrelated.test.mjs',
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\ntest('unrelated fixed', () => { assert.equal(1, 1); });\n",
  );
  git([
    'add',
    'docs/design/node-proving.md',
    'apps/server/src/feature.mjs',
    'scripts/sample-feature.test.mjs',
    'scripts/unrelated.test.mjs',
  ]);
  git(['commit', '-m', 'feat(feature): tautology test', '-m', 'Plan: docs/design/node-proving.md']);
  const tautologyRes = evaluatePlanCommit(dir, git(['rev-parse', 'HEAD']), 'HEAD', {
    mode: 'light',
  });
  assert.equal(tautologyRes.ok, false);
  assert.match(tautologyRes.reason, /pass on the parent/);

  write(
    'scripts/sample-feature.test.mjs',
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { value } from '../apps/server/src/feature.mjs';\ntest('requires new value', () => { assert.equal(value, 'new'); });\n",
  );
  git(['add', 'scripts/sample-feature.test.mjs']);
  git(['commit', '--amend', '--no-edit']);
  const realRedRes = evaluatePlanCommit(dir, git(['rev-parse', 'HEAD']), 'HEAD', {
    mode: 'light',
  });
  assert.equal(realRedRes.ok, true);
});

test('always-failing proving test is rejected because it fails on the commit itself', (t) => {
  const { dir, git, write } = initTempRepo(t);
  write('apps/server/src/feature.mjs', 'export const value = "old";\n');
  git(['add', 'apps/server/src/feature.mjs']);
  git(['commit', '-m', 'base']);

  const planBody = `# Always Red — plan, 2026-11-27
## User scenario
A new user checks the feature output and receives the updated value when enabled.
## Scope
1. Update the feature output value to "new".
2. Keep unrelated behavior unchanged.
## Edge cases
| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Future edge | Deferred cleanly | scripts/future.test.mjs | later: slice 2 |
| Always red test | Should not pass | scripts/always-red.test.mjs | this change |
## Out of scope
- Changing any other endpoint.`;
  write('docs/design/always-red.md', sign(planBody));
  write('apps/server/src/feature.mjs', 'export const value = "new";\n');
  write(
    'scripts/always-red.test.mjs',
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\ntest('always fails', () => { assert.equal(1, 2); });\n",
  );
  git([
    'add',
    'docs/design/always-red.md',
    'apps/server/src/feature.mjs',
    'scripts/always-red.test.mjs',
  ]);
  git(['commit', '-m', 'feat(feature): always red', '-m', 'Plan: docs/design/always-red.md']);
  const res = evaluatePlanCommit(dir, git(['rev-parse', 'HEAD']), 'HEAD', { mode: 'light' });
  assert.equal(res.ok, false);
  assert.match(res.reason, /fail on the commit itself/);
});

test('every this-change proving test file must be modified and fail individually on parent', (t) => {
  const { dir, git, write } = initTempRepo(t);
  write('apps/server/src/feature.mjs', 'export const a = "old";\nexport const b = "old";\n');
  write(
    'scripts/second.test.mjs',
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\ntest('existing second', () => { assert.equal(1, 1); });\n",
  );
  git(['add', 'apps/server/src/feature.mjs', 'scripts/second.test.mjs']);
  git(['commit', '-m', 'base']);

  const planBody = `# Multi Test — plan, 2026-11-27
## User scenario
A new user runs both feature paths and sees both updated values cleanly.
## Scope
1. Update both feature values a and b.
2. Keep unrelated endpoints unchanged.
## Edge cases
| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| First path | Shows new a | scripts/first.test.mjs | this change |
| Second path | Shows new b | scripts/second.test.mjs | this change |
## Out of scope
- Extra panels.`;
  write('docs/design/multi-test.md', sign(planBody));
  write('apps/server/src/feature.mjs', 'export const a = "new";\nexport const b = "new";\n');
  write(
    'scripts/first.test.mjs',
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { a } from '../apps/server/src/feature.mjs';\ntest('first', () => { assert.equal(a, 'new'); });\n",
  );
  git([
    'add',
    'docs/design/multi-test.md',
    'apps/server/src/feature.mjs',
    'scripts/first.test.mjs',
  ]);
  git([
    'commit',
    '-m',
    'feat(feature): leave second untouched',
    '-m',
    'Plan: docs/design/multi-test.md',
  ]);
  const untouchedRes = evaluatePlanCommit(dir, git(['rev-parse', 'HEAD']));
  assert.equal(untouchedRes.ok, false);
  assert.match(
    untouchedRes.reason,
    /unmodified "this change" proving test file.*scripts\/second\.test\.mjs/,
  );

  write(
    'scripts/second.test.mjs',
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { b } from '../apps/server/src/feature.mjs';\ntest('tautology second', () => { assert.ok(typeof b === 'string'); });\n",
  );
  git(['add', 'scripts/second.test.mjs']);
  git(['commit', '--amend', '--no-edit']);
  const partialTautology = evaluatePlanCommit(dir, git(['rev-parse', 'HEAD']), 'HEAD', {
    mode: 'light',
  });
  assert.equal(partialTautology.ok, false);
  assert.match(partialTautology.reason, /pass on the parent source: scripts\/second\.test\.mjs/);

  write(
    'scripts/second.test.mjs',
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { b } from '../apps/server/src/feature.mjs';\ntest('real second', () => { assert.equal(b, 'new'); });\n",
  );
  git(['add', 'scripts/second.test.mjs']);
  git(['commit', '--amend', '--no-edit']);
  const bothReal = evaluatePlanCommit(dir, git(['rev-parse', 'HEAD']), 'HEAD', { mode: 'light' });
  assert.equal(bothReal.ok, true);
});

test('evaluatePlanRange checks each commit against its own plan and rejects head-tampered plans', (t) => {
  const { dir, git, write } = initTempRepo(t);
  write('apps/server/src/feature.mjs', 'export const a = "old";\nexport const b = "old";\n');
  git(['add', 'apps/server/src/feature.mjs']);
  git(['commit', '-m', 'base']);
  const base = git(['rev-parse', 'HEAD']);

  const makePlan = (secondStatus) => `# Multi Slice — plan, 2026-11-27
## User scenario
A new user exercises slice 1 first and slice 2 next without broken defaults.
## Scope
1. Implement slice 1 path a.
2. Implement slice 2 path b.
## Edge cases
| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Slice 1 path | Shows new a | scripts/first.test.mjs | this change |
| Slice 2 path | Shows new b | scripts/second.test.mjs | ${secondStatus} |
## Out of scope
- Extra panels.`;

  write('docs/design/multi-slice.md', sign(makePlan('later: slice 2')));
  write('apps/server/src/feature.mjs', 'export const a = "new";\nexport const b = "old";\n');
  write(
    'scripts/first.test.mjs',
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { a } from '../apps/server/src/feature.mjs';\ntest('slice 1', () => { assert.equal(a, 'new'); });\n",
  );
  git([
    'add',
    'docs/design/multi-slice.md',
    'apps/server/src/feature.mjs',
    'scripts/first.test.mjs',
  ]);
  git(['commit', '-m', 'feat(slice1): add a', '-m', 'Plan: docs/design/multi-slice.md']);

  write('docs/design/multi-slice.md', sign(makePlan('this change')));
  write('apps/server/src/feature.mjs', 'export const a = "new";\nexport const b = "new";\n');
  write(
    'scripts/first.test.mjs',
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { a, b } from '../apps/server/src/feature.mjs';\ntest('slice 1+2', () => { assert.equal(a + b, 'newnew'); });\n",
  );
  write(
    'scripts/second.test.mjs',
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { b } from '../apps/server/src/feature.mjs';\ntest('slice 2', () => { assert.equal(b, 'new'); });\n",
  );
  git([
    'add',
    'docs/design/multi-slice.md',
    'apps/server/src/feature.mjs',
    'scripts/first.test.mjs',
    'scripts/second.test.mjs',
  ]);
  git(['commit', '-m', 'feat(slice2): add b', '-m', 'Plan: docs/design/multi-slice.md']);
  const headB = git(['rev-parse', 'HEAD']);

  const rangePass = evaluatePlanRange({ cwd: dir, base, head: headB, mode: 'light' });
  assert.equal(
    rangePass.every((r) => r.ok),
    true,
  );

  write(
    'docs/design/multi-slice.md',
    sign(makePlan('this change')).replace('Shows new b', 'Tampered'),
  );
  git(['add', 'docs/design/multi-slice.md']);
  git(['commit', '-m', 'docs(slice2): tamper plan']);
  const headC = git(['rev-parse', 'HEAD']);
  const rangeTampered = evaluatePlanRange({ cwd: dir, base, head: headC, mode: 'static' });
  assert.equal(
    rangeTampered.some((r) => !r.ok),
    true,
  );
  assert.match(
    rangeTampered
      .filter((r) => !r.ok)
      .map((r) => r.reason)
      .join('; '),
    /Plan-SHA256 mismatch/,
  );
});
