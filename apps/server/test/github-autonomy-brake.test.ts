import { expect, test } from 'vitest';
import { pauseGithubRepo, readGithubAutonomyPause } from '../src/services/github-autonomy-brake.js';
import { recentRecoveryTarget } from '../src/services/github-recovery.js';
import { newGateReadCache } from '../src/services/merge-gate/github-facts.js';

test('marker pause creates the label and issue once, and never closes a marker', async () => {
  const calls: { url: string; method: string; body: unknown }[] = [];
  let created = false;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (url.includes('/issues?')) return Response.json(created ? [{ number: 7 }] : []);
    if (url.endsWith('/labels/autonomy-paused')) return new Response('', { status: 404 });
    if (url.endsWith('/issues')) created = true;
    return Response.json({ number: 7 });
  };
  await pauseGithubRepo(fetchImpl, 'token', 'owner/repo', 'Paused in the product');
  await pauseGithubRepo(fetchImpl, 'token', 'owner/repo', 'Paused again');
  expect(calls.filter((call) => call.method === 'POST')).toEqual([
    expect.objectContaining({
      url: 'https://api.github.com/repos/owner/repo/labels',
      body: expect.objectContaining({ name: 'autonomy-paused' }),
    }),
    expect.objectContaining({
      url: 'https://api.github.com/repos/owner/repo/issues',
      body: expect.objectContaining({ labels: ['autonomy-paused'] }),
    }),
  ]);
});
test('an open marker is cached for 60 seconds, scoped by repository, and failures fail closed', async () => {
  const cache = newGateReadCache();
  let count = 0;
  const fetchImpl: typeof fetch = async () => {
    count++;
    return Response.json([{ number: 7 }]);
  };
  expect(await readGithubAutonomyPause(fetchImpl, 'token', 'owner/repo', cache, 0)).toBe(true);
  expect(await readGithubAutonomyPause(fetchImpl, 'token', 'owner/repo', cache, 59_999)).toBe(true);
  expect(count).toBe(1);
  expect(await readGithubAutonomyPause(fetchImpl, 'token', 'owner/repo', cache, 60_000)).toBe(true);
  expect(count).toBe(2);
  expect(
    await readGithubAutonomyPause(
      async () => new Response('', { status: 500 }),
      'token',
      'other/repo',
      cache,
      60_000,
    ),
  ).toBe(true);
});

test.each(['after-green', 'before-green', 'no-green'] as const)(
  'recovery eligibility window: %s',
  async (mode) => {
    const main = 'a'.repeat(40);
    const target = 'b'.repeat(40);
    const green = 'c'.repeat(40);
    expect(
      await recentRecoveryTarget(
        (async (input) => {
          const url = String(input);
          const sha = url.match(/(?:commits\/)([a-f0-9]{40})/)?.[1];
          if (url.includes('/check-runs'))
            return Response.json({
              check_runs: [
                {
                  id: 1,
                  name: 'check',
                  status: 'completed',
                  conclusion: sha === green && mode !== 'no-green' ? 'success' : 'failure',
                  app: { slug: 'github-actions' },
                },
              ],
            });
          const order = mode === 'before-green' ? [main, green, target] : [main, target, green];
          const index = order.indexOf(sha ?? '');
          return Response.json({
            parents: index >= 0 && index < 2 ? [{ sha: order[index + 1] }] : [],
          });
        }) as typeof fetch,
        'token',
        'owner/repo',
        main,
        target,
      ),
    ).toBe(mode === 'after-green');
  },
);

test('marker lookup paginates past labelled pull requests', async () => {
  const pages: string[] = [];
  expect(
    await readGithubAutonomyPause(
      (async (input) => {
        const url = String(input);
        pages.push(url);
        return Response.json(
          url.includes('page=2')
            ? [{ number: 101 }]
            : Array.from({ length: 100 }, (_, i) => ({ number: i + 1, pull_request: {} })),
        );
      }) as typeof fetch,
      'token',
      'owner/repo',
      newGateReadCache(),
      0,
    ),
  ).toBe(true);
  expect(pages).toHaveLength(2);
});
