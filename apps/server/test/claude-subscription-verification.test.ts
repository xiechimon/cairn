import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { verifyClaudeSubscription } from '../src/services/claude-subscription-verification.js';

const TOKEN = `sk-ant-oat01-verification-test-token-${'z'.repeat(60)}`;

const dirs: string[] = [];
function fixtureDir(): string {
  const dir = makeTestTempDir('claude-verify-');
  dirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of dirs.splice(0)) releaseTestTempDir(dir);
});

function fakeClaude(dir: string, body: string): string {
  const path = join(dir, 'claude');
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return path;
}

function recordingBody(dir: string, tail: string): string {
  return [
    `printf '%s\\n' "$@" > "${dir}/argv"`,
    `env > "${dir}/env"`,
    `pwd > "${dir}/cwd"`,
    `if [ -d "$HOME" ]; then echo present > "${dir}/home-state"; fi`,
    tail,
  ].join('\n');
}

beforeEach(() => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-api03-must-not-leak');
  vi.stubEnv('CAIRN_MASTER_KEY', 'cairn-secret-must-not-leak');
  vi.stubEnv('HTTPS_PROXY', 'http://proxy.test:3128');
  vi.stubEnv('NO_PROXY', 'localhost');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('verifyClaudeSubscription', () => {
  test('exit status 0 verifies the token', async () => {
    const dir = fixtureDir();
    vi.stubEnv('CLAUDE_BIN', fakeClaude(dir, 'exit 0'));
    expect(await verifyClaudeSubscription(TOKEN)).toEqual({ ok: true });
  });

  test('an authentication failure is classified without echoing the output', async () => {
    const dir = fixtureDir();
    vi.stubEnv(
      'CLAUDE_BIN',
      fakeClaude(dir, `echo "Invalid authentication credentials ${TOKEN}" >&2\nexit 1`),
    );
    const result = await verifyClaudeSubscription(TOKEN);
    expect(result).toEqual({ ok: false, reason: 'auth' });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  test('a non-auth failure is classified as failed', async () => {
    const dir = fixtureDir();
    vi.stubEnv('CLAUDE_BIN', fakeClaude(dir, 'echo "region blocked" >&2\nexit 3'));
    expect(await verifyClaudeSubscription(TOKEN)).toEqual({ ok: false, reason: 'failed' });
  });

  test('a run that outlives the timeout is killed and classified as timeout', async () => {
    const dir = fixtureDir();
    vi.stubEnv('CLAUDE_BIN', fakeClaude(dir, 'exec sleep 20'));
    const started = Date.now();
    expect(await verifyClaudeSubscription(TOKEN, { timeoutMs: 200 })).toEqual({
      ok: false,
      reason: 'timeout',
    });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test('a missing binary is classified as unavailable', async () => {
    const dir = fixtureDir();
    vi.stubEnv('CLAUDE_BIN', join(dir, 'does-not-exist'));
    expect(await verifyClaudeSubscription(TOKEN)).toEqual({ ok: false, reason: 'unavailable' });
  });

  test('the child gets a clean environment and a throwaway HOME', async () => {
    const dir = fixtureDir();
    vi.stubEnv('CLAUDE_BIN', fakeClaude(dir, recordingBody(dir, 'exit 0')));
    await verifyClaudeSubscription(TOKEN);
    const env = readFileSync(join(dir, 'env'), 'utf8').split('\n');
    expect(env).toContain(`CLAUDE_CODE_OAUTH_TOKEN=${TOKEN}`);
    expect(env).toContain('HTTPS_PROXY=http://proxy.test:3128');
    expect(env).toContain('NO_PROXY=localhost');
    expect(env.join('\n')).not.toContain('ANTHROPIC_API_KEY');
    expect(env.join('\n')).not.toContain('must-not-leak');
    expect(env.filter((line) => line.startsWith('CAIRN_'))).toEqual([]);
    const home = env.find((line) => line.startsWith('HOME='))?.slice('HOME='.length);
    expect(home).toBeTruthy();
    expect(home).not.toBe(homedir());
    expect(home).not.toBe(process.env.HOME);
    expect(readFileSync(join(dir, 'home-state'), 'utf8').trim()).toBe('present');
    expect(existsSync(home ?? '')).toBe(false);
    expect(readFileSync(join(dir, 'cwd'), 'utf8').trim()).toBe(home);
  });

  test('the throwaway HOME is removed after a failure too', async () => {
    const dir = fixtureDir();
    vi.stubEnv('CLAUDE_BIN', fakeClaude(dir, recordingBody(dir, 'exit 1')));
    await verifyClaudeSubscription(TOKEN);
    const home = readFileSync(join(dir, 'env'), 'utf8')
      .split('\n')
      .find((line) => line.startsWith('HOME='))
      ?.slice('HOME='.length);
    expect(existsSync(home ?? '')).toBe(false);
  });

  test('the token never appears in argv or in the result', async () => {
    const dir = fixtureDir();
    vi.stubEnv('CLAUDE_BIN', fakeClaude(dir, recordingBody(dir, 'exit 0')));
    const result = await verifyClaudeSubscription(TOKEN);
    const argv = readFileSync(join(dir, 'argv'), 'utf8');
    expect(argv).toContain('-p');
    expect(argv).not.toContain(TOKEN);
    expect(argv).not.toContain('sk-ant');
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});
