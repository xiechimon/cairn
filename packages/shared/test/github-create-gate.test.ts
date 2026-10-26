import { execFile } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { acquireGithubCreateSlot, parseGithubCreateRateLimit } from '../src/github-create-gate.js';

test('reservations respect spacing and a rolling hourly cap', async () => {
  const dir = makeTestTempDir('github-create-');
  let now = 1000;
  const delays: string[] = [];
  try {
    const options = {
      directory: dir,
      minIntervalMs: 100,
      hourlyCap: 2,
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
      onDelay: (reason: string) => {
        delays.push(reason);
      },
    };
    expect(await acquireGithubCreateSlot(options)).toBe(1000);
    expect(await acquireGithubCreateSlot(options)).toBe(1100);
    expect(await acquireGithubCreateSlot(options)).toBe(3601000);
    expect(delays).toContain('hourly cap');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('limits honor headers and secondary messages without retrying permissions', () => {
  const response = (status: number, values: Record<string, string>) => ({
    status,
    headers: { get: (name: string) => values[name] ?? null },
  });
  expect(parseGithubCreateRateLimit(response(403, { 'retry-after': '3' }), '', 1000)).toBe(3000);
  expect(parseGithubCreateRateLimit(response(429, { 'x-ratelimit-reset': '8' }), '', 1000)).toBe(
    7000,
  );
  expect(parseGithubCreateRateLimit(response(403, {}), 'secondary rate limit', 1000)).toBe(60000);
  expect(parseGithubCreateRateLimit(response(403, {}), 'Resource not accessible', 1000)).toBeNull();
});

test('an abandoned lock fails closed instead of waiting forever', async () => {
  const dir = makeTestTempDir('github-create-locked-');
  let now = 0;
  try {
    await mkdir(join(dir, 'lock'));
    await expect(
      acquireGithubCreateSlot({
        directory: dir,
        lockTimeoutMs: 100,
        now: () => now,
        sleep: async (ms) => {
          now += ms;
        },
      }),
    ).rejects.toThrow('GitHub create lock timed out');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('separate CLI processes reserve the same on-disk window', async () => {
  const home = makeTestTempDir('github-create-cli-');
  try {
    const run = () =>
      promisify(execFile)(
        process.execPath,
        [
          'scripts/lib/github-create-gate.mjs',
          process.execPath,
          '-e',
          'process.stdout.write("created")',
        ],
        { env: { ...process.env, CAIRN_HOME: home, CAIRN_GITHUB_CREATE_MIN_INTERVAL_MS: '40' } },
      );
    const results = await Promise.all([run(), run(), run()]);
    expect(results.map((result) => result.stdout)).toEqual(['created', 'created', 'created']);
    const timestamps: number[] = JSON.parse(
      await readFile(join(home, 'github-create/state.json'), 'utf8'),
    );
    expect(timestamps).toHaveLength(3);
    expect((timestamps[1] ?? Number.NaN) - (timestamps[0] ?? Number.NaN)).toBeGreaterThanOrEqual(
      40,
    );
    expect((timestamps[2] ?? Number.NaN) - (timestamps[1] ?? Number.NaN)).toBeGreaterThanOrEqual(
      40,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
