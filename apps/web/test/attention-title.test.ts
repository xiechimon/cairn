import { describe, expect, test } from 'vitest';
import { attentionTitle } from '../src/board/attention-title.js';

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
