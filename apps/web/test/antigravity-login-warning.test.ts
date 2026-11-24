import type { AntigravitySubscriptionListEntry } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { antigravitySubscriptionSignedOutWarning } from '../src/antigravity-login-warning.js';

function t(key: string, params?: Record<string, string | number>): string {
  if (params == null) return key;
  return Object.entries(params).reduce(
    (out, [name, value]) => out.replaceAll(`{${name}}`, String(value)),
    key,
  );
}

const subscription = {
  id: 'ag-sub-1',
  kind: 'antigravity-subscription' as const,
  label: 'Antigravity 订阅',
  hasToken: false,
  expiresAt: null,
  enabled: true,
  runnerId: 'bound-runner',
  runnerLogin: 'missing_local_login',
  createdAt: 1,
} satisfies AntigravitySubscriptionListEntry;

describe('antigravity subscription login warning', () => {
  test.each(['missing_local_login', 'unavailable'] as const)(
    'uses the existing sign-in copy when the subscription status is %s',
    (runnerLogin) => {
      const text = antigravitySubscriptionSignedOutWarning({ ...subscription, runnerLogin }, t);
      expect(text).toContain('Antigravity 订阅');
      expect(text).toContain('模型路由');
      expect(text).toContain('重新登录');
    },
  );

  test('uses the existing offline copy when the bound Runner is offline', () => {
    expect(antigravitySubscriptionSignedOutWarning({
      ...subscription, runnerLogin: 'unavailable', runnerOffline: true,
    }, t)).toBe('执行机离线');
  });

  test('does not warn a token subscription, a disabled subscription, or an authenticated Runner', () => {
    expect(antigravitySubscriptionSignedOutWarning({ ...subscription, hasToken: true }, t)).toBeNull();
    expect(antigravitySubscriptionSignedOutWarning({ ...subscription, enabled: false }, t)).toBeNull();
    expect(antigravitySubscriptionSignedOutWarning({ ...subscription, runnerLogin: 'ok' }, t)).toBeNull();
  });
});
