import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';
import {
  allocationKey,
  inventoryKeys,
  rawAllocationSites,
  trackedAllocationSites,
} from './test-tmpdir-inventory.mjs';

const root = resolve(import.meta.dirname, '..');

for (const [name, source, expected] of [
  ['sync and async', 'RAW_SYNC("x"); await RAW_ASYNC("y");', 2],
  ['namespace forms', 'fs.RAW_SYNC("x"); await fsp.RAW_ASYNC("y");', 2],
  ['import alias', 'import { RAW_SYNC as mk } from "node:fs";\nmk("x");', 1],
  [
    'multiline import alias',
    'import {\nRAW_ASYNC as mk\n} from "node:fs/promises";\nawait mk("x");',
    1,
  ],
  ['destructured alias', 'const { RAW_SYNC: mk } = require("node:fs"); mk("x");', 1],
  ['assigned alias chain', 'const next = first; const first = fs.RAW_ASYNC; await next("x");', 1],
  ['bracket access', 'fs["RAW_SYNC"]("x");', 1],
  [
    'nonexecuting examples',
    '// RAW_SYNC("x")\nconst example = `RAW_ASYNC("y")`; const text = "RAW_SYNC(ignored)";',
    0,
  ],
  ['regular expression example', 'const example = /mkdtempSync\\(ignored/;', 0],
  ['template interpolation', 'const text = `ignored RAW_SYNC( $' + '{RAW_ASYNC("x")} tail`;', 1],
  ['regex alternatives', 'if (/rgba?\\(/.test(s) || /#[0-9a-f]{3,8}/i.test(s)) return true;', 0],
  ['allocation result is not a function alias', 'const path = RAW_SYNC("x"); path("y");', 1],
  [
    'object property is not a destructured alias',
    'const options = { RAW_SYNC: unrelated }; unrelated("x");',
    0,
  ],
  ['helper allocation', 'makeTestTempDir("x");', 0],
]) {
  test(`allocation inventory recognizes ${name}`, () => {
    assert.equal(
      rawAllocationSites(
        source.replaceAll('RAW_SYNC', 'mkdtempSync').replaceAll('RAW_ASYNC', 'mkdtemp'),
      ).length,
      expected,
    );
  });
}

test('allocation inventory preserves each call location on a shared line', () => {
  assert.deepEqual(
    rawAllocationSites(
      'RAW_ASYNC("a"); RAW_SYNC("b");'
        .replaceAll('RAW_SYNC', 'mkdtempSync')
        .replaceAll('RAW_ASYNC', 'mkdtemp'),
      'x.ts',
    ),
    [
      { file: 'x.ts', line: 1, column: 1, call: 'mkdtemp' },
      { file: 'x.ts', line: 1, column: 15, call: 'mkdtempSync' },
    ],
  );
});

test('every raw mkdtemp site at the documented snapshot is listed in scripts/test-tmpdir-inventory.md', () => {
  const markdown = readFileSync(resolve(root, 'scripts/test-tmpdir-inventory.md'), 'utf8');
  const revision = markdown.match(/^Snapshot: origin\/main ([a-f0-9]{40})\./m)?.[1];
  assert.ok(revision, 'inventory must name its full snapshot commit SHA');
  const expected = trackedAllocationSites(root, revision).map(allocationKey).sort();
  const actual = inventoryKeys(markdown).sort();
  assert.equal(
    new Set(actual).size,
    actual.length,
    'inventory contains duplicate allocation sites',
  );
  assert.deepEqual(actual, expected);
});

test('allocation snapshot reads committed sources despite staged and working tree changes', () => {
  const fixture = makeTestTempDir('inventory-snapshot-');
  try {
    const git = (...args) =>
      execFileSync('git', args, {
        cwd: fixture,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    git('init', '--quiet');
    mkdirSync(resolve(fixture, 'scripts'));
    const file = resolve(fixture, 'scripts/fixture.test.mjs');
    writeFileSync(file, 'RAW_SYNC("snapshot");'.replace('RAW_SYNC', 'mkdtempSync'));
    git('add', '--', 'scripts/fixture.test.mjs');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'snapshot',
    );
    const revision = git('rev-parse', 'HEAD').trim();
    writeFileSync(file, 'makeTestTempDir("migrated");');
    writeFileSync(
      resolve(fixture, 'scripts/new.test.mjs'),
      'RAW_SYNC("later");'.replace('RAW_SYNC', 'mkdtempSync'),
    );
    git('add', '--', 'scripts/new.test.mjs');
    assert.deepEqual(trackedAllocationSites(fixture, revision).map(allocationKey), [
      'scripts/fixture.test.mjs:1:1',
    ]);
    assert.deepEqual(trackedAllocationSites(fixture).map(allocationKey), [
      'scripts/new.test.mjs:1:1',
    ]);
    assert.throws(() =>
      trackedAllocationSites(fixture, '0000000000000000000000000000000000000000'),
    );
  } finally {
    releaseTestTempDir(fixture);
  }
});

test('eval CLI and harness allocations have function-level ownership rather than Vitest hooks', () => {
  const markdown = readFileSync(resolve(root, 'scripts/test-tmpdir-inventory.md'), 'utf8');
  const rows = markdown.split('\n').filter((line) => line.startsWith('| `integration/eval/'));
  assert.equal(rows.length, 8);
  for (const row of rows) {
    assert.doesNotMatch(row, /Vitest|onTestFinished|afterEach|afterAll/);
    assert.match(row, /finally|close|dispose/);
  }
});

test('live verification CLI allocation names stop and process-exit ownership rather than Vitest hooks', () => {
  const markdown = readFileSync(resolve(root, 'scripts/test-tmpdir-inventory.md'), 'utf8');
  const rows = markdown
    .split('\n')
    .filter((line) => line.includes('integration/verify/image-fallback-live.mts'));
  assert.equal(rows.length, 1);
  assert.doesNotMatch(rows[0], /Vitest|onTestFinished|afterEach|afterAll/);
  assert.match(rows[0], /stop\(\)/);
  assert.match(rows[0], /process-exit/);
});
