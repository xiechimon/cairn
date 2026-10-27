import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import {
  parseClaudeOauthExpiresAt,
  readDefaultClaudeOauthExpiresAt,
} from '../src/claude-code-auth.js';

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

describe('readDefaultClaudeOauthExpiresAt', () => {
  test('uses the active config directory without falling back to the default account', () => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-auth-home-'));
    const custom = join(home, 'custom');
    const defaultDir = join(home, '.claude');
    mkdirSync(custom);
    mkdirSync(defaultDir);
    const credentials = (expiresAt: number) => JSON.stringify({ claudeAiOauth: { expiresAt } });
    writeFileSync(join(defaultDir, '.credentials.json'), credentials(100));
    writeFileSync(join(custom, '.credentials.json'), credentials(200));
    vi.stubEnv('HOME', home);
    try {
      vi.stubEnv('CLAUDE_CONFIG_DIR', custom);
      expect(readDefaultClaudeOauthExpiresAt()).toBe(200);
      writeFileSync(join(custom, '.credentials.json'), 'invalid');
      expect(readDefaultClaudeOauthExpiresAt()).toBeNull();
      rmSync(join(custom, '.credentials.json'));
      expect(readDefaultClaudeOauthExpiresAt()).toBeNull();
      vi.stubEnv('CLAUDE_CONFIG_DIR', '');
      expect(readDefaultClaudeOauthExpiresAt()).toBe(100);
    } finally {
      vi.unstubAllEnvs();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
