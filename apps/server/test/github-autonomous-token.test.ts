import { afterEach, expect, expectTypeOf, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { loadConfig } from '../src/config.js';
import { openMemoryDb } from '../src/db/client.js';
import { project } from '../src/db/schema.js';
import type {
  githubComment,
  githubCreateCommitStatus,
  githubMergePull,
  githubReplyReviewThread,
  githubResolveReviewThread,
} from '../src/lib/github.js';
import type {
  githubSetPullDraft,
  githubSetReviewHoldLabel,
} from '../src/lib/github-review-findings.js';
import {
  type AppToken,
  type AutonomousToken,
  registerAppToken,
  type UserToken,
} from '../src/lib/github-token.js';
import * as app from '../src/services/github-app-token.js';
import { autonomousToken, githubReadToken } from '../src/services/github-autonomous-token.js';
import { pauseTeamGithubRepos } from '../src/services/github-autonomy-brake.js';
import * as connection from '../src/services/github-connection.js';
import { githubGatePort } from '../src/services/merge-gate-github.js';
import { createTodo, flushSelfIssueWrites } from '../src/services/todos.js';
import { stubGithubApp } from './github-identity-fixture.js';
import { bootServer, req } from './helpers.js';

const repo = { owner: 'octo', repo: 'alpha' };
afterEach(() => vi.restoreAllMocks());

test('autonomous resolver prefers App and records only safe fallback context', async () => {
  const db = openMemoryDb();
  const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const user = vi.spyOn(connection, 'userTokenOrNull').mockResolvedValue('fake-user' as UserToken);
  const provider = vi.spyOn(app, 'appTokenOrNull').mockResolvedValue('fake-app' as AppToken);
  const deps = { db };
  expect(await autonomousToken(deps, 'team', repo)).toBe('fake-app');
  expect(user).not.toHaveBeenCalled();
  provider.mockImplementation(async (input) => {
    input.onReason?.({ ...repo, reason: 'repo-not-installed' });
    return null;
  });
  expect(await autonomousToken(deps, 'team', repo)).toBe('fake-user');
  expect(log).toHaveBeenCalledWith(
    'github write unattributed',
    expect.objectContaining({
      ...repo,
      reason: 'repo-not-installed',
      callSite: expect.any(String),
    }),
  );
  expect(JSON.stringify(log.mock.calls).includes('fake-user')).toBe(false);
  user.mockResolvedValue(null);
  expect(await autonomousToken(deps, 'team', repo)).toBeNull();
});

test('status permission failure falls back exactly once, other errors do not', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  for (const status of [403, 401, 500]) {
    const fetch = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      Response.json({ message: 'Resource not accessible by integration' }, { status }),
    );
    registerAppToken('fake-app' as AppToken, Date.now() + 60000, (inner) => inner);
    const fallback = vi.fn(async () => 'fake-user' as UserToken);
    const port = githubGatePort(
      fetch,
      'fake-app' as AppToken,
      repo.owner,
      repo.repo,
      1000,
      fallback,
    );
    await port.createStatus('a'.repeat(40), { state: 'success', context: 'test', description: '' });
    expect(fetch).toHaveBeenCalledTimes(status === 403 ? 2 : 1);
    expect(fallback).toHaveBeenCalledTimes(status === 403 ? 1 : 0);
    expect(
      fetch.mock.calls.map((call) => new Headers(call[1]?.headers).get('authorization')),
    ).toEqual(status === 403 ? ['Bearer fake-app', 'Bearer fake-user'] : ['Bearer fake-app']);
  }
});

test('write signatures reject unbranded strings and merge rejects App identity', () => {
  expectTypeOf<AppToken>().not.toExtend<Parameters<typeof githubMergePull>[1]>();
  expectTypeOf<UserToken>().toExtend<Parameters<typeof githubMergePull>[1]>();
  expectTypeOf<string>().not.toExtend<Parameters<typeof githubSetPullDraft>[1]>();
  expectTypeOf<string>().not.toExtend<Parameters<typeof githubSetReviewHoldLabel>[1]>();
  expectTypeOf<string>().not.toExtend<Parameters<typeof githubCreateCommitStatus>[1]>();
  expectTypeOf<string>().not.toExtend<Parameters<typeof githubReplyReviewThread>[1]>();
  expectTypeOf<string>().not.toExtend<Parameters<typeof githubResolveReviewThread>[1]>();
  expectTypeOf<string>().not.toExtend<Parameters<typeof githubComment>[1]>();
  expectTypeOf<AutonomousToken>().toExtend<Parameters<typeof githubReplyReviewThread>[1]>();
  expectTypeOf<AutonomousToken>().toExtend<Parameters<typeof githubResolveReviewThread>[1]>();
  expectTypeOf<AutonomousToken>().toExtend<Parameters<typeof githubComment>[1]>();
  expectTypeOf<AutonomousToken>().toExtend<Parameters<typeof githubSetPullDraft>[1]>();
  expectTypeOf<AutonomousToken>().toExtend<Parameters<typeof githubSetReviewHoldLabel>[1]>();
  expectTypeOf<AutonomousToken>().toExtend<Parameters<typeof githubCreateCommitStatus>[1]>();
});

