import type { TeamRoutingSettings } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  antigravitySubscriptionLoginWarning,
  antigravitySubscriptionSignedOutWarning,
} from '../src/antigravity-login-warning.js';
import { subscriptionLoginWarning } from '../src/claude-login-warning.js';
import { coordinatorProviderOf } from '../src/coordinator-provider.js';
import { devinSubscriptionLoginWarning } from '../src/devin-login-warning.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;
const COORDINATOR_BLOCKED = 'Coordinator 和任务暂时无法使用';

function t(key: string, params?: Record<string, string | number>): string {
  if (params == null) return key;
  return Object.entries(params).reduce(
    (out, [name, value]) => out.replaceAll(`{${name}}`, String(value)),
    key,
  );
}

const claudeCoordinator: TeamRoutingSettings = {
  rules: [],
  policies: [],
  coordinatorDefault: { reason: 'claude-code', provider: 'claude-code', modelId: 'claude-opus-5-5' },
};

const antigravitySignedOut = {
  id: 'ag-sub-1',
  kind: 'antigravity-subscription' as const,
  label: 'Antigravity 订阅',
  hasToken: false,
  expiresAt: null,
  enabled: true,
  runnerId: 'bound-runner',
  runnerLogin: 'missing_local_login' as const,
  createdAt: 1,
};

describe('Coordinator-blocked attribution in login warnings', () => {
  test('an Antigravity sign-in problem does not blame the Coordinator when it runs on Claude Code', () => {
    const provider = coordinatorProviderOf(claudeCoordinator);
    expect(provider).toBe('claude-code');
    const signedOut = antigravitySubscriptionSignedOutWarning(
      antigravitySignedOut,
      t,
      provider === 'antigravity',
    );
    expect(signedOut).toContain('Antigravity 订阅');
    expect(signedOut).not.toContain('Coordinator');
    const expired = antigravitySubscriptionLoginWarning(
      { ...antigravitySignedOut, hasToken: true, expiresAt: NOW - DAY },
      NOW,
      t,
      provider === 'antigravity',
    );
    expect(expired).toContain('已过期');
    expect(expired).not.toContain('Coordinator');
  });

  test('the subscription the Coordinator runs on is named as blocking it', () => {
    const expired = subscriptionLoginWarning(
      { id: 's1', kind: 'claude-subscription', label: 'Personal', expiresAt: NOW - DAY, createdAt: NOW },
      NOW,
      t,
      coordinatorProviderOf(claudeCoordinator) === 'claude-code',
    );
    expect(expired).toContain(COORDINATOR_BLOCKED);
  });

  test('a stored coordinator rule wins over the default, and unknown settings blame nothing', () => {
    expect(
      coordinatorProviderOf({
        ...claudeCoordinator,
        rules: [
          {
            id: 'r1',
            teamId: 'team',
            use: 'coordinator',
            provider: 'devin',
            modelId: 'swe-2',
            thinkingLevel: null,
            fallbackModels: null,
            machineId: null,
            requiredCapabilities: null,
            seededFromAgentId: null,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    ).toBe('devin');
    expect(coordinatorProviderOf(undefined)).toBeNull();
    const devinExpired = devinSubscriptionLoginWarning(
      { id: 'd1', kind: 'devin-subscription', label: 'Devin', expiresAt: NOW - DAY, createdAt: NOW },
      NOW,
      t,
      false,
    );
    expect(devinExpired).toContain('已过期');
    expect(devinExpired).not.toContain('Coordinator');
  });
});
