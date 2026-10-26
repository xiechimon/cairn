import { rm } from 'node:fs/promises';
import { afterEach, expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { githubCreateIssue } from '../src/lib/github.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

test('parallel creates share slots and an explicit secondary limit retries successfully', async () => {
  const home = makeTestTempDir('github-create-server-');
  vi.stubEnv('CAIRN_HOME', home);
  vi.stubEnv('CAIRN_GITHUB_CREATE_MIN_INTERVAL_MS', '30');
  const calls: number[] = [];
  const upstream = vi.fn(async () => {
    calls.push(Date.now());
    const limited = calls.length === 1;
    return {
      ok: !limited,
      status: limited ? 403 : 201,
      headers: { get: (name: string) => (name === 'retry-after' ? '1' : null) },
      json: async () => ({ number: calls.length }),
      text: async () => 'secondary rate limit',
    };
  });
  try {
    const results = await Promise.all([
      githubCreateIssue(upstream, 'token', 'owner', 'repo', { title: 'first', body: '' }),
      githubCreateIssue(upstream, 'token', 'owner', 'repo', { title: 'second', body: '' }),
    ]);
    expect(results).toHaveLength(2);
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(calls[1]! - calls[0]!).toBeGreaterThanOrEqual(30);
    expect(calls[2]! - calls[0]!).toBeGreaterThanOrEqual(1000);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
