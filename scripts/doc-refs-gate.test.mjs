import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { anchorsOf, collectViolations, slugify } from './doc-refs-gate.mjs';
import { testGitEnv } from './test-git-env.mjs';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

function fixture(files, docs) {
  const tracked = new Set(Object.keys(files));
  for (const f of Object.keys(files)) {
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) tracked.add(parts.slice(0, i).join('/'));
  }
  return { tracked, docs, readFile: (p) => files[p] ?? null };
}

test('slugify matches github heading anchors', () => {
  assert.equal(slugify('Debugging a turn or task'), 'debugging-a-turn-or-task');
  assert.equal(slugify('Evidence limits checklist'), 'evidence-limits-checklist');
  assert.equal(anchorsOf('# A\n# A\n## B!').has('a-1'), true);
});

test('a markdown link to a missing file is a violation; links, anchors and prefixes resolve', () => {
  const files = {
    'docs/a.md': '[x](b.md) [y](missing.md) [z](#section)',
    'docs/b.md': '# T',
    'docs/deep.md': '# Title\n## Section',
    'scripts/x.mjs': 'x',
  };
  const docs = ['docs/a.md', 'docs/b.md', 'docs/deep.md'];
  const rows = collectViolations(fixture(files, docs));
  assert.deepEqual(
    rows.map((r) => `${r.kind}:${r.ref}`),
    ['link:missing.md', 'anchor:#section'],
  );
});

test('backtick paths under a top-level dir must exist; unknown schemes and placeholders are skipped', () => {
  const files = {
    'docs/a.md':
      'run `node scripts/real.mjs` then `scripts/gone.mjs`; scheme [x](attachment:f/{id}.png); `<dir>/x.mjs` stays',
    'scripts/real.mjs': 'x',
  };
  const rows = collectViolations(fixture(files, ['docs/a.md']));
  assert.deepEqual(
    rows.map((r) => r.ref),
    ['`scripts/gone.mjs`'],
  );
});

test('paths resolve relative to the doc dir and to the skill root', () => {
  const files = {
    '.claude/skills/s/SKILL.md': 'see `scripts/drive-x.mjs` and `features/y.md`',
    '.claude/skills/s/scripts/drive-x.mjs': 'x',
    '.claude/skills/s/features/y.md': '# y',
  };
  const rows = collectViolations(fixture(files, ['.claude/skills/s/SKILL.md']));
  assert.deepEqual(rows, []);
});

test('another file with the same prefix does not satisfy a reference', () => {
  const files = {
    'docs/a.md': 'Use `scripts/gone.mjs` and inspect `scripts/`.',
    'scripts/gone.mjs.test': 'x',
  };
  assert.deepEqual(
    collectViolations(fixture(files, ['docs/a.md'])).map((row) => row.ref),
    ['`scripts/gone.mjs`'],
  );
});

test('a scope line listing path prefixes resolves by prefix', () => {
  const files = {
    'docs/surfaces/s.md': 'Scope: `apps/web/src/board/home-c`',
    'apps/web/src/board/home-compact.tsx': 'x',
  };
  const rows = collectViolations(fixture(files, ['docs/surfaces/s.md']));
  assert.deepEqual(rows, []);
});

test('markdown links inside code fences are not checked', () => {
  const files = { 'docs/a.md': '```\n[example](not-an-actual-file.md)\n```\n' };
  const rows = collectViolations(fixture(files, ['docs/a.md']));
  assert.deepEqual(rows, []);
});

test('a markdown link must match a tracked path exactly, not by prefix', () => {
  const files = {
    'docs/a.md': '[x](../scripts/doc-refs-gate) [y](../scripts/doc-refs-gate.mjs)',
    'scripts/doc-refs-gate.mjs': 'x',
  };
  const rows = collectViolations(fixture(files, ['docs/a.md']));
  assert.deepEqual(
    rows.map((r) => `${r.kind}:${r.ref}`),
    ['link:../scripts/doc-refs-gate'],
  );
});

