import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  classifyCommit,
  computePlanHash,
  evaluatePlanCommit,
  isValidPlanPath,
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
| Edge case | What the user sees | Proving test |
|---|---|---|
| Selected offline | Chip keeps offline dot and queued label | apps/web/e2e/add.spec.ts |
| Unknown machine | Error toast keeps text | apps/server/test/todo.test.ts |
## Out of scope
- Adding a machine selector to the Coordinator chat composer.`;
const sign = (body = BODY) =>
  `${body}\n\n## Review\n\n- Verdict: PASS\n- Plan-SHA256: ${computePlanHash(body)}\n- Reviewer: fresh-opus\n- Findings: 0 blocking\n`;

test('red-first replay: missed-edge feat fails without plan; docs-only control passes', () => {
  const missed = evaluatePlanCommit(REPO, '8714d08efd3f1170577fd14777d73d558e728c29');
  assert.equal(missed.ok, false);
  assert.match(missed.reason, /Plan: docs\/design\/<slug>\.md/);
  const clean = evaluatePlanCommit(REPO, '596034c5f2a385b6fbaa9ddfcc786e378050e92f');
  assert.equal(clean.ok, true);
  assert.equal(clean.skipped, 'no product runtime change');
});

test('temp repo passes with hash-verified plan and fails when edited without re-review', () => {
  const dir = makeTestTempDir('plan-gate-');
  const opt = { cwd: dir, encoding: 'utf8' };
  const git = (a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@e', ...a], opt);
  const run = (a) => spawnSync(process.execPath, [CLI, ...a], opt);
  try {
    git(['init', '-b', 'main']);
    writeFileSync(join(dir, 'README.md'), 'init\n');
    git(['add', 'README.md']);
    git(['commit', '-m', 'init']);
    git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    const plan = sign();
    assert.equal(computePlanHash(plan), computePlanHash(BODY));
    mkdirSync(join(dir, 'docs/design'), { recursive: true });
    mkdirSync(join(dir, 'apps/web/src'), { recursive: true });
    writeFileSync(join(dir, 'docs/design/sample.md'), plan);
    writeFileSync(join(dir, 'apps/web/src/sample.ts'), 'export const s = 1;\n');
    git(['add', 'docs/design/sample.md', 'apps/web/src/sample.ts']);
    git(['commit', '-m', 'feat(sample): add behavior', '-m', 'Plan: docs/design/sample.md']);
    assert.equal(run([]).status, 0);
    assert.equal(run(['--hash', 'docs/design/sample.md']).stdout.trim(), computePlanHash(BODY));
    assert.equal(run(['--check-file', 'docs/design/sample.md']).status, 0);
    const edit = plan.replace('Unknown machine', 'Edited edge');
    writeFileSync(join(dir, 'docs/design/sample.md'), edit);
    git(['add', 'docs/design/sample.md']);
    git(['commit', '-m', 'docs(sample): edit without re-hash']);
    const tampered = run([]);
    assert.equal(tampered.status, 1);
    assert.match(tampered.stderr, /Plan-SHA256 mismatch/);
  } finally {
    releaseTestTempDir(dir);
  }
});

test('hollow satisfiers, invalid paths, classifier tiers, and missing merge-base fail closed', () => {
  const valid = sign();
  assert.equal(validatePlanContent(valid).ok, true);
  const bad = [
    ['A new user opens the task panel, picks a computer, and sees tasks wait for it.', 'TODO'],
    ['1. Show', '- Show'],
    ['| Unknown machine | Error toast keeps text | apps/server/test/todo.test.ts |', ''],
    ['Unknown machine', 'TBD'],
    ['- Adding a machine selector to the Coordinator chat composer.', ''],
    ['Verdict: PASS', 'Verdict: FAIL'],
    ['fresh-opus', '<reviewer>'],
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
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    assert.equal(spawnSync(process.execPath, [CLI], { cwd: dir }).status, 2);
  } finally {
    releaseTestTempDir(dir);
  }
});
