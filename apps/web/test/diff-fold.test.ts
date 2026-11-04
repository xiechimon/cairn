import { describe, expect, test } from 'vitest';
import { unmodifiedBefore } from '../src/detail/docpane.js';

const hunks = [{ header: '@@ -88,7 +88,8 @@ cardFace' }, { header: '@@ -130,4 +131,6 @@' }, { header: '@@ -134 +137 @@' }];

describe('unmodifiedBefore', () => {
  test('lines above the first hunk', () => {
    expect(unmodifiedBefore(hunks, 0)).toBe(87);
  });
  test('lines between two hunks, from the old side', () => {
    expect(unmodifiedBefore(hunks, 1)).toBe(35);
  });
  test('a hunk with an implicit length of one directly after the previous one', () => {
    expect(unmodifiedBefore(hunks, 2)).toBe(0);
  });
  test('a header that does not parse folds nothing', () => {
    expect(unmodifiedBefore([{ header: 'binary' }], 0)).toBe(0);
  });
});
