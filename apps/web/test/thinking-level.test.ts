import { THINKING_LEVELS } from '@cairn/shared';
import { describe, expect, it } from 'vitest';
import { toThinkingLevelDisplay } from '../src/api/mappers.js';

describe('toThinkingLevelDisplay (read-only row tier projection)', () => {
  it('F1 null → null (no tier to present)', () => {
    expect(toThinkingLevelDisplay(null, THINKING_LEVELS)).toBeNull();
  });

  it('F2 in-vocab → verbatim', () => {
    expect(toThinkingLevelDisplay('high', THINKING_LEVELS)).toBe('high');
    expect(toThinkingLevelDisplay('off', THINKING_LEVELS)).toBe('off');
    expect(toThinkingLevelDisplay('max', THINKING_LEVELS)).toBe('max');
  });

  it('F3 out-of-vocab → null (tiers the engine does not have are not presented)', () => {
    expect(toThinkingLevelDisplay('ultra', THINKING_LEVELS)).toBeNull();
    expect(toThinkingLevelDisplay('HIGH', THINKING_LEVELS)).toBeNull();
    expect(toThinkingLevelDisplay('', THINKING_LEVELS)).toBeNull();
  });

  it('F4 empty vocab → nothing presented for any value', () => {
    expect(toThinkingLevelDisplay('high', [])).toBeNull();
  });

  it('F5 vocab order not involved (membership independent of input order)', () => {
    expect(toThinkingLevelDisplay('high', ['high', 'low'])).toBe('high');
    expect(toThinkingLevelDisplay('low', ['high', 'low'])).toBe('low');
  });
});