import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  classify,
  collectDiffImages,
  commonPages,
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

const violation = (rule, impact, targets) => ({ rule, impact, nodes: targets.length, targets });

test('axe diff compares rule and target node, so more nodes of an existing rule are new', () => {
  const base = new Map([['p-dark', [violation('color-contrast', 'serious', ['.a'])]]]);
  const head = new Map([
    ['p-dark', [violation('color-contrast', 'serious', ['.a', '.b', '.c', '.d'])]],
  ]);
  const { added, fixed } = diffAxe(base, head);
  assert.deepEqual(added, [
    { page: 'p-dark', rule: 'color-contrast', impact: 'serious', nodes: 3, target: '.b' },
  ]);
  assert.deepEqual(fixed, []);
  assert.deepEqual(totals(base), { critical: 0, serious: 1, moderate: 0, minor: 0 });
  assert.deepEqual(totals(head), { critical: 0, serious: 4, moderate: 0, minor: 0 });
});

test('the same node count on different nodes is one new and one fixed', () => {
  const base = new Map([['p-dark', [violation('label', 'critical', ['.a'])]]]);
  const head = new Map([['p-dark', [violation('label', 'critical', ['.b'])]]]);
  const { added, fixed } = diffAxe(base, head);
  assert.deepEqual(
    added.map((v) => `${v.rule}:${v.target}`),
    ['label:.b'],
  );
  assert.deepEqual(
    fixed.map((v) => `${v.rule}:${v.target}`),
    ['label:.a'],
  );
});

test('new and fixed rules are reported only for pages rendered on both sides', () => {
  const base = new Map([
    ['p-dark', [violation('color-contrast', 'serious', ['.a'])]],
    ['q-dark', []],
    ['only-base-dark', [violation('label', 'critical', ['.x'])]],
  ]);
  const head = new Map([
    ['p-dark', [violation('label', 'critical', ['.b'])]],
    ['q-dark', [violation('region', 'moderate', ['body'])]],
    ['only-head-dark', [violation('label', 'critical', ['.y'])]],
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
  const common = commonPages(base, head);
  assert.deepEqual([...common].sort(), ['p-dark', 'q-dark']);
  assert.deepEqual(totals(head, common), { critical: 1, serious: 0, moderate: 1, minor: 0 });
  assert.deepEqual(totals(base, common), { critical: 0, serious: 1, moderate: 0, minor: 0 });
});

test('the report names counts, changed pages, axe additions and job time', () => {
  const text = render({
    classes: { changed: ['a-dark.png'], added: [], removed: [], unchanged: 5 },
    axeDiff: {
      added: [{ page: 'a-dark', rule: 'label', impact: 'critical', nodes: 1, target: '.x' }],
      fixed: [],
    },
    baseTotals: totals(new Map()),
    headTotals: totals(new Map([['a-dark', [violation('label', 'critical', ['.x'])]]])),
    headErrors: [],
    baseErrors: [],
    durations: { head: 119.6 },
  });
  assert.match(
    text,
    /Screens \(page x theme\): 1 changed, 0 new, 0 removed, 5 unchanged\. Job time: head 120s\./,
  );
  assert.match(text, /\| a-dark \| changed \|/);
  assert.match(text, /head 1 critical/);
  assert.match(text, /\| a-dark \| label \| critical \| 1 \| `\.x` \|/);
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

test('the report says so when the two sides were installed from different lockfiles', () => {
  const input = {
    classes: { changed: [], added: [], removed: [], unchanged: 2 },
    axeDiff: { added: [], fixed: [] },
    baseTotals: totals(new Map()),
    headTotals: totals(new Map()),
    headErrors: [],
    baseErrors: [],
  };
  assert.match(
    render({ ...input, lockfilesDiffer: true }),
    /Dependencies differ: each side was installed from its own pnpm-lock\.yaml/,
  );
  assert.doesNotMatch(render({ ...input, lockfilesDiffer: false }), /Dependencies differ/);
});
