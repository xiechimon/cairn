import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLAUDE_CODE_AUTH_FAILURE_MARKER, isProviderAuthFailure } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  claudeCodeSubscriptionMissingMessage,
  claudeCodeTeamSubscriptionAuthFailureMessage,
  parseClaudeCodeAuthStatus,
  probeClaudeCodeAuth,
} from '../src/claude-code-auth.js';
import { testTempDir } from './test-temp-dir.js';

function statusJson(fields: Record<string, unknown>): string {
  return JSON.stringify({
    loggedIn: true,
    authMethod: 'oauth_token',
    apiProvider: 'firstParty',
    analyticsDisabled: false,
    projectsDirectory: '/home/u/.claude/projects',
    configDirectory: '/home/u/.claude',
    ...fields,
  });
}

describe('parseClaudeCodeAuthStatus', () => {
  test('failure mode 1: logged out → not-logged-in', () => {
    expect(parseClaudeCodeAuthStatus(statusJson({ loggedIn: false, authMethod: 'none' }))).toEqual({
      state: 'not-logged-in',
      provider: 'firstParty',
    });
  });

  test('failure mode 2: OAuth login → logged-in', () => {
    expect(parseClaudeCodeAuthStatus(statusJson({ authMethod: 'oauth_token' }))).toEqual({
      state: 'logged-in',
      method: 'oauth_token',
      provider: 'firstParty',
    });
  });

  test('failure mode 3: apiKeyHelper → logged-in (apiKeySource carried along)', () => {
    const raw = statusJson({ authMethod: 'api_key_helper', apiKeySource: 'apiKeyHelper' });
    expect(parseClaudeCodeAuthStatus(raw)).toEqual({
      state: 'logged-in',
      method: 'api_key_helper',
      provider: 'firstParty',
    });
  });

  test('failure mode 4: third-party provider (bedrock) → logged-in (verdict reads loggedIn only)', () => {
    const raw = statusJson({ authMethod: 'third_party', apiProvider: 'bedrock' });
    expect(parseClaudeCodeAuthStatus(raw)).toEqual({
      state: 'logged-in',
      method: 'third_party',
      provider: 'bedrock',
    });
  });

  test('failure mode 5: non-JSON / non-object / missing loggedIn → unknown (does not block the step)', () => {
    for (const raw of ['', 'not json', '[]', '"str"', JSON.stringify({ authMethod: 'none' })]) {
      const parsed = parseClaudeCodeAuthStatus(raw);
      expect(parsed.state).toBe('unknown');
    }
  });
});

describe('probeClaudeCodeAuth', () => {
  test('failure mode 6: command not executable → unknown (no throw, no block)', async () => {
    const probe = await probeClaudeCodeAuth({
      command: 'cairn-no-such-claude-binary',
      timeoutMs: 2_000,
    });
    expect(probe.state).toBe('unknown');
  });

  test('injected run: stdout goes through parse (success path spawns no real CLI)', async () => {
    const probe = await probeClaudeCodeAuth({
      run: async () => ({ stdout: statusJson({ loggedIn: false, authMethod: 'none' }) }),
    });
    expect(probe).toEqual({ state: 'not-logged-in', provider: 'firstParty' });
  });

  test('failure mode 6b: real subprocess rc=1 + JSON stdout → verdict as usual (not folded into unknown by the exit code)', async () => {
    const dir = testTempDir('cairn-cc-auth-');
    const stub = join(dir, 'claude');
    writeFileSync(
      stub,
      `#!/bin/sh\necho '${statusJson({ loggedIn: false, authMethod: 'none' })}'\nexit 1\n`,
    );
    chmodSync(stub, 0o755);
    try {
      const probe = await probeClaudeCodeAuth({ command: stub, timeoutMs: 5_000 });
      expect(probe).toEqual({ state: 'not-logged-in', provider: 'firstParty' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('injected run: run throws → unknown (reason kept in the reason field)', async () => {
    const probe = await probeClaudeCodeAuth({
      run: async () => {
        throw new Error('spawn claude ENOENT');
      },
    });
    expect(probe.state).toBe('unknown');
    expect(probe.state === 'unknown' && probe.reason).toContain('ENOENT');
  });
});

describe('claudeCodeSubscriptionMissingMessage', () => {
  test('is an auth failure that asks for a stored subscription, not a Runner login', () => {
    const msg = claudeCodeSubscriptionMissingMessage();
    expect(msg).toContain(CLAUDE_CODE_AUTH_FAILURE_MARKER);
    expect(isProviderAuthFailure(msg)).toBe(true);
    expect(msg).toContain('claude setup-token');
    expect(msg).toContain('设置 → 模型服务');
    expect(msg).not.toContain('/login');
  });
});

describe('claudeCodeTeamSubscriptionAuthFailureMessage', () => {
  test('names the rejected team subscription, CLI reason and token replacement remedy', () => {
    const msg = claudeCodeTeamSubscriptionAuthFailureMessage('OAuth token revoked');
    expect(msg).toContain(CLAUDE_CODE_AUTH_FAILURE_MARKER);
    expect(isProviderAuthFailure(msg)).toBe(true);
    expect(msg).toContain('你的 Claude 订阅登录已失效');
    expect(msg).toContain('Coordinator 和任务');
    expect(msg).toContain('OAuth token revoked');
    expect(msg).toContain('设置 → 模型服务');
    expect(msg).toContain('移除');
    expect(msg).toContain('claude setup-token');
    expect(msg).not.toContain('claude auth status');
    expect(msg).not.toContain('/login');
  });
});
