import { createServer } from 'node:http';
import { join } from 'node:path';
import { afterEach, expect, expectTypeOf, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { loadConfig } from '../src/config.js';
import { type AppToken, tokenValue, type UserToken } from '../src/lib/github-token.js';
import { appGithubFetch, appTokenOrNull } from '../src/services/github-app-token.js';
import * as connection from '../src/services/github-connection.js';

const repo = { owner: 'octo', repo: 'alpha' };
const disposals: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dispose of disposals.splice(0).reverse()) await dispose();
});

async function mint(options: { status?: number; payload?: unknown } = {}) {
  const dir = makeTestTempDir('app-provider-');
  disposals.push(async () => releaseTestTempDir(dir));
  const socketPath = join(dir, 'mint.sock');
  const refreshes: boolean[] = [];
  const server = createServer((req, res) => {
    refreshes.push(req.headers['x-cairn-refresh'] === '1');
    res.statusCode = options.status ?? 200;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify(
        options.payload ?? {
          token: `app-${refreshes.length}`,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          installationId: 456,
          appSlug: 'cairnwright',
        },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  disposals.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const reason = vi.fn();
  return {
    deps: { config: { githubAppTokenSocket: socketPath }, onReason: reason },
    refreshes,
    reason,
  };
}

function installed() {
  return Response.json({ total_count: 1, repositories: [{ full_name: 'octo/alpha' }] });
}

test('unconfigured and missing sockets return structured reasons without throwing', async () => {
  const onReason = vi.fn();
  vi.stubEnv('CAIRN_AUTH', 'off');
  vi.stubEnv('CAIRN_APP_TOKEN_SOCKET', '');
  expect(loadConfig().githubAppTokenSocket).toBeNull();
  vi.stubEnv('CAIRN_APP_TOKEN_SOCKET', '/configured/app.sock');
  expect(loadConfig().githubAppTokenSocket).toBe('/configured/app.sock');
  expect(
    await appTokenOrNull({ config: { githubAppTokenSocket: null }, onReason }, repo),
  ).toBeNull();
  expect(onReason).toHaveBeenLastCalledWith({ reason: 'app-token-unconfigured', ...repo });
  expect(
    await appTokenOrNull({ config: { githubAppTokenSocket: '/missing/app.sock' }, onReason }, repo),
  ).toBeNull();
  expect(onReason).toHaveBeenLastCalledWith({ reason: 'app-token-unavailable', ...repo });
});

test('uninstalled repository fails closed; membership cached with token and case insensitive', async () => {
  const { deps, reason, refreshes } = await mint();
  const fetch = vi.fn(async () => installed());
  vi.stubGlobal('fetch', fetch);
  const token = await appTokenOrNull(deps, repo);
  expect(token && tokenValue(token)).toBe('app-1');
  expect(await appTokenOrNull(deps, { owner: 'OCTO', repo: 'ALPHA' })).toBe(token);
  expect(await appTokenOrNull(deps, { owner: 'octo', repo: 'other' })).toBeNull();
  expect(reason).toHaveBeenLastCalledWith({
    reason: 'repo-not-installed',
    owner: 'octo',
    repo: 'other',
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(refreshes).toEqual([false]);
});

test('membership pagination covers repositories after the first hundred', async () => {
  const { deps } = await mint();
  const fetch = vi.fn(async (input: string | URL) =>
    String(input).endsWith('page=1')
      ? Response.json({
          total_count: 101,
          repositories: Array.from({ length: 100 }, (_, i) => ({ full_name: `octo/r${i}` })),
        })
      : installed(),
  );
  vi.stubGlobal('fetch', fetch);
  expect(await appTokenOrNull(deps, repo)).not.toBeNull();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('App request 401 forces exactly one re-mint and never calls user refresh', async () => {
  const { deps, refreshes } = await mint();
  const userRefresh = vi.spyOn(connection, 'refreshingGithubFetch');
  const auth: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input).includes('/installation/repositories')) return installed();
      auth.push(new Headers(init?.headers).get('authorization') ?? '');
      return new Response(null, { status: 401 });
    }),
  );
  const result = await appGithubFetch(
    deps,
    repo,
    'https://api.github.com/repos/octo/alpha/issues',
    { method: 'POST' },
  );
  expect(result?.status).toBe(401);
  expect(auth).toEqual(['Bearer app-1', 'Bearer app-2']);
  expect(refreshes).toEqual([false, true]);
  expect(userRefresh).not.toHaveBeenCalled();
});

test('membership 401 retries once and network failure fails closed', async () => {
  const { deps, refreshes, reason } = await mint();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 401 })),
  );
  expect(await appTokenOrNull(deps, repo)).toBeNull();
  expect(refreshes).toEqual([false, true]);
  expect(reason).toHaveBeenLastCalledWith({ reason: 'app-token-unavailable', ...repo });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('private upstream details');
    }),
  );
  expect(await appTokenOrNull(deps, repo)).toBeNull();
  expect(JSON.stringify(reason.mock.calls)).not.toContain('private upstream details');
});

test('App fetch refuses another origin before obtaining a token', async () => {
  const { deps, refreshes } = await mint();
  await expect(appGithubFetch(deps, repo, 'https://example.com/steal')).rejects.toThrow(
    'GitHub API',
  );
  expect(refreshes).toEqual([]);
});

