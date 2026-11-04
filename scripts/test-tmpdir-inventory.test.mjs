import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
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

test('every raw mkdtemp site in tracked test sources is listed in docs/verify/1951/inventory.md', () => {
  const expected = trackedAllocationSites(root).map(allocationKey).sort();
  const markdown = readFileSync(resolve(root, 'docs/verify/1951/inventory.md'), 'utf8');
  const actual = inventoryKeys(markdown).sort();
  assert.equal(
    new Set(actual).size,
    actual.length,
    'inventory contains duplicate allocation sites',
  );
  assert.deepEqual(actual, expected);
});
