import { describe, expect, it } from 'vitest';
import type { GroupedRow } from '../src/chief/thread-activity.js';
import { streamDividers } from '../src/chief/time-dividers.js';

const MIN = 60_000;
const at = (d: number, h: number, min: number) => new Date(2026, 10, d, h, min).getTime();

function rows(items: GroupedRow['item'][]): GroupedRow[] {
  return items.map((item, i) => ({ item, i }));
}

describe('streamDividers (owner 2026-11-26: a divider only at a day change or a gap over an hour)', () => {
  it('puts no divider between consecutive Coordinator replies minutes apart', () => {
    const { dividers, lastAt } = streamDividers(
      rows([
        { kind: 'user', text: 'a', createdAt: at(26, 14, 0) },
        { kind: 'robot', paragraphs: [], seconds: '', createdAt: at(26, 14, 1) },
        { kind: 'robot', paragraphs: [], seconds: '', createdAt: at(26, 14, 5) },
        { kind: 'robot', paragraphs: [], seconds: '', typing: true },
      ]),
      null,
      null,
    );
    expect(dividers).toEqual([null, null, null, null]);
    expect(lastAt).toBe(at(26, 14, 5));
  });

  it('marks a gap over an hour for every author, and not a gap of 59 minutes', () => {
    const { dividers } = streamDividers(
      rows([
        { kind: 'robot', paragraphs: [], seconds: '', createdAt: at(26, 9, 0) },
        { kind: 'user', text: 'a', createdAt: at(26, 9, 59) },
        { kind: 'robot', paragraphs: [], seconds: '', createdAt: at(26, 11, 0) },
      ]),
      at(26, 8, 0) - 61 * MIN,
      null,
    );
    expect(dividers).toEqual([at(26, 9, 0), null, at(26, 11, 0)]);
  });

  it('marks a day change even when the gap is short', () => {
    const { dividers } = streamDividers(
      rows([
        { kind: 'user', text: 'a', createdAt: at(25, 23, 50) },
        { kind: 'robot', paragraphs: [], seconds: '', createdAt: at(26, 0, 5) },
      ]),
      null,
      null,
    );
    expect(dividers).toEqual([null, at(26, 0, 5)]);
  });
});
