import { parseSearchQuery, type SearchFilterResult } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  chipProblem,
  completeTrailingToken,
  joinQuery,
  removeChipAt,
  splitQuery,
} from '../src/search/search-query.js';

const NOW = Date.UTC(2026, 10, 4, 12);
const split = (query: string) => splitQuery(query, NOW);
const raws = (query: string) => split(query).chips.map((chip) => chip.raw);

describe('splitQuery', () => {
  test('a completed filter token becomes a chip and leaves the input empty', () => {
    expect(split('is:failed ')).toMatchObject({ text: '' });
    expect(raws('is:failed ')).toEqual(['is:failed']);
  });

  test('the token still being typed stays in the input', () => {
    const result = split('is:failed proj');
    expect(result.chips.map((chip) => chip.raw)).toEqual(['is:failed']);
    expect(result.text).toBe('proj');
  });

  test('a filter token without a trailing space is not a chip yet', () => {
    const result = split('is:failed');
    expect(result.chips).toEqual([]);
    expect(result.text).toBe('is:failed');
  });

  test('words keep their place in the input next to the in-progress token', () => {
    const result = split('is:failed fold project:cai');
    expect(raws('is:failed fold project:cai')).toEqual(['is:failed']);
    expect(result.text).toBe('fold project:cai');
  });

  test('a quoted value with a space is one chip and an open quote is still in progress', () => {
    expect(raws('project:"my project" ')).toEqual(['project:"my project"']);
    const open = split('project:"my pro');
    expect(open.chips).toEqual([]);
    expect(open.text).toBe('project:"my pro');
  });

  test('negated filters keep their dash in the chip', () => {
    const [chip] = split('-is:done ').chips;
    expect(chip?.raw).toBe('-is:done');
    expect(chip?.negated).toBe(true);
  });

  test('a filter with a bad value is still a chip and carries its problem', () => {
    const [chip] = split('cost:lots ').chips;
    expect(chip?.problem).toBe('bad_cost');
  });

  test('unknown keys are words, not chips', () => {
    const result = split('foo:bar ');
    expect(result.chips).toEqual([]);
    expect(result.text).toBe('foo:bar ');
  });
});

describe('joinQuery', () => {
  const roundTrip = (query: string) => {
    const { chips, text } = split(query);
    return parseSearchQuery(joinQuery(chips, text), NOW);
  };

  test('chips and text join back into a query that parses the same way', () => {
    for (const query of [
      'is:failed project:cairn ',
      'is:failed fold project:cairn ',
      '-is:done cost:>5 after:7d something',
      'project:"my project" "two words" ',
      'is:failed cost:lots ',
    ]) {
      const before = parseSearchQuery(query, NOW);
      const after = roundTrip(query);
      expect(after.filters.map((f) => f.raw).sort()).toEqual(before.filters.map((f) => f.raw).sort());
      expect(after.words.map((w) => w.text).sort()).toEqual(before.words.map((w) => w.text).sort());
    }
  });

  test('chips are followed by a space so they stay chips', () => {
    const { chips } = split('is:failed project:cairn ');
    expect(joinQuery(chips, '')).toBe('is:failed project:cairn ');
    expect(split(joinQuery(chips, 'fo')).text).toBe('fo');
  });

  test('typing after a chip keeps the chips', () => {
    const { chips } = split('is:failed ');
    expect(joinQuery(chips, 'proj')).toBe('is:failed proj');
  });

  test('removing a chip drops only that filter', () => {
    const { chips, text } = split('is:failed project:cairn fold ');
    const next = joinQuery(removeChipAt(chips, 0), text);
    expect(raws(next)).toEqual(['project:cairn']);
    expect(split(next).text).toBe('fold ');
  });

  test('an empty query joins to an empty string', () => {
    expect(joinQuery([], '')).toBe('');
  });
});

describe('completeTrailingToken', () => {
  test('a key prefix completes to the key and a colon', () => {
    expect(completeTrailingToken('is:failed proj')).toBe('is:failed project:');
    expect(completeTrailingToken('aft')).toBe('after:');
    expect(completeTrailingToken('c')).toBe('cost:');
  });

  test('an exact key wins over a longer key with the same prefix', () => {
    expect(completeTrailingToken('pr')).toBe('pr:');
  });

  test('is: completes a state from its prefix', () => {
    expect(completeTrailingToken('is:fa')).toBe('is:failed');
    expect(completeTrailingToken('-is:wa')).toBe('-is:waiting');
  });

  test('a negated key keeps its dash', () => {
    expect(completeTrailingToken('-proj')).toBe('-project:');
  });

  test('nothing to complete returns null', () => {
    expect(completeTrailingToken('')).toBeNull();
    expect(completeTrailingToken('is:failed ')).toBeNull();
    expect(completeTrailingToken('zzz')).toBeNull();
    expect(completeTrailingToken('is:failed')).toBeNull();
    expect(completeTrailingToken('project:ca')).toBeNull();
  });
});

describe('chipProblem', () => {
  const [chip] = split('project:nope ').chips;
  const result = (valid: boolean, reason?: SearchFilterResult['reason']): SearchFilterResult => ({
    key: 'project',
    raw: 'project:nope',
    value: 'nope',
    negated: false,
    valid,
    ...(reason === undefined ? {} : { reason }),
  });

  test('the client parser problem is reported without a server answer', () => {
    const [bad] = split('after:soon ').chips;
    expect(bad && chipProblem(bad, undefined)).toBe('bad_date');
  });

  test('the server flags a value only it can check', () => {
    expect(chip && chipProblem(chip, [result(false, 'unknown_project')])).toBe('unknown_project');
  });

  test('a valid server result leaves the chip clean', () => {
    expect(chip && chipProblem(chip, [result(true)])).toBeNull();
  });

  test('no server answer yet leaves the chip clean', () => {
    expect(chip && chipProblem(chip, undefined)).toBeNull();
  });
});