test('a backtick path#anchor verifies the anchor in the target doc', () => {
  const files = {
    'docs/a.md': 'see `docs/b.md#real-anchor` and `docs/b.md#gone`',
    'docs/b.md': '# T\n## Real anchor',
  };
  const rows = collectViolations(fixture(files, ['docs/a.md', 'docs/b.md']));
  assert.deepEqual(
    rows.map((r) => `${r.kind}:${r.ref}`),
    ['anchor:`docs/b.md#gone`'],
  );
});

const GATE_MODULES = [
  'doc-refs-gate.mjs',
  'doc-retired-terms-gate.mjs',
  'living-docs.mjs',
  'diff-base.mjs',
  'scrub-git-env.mjs',
];
const BASELINE = 'scripts/doc-refs-baseline.json';
const KNOWN = 'docs/spec/a.md|path|`scripts/old.mjs`';
const SPEC =
  'See `scripts/old.mjs`.\nThe volume states one rule here.\nAnd a second rule below it.\n';
const BROKEN = 'Run `scripts/gone.mjs`.\n';

function repo(t) {
  const sandbox = makeTestTempDir('doc-refs-');
  t.after(() => releaseTestTempDir(sandbox));
  const root = realpathSync(sandbox);
  const env = { ...testGitEnv(), PREPUSH_BASE_SHA: 'HEAD' };
  const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' });
  const write = (tree) => {
    for (const [path, text] of Object.entries(tree)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    git('add', '-A');
  };
  const baseline = (...rows) => ({ [BASELINE]: JSON.stringify({ rows }) });
  const rows = () => JSON.parse(readFileSync(join(root, BASELINE), 'utf8')).rows;
  const run = (...args) =>
    spawnSync(process.execPath, [join(root, 'scripts/doc-refs-gate.mjs'), ...args], {
      cwd: root,
      env,
      encoding: 'utf8',
    });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  mkdirSync(join(root, 'scripts'));
  for (const file of GATE_MODULES)
    copyFileSync(join(import.meta.dirname, file), join(root, 'scripts', file));
  write({
    'docs/spec/a.md': SPEC,
    'docs/design/surfaces/s.md': '## Rules\nA rule.\n',
    ...baseline(KNOWN),
  });
  git('commit', '-q', '-m', 'base');
  assert.equal(run().status, 0, run().stderr);
  return { root, env, git, write, baseline, rows, run };
}

test('a record may carry a broken reference, and --report still lists it', (t) => {
  const r = repo(t);
  r.write({
    'docs/design/plan.md': BROKEN,
    '.claude/skills/s/references/x.md': BROKEN,
  });
  assert.equal(r.run().status, 0, r.run().stderr);
  assert.match(r.run('--report').stdout, /docs\/design\/plan\.md:1 path `scripts\/gone\.mjs`/);
});

for (const [name, path, text] of [
  ['a spec volume', 'docs/spec/b.md', BROKEN],
  ['a landing design doc that is living', 'docs/design/tested-sha-landing.md', BROKEN],
  ['a surface Rules row', 'docs/design/surfaces/s.md', `## Rules\n${BROKEN}`],
  [
    'a surface file outside Rules',
    'docs/design/surfaces/s.md',
    `## Rules\nA rule.\n## Notes\n${BROKEN}`,
  ],
  ['a package readme', 'packages/x/README.md', BROKEN],
]) {
  test(`a new broken reference is red in ${name}`, (t) => {
    const r = repo(t);
    r.write({ [path]: text });
    assert.equal(r.run().status, 1);
  });

  test(`a baseline row cannot admit it in ${name}`, (t) => {
    const r = repo(t);
    r.write({ [path]: text, ...r.baseline(KNOWN, `${path}|path|\`scripts/gone.mjs\``) });
    const result = r.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /baseline grew/);
  });

  test(`--write-baseline refuses to add it for ${name}`, (t) => {
    const r = repo(t);
    r.write({ [path]: text });
    const result = r.run('--write-baseline');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /refuses to grow/);
    assert.deepEqual(r.rows(), [KNOWN]);
  });
}

test('--write-baseline drops resolved rows and never records a record', (t) => {
  const r = repo(t);
  r.write({ 'docs/spec/a.md': 'Fixed.\n', 'docs/design/plan.md': BROKEN });
  assert.equal(r.run('--write-baseline').status, 0);
  assert.deepEqual(r.rows(), []);
});

