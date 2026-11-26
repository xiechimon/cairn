import { describe, expect, it } from 'vitest';
import type { GroupedRow } from '../src/chief/thread-activity.js';
import { streamDividers } from '../src/chief/time-dividers.js';

const MIN = 60_000;

function rows(items: GroupedRow['item'][]): GroupedRow[] {
  return items.map((item, i) => ({ item, i }));
}

describe('streamDividers', () => {
  it('puts the later reply time between two Coordinator replies sent minutes apart', () => {
    const { dividers, lastAt } = streamDividers(
      rows([
        { kind: 'user', text: 'a', createdAt: 0 },
        { kind: 'robot', paragraphs: [], seconds: '', createdAt: 30_000 },
        { kind: 'robot', paragraphs: [], seconds: '', createdAt: 4.5 * MIN },
        { kind: 'user', text: 'b', createdAt: 5 * MIN },
        { kind: 'robot', paragraphs: [], seconds: '', createdAt: 5.5 * MIN },
      ]),
      null,
      null,
    );
    expect(dividers).toEqual([null, null, 4.5 * MIN, null, null]);
    expect(lastAt).toBe(5.5 * MIN);
  });

  it('keeps the ten-minute gap divider for every author and never doubles it', () => {
    const { dividers } = streamDividers(
      rows([
        { kind: 'robot', paragraphs: [], seconds: '', createdAt: 0 },
        { kind: 'robot', paragraphs: [], seconds: '', createdAt: 20 * MIN },
        { kind: 'user', text: 'a', createdAt: 40 * MIN },
        { kind: 'robot', paragraphs: [], seconds: '' },
      ]),
      -30 * MIN,
      null,
    );
    expect(dividers).toEqual([0, 20 * MIN, 40 * MIN, null]);
  });

  it('splits replies that only a hidden thinking row stands between, and dates a still-typing reply now', () => {
    const { dividers, lastAt } = streamDividers(
      rows([
        { kind: 'robot', paragraphs: [], seconds: '', createdAt: MIN },
        { kind: 'thinking', text: 'checking the log' },
        { kind: 'robot', paragraphs: [], seconds: '', createdAt: 2 * MIN },
        { kind: 'robot', paragraphs: [], seconds: '', typing: true },
      ]),
      null,
      null,
      3 * MIN,
    );
    expect(dividers).toEqual([null, null, 2 * MIN, 3 * MIN]);
    expect(lastAt).toBe(2 * MIN);
  });
});
