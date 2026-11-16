import { describe, expect, test } from 'vitest';
import { classifyClaudeCodeLogin } from '../src/records/claude-login.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

describe('classifyClaudeCodeLogin', () => {
  test('unknown probe stays unknown and drops expiresAt', () => {
    expect(classifyClaudeCodeLogin('unknown', NOW - 60_000, NOW)).toEqual({ state: 'unknown' });
  });

  test('logged-in with no oauth clock is ok', () => {
    expect(classifyClaudeCodeLogin('logged-in', null, NOW)).toEqual({ state: 'ok' });
  });

  test('not-logged-in with no oauth clock does not become expired', () => {
    expect(classifyClaudeCodeLogin('not-logged-in', null, NOW)).toEqual({ state: 'unknown' });
  });

  test('a past expiresAt is expired for both logged-in and not-logged-in', () => {
    const expiresAt = NOW - 3_600_000;
    expect(classifyClaudeCodeLogin('logged-in', expiresAt, NOW)).toEqual({
      state: 'expired',
      expiresAt,
    });
    expect(classifyClaudeCodeLogin('not-logged-in', expiresAt, NOW)).toEqual({
      state: 'expired',
      expiresAt,
    });
  });

  test('exactly 3 days left is expiring; one millisecond more is ok', () => {
    expect(classifyClaudeCodeLogin('logged-in', NOW + 3 * DAY, NOW)).toEqual({
      state: 'expiring',
      expiresAt: NOW + 3 * DAY,
    });
    expect(classifyClaudeCodeLogin('logged-in', NOW + 3 * DAY + 1, NOW)).toEqual({
      state: 'ok',
      expiresAt: NOW + 3 * DAY + 1,
    });
  });

  test('the instant of expiry is expired', () => {
    expect(classifyClaudeCodeLogin('logged-in', NOW, NOW)).toEqual({
      state: 'expired',
      expiresAt: NOW,
    });
  });
});