test('a record row the base commit already holds blocks nobody', (t) => {
  const r = repo(t);
  r.write({
    'docs/design/plan.md': BROKEN,
    ...r.baseline(KNOWN, 'docs/design/plan.md|path|`scripts/gone.mjs`'),
  });
  r.git('commit', '-q', '-m', 'inherited record row');
  assert.equal(r.run().status, 0, r.run().stderr);
});

for (const [name, tree, row] of [
  ['a living doc before its reference breaks', {}, 'docs/spec/a.md|path|`scripts/gone.mjs`'],
  [
    'a record that could later be promoted',
    { 'docs/design/plan.md': BROKEN },
    'docs/design/plan.md|path|`scripts/gone.mjs`',
  ],
]) {
  test(`a baseline row cannot be planted for ${name}`, (t) => {
    const r = repo(t);
    r.write({ ...tree, ...r.baseline(KNOWN, row) });
    const result = r.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /baseline grew/);
  });
}

test('the root changelog is a record', (t) => {
  const r = repo(t);
  r.write({ 'CHANGELOG.md': BROKEN });
  assert.equal(r.run().status, 0, r.run().stderr);
});

test('a renamed living doc carries its baselined row', (t) => {
  const r = repo(t);
  r.git('mv', 'docs/spec/a.md', 'docs/spec/renamed.md');
  r.write({});
  assert.equal(r.run('--write-baseline').status, 0, r.run('--write-baseline').stderr);
  assert.deepEqual(r.rows(), [KNOWN.replace('a.md', 'renamed.md')]);
  assert.equal(r.run().status, 0, r.run().stderr);
  assert.equal(r.run('--write-baseline').status, 0);
});

test('moving a living doc into a record folder does not hide a reference it breaks', (t) => {
  const r = repo(t);
  r.git('mv', 'docs/spec/a.md', 'docs/design/a.md');
  r.write({ 'docs/design/a.md': `${SPEC}${BROKEN}` });
  const result = r.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/design\/a\.md:4 path does not resolve/);
});

test('archiving a living doc as it is stays green, then it is a record', (t) => {
  const r = repo(t);
  r.git('mv', 'docs/spec/a.md', 'docs/design/a.md');
  r.write(r.baseline(KNOWN.replace('docs/spec/', 'docs/design/')));
  assert.equal(r.run().status, 0, r.run().stderr);
  r.git('commit', '-q', '-m', 'archive');
  r.write({ 'docs/design/a.md': `${SPEC}${BROKEN}` });
  assert.equal(r.run().status, 0, r.run().stderr);
});

test('a surface file stays judged when a heading added above a rule', (t) => {
  const r = repo(t);
  r.write({ 'docs/design/surfaces/s.md': `## Rules\n## Notes\nA rule.\n${BROKEN}` });
  assert.equal(r.run().status, 1);
});

test('a surface file stays judged when the Rules heading is renamed', (t) => {
  const r = repo(t);
  r.write({ 'docs/design/surfaces/s.md': `## Rules (current)\n${BROKEN}` });
  assert.equal(r.run().status, 1);
});

test('a surface file stays judged when the table moves under another heading', (t) => {
  const r = repo(t);
  r.write({ 'docs/design/surfaces/s.md': `## Rules\n## Rule table\n${BROKEN}` });
  assert.equal(r.run().status, 1);
});

test('moving a living doc into docs/research does not hide a reference it breaks', (t) => {
  const r = repo(t);
  mkdirSync(join(r.root, 'docs/research'), { recursive: true });
  r.git('mv', 'docs/spec/a.md', 'docs/research/a.md');
  r.write({ 'docs/research/a.md': `${SPEC}${BROKEN}` });
  const result = r.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/research\/a\.md:4 path does not resolve/);
});

test('moving a living doc into docs/lessons does not hide a reference it breaks', (t) => {
  const r = repo(t);
  mkdirSync(join(r.root, 'docs/lessons'), { recursive: true });
  r.git('mv', 'docs/spec/a.md', 'docs/lessons/a.md');
  r.write({ 'docs/lessons/a.md': `${SPEC}${BROKEN}` });
  const result = r.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/lessons\/a\.md:4 path does not resolve/);
});

