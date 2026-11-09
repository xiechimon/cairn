import { describe, expect, test } from 'vitest';
import { contextTokensOf } from '../src/agent-backend.js';

describe('contextTokensOf', () => {
  test('sums input, output, cacheRead and cacheWrite', () => {
    expect(contextTokensOf({ input: 120, output: 60, cacheRead: 20_800, cacheWrite: 50 })).toBe(
      120 + 60 + 20_800 + 50,
    );
  });

  test('treats missing fields as zero', () => {
    expect(contextTokensOf({ input: 10 })).toBe(10);
    expect(contextTokensOf(null)).toBe(0);
    expect(contextTokensOf(undefined)).toBe(0);
  });
});