test('token kinds and plain strings are mutually non-assignable', () => {
  expectTypeOf<AppToken>().not.toExtend<UserToken>();
  expectTypeOf<UserToken>().not.toExtend<AppToken>();
  expectTypeOf<string>().not.toExtend<AppToken>();
  expectTypeOf<string>().not.toExtend<UserToken>();
});

test('mint HTTP errors, malformed payloads and malformed membership never escape', async () => {
  for (const options of [{ status: 502 }, { payload: { token: 'missing-metadata' } }]) {
    const { deps, reason } = await mint(options);
    expect(await appTokenOrNull(deps, repo)).toBeNull();
    expect(reason).toHaveBeenLastCalledWith({ reason: 'app-token-unavailable', ...repo });
  }
  const { deps, reason } = await mint();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ repositories: 'invalid' })),
  );
  expect(await appTokenOrNull(deps, repo)).toBeNull();
  expect(reason).toHaveBeenLastCalledWith({ reason: 'app-token-unavailable', ...repo });
});

test('expiry refreshes both the token and its repository membership', async () => {
  const { deps, refreshes, reason } = await mint();
  const fetch = vi.fn(async () => installed());
  vi.stubGlobal('fetch', fetch);
  expect(await appTokenOrNull(deps, repo)).not.toBeNull();
  const clock = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(clock + 3300_000);
  fetch.mockImplementation(async () => Response.json({ total_count: 0, repositories: [] }));
  expect(await appTokenOrNull(deps, repo)).toBeNull();
  expect(refreshes).toEqual([false, false]);
  expect(reason).toHaveBeenLastCalledWith({ reason: 'repo-not-installed', ...repo });
});

test('401 never writes when refreshed installation no longer covers the repo', async () => {
  const { deps, refreshes } = await mint();
  let membershipCalls = 0;
  let writes = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      if (String(input).includes('/installation/repositories')) {
        membershipCalls++;
        return membershipCalls === 1
          ? installed()
          : Response.json({ total_count: 0, repositories: [] });
      }
      writes++;
      return new Response(null, { status: 401 });
    }),
  );
  expect(
    await appGithubFetch(deps, repo, 'https://api.github.com/repos/octo/alpha/issues', {
      method: 'POST',
    }),
  ).toBeNull();
  expect(writes).toBe(1);
  expect(refreshes).toEqual([false, true]);
});

test('distinct deps on one socket share concurrent and cached installation work', async () => {
  const { deps, refreshes } = await mint();
  let resolveListing!: (response: Response) => void;
  const listing = new Promise<Response>((resolve) => {
    resolveListing = resolve;
  });
  let resolveStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  const fetch = vi.fn(() => {
    resolveStarted();
    return listing;
  });
  vi.stubGlobal('fetch', fetch);
  const first = appTokenOrNull({ ...deps }, repo);
  await started;
  const second = appTokenOrNull({ ...deps, config: { ...deps.config } }, repo);
  resolveListing(installed());
  const tokens = await Promise.all([first, second]);
  expect(tokens.every((token) => token !== null)).toBe(true);
  expect(tokens[0] === tokens[1]).toBe(true);
  expect((await appTokenOrNull({ ...deps }, repo)) === tokens[0]).toBe(true);
  expect(refreshes).toEqual([false]);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('failed mint is evicted so the next call on the same socket retries', async () => {
  const options = { status: 502 };
  const { deps, refreshes } = await mint(options);
  const fetch = vi.fn(async () => installed());
  vi.stubGlobal('fetch', fetch);
  expect(
    await Promise.all([appTokenOrNull({ ...deps }, repo), appTokenOrNull({ ...deps }, repo)]),
  ).toEqual([null, null]);
  options.status = 200;
  expect((await appTokenOrNull({ ...deps }, repo)) !== null).toBe(true);
  expect(refreshes).toEqual([false, false]);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('injected fetch handles listing and App requests with redirects disabled', async () => {
  const { deps, refreshes } = await mint();
  const globalFetch = vi.fn(async () => {
    throw new Error('global fetch must not be used');
  });
  vi.stubGlobal('fetch', globalFetch);
  const fetchImpl = vi.fn(async (input: string | URL, _init?: RequestInit) =>
    String(input).includes('/installation/repositories')
      ? installed()
      : new Response(null, { status: 204 }),
  );
  const injected = { ...deps, fetchImpl };
  await expect(appGithubFetch(injected, repo, 'https://example.com/steal')).rejects.toThrow(
    'GitHub API',
  );
  expect(refreshes).toEqual([]);
  expect(fetchImpl).not.toHaveBeenCalled();
  const response = await appGithubFetch(
    injected,
    repo,
    'https://api.github.com/repos/octo/alpha/issues',
    { method: 'POST', headers: { accept: 'application/vnd.github+json' }, redirect: 'follow' },
  );
  expect(response?.status).toBe(204);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  for (const call of fetchImpl.mock.calls) expect(call[1]).toMatchObject({ redirect: 'error' });
  expect(globalFetch).not.toHaveBeenCalled();
});
