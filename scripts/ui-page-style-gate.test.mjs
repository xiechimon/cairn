import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { baselineNameFor } from './gallery-snapshots-accept.mjs';
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
