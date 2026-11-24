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
    const shown = glance?.lines ?? [];
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
    expect(glance?.path).toBe(coupon.path);
  });

  test('a long hunk is cut at 10 lines', () => {
    const long = file('a.ts', [
      { header: '@@ -1,0 +1,30 @@', lines: Array.from({ length: 30 }, (_, i) => `+line ${i}`) },
    ]);
    const shown = glanceOf([long])?.lines ?? [];
    expect(shown).toHaveLength(10);
    expect(shown.at(-1)).toMatchObject({ new: 10 });
  });

  test('named key hunks replace the automatic pick', () => {
    const shown = glanceOf([coupon], [{ path: coupon.path, start: 43, end: 45 }])?.lines ?? [];
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
      )?.lines ?? [];
    expect(shown.map((line) => line.kind)).toEqual(['del', 'add', 'gap', 'add', 'add']);
  });

  test('a note sits right under the last line of the range it explains', () => {
    const shown =
      glanceOf(
        [coupon],
        [
          { path: coupon.path, start: 16, end: 16, note: 'One discount per order.' },
          { path: coupon.path, start: 44, end: 45, note: 'The last line absorbs the rounding.' },
        ],
      )?.lines ?? [];
    expect(shown.map((line) => line.kind)).toEqual([
      'del',
      'add',
      'note',
      'gap',
      'add',
      'add',
      'note',
    ]);
    expect(shown[2]?.text).toBe('One discount per order.');
  });

  test('a named key file leads even when another file changed more', () => {
    const glance = glanceOf([coupon, small('x.ts')], [{ path: 'apps/web/src/x.ts' }]);
    expect(glance?.path).toBe('apps/web/src/x.ts');
    expect(glance?.lines.map((line) => line.kind)).toEqual(['del', 'add']);
  });
});
