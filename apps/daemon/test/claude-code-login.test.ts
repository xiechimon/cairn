import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  parseClaudeOauthExpiresAt,
  readDefaultClaudeOauthExpiresAt,
} from '../src/claude-code-auth.js';
import { testTempDir } from './test-temp-dir.js';

describe('parseClaudeOauthExpiresAt', () => {
  test('reads the refresh expiry and never returns token material', () => {
    const raw = JSON.stringify({
      claudeAiOauth: {
        accessToken: 'should-not-leak-access',
        refreshToken: 'should-not-leak-refresh',
        expiresAt: 1_793_033_004_890,
        refreshTokenExpiresAt: 1_795_033_004_890,
      },
      mcpOAuth: { token: 'should-not-leak-mcp' },
    });
    const expiresAt = parseClaudeOauthExpiresAt(raw);
    expect(expiresAt).toBe(1_795_033_004_890);
    expect(JSON.stringify(expiresAt)).not.toContain('should-not-leak');
  });

  test('uses the access clock only when no refresh token is available', () => {
    expect(parseClaudeOauthExpiresAt(JSON.stringify({ claudeAiOauth: { expiresAt: 100 } }))).toBe(
      100,
    );
    expect(
      parseClaudeOauthExpiresAt(
        JSON.stringify({ claudeAiOauth: { expiresAt: 100, refreshToken: 'fake' } }),
      ),
    ).toBeNull();
    expect(
      parseClaudeOauthExpiresAt(
        JSON.stringify({
          claudeAiOauth: { expiresAt: 100, refreshToken: 'fake', refreshTokenExpiresAt: 200 },
        }),
      ),
    ).toBe(200);
  });

  test('a usable access token outlives an expired refresh token', () => {
    expect(
      parseClaudeOauthExpiresAt(
        JSON.stringify({
          claudeAiOauth: { expiresAt: 200, refreshToken: 'fake', refreshTokenExpiresAt: 100 },
        }),
      ),
    ).toBe(200);
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
    expect(
      parseClaudeOauthExpiresAt(JSON.stringify({ claudeAiOauth: { expiresAt: 1e30 } })),
    ).toBeNull();
  });
});

describe('readDefaultClaudeOauthExpiresAt', () => {
  test('reads credentials from the given managed config directory', () => {
    const home = testTempDir('cairn-auth-home-');
    const custom = join(home, 'custom');
    const other = join(home, 'other');
    mkdirSync(custom);
    mkdirSync(other);
    const credentials = (expiresAt: number) => JSON.stringify({ claudeAiOauth: { expiresAt } });
    writeFileSync(join(other, '.credentials.json'), credentials(100));
    writeFileSync(join(custom, '.credentials.json'), credentials(200));
    try {
      expect(readDefaultClaudeOauthExpiresAt(custom)).toBe(200);
      expect(readDefaultClaudeOauthExpiresAt(relative(process.cwd(), custom))).toBeNull();
      writeFileSync(join(custom, '.credentials.json'), 'invalid');
      expect(readDefaultClaudeOauthExpiresAt(custom)).toBeNull();
      rmSync(join(custom, '.credentials.json'));
      expect(readDefaultClaudeOauthExpiresAt(custom)).toBeNull();
      expect(readDefaultClaudeOauthExpiresAt(other)).toBe(100);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
