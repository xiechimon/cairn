import { describe, expect, test } from 'vitest';
import { attentionTitle } from '../src/board/attention-title.js';
import {
  needsYouThreads,
  TRAY_PINNED,
  trayWindow,
} from '../src/board/needs-you.js';
import { todo } from './helpers.js';

describe('the tab title carries the needs-you count', () => {
  test('a question alone makes the title carry the count; none leaves the plain name', () => {
    expect(attentionTitle(0)).toBe('Cairn');
    expect(attentionTitle(1)).toBe('(1) Cairn');
    expect(attentionTitle(12)).toBe('(12) Cairn');
  });

  test('a negative or fractional count never leaks into the title', () => {
    expect(attentionTitle(-1)).toBe('Cairn');
    expect(attentionTitle(Number.NaN)).toBe('Cairn');
  });
});

describe('the tray shows at most three items and counts the rest', () => {
  const many = (n: number) => needsYouThreads(Array.from({ length: n }, (_, i) => todo(i + 1, 'failed')));

  test('pins three and reports the remainder', () => {
    expect(TRAY_PINNED).toBe(3);
    const window = trayWindow(many(5), false);
    expect(window.shown).toHaveLength(3);
    expect(window.more).toBe(2);
  });

  test('three or fewer show everything with no remainder', () => {
    expect(trayWindow(many(3), false)).toMatchObject({ more: 0 });
    expect(trayWindow(many(0), false)).toEqual({ shown: [], more: 0 });
  });

  test('opening the remainder shows all and keeps the count for the toggle', () => {
    const window = trayWindow(many(5), true);
    expect(window.shown).toHaveLength(5);
    expect(window.more).toBe(2);
  });
});
