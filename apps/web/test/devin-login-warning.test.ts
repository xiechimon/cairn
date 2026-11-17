import { describe, expect, test } from 'vitest';
import { devinSubscriptionLoginWarning } from '../src/devin-login-warning.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function t(key: string, params?: Record<string, string | number>): string {
  if (params == null) return key;
  return Object.entries(params).reduce(
    (out, [name, value]) => out.replaceAll(`{${name}}`, String(value)),
    key,
  );
}

const subscription = {
  id: 'devin-subscription-1',
  kind: 'devin-subscription' as const,
  label: 'Devin',
  expiresAt: NOW + 30 * DAY,
  createdAt: NOW,
};

describe('devin subscription brief warning', () => {
  test('warns within 30 days, including the boundary, with credentials.toml instructions', () => {
    expect(devinSubscriptionLoginWarning(subscription, NOW, t)).toContain('30');
    expect(
      devinSubscriptionLoginWarning({ ...subscription, expiresAt: NOW + DAY }, NOW, t),
    ).toContain('credentials.toml');
    const expired = devinSubscriptionLoginWarning(
      { ...subscription, expiresAt: NOW - DAY },
      NOW,
      t,
    );
    expect(expired).toContain('已过期');
    expect(expired).toContain('Coordinator 和任务都暂时用不了');
    expect(expired).toContain('credentials.toml');
    expect(expired).toContain('设置 → 模型路由');
  });
  test('does not warn about a stored subscription that is not the enabled one', () => {
    expect(
      devinSubscriptionLoginWarning(
        { ...subscription, enabled: false, expiresAt: NOW - DAY },
        NOW,
        t,
      ),
    ).toBeNull();
  });
  test('does not warn beyond 30 days or without a known expiry', () => {
    expect(
      devinSubscriptionLoginWarning({ ...subscription, expiresAt: NOW + 30 * DAY + 1 }, NOW, t),
    ).toBeNull();
    expect(
      devinSubscriptionLoginWarning({ ...subscription, expiresAt: null }, NOW, t),
    ).toBeNull();
  });
});
