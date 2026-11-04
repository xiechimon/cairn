import { describe, expect, test } from 'vitest';
import { parseSearchQuery } from '../src/search-syntax.js';

const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);
const parse = (q: string) => parseSearchQuery(q, NOW);

describe('parseSearchQuery', () => {
  test('plain words become word tokens and no filters', () => {
    expect(parse('fix the bug')).toEqual({
      filters: [],
      words: [
        { text: 'fix', negated: false },
        { text: 'the', negated: false },
        { text: 'bug', negated: false },
      ],
    });
  });

  test('quoted phrases stay one word and may contain spaces and colons', () => {
    expect(parse('"fix the bug" "is:failed"').words).toEqual([
      { text: 'fix the bug', negated: false },
      { text: 'is:failed', negated: false },
    ]);
    expect(parse('"is:failed"').filters).toEqual([]);
  });

  test('quoted filter values keep spaces: project:"my project"', () => {
    const [filter] = parse('project:"my project"').filters;
    expect(filter?.condition).toEqual({ key: 'project', name: 'my project' });
  });

  test('a leading minus negates words and filters; a lone minus is a word', () => {
    const parsed = parse('-draft -is:done - x');
    expect(parsed.words).toEqual([
      { text: 'draft', negated: true },
      { text: '-', negated: false },
      { text: 'x', negated: false },
    ]);
    expect(parsed.filters[0]).toMatchObject({ key: 'is', negated: true });
  });

  test('unknown keys are treated as plain words', () => {
    const parsed = parse('label:bug http://x');
    expect(parsed.filters).toEqual([]);
    expect(parsed.words.map((w) => w.text)).toEqual(['label:bug', 'http://x']);
  });

  test('keys are case-insensitive and is: values map to states', () => {
    const states = ['failed', 'waiting', 'review', 'running', 'done', 'snoozed'];
    for (const state of states) {
      expect(parse(`IS:${state.toUpperCase()}`).filters[0]?.condition).toEqual({
        key: 'is',
        state,
      });
    }
    expect(parse('is:bogus').filters[0]).toMatchObject({
      condition: null,
      problem: 'unknown_state',
    });
  });

  test('empty value is flagged while typing', () => {
    expect(parse('is:').filters[0]).toMatchObject({ problem: 'empty', condition: null });
    expect(parse('project:').filters[0]?.problem).toBe('empty');
  });

  test('pr accepts a positive integer or any', () => {
    expect(parse('pr:42').filters[0]?.condition).toEqual({ key: 'pr', number: 42 });
    expect(parse('pr:ANY').filters[0]?.condition).toEqual({ key: 'pr', number: 'any' });
    for (const bad of ['pr:0', 'pr:x', 'pr:1.5', 'pr:-3']) {
      expect(parse(bad).filters[0]?.problem).toBe('bad_pr');
    }
  });

  test('after accepts absolute UTC dates and relative days or hours', () => {
    expect(parse('after:2026-11-01').filters[0]?.condition).toEqual({
      key: 'after',
      sinceMs: Date.UTC(2026, 10, 1),
    });
    expect(parse('after:7d').filters[0]?.condition).toEqual({
      key: 'after',
      sinceMs: NOW - 7 * 86_400_000,
    });
    expect(parse('after:24h').filters[0]?.condition).toEqual({
      key: 'after',
      sinceMs: NOW - 24 * 3_600_000,
    });
    for (const bad of ['after:2026-02-30', 'after:yesterday', 'after:7w', 'after:2026-1-1']) {
      expect(parse(bad).filters[0]?.problem).toBe('bad_date');
    }
  });

  test('cost accepts >N or <N dollars and rejects the rest', () => {
    expect(parse('cost:>5').filters[0]?.condition).toEqual({ key: 'cost', op: '>', dollars: 5 });
    expect(parse('cost:<0.25').filters[0]?.condition).toEqual({
      key: 'cost',
      op: '<',
      dollars: 0.25,
    });
    for (const bad of ['cost:lots', 'cost:5', 'cost:>', 'cost:>-1', 'cost:>=2']) {
      expect(parse(bad).filters[0]?.problem).toBe('bad_cost');
    }
  });

  test('repeated filters are all kept in order; the search service ORs same-key positives and ANDs negatives', () => {
    const parsed = parse('is:failed is:review -is:snoozed');
    expect(parsed.filters.map((f) => [f.negated, f.value])).toEqual([
      [false, 'failed'],
      [false, 'review'],
      [true, 'snoozed'],
    ]);
  });

  test('raw keeps the token text as typed, including the minus and quotes', () => {
    expect(parse('-project:"a b"').filters[0]?.raw).toBe('-project:"a b"');
  });

  test('unterminated quote runs to the end of input', () => {
    expect(parse('by:"ian x').filters[0]?.condition).toEqual({ key: 'by', name: 'ian x' });
  });

  test('empty and whitespace-only input parse to nothing', () => {
    expect(parse('   ')).toEqual({ filters: [], words: [] });
  });
});
