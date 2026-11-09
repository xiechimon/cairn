import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectMergeConfigSchema } from '@cairn/shared';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';
import { project } from '../src/db/schema.js';
import type { AutonomousToken } from '../src/lib/github-token.js';
import { autonomousMergePolicy } from '../src/services/autonomous-merge.js';
import {
  pauseGithubRepo,
  pauseTeamAutonomy,
  readGithubAutonomyPause,
  syncAutonomyPauses,
} from '../src/services/github-autonomy-brake.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { recentRecoveryTarget } from '../src/services/github-recovery.js';
import { newGateReadCache } from '../src/services/merge-gate/github-facts.js';
import { stubGithubApp } from './github-identity-fixture.js';
import { bootServer, req } from './helpers.js';

afterEach(() => vi.restoreAllMocks());

function teamMarkersWorld() {
  const issues = new Map<string, { repo: string; number: number; open: boolean }>();
  let next = 7;
  let postsFail = false;
  const gates: (() => Promise<void>)[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const parts = url.pathname.split('/');
    const repo = parts.slice(2, 4).join('/');
    if (url.pathname.endsWith('/issues') && init?.method === 'POST') {
      const gate = gates.shift();
      if (gate !== undefined) await gate();
      if (postsFail) return new Response('', { status: 403 });
      const marker = { repo, number: next++, open: true };
      issues.set(`${repo}#${marker.number}`, marker);
      return Response.json({ number: marker.number });
    }
    if (url.pathname.endsWith('/issues'))
      return Response.json(
        [...issues.values()]
          .filter((issue) => issue.repo === repo && issue.open)
          .map((issue) => ({ number: issue.number })),
      );
    if (parts[4] === 'issues' && parts[5] !== undefined) {
      const issue = issues.get(`${repo}#${parts[5]}`);
      return issue === undefined
        ? new Response('', { status: 404 })
        : Response.json({ state: issue.open ? 'open' : 'closed' });
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
  return {
    s,
    deps,
    issues,
    paused: () =>
      autonomousMergePolicy(
        s.db,
        s.team.id,
        projectMergeConfigSchema.parse({ mergePolicy: 'autonomous' }),
      ).autonomyPaused,
    closeAll: () => {
      for (const issue of issues.values()) issue.open = false;
    },
    failPosts: (fail: boolean) => {
      postsFail = fail;
    },
    holdNextPost: () => {
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      gates.push(() => held);
      return release;
    },
  };
}

test('main red in repo A pauses repo B and the local projects; closing every published marker resumes them', async () => {
  const w = teamMarkersWorld();
  try {
    await pauseTeamAutonomy(w.deps, w.s.team.id, {
      source: 'main-red',
      reason: 'Main check failed in octo/alpha.',
    });
    expect([...w.issues.values()].map((issue) => issue.repo).sort()).toEqual([
      'octo/alpha',
      'octo/beta',
    ]);
    expect(w.paused()).toBe(true);
    const first = [...w.issues.values()][0];
    if (first) first.open = false;
    await syncAutonomyPauses(w.deps);
    expect(w.paused()).toBe(true);
    w.closeAll();
    await syncAutonomyPauses(w.deps);
    expect(w.paused()).toBe(false);
  } finally {
    w.s.dispose();
  }
});

test('a rejected publication stays paused through empty reads until the owner resumes, and names the error', async () => {
  const w = teamMarkersWorld();
  try {
    w.failPosts(true);
    await expect(
      pauseTeamAutonomy(w.deps, w.s.team.id, { source: 'unjudged-landing', reason: 'Unjudged.' }),
    ).rejects.toThrow();
    await syncAutonomyPauses(w.deps);
    await syncAutonomyPauses(w.deps);
    expect(w.paused()).toBe(true);
    const teams = (await (await req(w.s.app, 'GET', '/api/teams')).json()) as {
      autonomyPaused: boolean;
      autonomyPauses: { publishError: string | null }[];
    }[];
    expect(teams[0]?.autonomyPaused).toBe(true);
    expect(teams[0]?.autonomyPauses[0]?.publishError).toContain('403');
    expect(
      (
        await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}`, {
          autonomyPaused: false,
        })
      ).status,
    ).toBe(200);
    expect(w.paused()).toBe(false);
  } finally {
    w.s.dispose();
  }
});

test('a successful pause finishing after a failed concurrent pause cannot resume the failed one', async () => {
  const w = teamMarkersWorld();
  try {
    const release = w.holdNextPost();
    const slow = pauseTeamAutonomy(w.deps, w.s.team.id, {
      source: 'main-red',
      reason: 'Main check failed in octo/alpha.',
    });
    await vi.waitFor(() => expect(w.issues.size).toBe(1));
    w.failPosts(true);
    await expect(
      pauseTeamAutonomy(w.deps, w.s.team.id, { source: 'unjudged-landing', reason: 'Unjudged.' }),
    ).rejects.toThrow();
    w.failPosts(false);
    release();
    await slow;
    w.closeAll();
    await syncAutonomyPauses(w.deps);
    expect(w.paused()).toBe(true);
  } finally {
    w.s.dispose();
  }
});

test('after the owner resumes a failed pause, a new settings pause resumes once its markers close', async () => {
  const w = teamMarkersWorld();
  try {
    w.failPosts(true);
    await pauseTeamAutonomy(w.deps, w.s.team.id, {
      source: 'settings',
      reason: 'Paused by the team owner.',
    }).catch(() => undefined);
    await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}`, { autonomyPaused: false });
    w.failPosts(false);
    await pauseTeamAutonomy(w.deps, w.s.team.id, {
      source: 'settings',
      reason: 'Paused by the team owner.',
    });
    expect(w.paused()).toBe(true);
    w.closeAll();
    await syncAutonomyPauses(w.deps);
    expect(w.paused()).toBe(false);
  } finally {
    w.s.dispose();
  }
});

test('a settings pause sent again after its markers closed stays paused on its own new markers', async () => {
  const w = teamMarkersWorld();
  try {
    const pause = () =>
      req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}`, { autonomyPaused: true });
    expect((await pause()).status).toBe(200);
    w.closeAll();
    expect((await pause()).status).toBe(200);
    await syncAutonomyPauses(w.deps);
    expect(w.paused()).toBe(true);
    expect([...w.issues.values()].filter((issue) => issue.open)).toHaveLength(2);
  } finally {
    w.s.dispose();
  }
});

test('a repeated request key opens one entry, and an acknowledged key does not reopen', async () => {
  const w = teamMarkersWorld();
  try {
    const request = { source: 'main-red' as const, reason: 'Main red.', requestKey: 'main-red:a' };
    await pauseTeamAutonomy(w.deps, w.s.team.id, request);
    await pauseTeamAutonomy(w.deps, w.s.team.id, request);
    expect(w.issues.size).toBe(2);
    w.closeAll();
    await syncAutonomyPauses(w.deps);
    await pauseTeamAutonomy(w.deps, w.s.team.id, request);
    expect(w.paused()).toBe(false);
  } finally {
    w.s.dispose();
  }
});

test('an unreadable published marker keeps the pause', async () => {
  const w = teamMarkersWorld();
  try {
    await pauseTeamAutonomy(w.deps, w.s.team.id, { source: 'settings', reason: 'Paused.' });
    w.issues.clear();
    await syncAutonomyPauses(w.deps);
    expect(w.paused()).toBe(true);
  } finally {
    w.s.dispose();
  }
});

test('the migration turns a legacy team pause into an open entry the owner resume clears', () => {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  const directory = makeTestTempDir('cairn-autonomy-pause-migration-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  try {
    const cut = journal.entries.findIndex((entry) => entry.tag.endsWith('_autonomy_pause_entries'));
    expect(cut).toBeGreaterThan(0);
    const prior = join(directory, 'prior');
    mkdirSync(join(prior, 'meta'), { recursive: true });
    const entries = journal.entries.slice(0, cut);
    writeFileSync(join(prior, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    for (const entry of entries)
      copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(prior, `${entry.tag}.sql`));
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: prior });
    sqlite.exec(
      "INSERT INTO team (id, name, createdAt, autonomyPaused) VALUES ('latched', 'Latched', 1, 1), ('open', 'Open', 1, 0)",
    );
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    expect(
      sqlite
        .prepare('SELECT teamId, source, reason, markers, resolvedAt FROM autonomy_pause')
        .all(),
    ).toEqual([
      {
        teamId: 'latched',
        source: 'legacy',
        reason: 'legacy pause (no marker)',
        markers: '[]',
        resolvedAt: null,
      },
    ]);
  } finally {
    sqlite.close();
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
