import { describe, expect, test } from 'vitest';
import { glanceOf } from '../src/records/diff-glance.js';
import type { DocumentDiffFile } from '../src/records/document-diff.js';

const file = (path: string, hunks: { header: string; lines: string[] }[]): DocumentDiffFile => {
  const lines = hunks.flatMap((hunk) => hunk.lines);
  return {
    path,
    additions: lines.filter((line) => line.startsWith('+')).length,
    deletions: lines.filter((line) => line.startsWith('-')).length,
    hunks,
  };
};

const coupon = file('apps/server/src/services/coupon-split.ts', [
  {
    header: '@@ -14,4 +14,7 @@',
    lines: [
      ' import { roundCents } from "./money";',
      ' export function splitCoupon(lines, coupon) {',
      '-  return lines.map((line) => roundCents(line.total * coupon.rate))',
      '+  const orderTotal = lines.reduce((sum, line) => sum + line.total, 0)',
      '+  const orderDiscount = roundCents(orderTotal * coupon.rate)',
      '+  return settleRemainder(lines, orderDiscount)',
      ' }',
    ],
  },
  {
    header: '@@ -40,3 +43,5 @@',
    lines: [
      ' function settleRemainder(shares, target) {',
      '+  const gap = roundCents(target - sum(shares))',
      '+  shares[shares.length - 1] += gap',
      '   return shares',
    ],
  },
]);

const small = (name: string) =>
  file(`apps/web/src/${name}`, [{ header: '@@ -1,1 +1,1 @@', lines: ['-a', '+b'] }]);

describe('a diff glance shows only the key lines', () => {
  test('changed lines with one line of context, numbered, a gap between hunks, at most 10 lines', () => {
    const glance = glanceOf([coupon]);
    const [key] = glance?.files ?? [];
    const shown = key?.lines ?? [];
    expect(shown.filter((line) => line.kind !== 'gap').length).toBeLessThanOrEqual(10);
    expect(shown.map((line) => line.kind)).toEqual([
      'context',
      'del',
      'add',
      'add',
      'add',
      'context',
      'gap',
      'context',
      'add',
      'add',
      'context',
    ]);
    expect(shown[1]).toMatchObject({
      kind: 'del',
      old: 16,
      text: '  return lines.map((line) => roundCents(line.total * coupon.rate))',
    });
    expect(shown[2]).toMatchObject({ kind: 'add', new: 16 });
    expect(shown[8]).toMatchObject({ kind: 'add', new: 44 });
    expect(glance?.files[0]).toMatchObject({ additions: 5, deletions: 1 });
  });

  test('a long hunk is cut at 10 lines', () => {
    const long = file('a.ts', [
      { header: '@@ -1,0 +1,30 @@', lines: Array.from({ length: 30 }, (_, i) => `+line ${i}`) },
    ]);
    const shown = glanceOf([long])?.files[0]?.lines ?? [];
    expect(shown).toHaveLength(10);
    expect(shown.at(-1)).toMatchObject({ new: 10 });
  });

  test('named key hunks replace the automatic pick', () => {
    const shown =
      glanceOf([coupon], [{ path: coupon.path, start: 43, end: 45 }])?.files[0]?.lines ?? [];
    expect(shown.map((line) => line.new)).toEqual([43, 44, 45]);
  });

  test('two named ranges in one file show both, with a gap between them', () => {
    const shown =
      glanceOf(
        [coupon],
        [
          { path: coupon.path, start: 16, end: 16 },
          { path: coupon.path, start: 44, end: 45 },
        ],
      )?.files[0]?.lines ?? [];
    expect(shown.map((line) => line.kind)).toEqual(['del', 'add', 'gap', 'add', 'add']);
  });

  test('the key file comes first with code; other files are one line each, and past four only three show', () => {
    const three = glanceOf([small('one.ts'), coupon, small('two.ts')]);
    expect(three?.files.map((entry) => entry.path)).toEqual([
      coupon.path,
      'apps/web/src/one.ts',
      'apps/web/src/two.ts',
    ]);
    expect((three?.files ?? []).slice(1).every((entry) => entry.lines === undefined)).toBe(true);
    expect(three?.more).toBeUndefined();

    const nine = glanceOf([coupon, ...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(small)]);
    expect(nine?.files).toHaveLength(4);
    expect(nine?.more).toEqual({ count: 5, additions: 5, deletions: 5 });
  });

  test('a named key file leads even when another file changed more', () => {
    const glance = glanceOf([coupon, small('x.ts')], [{ path: 'apps/web/src/x.ts' }]);
    expect(glance?.files[0]?.path).toBe('apps/web/src/x.ts');
    expect(glance?.files[0]?.lines?.map((line) => line.kind)).toEqual(['del', 'add']);
  });
});
