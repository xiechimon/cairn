import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sizeFacts, sizeFactsLine } from './size-facts.mjs';

const limits = { maxLines: 800, maxFiles: 40 };

test('lines sum both columns and files count rows, binary rows count no lines', () => {
  assert.deepEqual(sizeFacts('3\t4\ta.ts\n-\t-\tb.png\n10\t0\tc.ts\n', limits), {
    lines: 17,
    files: 3,
    oversize: false,
    maxLines: 800,
    maxFiles: 40,
  });
});

test('800 lines and 40 files are within limits, one more is oversize', () => {
  assert.equal(sizeFacts('400\t400\ta.ts\n', limits).oversize, false);
  assert.equal(sizeFacts('400\t401\ta.ts\n', limits).oversize, true);
  const rows = (n) => Array.from({ length: n }, (_, i) => `1\t0\tf${i}.ts\n`).join('');
  assert.equal(sizeFacts(rows(40), limits).oversize, false);
  assert.equal(sizeFacts(rows(41), limits).oversize, true);
});

test('the limits come from the caller, so a different JSON moves the threshold', () => {
  assert.equal(sizeFacts('5\t0\ta.ts\n', { maxLines: 4, maxFiles: 40 }).oversize, true);
  assert.match(
    sizeFactsLine(sizeFacts('5\t0\ta.ts\n', { maxLines: 4, maxFiles: 40 })),
    /limits 4 lines, 40 files/,
  );
});

test('missing or invalid limits fail closed', () => {
  assert.throws(() => sizeFacts('5\t0\ta.ts\n', {}), /limits/);
  assert.throws(() => sizeFacts('5\t0\ta.ts\n', { maxLines: 0, maxFiles: 40 }), /limits/);
});

test('an empty diff has no size', () => {
  assert.equal(sizeFacts('', limits).lines, 0);
  assert.equal(sizeFacts('', limits).files, 0);
  assert.equal(sizeFacts('', limits).oversize, false);
});

test('the oversize line asks for the explicit answer and the in-limit line does not', () => {
  const over = sizeFactsLine(sizeFacts('900\t0\ta.ts\n', limits));
  assert.match(over, /OVERSIZE/);
  assert.match(over, /900 lines, 1 files/);
  assert.match(over, /Why is it this big/);
  const within = sizeFactsLine(sizeFacts('5\t0\ta.ts\n', limits));
  assert.doesNotMatch(within, /OVERSIZE|Why is it this big/);
  assert.match(within, /5 lines, 1 files/);
});