test('human pause click keeps the user token while App is available', async () => {
  const writes: boolean[] = [];
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST')
      writes.push(new Headers(init.headers).get('authorization') === 'Bearer identity-test-user');
    return Response.json(String(_input).includes('/issues?') ? [] : { number: 1 });
  };
  const s = bootServer({ githubFetch: fetch });
  try {
    s.db
      .insert(project)
      .values({
        id: 'identity-project',
        name: 'identity',
        teamId: s.team.id,
        repoKind: 'github',
        githubRepo: 'octo/alpha',
      })
      .run();
    connection.upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId: s.team.id, login: 'human', accessToken: 'identity-test-user', scope: 'repo' },
    );
    stubGithubApp(null);
    const result = await req(s.app, 'PATCH', `/api/teams/${s.team.id}`, { autonomyPaused: true });
    expect(result.status).toBe(200);
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every(Boolean)).toBe(true);
  } finally {
    s.dispose();
  }
});

test.each([autonomousToken, githubReadToken])(
  'resolved config socket is used and explicit null overrides environment: %s',
  async (resolve) => {
    const db = openMemoryDb();
    vi.stubEnv('CAIRN_APP_TOKEN_SOCKET', '/environment.sock');
    vi.stubEnv('CAIRN_GITHUB_APP_SLUG', 'cairnwright');
    vi.stubEnv('CAIRN_GITHUB_APP_BOT_ID', '347615582');
    const provider = vi.spyOn(app, 'appTokenOrNull').mockResolvedValue('fake-app' as AppToken);
    try {
      const config = loadConfig({ authToken: null, githubAppTokenSocket: '/config.sock' });
      await resolve({ db, githubAppTokenSocket: config.githubAppTokenSocket }, 'team', repo);
      expect(provider.mock.calls.at(-1)?.[0].config.githubAppTokenSocket).toBe('/config.sock');
      await resolve({ db, githubAppTokenSocket: null }, 'team', repo);
      expect(provider.mock.calls.at(-1)?.[0].config.githubAppTokenSocket).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  },
);

test('human service entry points resolve UserToken internally with App available', async () => {
  const writes: boolean[] = [];
  const githubFetch: typeof fetch = async (input, init) => {
    if (init?.method === 'POST')
      writes.push(
        new Headers(init.headers).get('authorization') === 'Bearer service-human-fixture',
      );
    return Response.json(String(input).includes('/issues?') ? [] : { number: 1 });
  };
  const home = makeTestTempDir('human-identity-');
  vi.stubEnv('CAIRN_HOME', home);
  vi.stubEnv('CAIRN_GITHUB_CREATE_MIN_INTERVAL_MS', '0');
  const s = bootServer({ githubFetch });
  try {
    s.db
      .insert(project)
      .values({
        id: 'human-service-project',
        teamId: s.team.id,
        name: 'project',
        repoKind: 'github',
        githubRepo: 'octo/alpha',
      })
      .run();
    connection.upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId: s.team.id, login: 'human', accessToken: 'service-human-fixture', scope: 'repo' },
    );
    stubGithubApp(null);
    const deps = { ...s.svc, box: s.secretBox, githubFetch };
    createTodo(deps, {
      teamId: s.team.id,
      projectId: 'human-service-project',
      title: 'human task',
      spec: 'spec',
      createdBy: s.user.id,
      ownerId: s.user.id,
    });
    await flushSelfIssueWrites();
    await pauseTeamGithubRepos(deps, s.team.id);
    expect(writes.length).toBeGreaterThan(1);
    expect(writes.every(Boolean)).toBe(true);
  } finally {
    s.dispose();
    vi.unstubAllEnvs();
    releaseTestTempDir(home);
  }
});
