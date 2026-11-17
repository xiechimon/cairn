import { describe, expect, it } from 'vitest';
import { groupMade, madeGroupOf, matchesMadeQuery } from '../src/board/made-groups.js';

describe('madeGroupOf', () => {
  it('uses the explicit kind first', () => {
    expect(madeGroupOf({ madeKind: 'design', output: 'code' })).toBe('design');
  });

  it('falls back to the deliverable output, then to other', () => {
    expect(madeGroupOf({ output: 'info' })).toBe('document');
    expect(madeGroupOf({ output: 'report' })).toBe('document');
    expect(madeGroupOf({ output: 'dataset' })).toBe('dataset');
    expect(madeGroupOf({ output: 'link' })).toBe('link');
    expect(madeGroupOf({})).toBe('other');
  });

  it('leaves code changes out of Made', () => {
    expect(madeGroupOf({ output: 'code' })).toBeNull();
    expect(madeGroupOf({ madeKind: 'code', output: 'info' })).toBeNull();
  });
});

describe('groupMade', () => {
  it('groups by kind in a fixed order, newest first inside each, and drops empty groups', () => {
    const items = [
      { id: 'old-doc', madeKind: 'document' as const, phaseAt: 1 },
      { id: 'legacy', phaseAt: 5 },
      { id: 'new-doc', madeKind: 'document' as const, phaseAt: 9 },
      { id: 'design', madeKind: 'design' as const, phaseAt: 3 },
      { id: 'pr', output: 'code' as const, phaseAt: 7 },
    ];
    const groups = groupMade(items, 10);
    expect(groups.map((g) => g.key)).toEqual(['document', 'design', 'other']);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['new-doc', 'old-doc']);
  });

  it('moves every kind to one last Earlier group from the seventh calendar day back, newest first', () => {
    const now = Date.UTC(2026, 8, 24, 1, 0);
    const items = [
      { id: 'six-days', madeKind: 'document' as const, phaseAt: Date.UTC(2026, 8, 17, 16, 30) },
      { id: 'seven-days', madeKind: 'page' as const, phaseAt: Date.UTC(2026, 8, 17, 15, 30) },
      { id: 'month-old', madeKind: 'document' as const, phaseAt: Date.UTC(2026, 7, 20, 3, 0) },
      { id: 'old-pr', output: 'code' as const, phaseAt: Date.UTC(2026, 8, 1, 3, 0) },
      { id: 'today', madeKind: 'design' as const, phaseAt: now - 60_000 },
    ];
    const groups = groupMade(items, now);
    expect(groups.map((g) => [g.key, g.items.map((i) => i.id)])).toEqual([
      ['document', ['six-days']],
      ['design', ['today']],
      ['earlier', ['seven-days', 'month-old']],
    ]);
  });

  it('shows only Earlier when nothing is recent', () => {
    const now = Date.UTC(2026, 8, 24, 1, 0);
    const groups = groupMade([{ id: 'a', output: 'info' as const, phaseAt: Date.UTC(2026, 7, 1) }], now);
    expect(groups.map((g) => g.key)).toEqual(['earlier']);
  });

  it('returns nothing for no items', () => {
    expect(groupMade([], 0)).toEqual([]);
  });
});

describe('matchesMadeQuery', () => {
  it('matches title or project name case-insensitively', () => {
    expect(matchesMadeQuery('Unread dot on threads', 'cairn', 'UNREAD')).toBe(true);
    expect(matchesMadeQuery('Unread dot on threads', 'Credential relay', 'relay')).toBe(true);
    expect(matchesMadeQuery('Unread dot on threads', 'cairn', 'zzz')).toBe(false);
  });

  it('matches the kind label too', () => {
    expect(matchesMadeQuery('Design System', 'cairn', '设计', '设计')).toBe(true);
    expect(matchesMadeQuery('Design System', 'cairn', '文档', '设计')).toBe(false);
  });

  it('matches everything for a blank query and tolerates a missing project', () => {
    expect(matchesMadeQuery('Anything', undefined, '   ')).toBe(true);
    expect(matchesMadeQuery('Anything', undefined, 'any')).toBe(true);
  });
});
