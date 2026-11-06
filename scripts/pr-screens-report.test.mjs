import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  classify,
  collectDiffImages,
  diffAxe,
  failedCompareFiles,
  render,
  totals,
} from './pr-screens-report.mjs';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

const results = {
  suites: [
    {
      specs: [
        { title: 'compare: a-dark.png', ok: false },
        { title: 'compare: b-dark.png', ok: true },
        { title: 'compare: new-dark.png', ok: false },
      ],
    },
  ],
};

test('failed compare titles become file names', () => {
  assert.deepEqual([...failedCompareFiles(results)].sort(), ['a-dark.png', 'new-dark.png']);
});

test('a failed compare with a base image is changed, without one it is new, base-only is removed', () => {
  const classes = classify(
    ['a-dark.png', 'b-dark.png', 'gone-dark.png'],
    ['a-dark.png', 'b-dark.png', 'new-dark.png'],
    failedCompareFiles(results),
  );
  assert.deepEqual(classes, {
    changed: ['a-dark.png'],
    added: ['new-dark.png'],
    removed: ['gone-dark.png'],
    unchanged: 1,
  });
});

test('axe diff reports new and fixed rules only for pages rendered on both sides', () => {
  const base = new Map([
    ['p-dark', [{ rule: 'color-contrast', impact: 'serious', nodes: 2 }]],
    ['q-dark', []],
  ]);
  const head = new Map([
    ['p-dark', [{ rule: 'label', impact: 'critical', nodes: 1 }]],
    ['q-dark', [{ rule: 'region', impact: 'moderate', nodes: 1 }]],
    ['only-head-dark', [{ rule: 'label', impact: 'critical', nodes: 1 }]],
  ]);
  const { added, fixed } = diffAxe(base, head);
  assert.deepEqual(
    added.map((v) => `${v.page}:${v.rule}`),
    ['p-dark:label', 'q-dark:region'],
  );
  assert.deepEqual(
    fixed.map((v) => `${v.page}:${v.rule}`),
    ['p-dark:color-contrast'],
  );
  assert.deepEqual(totals(head), { critical: 2, serious: 0, moderate: 1, minor: 0 });
});

test('the report names counts, changed pages, axe additions and job time', () => {
  const text = render({
    classes: { changed: ['a-dark.png'], added: [], removed: [], unchanged: 5 },
    axeDiff: {
      added: [{ page: 'a-dark', rule: 'label', impact: 'critical', nodes: 1 }],
      fixed: [],
    },
    baseTotals: totals(new Map()),
    headTotals: totals(new Map([['a-dark', [{ rule: 'label', impact: 'critical', nodes: 1 }]]])),
    headErrors: [],
    baseErrors: [],
    durations: { head: 119.6 },
  });
  assert.match(text, /1 changed, 0 new, 0 removed, 5 unchanged\. Job time: head 120s\./);
  assert.match(text, /\| a-dark \| changed \|/);
  assert.match(text, /head 1 critical/);
  assert.match(text, /\| a-dark \| label \| critical \| 1 \|/);
});

test('changed pages render inline as images from the asset base, capped, with the selection line', () => {
  const changed = Array.from({ length: 10 }, (_, i) => `p${i}-dark.png`);
  const text = render({
    classes: { changed, added: [], removed: [], unchanged: 0 },
    axeDiff: { added: [], fixed: [] },
    baseTotals: totals(new Map()),
    headTotals: totals(new Map()),
    headErrors: [],
    baseErrors: [],
    assetBase: 'https://raw.githubusercontent.com/o/r/abc/screens',
    selection: { all: false, count: 10, total: 44 },
  });
  assert.match(
    text,
    /Audited 10 of 44 pages \(only the routes this diff touches\); baseline is the merge base on main\./,
  );
  assert.match(
    text,
    /<img src="https:\/\/raw\.githubusercontent\.com\/o\/r\/abc\/screens\/p0-dark\.base\.png" width="320"/,
  );
  assert.match(text, /p7-dark\.diff\.png/);
  assert.doesNotMatch(text, /p8-dark\.diff\.png/);
  assert.match(text, /2 more changed pages are in the artifact\./);
});

test('changed pages are copied with base, head and the Playwright diff', () => {
  const dir = makeTestTempDir('pr-screens-');
  try {
    for (const sub of ['base', 'head', 'results/x']) mkdirSync(join(dir, sub), { recursive: true });
    writeFileSync(join(dir, 'base/a-dark.png'), 'b');
    writeFileSync(join(dir, 'head/a-dark.png'), 'h');
    writeFileSync(join(dir, 'results/x/a-dark-diff.png'), 'd');
    collectDiffImages(
      join(dir, 'results'),
      join(dir, 'out'),
      { changed: ['a-dark.png'], added: [] },
      join(dir, 'head'),
      join(dir, 'base'),
    );
    assert.equal(readFileSync(join(dir, 'out/a-dark.base.png'), 'utf8'), 'b');
    assert.equal(readFileSync(join(dir, 'out/a-dark.head.png'), 'utf8'), 'h');
    assert.equal(readFileSync(join(dir, 'out/a-dark.diff.png'), 'utf8'), 'd');
  } finally {
    releaseTestTempDir(dir);
  }
});
