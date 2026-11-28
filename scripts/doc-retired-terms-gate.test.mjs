import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { checkRepo, nextBaseline, REGISTRY_REL, renamesSince } from './doc-retired-terms-gate.mjs';
import { testGitEnv } from './test-git-env.mjs';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

const term = {
  id: 'manual-queue',
  pattern: 'queue/main',
  canary: 'git push origin HEAD:queue/main',
  reason: 'the speculative queue replaced it',
};

function repo(t, files, registry) {
  const sandbox = makeTestTempDir('retired-terms-');
  t.after(() => releaseTestTempDir(sandbox));
  const root = realpathSync(sandbox);
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, env: testGitEnv(), stdio: 'pipe' });
  const write = (tree) => {
    for (const [path, text] of Object.entries(tree)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), typeof text === 'string' ? text : JSON.stringify(text));
    }
    git('add', '-A');
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  write({ ...files, [REGISTRY_REL]: registry });
  git('commit', '-q', '-m', 'base');
  return { root, git, write, check: () => checkRepo(root, 'HEAD').failures.join('\n') };
}

const base = { 'docs/ops/a.md': 'Never push queue/main.\n', 'docs/research/r.md': 'x\n' };
const registry = { terms: [term], baseline: { 'manual-queue': { 'docs/ops/a.md': 1 } } };

test('a new mention in a living doc is red, a record may keep naming it', (t) => {
  const r = repo(t, base, registry);
  r.write({
    'docs/research/r.md': 'queue/main queue/main\n',
    'docs/design/old-plan.md': 'queue/main\n',
    'docs/design/surfaces/s.md': '## History\nqueue/main\n## Rules\n| A1 | fine |\n',
  });
  assert.equal(r.check(), '');
  r.write({ 'docs/design/surfaces/s.md': '## Rules\n| A1 | queue/main |\n' });
  assert.match(r.check(), /surfaces\/s\.md has 1/);
  r.write({ 'docs/spec/b.md': 'Land through queue/main.\n' });
  assert.match(r.check(), /docs\/spec\/b\.md.*manual-queue/);
});

test('raising the committed count does not admit a mention', (t) => {
  const r = repo(t, base, registry);
  r.write({
    'docs/ops/a.md': 'Never push queue/main. Or queue/main.\n',
    [REGISTRY_REL]: { terms: [term], baseline: { 'manual-queue': { 'docs/ops/a.md': 2 } } },
  });
  assert.match(r.check(), /baseline grew/);
  assert.match(r.check(), /docs\/ops\/a\.md has 2/);
});

test('a removed mention cannot come back even while the committed count is slack', (t) => {
  const r = repo(t, base, registry);
  r.write({ 'docs/ops/a.md': 'Nothing here.\n' });
  assert.equal(r.check(), '');
  r.git('commit', '-q', '-m', 'remove');
  r.write(base);
  assert.match(r.check(), /docs\/ops\/a\.md has 1/);
});

test('renaming a living doc carries its count and still refuses growth', (t) => {
  const r = repo(t, base, registry);
  r.git('mv', 'docs/ops/a.md', 'docs/ops/renamed.md');
  r.write({
    [REGISTRY_REL]: { terms: [term], baseline: { 'manual-queue': { 'docs/ops/renamed.md': 1 } } },
  });
  assert.equal(r.check(), '');
  r.write({ 'docs/ops/renamed.md': 'Never push queue/main. Or queue/main.\n' });
  assert.match(r.check(), /renamed\.md has 2/);
});

const body = (word) => Array.from({ length: 20 }, (_, i) => `${word} line ${i}`).join('\n');

test('a rename and a later rewrite stacked on one base keep the carried count', (t) => {
  const r = repo(t, { 'docs/ops/a.md': `Never push queue/main.\n${body('old')}\n` }, registry);
  const from = r.git('rev-parse', 'HEAD').toString().trim();
  const moved = { terms: [term], baseline: { 'manual-queue': { 'docs/ops/b.md': 1 } } };
  r.git('mv', 'docs/ops/a.md', 'docs/ops/b.md');
  r.write({ [REGISTRY_REL]: moved });
  r.git('commit', '-q', '-m', 'rename');
  r.write({ 'docs/ops/b.md': `Never push queue/main.\n${body('new')}\n` });
  r.git('commit', '-q', '-m', 'rewrite');
  assert.equal(checkRepo(r.root, from).failures.join('\n'), '');
  const written = nextBaseline(
    moved,
    new Map([['manual-queue', new Map([['docs/ops/b.md', 1]])]]),
    renamesSince(r.root, from),
  );
  assert.deepEqual(written.baseline, moved.baseline);
});

