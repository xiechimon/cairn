import { describe, expect, test } from 'vitest';
import { subscriptionLoginWarning } from '../src/claude-login-warning.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function t(key: string, params?: Record<string, string | number>): string {
  if (params == null) return key;
  return Object.entries(params).reduce(
    (out, [name, value]) => out.replaceAll(`{${name}}`, String(value)),
    key,
  );
}

const subscription = { id: 'subscription-1', kind: 'claude-subscription' as const, label: 'Personal', expiresAt: NOW + 30 * DAY, createdAt: NOW };

describe('subscription brief warning', () => {
  test('warns within 30 days, including the boundary, with setup-token instructions', () => {
    expect(subscriptionLoginWarning(subscription, NOW, t)).toContain('30');
    expect(subscriptionLoginWarning({ ...subscription, expiresAt: NOW + DAY }, NOW, t)).toContain('claude setup-token');
    const expired = subscriptionLoginWarning({ ...subscription, expiresAt: NOW - DAY }, NOW, t);
    expect(expired).toContain('已过期');
    expect(expired).not.toContain('Claude 订阅已过期');
    expect(expired).toContain('Coordinator 和任务都暂时用不了');
    expect(expired).toContain('claude setup-token');
    expect(expired).toContain('设置 → 模型路由');
  });
  test('does not warn about a stored subscription that is not the enabled one', () => {
    expect(
      subscriptionLoginWarning({ ...subscription, enabled: false, expiresAt: NOW - DAY }, NOW, t),
    ).toBeNull();
  });
  test('does not warn beyond 30 days or without a known expiry', () => {
    expect(subscriptionLoginWarning({ ...subscription, expiresAt: NOW + 30 * DAY + 1 }, NOW, t)).toBeNull();
    expect(subscriptionLoginWarning({ ...subscription, expiresAt: null }, NOW, t)).toBeNull();
  });
});
