import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anchorsOf, collectViolations, slugify } from './doc-refs-gate.mjs';

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
