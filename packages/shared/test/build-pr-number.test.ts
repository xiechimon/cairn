import { describe, expect, test } from 'vitest';
import { prNumberFromUrl, resolvedBuildPrNumber } from '../src/records/build.js';

describe('prNumberFromUrl', () => {
  test('reads the pull number from a github PR url', () => {
    expect(prNumberFromUrl('https://github.com/demo-owner/demo-repo/pull/3812')).toBe(3812);
  });

  test('accepts query and fragment suffixes', () => {
    expect(prNumberFromUrl('https://github.com/o/r/pull/9?check=1')).toBe(9);
    expect(prNumberFromUrl('https://github.com/o/r/pull/9#discussion_r1')).toBe(9);
  });

  test('rejects missing or non-pull urls', () => {
    expect(prNumberFromUrl(null)).toBeNull();
    expect(prNumberFromUrl('')).toBeNull();
    expect(prNumberFromUrl('https://github.com/o/r/issues/9')).toBeNull();
  });
});

describe('resolvedBuildPrNumber', () => {
  test('prefers the stored number', () => {
    expect(
      resolvedBuildPrNumber({
        prNumber: 12,
        prUrl: 'https://github.com/o/r/pull/99',
      }),
    ).toBe(12);
  });

  test('falls back to parsing a legacy url-only row', () => {
    expect(
      resolvedBuildPrNumber({
        prNumber: null,
        prUrl: 'https://github.com/demo-owner/demo-repo/pull/43',
      }),
    ).toBe(43);
  });
});
