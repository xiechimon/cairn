import { projectMergeConfigSchema } from '@cairn/shared';
import { afterEach, expect, test, vi } from 'vitest';
import { project } from '../src/db/schema.js';
import type { AutonomousToken } from '../src/lib/github-token.js';
import { autonomousMergePolicy } from '../src/services/autonomous-merge.js';
import {
  pauseGithubRepo,
  pauseTeamGithubReposAutonomously,
  readGithubAutonomyPause,
  syncAutonomyPauses,
} from '../src/services/github-autonomy-brake.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { recentRecoveryTarget } from '../src/services/github-recovery.js';
import { newGateReadCache } from '../src/services/merge-gate/github-facts.js';
import { stubGithubApp } from './github-identity-fixture.js';
import { bootServer } from './helpers.js';

afterEach(() => vi.restoreAllMocks());

function teamMarkersWorld() {
  const open = new Set<string>();
  let readsFail = false;
  const posted: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const repo = url.pathname.split('/').slice(2, 4).join('/');
    if (url.pathname.endsWith('/issues') && init?.method === 'POST') {
      posted.push(repo);
      open.add(repo);
      return Response.json({ number: 7 });
    }
    if (url.pathname.endsWith('/issues')) {
      if (readsFail) return new Response('', { status: 502 });
      return Response.json(open.has(repo) ? [{ number: 7 }] : []);
    }
    return Response.json({ name: 'autonomy-paused' });
  };
  const s = bootServer({ githubFetch: fetchImpl });
  for (const [id, repo] of [
    ['alpha', 'octo/alpha'],
    ['beta', 'octo/beta'],
    ['local', null],
  ] as const)
    s.db
      .insert(project)
      .values({
        id,
        teamId: s.team.id,
        name: id,
        repoKind: repo === null ? 'local' : 'github',
        githubRepo: repo,
      })
      .run();
  upsertGithubConnection(
    { db: s.db, box: s.secretBox },
    { teamId: s.team.id, login: 'owner', accessToken: 'token', scope: 'repo' },
  );
  stubGithubApp(null);
  const deps = { ...s.svc, box: s.secretBox, githubFetch: fetchImpl };
  const localPaused = () =>
    autonomousMergePolicy(
      s.db,
      s.team.id,
      projectMergeConfigSchema.parse({ mergePolicy: 'autonomous' }),
    ).autonomyPaused;
  return {
    s,
    deps,
    open,
    posted,
    localPaused,
    failReads: () => {
      readsFail = true;
    },
  };
}

test('an automatic pause in one repository pauses every team repository and the local projects; closing the markers resumes them all', async () => {
  const w = teamMarkersWorld();
  try {
    await pauseTeamGithubReposAutonomously(w.deps, w.s.team.id, 'Main check failed in octo/alpha.');
    expect(w.posted.sort()).toEqual(['octo/alpha', 'octo/beta']);
    expect(w.localPaused()).toBe(true);
    w.open.delete('octo/alpha');
    await syncAutonomyPauses(w.deps);
    expect(w.localPaused()).toBe(true);
    w.open.clear();
    await syncAutonomyPauses(w.deps);
    expect(w.localPaused()).toBe(false);
  } finally {
    w.s.dispose();
  }
});

test('an unreadable marker keeps the team paused', async () => {
  const w = teamMarkersWorld();
  try {
    await pauseTeamGithubReposAutonomously(w.deps, w.s.team.id);
    w.open.clear();
    w.failReads();
    await syncAutonomyPauses(w.deps);
    expect(w.localPaused()).toBe(true);
  } finally {
    w.s.dispose();
  }
});

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
  await pauseGithubRepo(
    fetchImpl,
    'token' as AutonomousToken,
    'owner/repo',
    'Paused in the product',
  );
  await pauseGithubRepo(fetchImpl, 'token' as AutonomousToken, 'owner/repo', 'Paused again');
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