test('a path re-created after its rename cannot hand its count to both files', (t) => {
  const r = repo(t, base, registry);
  const from = r.git('rev-parse', 'HEAD').toString().trim();
  r.git('mv', 'docs/ops/a.md', 'docs/ops/b.md');
  r.git('commit', '-q', '-m', 'rename');
  r.write({
    'docs/ops/a.md': 'Never push queue/main.\n',
    [REGISTRY_REL]: {
      terms: [term],
      baseline: { 'manual-queue': { 'docs/ops/a.md': 1, 'docs/ops/b.md': 1 } },
    },
  });
  assert.match(checkRepo(r.root, from).failures.join('\n'), /b\.md has 1/);
});

test('a heading inside a code fence does not end the Rules section', (t) => {
  const r = repo(t, base, registry);
  r.write({ 'docs/design/surfaces/s.md': '## Rules\n```\n## Example\n```\n| A1 | queue/main |\n' });
  assert.match(r.check(), /surfaces\/s\.md has 1/);
});

test('record folder names only exempt files inside project skills', (t) => {
  const r = repo(t, base, registry);
  r.write({ '.claude/skills/x/references/y.md': 'queue/main\n' });
  assert.equal(r.check(), '');
  r.write({ 'docs/spec/archive/old.md': 'queue/main\n' });
  assert.match(r.check(), /docs\/spec\/archive\/old\.md has 1/);
});

test('dropping or loosening a term does not admit a mention in the same change', (t) => {
  const r = repo(t, base, registry);
  r.write({
    'docs/ops/b.md': 'Use queue/main.\n',
    [REGISTRY_REL]: {
      terms: [{ ...term, pattern: 'queue/mainline', canary: 'queue/mainline' }],
      baseline: {},
    },
  });
  assert.match(r.check(), /docs\/ops\/b\.md has 1/);
});

test('a retiring change registers a term with today counts and cannot add it elsewhere', (t) => {
  const r = repo(t, { 'docs/ops/a.md': 'old-tool runs.\n' }, registry);
  const added = { id: 'old-tool', pattern: 'old-tool', canary: 'old-tool', reason: 'removed' };
  r.write({
    [REGISTRY_REL]: {
      terms: [term, added],
      baseline: { 'old-tool': { 'docs/ops/a.md': 1 } },
    },
  });
  assert.equal(r.check(), '');
  r.write({ 'docs/ops/c.md': 'old-tool\n' });
  assert.match(r.check(), /docs\/ops\/c\.md has 1/);
});

for (const [name, hollow] of [
  ['no terms', []],
  ['a term whose pattern misses its own canary', [{ ...term, pattern: 'nothing-says-this' }]],
  ['a term that matches empty text', [{ ...term, pattern: 'x*' }]],
  ['a term with no reason', [{ ...term, reason: ' ' }]],
]) {
  test(`hollow registry is red: ${name}`, (t) => {
    const r = repo(t, base, registry);
    r.write({ [REGISTRY_REL]: { terms: hollow, baseline: registry.baseline } });
    assert.notEqual(r.check(), '');
  });
}

test('writing the baseline shrinks counts and refuses growth', () => {
  const old = { terms: [term], baseline: { 'manual-queue': { 'a.md': 2 } } };
  const counts = (n) => new Map([['manual-queue', new Map([['a.md', n]])]]);
  assert.deepEqual(nextBaseline(old, counts(1)).baseline, { 'manual-queue': { 'a.md': 1 } });
  assert.throws(() => nextBaseline(old, counts(3)), /refuses to grow/);
  const clean = nextBaseline(old, new Map()).baseline;
  assert.throws(() => nextBaseline({ terms: [term], baseline: clean }, counts(1)), /refuses/);
});

