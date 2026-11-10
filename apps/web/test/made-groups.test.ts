import { describe, expect, it } from 'vitest';
import { groupMade, madeGroupOf, matchesMadeQuery } from '../src/board/made-groups.js';

const at = (date: string, time: string) => Date.parse(`${date}T${time}+08:00`);

const THURSDAY = at('2026-09-24', '20:30:00');

describe('madeGroupOf', () => {
  it('puts the same calendar day in today, including just after midnight', () => {
    expect(madeGroupOf(at('2026-09-24', '00:00:00'), THURSDAY)).toBe('today');
    expect(madeGroupOf(at('2026-09-24', '20:29:00'), THURSDAY)).toBe('today');
  });

  it('splits at local midnight, not at 24 hours', () => {
    const justAfterMidnight = at('2026-09-24', '00:10:00');
    expect(madeGroupOf(at('2026-09-23', '23:50:00'), justAfterMidnight)).toBe('yesterday');
    expect(madeGroupOf(at('2026-09-23', '00:00:00'), THURSDAY)).toBe('yesterday');
    expect(madeGroupOf(at('2026-09-22', '23:59:00'), THURSDAY)).toBe('week');
  });

  it('keeps Monday of the current week in this week and Sunday before it in earlier', () => {
    expect(madeGroupOf(at('2026-09-21', '00:00:00'), THURSDAY)).toBe('week');
    expect(madeGroupOf(at('2026-09-20', '23:59:00'), THURSDAY)).toBe('earlier');
  });

  it('has no this-week group on a Monday', () => {
    const monday = at('2026-09-21', '09:00:00');
    expect(madeGroupOf(at('2026-09-20', '12:00:00'), monday)).toBe('yesterday');
    expect(madeGroupOf(at('2026-09-19', '12:00:00'), monday)).toBe('earlier');
  });

  it('treats a timestamp slightly in the future as today', () => {
    expect(madeGroupOf(THURSDAY + 60_000, THURSDAY)).toBe('today');
  });
});

describe('groupMade', () => {
  it('orders groups newest first and drops empty ones', () => {
    const items = [
      { id: 'old', phaseAt: at('2026-09-10', '10:00:00') },
      { id: 'new', phaseAt: at('2026-09-24', '19:00:00') },
      { id: 'mid', phaseAt: at('2026-09-22', '10:00:00') },
      { id: 'newer', phaseAt: at('2026-09-24', '20:00:00') },
    ];
    const groups = groupMade(items, THURSDAY);
    expect(groups.map((g) => g.key)).toEqual(['today', 'week', 'earlier']);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['newer', 'new']);
  });

  it('returns nothing for no items', () => {
    expect(groupMade([], THURSDAY)).toEqual([]);
  });
});

describe('matchesMadeQuery', () => {
  it('matches title or project name case-insensitively', () => {
    expect(matchesMadeQuery('Unread dot on threads', 'cairn', 'UNREAD')).toBe(true);
    expect(matchesMadeQuery('Unread dot on threads', 'Credential relay', 'relay')).toBe(true);
    expect(matchesMadeQuery('Unread dot on threads', 'cairn', 'zzz')).toBe(false);
  });

  it('matches everything for a blank query and tolerates a missing project', () => {
    expect(matchesMadeQuery('Anything', undefined, '   ')).toBe(true);
    expect(matchesMadeQuery('Anything', undefined, 'any')).toBe(true);
  });
});
