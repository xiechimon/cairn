import { expect, test, vi } from 'vitest';
import {
  type AppToken,
  githubAppTokenExpiry,
  isAppToken,
  registerAppToken,
} from '../src/lib/github-token.js';

test('App token registrations retain recent entries and sweep expired entries without new registrations', () => {
  vi.useFakeTimers();
  try {
    const token = (index: number) => `fixture-app-token-${index}` as AppToken;
    const expiry = Date.now() + 61_000;
    for (let index = 0; index < 256; index++) {
      registerAppToken(token(index), expiry, (inner) => inner);
    }
    expect(isAppToken(token(0))).toBe(true);
    registerAppToken(token(256), expiry, (inner) => inner);
    expect(isAppToken(token(0))).toBe(true);
    expect(isAppToken(token(1))).toBe(false);
    expect(githubAppTokenExpiry(token(256))).toBe(expiry);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(120_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(githubAppTokenExpiry(token(256))).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});