test('moving a living doc into docs/ops/archive does not hide a reference it breaks', (t) => {
  const r = repo(t);
  mkdirSync(join(r.root, 'docs/ops/archive'), { recursive: true });
  r.git('mv', 'docs/spec/a.md', 'docs/ops/archive/a.md');
  r.write({ 'docs/ops/archive/a.md': `${SPEC}${BROKEN}` });
  const result = r.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/ops\/archive\/a\.md:4 path does not resolve/);
});

test('moving a judged document outside the living list does not hide a reference it breaks', (t) => {
  const r = repo(t);
  r.write({ 'packages/x/README.md': SPEC.replace('`scripts/old.mjs`', 'the package') });
  r.git('commit', '-q', '-m', 'package readme');
  mkdirSync(join(r.root, 'docs/research'), { recursive: true });
  r.git('mv', 'packages/x/README.md', 'docs/research/x.md');
  r.write({
    'docs/research/x.md': `${SPEC.replace('`scripts/old.mjs`', 'the package')}${BROKEN}`,
  });
  const result = r.run();
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /docs\/research\/x\.md:\d+ path does not resolve: `scripts\/gone\.mjs`/,
  );
});

test('without a base commit a reference missing from the baseline is still red', (t) => {
  const r = repo(t);
  r.env.PREPUSH_BASE_SHA = '0'.repeat(40);
  assert.equal(r.run().status, 0, r.run().stderr);
  r.write({ 'docs/spec/b.md': BROKEN });
  const result = r.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/spec\/b\.md:1 path does not resolve: `scripts\/gone\.mjs`/);
});

function archive(t) {
  const r = repo(t);
  r.env.PREPUSH_BASE_SHA = r.git('rev-parse', 'HEAD').toString().trim();
  const commit = (message, text) => {
    if (text) r.write({ 'docs/research/a.md': text });
    r.git('commit', '-q', '-m', message);
  };
  mkdirSync(join(r.root, 'docs/research'), { recursive: true });
  r.git('mv', 'docs/spec/a.md', 'docs/research/a.md');
  r.write(r.baseline(KNOWN.replace('docs/spec/', 'docs/research/')));
  return { ...r, commit };
}

test('a later queued commit may edit a record that an earlier one archived', (t) => {
  const r = archive(t);
  r.commit('lane a archives the volume');
  r.commit('lane b appends to the record', `${SPEC}${BROKEN}`);
  assert.equal(r.run().status, 0, r.run().stderr);
});

test('a reference the moving commit breaks stays red under later commits', (t) => {
  const r = archive(t);
  r.commit('archive and edit', `${SPEC}${BROKEN}`);
  r.write({ 'docs/spec/other.md': 'Nothing to see.\n' });
  r.commit('unrelated');
  const result = r.run();
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /docs\/research\/a\.md:4 path does not resolve: `scripts\/gone\.mjs`/,
  );
});

test('archiving again after a revert is judged as of the latest move', (t) => {
  const r = archive(t);
  r.commit('archive');
  r.git('mv', 'docs/research/a.md', 'docs/spec/a.md');
  r.commit('revert the archive');
  r.git('mv', 'docs/spec/a.md', 'docs/research/a.md');
  r.commit('archive again and edit', `${SPEC}${BROKEN}`);
  const result = r.run();
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /docs\/research\/a\.md:4 path does not resolve: `scripts\/gone\.mjs`/,
  );
});

test('a reference the moving commit breaks and a later commit repairs is green', (t) => {
  const r = archive(t);
  r.commit('archive and edit', `${SPEC}${BROKEN}`);
  r.commit('repair', SPEC);
  assert.equal(r.run().status, 0, r.run().stderr);
});

test('--report marks which broken references sit in records', (t) => {
  const r = repo(t);
  r.write({ 'docs/design/plan.md': BROKEN });
  const out = r.run('--report').stdout;
  assert.match(out, /docs\/design\/plan\.md:1 path `scripts\/gone\.mjs` \(record, leave it\)/);
  assert.match(out, /docs\/spec\/a\.md:1 path `scripts\/old\.mjs`\n/);
});
