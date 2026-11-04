import { describe, expect, test } from 'vitest';
import {
  classifyClaudeCodeLogin,
  claudeLoginBlocksClaim,
  claudeLoginNotice,
} from '../src/records/claude-login.js';

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

describe('claudeLoginBlocksClaim', () => {
  test('expired blocks, including a stale expiring or ok label whose clock has passed', () => {
    expect(claudeLoginBlocksClaim({ state: 'expired' }, NOW)).toBe(true);
    expect(claudeLoginBlocksClaim({ state: 'expiring', expiresAt: NOW - 1 }, NOW)).toBe(true);
    expect(claudeLoginBlocksClaim({ state: 'ok', expiresAt: NOW }, NOW)).toBe(true);
  });

  test('unknown does not block, even with a past expiresAt', () => {
    expect(claudeLoginBlocksClaim({ state: 'unknown', expiresAt: NOW - 1 }, NOW)).toBe(false);
    expect(claudeLoginBlocksClaim({ state: 'unknown' }, NOW)).toBe(false);
  });

  test('missing login, expiring, and ok do not block while time remains', () => {
    expect(claudeLoginBlocksClaim(null, NOW)).toBe(false);
    expect(claudeLoginBlocksClaim(undefined, NOW)).toBe(false);
    expect(claudeLoginBlocksClaim({ state: 'expiring', expiresAt: NOW + 2 * DAY }, NOW)).toBe(
      false,
    );
    expect(claudeLoginBlocksClaim({ state: 'ok', expiresAt: NOW + 30 * DAY }, NOW)).toBe(false);
  });
});

describe('claudeLoginNotice', () => {
  test('warns inside 3 days, names a day count, and uses soon under one day', () => {
    expect(claudeLoginNotice({ state: 'expiring', expiresAt: NOW + 2 * DAY }, NOW)).toEqual({
      kind: 'expiring',
      days: 2,
    });
    expect(claudeLoginNotice({ state: 'ok', expiresAt: NOW + 3 * DAY }, NOW)).toEqual({
      kind: 'expiring',
      days: 3,
    });
    expect(claudeLoginNotice({ state: 'expiring', expiresAt: NOW + DAY }, NOW)).toEqual({
      kind: 'expiring',
      days: 1,
    });
    expect(claudeLoginNotice({ state: 'expiring', expiresAt: NOW + DAY - 1 }, NOW)).toEqual({
      kind: 'expiring',
      days: null,
    });
  });

  test('expired and a passed clock warn as expired', () => {
    expect(claudeLoginNotice({ state: 'expired', expiresAt: NOW - 3_600_000 }, NOW)).toEqual({
      kind: 'expired',
    });
    expect(claudeLoginNotice({ state: 'expiring', expiresAt: NOW - 1 }, NOW)).toEqual({
      kind: 'expired',
    });
    expect(claudeLoginNotice({ state: 'expired' }, NOW)).toEqual({ kind: 'expired' });
  });

  test('unknown, missing, and a login beyond 3 days do not warn', () => {
    expect(claudeLoginNotice({ state: 'unknown', expiresAt: NOW - 1 }, NOW)).toBeNull();
    expect(claudeLoginNotice(undefined, NOW)).toBeNull();
    expect(claudeLoginNotice({ state: 'ok', expiresAt: NOW + 3 * DAY + 1 }, NOW)).toBeNull();
    expect(claudeLoginNotice({ state: 'ok' }, NOW)).toBeNull();
  });

  test('expiring with no expiresAt still warns, without a day count', () => {
    expect(claudeLoginNotice({ state: 'expiring' }, NOW)).toEqual({
      kind: 'expiring',
      days: null,
    });
  });
});
