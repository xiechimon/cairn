import { describe, expect, test } from 'vitest';
import { parseClaudeOauthExpiresAt } from '../src/claude-code-auth.js';

describe('parseClaudeOauthExpiresAt', () => {
  test('reads only claudeAiOauth.expiresAt and never returns token material', () => {
    const raw = JSON.stringify({
      claudeAiOauth: {
        accessToken: 'should-not-leak-access',
        refreshToken: 'should-not-leak-refresh',
        expiresAt: 1_793_033_004_890,
      },
      mcpOAuth: { token: 'should-not-leak-mcp' },
    });
    const expiresAt = parseClaudeOauthExpiresAt(raw);
    expect(expiresAt).toBe(1_793_033_004_890);
    expect(JSON.stringify(expiresAt)).not.toContain('should-not-leak');
  });

  test('missing, non-numeric, or unreadable expiry is null', () => {
    expect(parseClaudeOauthExpiresAt('not json')).toBeNull();
    expect(parseClaudeOauthExpiresAt('[]')).toBeNull();
    expect(parseClaudeOauthExpiresAt(JSON.stringify({ mcpOAuth: { expiresAt: 5 } }))).toBeNull();
    expect(
      parseClaudeOauthExpiresAt(
        JSON.stringify({ claudeAiOauth: { expiresAt: '1793033004890', accessToken: 'x' } }),
      ),
    ).toBeNull();
    expect(parseClaudeOauthExpiresAt(JSON.stringify({ claudeAiOauth: {} }))).toBeNull();
  });
});
