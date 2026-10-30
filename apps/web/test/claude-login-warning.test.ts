import { claudeLoginNotice } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { formatClaudeLoginWarning } from '../src/claude-login-warning.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function t(key: string, params?: Record<string, string | number>): string {
  if (params == null) return key;
  return Object.entries(params).reduce(
    (out, [name, value]) => out.replaceAll(`{${name}}`, String(value)),
    key,
  );
}

describe('formatClaudeLoginWarning', () => {
  test('expired and expiring notices name the machine and re-login command', () => {
    const expired = claudeLoginNotice({ state: 'expired', expiresAt: NOW - DAY }, NOW);
    expect(expired).not.toBeNull();
    expect(formatClaudeLoginWarning(expired!, 'ghost', t)).toBe(
      'ghost 上的 Claude Code 登录已过期。在该机器上运行 `claude auth login` 重新登录。',
    );

    const days = claudeLoginNotice({ state: 'expiring', expiresAt: NOW + 2 * DAY }, NOW);
    expect(days).not.toBeNull();
    expect(formatClaudeLoginWarning(days!, 'omarchy', t)).toBe(
      'omarchy 上的 Claude Code 登录将在 2 天后过期。在该机器上运行 `claude auth login` 重新登录。',
    );

    const one = claudeLoginNotice({ state: 'expiring', expiresAt: NOW + DAY }, NOW);
    expect(one).not.toBeNull();
    expect(formatClaudeLoginWarning(one!, 'omarchy', t)).toBe(
      'omarchy 上的 Claude Code 登录将在 1 天后过期。在该机器上运行 `claude auth login` 重新登录。',
    );

    const soon = claudeLoginNotice({ state: 'expiring', expiresAt: NOW + 12 * 60 * 60 * 1000 }, NOW);
    expect(soon).not.toBeNull();
    expect(formatClaudeLoginWarning(soon!, 'soon-box', t)).toBe(
      'soon-box 上的 Claude Code 登录将在不到 1 天内过期。在该机器上运行 `claude auth login` 重新登录。',
    );
  });
});
