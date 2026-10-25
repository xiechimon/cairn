import { describe, expect, test } from 'vitest';
import {
  findDuplicateTicket,
  parseTicketDedupeKey,
  ticketDedupeKey,
  ticketDedupeMarker,
} from '../src/records/ticket-dedupe.js';

describe('ticketDedupeKey', () => {
  test('failure mode 1: path order / duplicates / ./ prefix / category case do not affect the key', () => {
    const a = ticketDedupeKey({ category: 'Missing-Test', paths: ['b/y.ts', 'a/x.ts'] });
    const b = ticketDedupeKey({
      category: 'missing-test',
      paths: ['./a/x.ts', 'b/y.ts', 'a/x.ts'],
    });
    expect(a).toBe(b);
  });

  test('failure mode 2: same category with different paths -> different keys', () => {
    const a = ticketDedupeKey({ category: 'missing-test', paths: ['apps/server/src/a.ts'] });
    const b = ticketDedupeKey({ category: 'missing-test', paths: ['apps/web/src/b.ts'] });
    expect(a).not.toBe(b);
  });

  test('different categories with same path -> different keys', () => {
    const a = ticketDedupeKey({ category: 'missing-test', paths: ['a.ts'] });
    const b = ticketDedupeKey({ category: 'stale-doc', paths: ['a.ts'] });
    expect(a).not.toBe(b);
  });

  test('category must not be empty', () => {
    expect(() => ticketDedupeKey({ category: '  ', paths: ['a.ts'] })).toThrow();
  });
});

describe('findDuplicateTicket', () => {
  const key = ticketDedupeKey({ category: 'missing-test', paths: ['apps/server/src/a.ts'] });
  const other = ticketDedupeKey({ category: 'missing-test', paths: ['apps/web/src/b.ts'] });

  test('failure mode 3: marker written into body reads back verbatim', () => {
    const body = `问题描述……\n\n${ticketDedupeMarker(key)}\n`;
    expect(parseTicketDedupeKey(body)).toBe(key);
    expect(parseTicketDedupeKey('没有标记')).toBeNull();
  });

  test('an open ticket with the same key marker -> that ticket returned; two different problems never match', () => {
    const issues = [
      { number: 10, state: 'open', body: `x\n${ticketDedupeMarker(other)}` },
      { number: 11, state: 'open', body: `y\n${ticketDedupeMarker(key)}` },
    ];
    expect(findDuplicateTicket(key, issues)?.number).toBe(11);
    expect(findDuplicateTicket(other, issues)?.number).toBe(10);
  });

  test('closed tickets with the same key do not count as duplicates (a recurring problem needs a new ticket)', () => {
    const issues = [{ number: 12, state: 'closed', body: ticketDedupeMarker(key) }];
    expect(findDuplicateTicket(key, issues)).toBeNull();
  });

  test('failure mode 4: body merely mentions the same text without the marker -> not a duplicate', () => {
    const issues = [
      { number: 13, state: 'open', body: `missing-test apps/server/src/a.ts ${key}` },
    ];
    expect(findDuplicateTicket(key, issues)).toBeNull();
  });
});
