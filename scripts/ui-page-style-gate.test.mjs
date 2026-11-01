import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ARTIFACT_PATTERN, baselineNameFor, pickBaselines } from './gallery-snapshots-accept.mjs';
import { scanSource, scanTree, selfCheck } from './ui-page-style-gate.mjs';

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'ui-page-style-'));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

test('the matcher passes its own canaries', () => {
  assert.deepEqual(selfCheck(), []);
});

test('a page that hard-codes a palette colour and inline type is reported with its line', () => {
  const hits = scanSource(
    'const a = 1;\n<div className="text-red-500" style={{ fontSize: 13 }} />',
  );
  assert.deepEqual(
    hits.map((h) => [h.rule, h.line]),
    [
      ['palette-color', 2],
      ['inline-type', 2],
    ],
  );
});

test('gallery, registry, icons and fixtures are exempt; pages are not', () => {
  const root = tree({
    'design/gallery.tsx': '<div className="bg-[#fff]" />',
    'components/ui/button.tsx': '<div className="bg-[color-mix(in_oklch,var(--a),white_5%)]" />',
    'icons/Logo.tsx': '<path fill="#D97757" />',
    'fixtures/data.ts': "export const c = { color: '#333' };",
    'pages/home.tsx': '<path fill="#123456" />',
    'board/card.tsx': '<div className="text-(--text-secondary) bg-card" />',
  });
  assert.deepEqual(
    scanTree(root).map((f) => [f.file, f.rule]),
    [['pages/home.tsx', 'color-literal']],
  );
});

test('accept maps CI renders onto Linux baseline names', () => {
  assert.equal(
    baselineNameFor('/x/test-results/gallery-snapshots-every-light/wait-pill-light-actual.png'),
    'wait-pill-light-linux.png',
  );
  assert.equal(
    baselineNameFor('/x/apps/web/e2e/gallery-snapshots.spec.ts-snapshots/sidebar-dark-linux.png'),
    'sidebar-dark-linux.png',
  );
  assert.equal(
    baselineNameFor('/x/test-results/gallery-snapshots-every-light/wait-pill-light-diff.png'),
    null,
  );
  assert.equal(baselineNameFor('/x/test-results/board-dnd/card-actual.png'), null);
});

test('a CI render wins over an uploaded old baseline, and two different renders are refused', () => {
  const old = '/x/shard-3/e2e/gallery-snapshots.spec.ts-snapshots/sidebar-dark-linux.png';
  const fresh = '/x/shard-2/test-results/gallery-snapshots-every-dark/sidebar-dark-actual.png';
  const bytes = {
    [old]: 'old',
    [fresh]: 'new',
    '/x/shard-4/test-results/gallery-snapshots-b/sidebar-dark-actual.png': 'other',
  };
  const read = (file) => Buffer.from(bytes[file]);
  assert.equal(pickBaselines([fresh, old], read).get('sidebar-dark-linux.png'), fresh);
  assert.equal(pickBaselines([old, fresh], read).get('sidebar-dark-linux.png'), fresh);
  assert.throws(
    () =>
      pickBaselines(
        [fresh, '/x/shard-4/test-results/gallery-snapshots-b/sidebar-dark-actual.png'],
        read,
      ),
    /two different CI renders/,
  );
});

test('accept downloads every gallery snapshot artifact CI uploads', () => {
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const names = [...ci.matchAll(/name: (gallery-snapshots[\w${}.-]*)/g)].map((m) => m[1]);
  assert.ok(names.length >= 2, `found ${names.join(', ')}`);
  const glob = new RegExp(`^${ARTIFACT_PATTERN.replaceAll('*', '.*')}$`);
  for (const name of names) assert.match(name.replace(/\$\{\{[^}]*\}\}/g, '1'), glob);
});
