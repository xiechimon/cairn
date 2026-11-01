import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sizeFacts, sizeFactsLine } from './size-facts.mjs';

test('lines sum both columns and files count rows, binary rows count no lines', () => {
  assert.deepEqual(sizeFacts('3\t4\ta.ts\n-\t-\tb.png\n10\t0\tc.ts\n'), {
    lines: 17,
    files: 3,
    oversize: false,
  });
});

test('800 lines and 40 files are within limits, one more is oversize', () => {
  assert.equal(sizeFacts('400\t400\ta.ts\n').oversize, false);
  assert.equal(sizeFacts('400\t401\ta.ts\n').oversize, true);
  const rows = (n) => Array.from({ length: n }, (_, i) => `1\t0\tf${i}.ts\n`).join('');
  assert.equal(sizeFacts(rows(40)).oversize, false);
  assert.equal(sizeFacts(rows(41)).oversize, true);
});

test('an empty diff has no size', () => {
  assert.deepEqual(sizeFacts(''), { lines: 0, files: 0, oversize: false });
});

test('the oversize line asks for the explicit answer and the in-limit line does not', () => {
  const over = sizeFactsLine(sizeFacts('900\t0\ta.ts\n'));
  assert.match(over, /OVERSIZE/);
  assert.match(over, /900 lines, 1 files/);
  assert.match(over, /Why is it this big/);
  const within = sizeFactsLine(sizeFacts('5\t0\ta.ts\n'));
  assert.doesNotMatch(within, /OVERSIZE|Why is it this big/);
  assert.match(within, /5 lines, 1 files/);
});
