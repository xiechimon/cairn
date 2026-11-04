import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { HttpError } from '../src/lib/errors.js';
import { githubCreateIssue } from '../src/lib/github.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

test('parallel creates share slots and an explicit secondary limit retries successfully', async () => {
  const home = await mkdtemp(join(tmpdir(), 'github-create-server-'));
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

test('an unwritable gate directory surfaces as HttpError 503 naming the directory, with zero outbound calls', async () => {
  const home = await mkdtemp(join(tmpdir(), 'github-create-server-readonly-'));
  const directory = join(home, 'github-create');
  await mkdir(directory);
  await chmod(directory, 0o500);
  vi.stubEnv('CAIRN_HOME', home);
  const upstream = vi.fn(async () => ({
    ok: true,
    status: 201,
    headers: { get: () => null },
    json: async () => ({ number: 1 }),
    text: async () => '',
  }));
  try {
    const failure = await githubCreateIssue(upstream, 'token', 'owner', 'repo', {
      title: 'blocked by permissions',
      body: '',
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(HttpError);
    expect((failure as HttpError).status).toBe(503);
    expect((failure as HttpError).message).toContain(directory);
    expect((failure as HttpError).message).toMatch(/not writable/);
    expect(upstream).not.toHaveBeenCalled();
  } finally {
    await chmod(directory, 0o700);
    await rm(home, { recursive: true, force: true });
  }
});