test('without a base commit the committed count is still the limit', (t) => {
  const r = repo(t, base, registry);
  assert.deepEqual(checkRepo(r.root, null).failures, []);
  r.write({ 'docs/ops/a.md': 'Never push queue/main. Or queue/main.\n' });
  assert.match(checkRepo(r.root, null).failures.join('\n'), /a\.md has 2 .* 1 allowed/);
});

test('scanning no living document at all is red', (t) => {
  const r = repo(
    t,
    { 'docs/research/r.md': 'x\n' },
    { terms: [term], baseline: { 'manual-queue': {} } },
  );
  assert.match(r.check(), /no living document found/);
});

test('the command CI runs fails on a mention the base commit does not have', (t) => {
  const r = repo(t, base, registry);
  mkdirSync(join(r.root, 'scripts'), { recursive: true });
  for (const file of [
    'doc-retired-terms-gate.mjs',
    'living-docs.mjs',
    'diff-base.mjs',
    'scrub-git-env.mjs',
  ])
    copyFileSync(join(import.meta.dirname, file), join(r.root, 'scripts', file));
  const run = () =>
    spawnSync(process.execPath, [join(r.root, 'scripts/doc-retired-terms-gate.mjs')], {
      env: { ...testGitEnv(), PREPUSH_BASE_SHA: 'HEAD' },
      encoding: 'utf8',
    });
  assert.match(run().stdout, /none new/);
  r.write({ 'docs/ops/b.md': 'queue/main\n' });
  assert.equal(run().status, 1);
  r.write({ 'docs/ops/b.md': 'Nothing.\n', 'docs/ops/a.md': 'Nothing.\n' });
  r.git('commit', '-q', '-m', 'remove');
  r.write({ 'docs/ops/a.md': base['docs/ops/a.md'] });
  const again = run();
  assert.equal(again.status, 1);
  assert.match(again.stderr, /docs\/ops\/a\.md has 1/);
});

test('retired plan re-review wording is rejected in living docs', (t) => {
  const committed = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '..', REGISTRY_REL), 'utf8'),
  );
  const planTerm = committed.terms.find((entry) => entry.id === 'plan-full-re-review');
  assert.ok(planTerm, 'registry must retire the old full re-review requirement');
  const r = repo(
    t,
    { 'docs/ops/a.md': 'Current guidance.\n' },
    { terms: [planTerm], baseline: {} },
  );
  r.write({
    'docs/ops/a.md':
      'Editing anything above `## Review` invalidates `Plan-SHA256` until re-reviewed.\n',
  });
  assert.match(r.check(), /docs\/ops\/a\.md.*plan-full-re-review/);
});

test('PASS-only plan instructions are retired without matching the current template', (t) => {
  const committed = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '..', REGISTRY_REL), 'utf8'),
  );
  const planTerm = committed.terms.find((entry) => entry.id === 'plan-pass-only');
  assert.ok(planTerm, 'registry must retire both old PASS-only instructions');
  const r = repo(
    t,
    { 'docs/ops/a.md': 'Current guidance.\n' },
    { terms: [planTerm], baseline: {} },
  );
  for (const wording of [
    'with `Verdict: PASS` and matching `Plan-SHA256` recorded',
    '(`Reviewer-Model` != `Author-Model`, `Verdict: PASS`, matching `Plan-SHA256`)',
  ]) {
    r.write({ 'docs/ops/a.md': `${wording}\n` });
    assert.match(r.check(), /plan-pass-only/);
  }
  r.write({ 'docs/ops/a.md': '- Verdict: PASS\n- Plan-SHA256: <hash>\n' });
  assert.equal(r.check(), '');
});

test('the committed registry keeps the four retired mechanisms', () => {
  const { terms } = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '..', REGISTRY_REL), 'utf8'),
  );
  for (const [id, sample] of [
    ['adr-number', 'ADR 0026'],
    ['adr-number', 'adr-0026'],
    ['adr-number', 'docs/adr/0021'],
    ['adr-number', 'Adr_0008'],
    ['pr-evidence-gate', 'pr-evidence'],
    ['manual-queue-main', 'HEAD:queue/main'],
    ['design-rules-file', 'DESIGN-RULES.md'],
  ])
    assert.match(sample, new RegExp(terms.find((entry) => entry.id === id).pattern), id);
});
