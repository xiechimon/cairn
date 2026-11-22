import type { AntigravitySubscription, MachineRecord } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  antigravityRunnersSignedOut,
  antigravitySubscriptionSignedOutWarning,
} from '../src/antigravity-login-warning.js';

function t(key: string, params?: Record<string, string | number>): string {
  if (params == null) return key;
  return Object.entries(params).reduce(
    (out, [name, value]) => out.replaceAll(`{${name}}`, String(value)),
    key,
  );
}

function machine(antigravity: {
  installed: boolean;
  authenticated?: boolean;
  online?: boolean;
}): MachineRecord {
  return {
    id: 'm1',
    name: 'macbook',
    teamId: 't1',
    online: antigravity.online ?? true,
    kind: 'local',
    latestCliVersion: '1.0.0',
    enabledRuntimes: ['antigravity'],
    capabilities: {
      antigravity: {
        installed: antigravity.installed,
        ...(antigravity.authenticated === undefined
          ? {}
          : { authenticated: antigravity.authenticated }),
      },
    },
  } as MachineRecord;
}

const subscription = {
  id: 'ag-sub-1',
  kind: 'antigravity-subscription' as const,
  label: 'Antigravity 订阅',
  hasToken: false,
  expiresAt: null,
  enabled: true,
  createdAt: 1,
} satisfies AntigravitySubscription;

describe('antigravity runners signed out', () => {
  test('warns when every online runner reports installed but unauthenticated', () => {
    expect(
      antigravityRunnersSignedOut([machine({ installed: true, authenticated: false })]),
    ).toBe(true);
    expect(
      antigravityRunnersSignedOut([
        machine({ installed: true, authenticated: false }),
        machine({ installed: false, authenticated: false }),
      ]),
    ).toBe(true);
  });

  test('does not warn when any online runner is authenticated', () => {
    expect(
      antigravityRunnersSignedOut([
        machine({ installed: true, authenticated: false }),
        machine({ installed: true, authenticated: true }),
      ]),
    ).toBe(false);
  });

  test('does not warn without a report: nothing installed, offline, or unknown auth state', () => {
    expect(antigravityRunnersSignedOut(undefined)).toBe(false);
    expect(antigravityRunnersSignedOut([])).toBe(false);
    expect(antigravityRunnersSignedOut([machine({ installed: false })])).toBe(false);
    expect(
      antigravityRunnersSignedOut([
        machine({ installed: true, authenticated: false, online: false }),
      ]),
    ).toBe(false);
    expect(antigravityRunnersSignedOut([machine({ installed: true })])).toBe(false);
  });
});

describe('antigravity subscription signed-out warning', () => {
  test('warns an enabled host-keyring subscription in plain words', () => {
    const text = antigravitySubscriptionSignedOutWarning(subscription, t);
    expect(text).toContain('Antigravity 订阅');
    expect(text).toContain('模型路由');
    expect(text).toContain('重新登录');
  });

  test('does not warn a token subscription or a disabled one', () => {
    expect(
      antigravitySubscriptionSignedOutWarning({ ...subscription, hasToken: true }, t),
    ).toBeNull();
    expect(
      antigravitySubscriptionSignedOutWarning({ ...subscription, enabled: false }, t),
    ).toBeNull();
  });
});
