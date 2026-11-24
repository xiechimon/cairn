import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { type CommitIdentityPolicy, localCommitViolation } from '@cairn/shared';
import { afterEach, expect, expectTypeOf, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { loadConfig } from '../src/config.js';
import { type FetchLike, githubCreateCommitStatus } from '../src/lib/github.js';
import {
  type AppToken,
  githubAppBotLogin,
  tokenValue,
  type UserToken,
} from '../src/lib/github-token.js';
import { appGithubFetch, appTokenOrNull } from '../src/services/github-app-token.js';
import * as connection from '../src/services/github-connection.js';

const repo = { owner: 'octo', repo: 'alpha' };
const READ_SCOPE =
  'actions:read,checks:read,contents:read,issues:read,metadata:read,pull_requests:read,statuses:read';
const READ_QUERY = `permissions=${encodeURIComponent(READ_SCOPE)}`;
const disposals: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dispose of disposals.splice(0).reverse()) await dispose();
});

type MintScopeEcho = {
  repositories?: string[];
  permissions?: Record<string, string>;
  repositoryId?: number;
} | null;

async function mint(
  options: {
    status?: number;
    statusFor?: (index: number) => number | undefined;
    errorBody?: string;
    payload?: unknown;
    dir?: string;
    socketName?: string;
    hold?: (url: string) => Promise<void> | undefined;
    scope?: MintScopeEcho | ((force: boolean) => MintScopeEcho);
  } = {},
) {
  const dir = options.dir ?? makeTestTempDir('app-provider-');
  disposals.push(async () => releaseTestTempDir(dir));
  const socketPath = join(dir, options.socketName ?? 'mint.sock');
  const refreshes: boolean[] = [];
  const urls: string[] = [];
  const server = createServer(async (req, res) => {
    const force = req.headers['x-cairn-refresh'] === '1';
    refreshes.push(force);
    urls.push(req.url ?? '');
    const tokenIndex = refreshes.length;
    await options.hold?.(req.url ?? '');
    res.statusCode = options.statusFor?.(tokenIndex) ?? options.status ?? 200;
    res.setHeader('content-type', 'application/json');
    if (res.statusCode === 422) {
      res.end(JSON.stringify({ error: options.errorBody ?? 'repo-not-installed' }));
      return;
    }
    const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
    const requested = params.get('repository');
    const requestedId = params.get('repository_id');
    const requestedPerms = Object.fromEntries(
      (params.get('permissions') ?? '')
        .split(',')
        .filter((entry) => entry.includes(':'))
        .map((entry) => entry.split(':') as [string, string]),
    );
    const scope = typeof options.scope === 'function' ? options.scope(force) : options.scope;
    const granted =
      scope === undefined
        ? {
            repositories: [`octo/${requested}`],
            permissions: requestedPerms,
            ...(requestedId === null ? {} : { repositoryId: Number(requestedId) }),
          }
        : scope;
    res.end(
      JSON.stringify(
        options.payload ?? {
          token: `app-${tokenIndex}`,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          installationId: 456,
          appSlug: 'cairnwright',
          ...(granted === null
            ? {}
            : {
                repositories: granted.repositories,
                permissions: granted.permissions,
                ...(granted.repositoryId === undefined
                  ? {}
                  : { repositoryId: granted.repositoryId }),
              }),
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
    urls,
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
  vi.stubEnv('CAIRN_GITHUB_APP_SLUG', 'cairnwright');
  vi.stubEnv('CAIRN_GITHUB_APP_BOT_ID', '347615582');
  expect(loadConfig().githubAppTokenSocket).toBe('/configured/app.sock');
  expect(
    await appTokenOrNull(
      { config: { githubAppTokenSocket: null }, onReason },
      repo,
      false,
      300_000,
      'server-read',
    ),
  ).toBeNull();
  expect(onReason).toHaveBeenLastCalledWith({ reason: 'app-token-unconfigured', ...repo });
  expect(
    await appTokenOrNull(
      { config: { githubAppTokenSocket: '/missing/app.sock' }, onReason },
      repo,
      false,
      300_000,
      'server-read',
    ),
  ).toBeNull();
  expect(onReason).toHaveBeenLastCalledWith({ reason: 'app-token-unavailable', ...repo });
});

test('a minted repository token exposes the app bot login and caches case-insensitively', async () => {
  const { deps, refreshes } = await mint();
  const token = await appTokenOrNull(deps, repo, false, 300_000, 'server-read');
  expect(token && tokenValue(token)).toBe('app-1');
  expect(token && githubAppBotLogin(token)).toBe('cairnwright[bot]');
  expect(
    await appTokenOrNull(deps, { owner: 'OCTO', repo: 'ALPHA' }, false, 300_000, 'server-read'),
  ).toBe(token);
  expect(refreshes).toEqual([false]);
});

test('a pinned server token cache separates repository IDs and ignores name casing', async () => {
  const { deps, urls, reason } = await mint();
  const token = await appTokenOrNull(
    deps,
    { ...repo, repositoryId: 42 },
    false,
    300_000,
    'server-read',
  );
  expect(token && tokenValue(token)).toBe('app-1');
  expect(urls[0]).toContain('repository_id=42');
  const again = await appTokenOrNull(
    deps,
    { owner: 'OCTO', repo: 'ALPHA', repositoryId: 42 },
    false,
    300_000,
    'server-read',
  );
  expect(again).toBe(token);
  expect(urls).toHaveLength(1);
  await appTokenOrNull(deps, { ...repo, repositoryId: 43 }, false, 300_000, 'server-read');
  expect(urls).toHaveLength(2);
  expect(reason).not.toHaveBeenCalled();
});

test.each([true, false])(
  'a pinned runner reuses a case-insensitive grant and refuses a renamed repository on renewal (force: %s)',
  async (force) => {
    const clock = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(clock);
    const scope = {
      repositories: ['OCTO/ALPHA'],
      permissions: requestedGrants(),
      repositoryId: 42,
    };
    const { deps, reason, refreshes } = await mint({ scope });
    const pinned = { ...repo, repositoryId: 42 };
    const token = await appTokenOrNull(deps, pinned, false, 300_000, 'runner');
    expect(token && tokenValue(token)).toBe('app-1');

    scope.repositories = ['octo/renamed'];
    expect(
      await appTokenOrNull(
        deps,
        { ...pinned, owner: 'Octo', repo: 'Alpha' },
        false,
        300_000,
        'runner',
      ),
    ).toBe(token);
    expect(refreshes).toEqual([false]);

    if (!force) now.mockReturnValue(clock + 3300_000);
    expect(await appTokenOrNull(deps, pinned, force, 300_000, 'runner')).toBeNull();
    expect(reason).toHaveBeenLastCalledWith({ ...pinned, reason: 'repo-renamed' });
    expect(refreshes).toEqual(force ? [false, true] : [false, false, true]);
  },
);

test('a pinned server mint cannot reuse a token verified against a different name', async () => {
  const scope = {
    repositories: ['octo/alpha'],
    permissions: Object.fromEntries(READ_SCOPE.split(',').map((grant) => grant.split(':'))),
    repositoryId: 42,
  };
  const { deps, reason, refreshes } = await mint({ scope });
  const pinned = { ...repo, repositoryId: 42 };
  expect(await appTokenOrNull(deps, pinned, false, 300_000, 'server-read')).not.toBeNull();
  const differentName = { ...pinned, repo: 'beta' };
  expect(await appTokenOrNull(deps, differentName, false, 300_000, 'server-read')).toBeNull();
  expect(reason).toHaveBeenLastCalledWith({ ...differentName, reason: 'repo-renamed' });
  expect(refreshes).toEqual([false, false, true]);
});

test.each([200, 502])(
  'a mismatched ordinary mint uses one forced result (HTTP %s)',
  async (status) => {
    const { deps, reason, refreshes } = await mint({
      scope: (force) => ({
        repositories: [force ? 'octo/renamed' : 'octo/alpha'],
        permissions: requestedGrants(),
        repositoryId: 42,
      }),
      statusFor: (index) => (index === 2 ? status : 200),
    });
    const reconnected = { ...repo, repo: 'renamed', repositoryId: 42 };
    const tokens = await Promise.all([
      appTokenOrNull(deps, reconnected, false, 300_000, 'runner'),
      appTokenOrNull(deps, reconnected, false, 300_000, 'runner'),
    ]);
    expect(refreshes).toEqual([false, true]);
    if (status === 200) {
      expect(tokens.map((token) => token && tokenValue(token))).toEqual(['app-2', 'app-2']);
      expect(await appTokenOrNull(deps, reconnected, false, 300_000, 'runner')).toBe(tokens[0]);
      expect(refreshes).toEqual([false, true]);
      expect(reason).not.toHaveBeenCalled();
    } else {
      expect(tokens).toEqual([null, null]);
      expect(reason).toHaveBeenLastCalledWith({ ...reconnected, reason: 'app-token-unavailable' });
    }
  },
);

test('an ordinary fetch that joins a forced mint does not refresh a confirmed rename again', async () => {
  const { deps, reason, refreshes } = await mint({
    scope: {
      repositories: ['octo/renamed'],
      permissions: requestedGrants(),
      repositoryId: 42,
    },
  });
  const pinned = { ...repo, repositoryId: 42 };
  expect(
    await Promise.all([
      appTokenOrNull(deps, pinned, true, 300_000, 'runner'),
      appTokenOrNull(deps, pinned, false, 300_000, 'runner'),
    ]),
  ).toEqual([null, null]);
  expect(refreshes).toEqual([true]);
  expect(reason.mock.calls).toEqual([
    [{ ...pinned, reason: 'repo-renamed' }],
    [{ ...pinned, reason: 'repo-renamed' }],
  ]);
});

test('a minted repository id that differs from the requested id is refused', async () => {
  const { deps, reason } = await mint({
    scope: { repositories: ['octo/alpha'], permissions: requestedGrants(), repositoryId: 43 },
  });
  const token = await appTokenOrNull(deps, { ...repo, repositoryId: 42 }, false, 300_000, 'runner');
  expect(token).toBeNull();
  expect(reason).toHaveBeenLastCalledWith({
    reason: 'app-token-unavailable',
    ...repo,
    repositoryId: 42,
  });
});

test.each([
  ['missing', undefined],
  ['empty', []],
  ['multiple', ['octo/alpha', 'octo/beta']],
] as const)(
  'an ID-pinned mint with repository list %s is refused and not cached',
  async (_, repositories) => {
    const { deps, reason, urls } = await mint({
      scope: {
        ...(repositories === undefined ? {} : { repositories: [...repositories] }),
        permissions: requestedGrants(),
        repositoryId: 42,
      },
    });
    const pinned = { ...repo, repositoryId: 42 };
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await appTokenOrNull(deps, pinned, false, 300_000, 'runner')).toBeNull();
    }
    expect(reason).toHaveBeenCalledWith({ ...pinned, reason: 'app-token-unavailable' });
    expect(urls).toHaveLength(2);
  },
);

test.each(['alpha', 'octo/..', 'octo/alpha/extra', 'octo/alpha?', 'bad owner/alpha'])(
  'malformed pinned grant %j is unavailable, never a rename or a cache hit',
  async (fullName) => {
    const scope = { repositories: [fullName], permissions: requestedGrants(), repositoryId: 42 };
    const { deps, reason, refreshes } = await mint({ scope });
    const pinned = { ...repo, repositoryId: 42 };
    expect(await appTokenOrNull(deps, pinned, false, 300_000, 'runner')).toBeNull();
    expect(reason).toHaveBeenLastCalledWith({ ...pinned, reason: 'app-token-unavailable' });
    expect(refreshes).toEqual([false]);
    expect(await appTokenOrNull(deps, pinned, true, 300_000, 'runner')).toBeNull();
    expect(reason).toHaveBeenLastCalledWith({ ...pinned, reason: 'app-token-unavailable' });
    scope.repositories = ['OCTO/ALPHA'];
    expect(await appTokenOrNull(deps, pinned, false, 300_000, 'runner')).toBe('app-3');
    expect(refreshes).toEqual([false, true, false]);
  },
);

test('the server evicts the least recently used scoped grant, including negative entries', async () => {
  const { deps, urls } = await mint({ statusFor: (index) => (index === 2 ? 422 : undefined) });
  const grant = (index: number) =>
    appTokenOrNull(deps, { ...repo, repo: `repo-${index}` }, false, 300_000, 'server-read');
  expect(await grant(0)).toBe('app-1');
  expect(await grant(1)).toBeNull();
  for (let index = 2; index < 256; index++) await grant(index);
  expect(await grant(0)).toBe('app-1');
  await grant(256);
  expect(await grant(0)).toBe('app-1');
  expect(await grant(1)).toBe('app-258');
  expect(urls).toHaveLength(258);
});

test('a malformed repository name is rejected before connecting to the mint socket', async () => {
  const { deps, reason, urls } = await mint();
  const invalid = { owner: 'invalid_owner', repo: 'alpha', repositoryId: 42 };
  expect(await appTokenOrNull(deps, invalid, false, 300_000, 'runner')).toBeNull();
  expect(reason).toHaveBeenCalledWith({ ...invalid, reason: 'app-token-unavailable' });
  expect(urls).toEqual([]);
});

test('an unsafe repository id is rejected before connecting to the mint socket', async () => {
  const { deps, reason, urls } = await mint();
  const pinned = { ...repo, repositoryId: Number.MAX_SAFE_INTEGER + 1 };
  expect(await appTokenOrNull(deps, pinned, false, 300_000, 'runner')).toBeNull();
  expect(reason).toHaveBeenCalledWith({ ...pinned, reason: 'app-token-unavailable' });
  expect(urls).toEqual([]);
});

test('App request 401 forces exactly one re-mint and never calls user refresh', async () => {
  const { deps, refreshes } = await mint();
  const userRefresh = vi.spyOn(connection, 'refreshingGithubFetch');
  const auth: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: string | URL, init?: RequestInit) => {
      auth.push(new Headers(init?.headers).get('authorization') ?? '');
      return new Response(null, { status: 401 });
    }),
  );
  const result = await appGithubFetch(
    deps,
    repo,
    'https://api.github.com/repos/octo/alpha/issues',
    { method: 'POST' },
    'server-write',
  );
  expect(result?.status).toBe(401);
  expect(auth).toEqual(['Bearer app-1', 'Bearer app-2']);
  expect(refreshes).toEqual([false, true]);
  expect(userRefresh).not.toHaveBeenCalled();
});

test('a dead mint socket fails closed', async () => {
  const dir = makeTestTempDir('app-provider-');
  disposals.push(async () => releaseTestTempDir(dir));
  const socketPath = join(dir, 'mint.sock');
  const server = createServer((req, res) => {
    req.socket.destroy();
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  disposals.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const reason = vi.fn();
  const deps = { config: { githubAppTokenSocket: socketPath }, onReason: reason };
  expect(await appTokenOrNull(deps, repo, false, 300_000, 'server-read')).toBeNull();
  expect(reason).toHaveBeenLastCalledWith({ reason: 'app-token-unavailable', ...repo });
});

test('App fetch refuses another origin before obtaining a token', async () => {
  const { deps, refreshes } = await mint();
  await expect(
    appGithubFetch(deps, repo, 'https://example.com/steal', {}, 'server-read'),
  ).rejects.toThrow('GitHub API');
  expect(refreshes).toEqual([]);
});

test('token kinds and plain strings are mutually non-assignable', () => {
  expectTypeOf<AppToken>().not.toExtend<UserToken>();
  expectTypeOf<UserToken>().not.toExtend<AppToken>();
  expectTypeOf<string>().not.toExtend<AppToken>();
  expectTypeOf<string>().not.toExtend<UserToken>();
});

test('mint HTTP errors and malformed payloads never escape', async () => {
  for (const options of [
    { status: 502 },
    { payload: { token: 'missing-metadata' } },
    {
      payload: {
        token: 'app-x',
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        installationId: 456,
        appSlug: 'cairnwright',
        repositories: 'invalid',
      },
    },
  ]) {
    const { deps, reason } = await mint(options);
    expect(await appTokenOrNull(deps, repo, false, 300_000, 'server-read')).toBeNull();
    expect(reason).toHaveBeenLastCalledWith({ reason: 'app-token-unavailable', ...repo });
  }
});

test('expiry re-mints the repository credential and re-checks installation', async () => {
  const options = { status: 200 };
  const { deps, refreshes, reason } = await mint(options);
  expect(await appTokenOrNull(deps, repo, false, 300_000, 'server-read')).not.toBeNull();
  const clock = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(clock + 3300_000);
  options.status = 422;
  expect(await appTokenOrNull(deps, repo, false, 300_000, 'server-read')).toBeNull();
  expect(refreshes).toEqual([false, false]);
  expect(reason).toHaveBeenLastCalledWith({ reason: 'repo-not-installed', ...repo });
});

test('a re-mint that finds the repository uninstalled never retries the write', async () => {
  const options = { status: 200 };
  const { deps, refreshes } = await mint(options);
  let writes = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      options.status = 422;
      writes++;
      return new Response(null, { status: 401 });
    }),
  );
  expect(
    await appGithubFetch(
      deps,
      repo,
      'https://api.github.com/repos/octo/alpha/issues',
      { method: 'POST' },
      'server-write',
    ),
  ).toBeNull();
  expect(writes).toBe(1);
  expect(refreshes).toEqual([false, true]);
});

test('distinct deps on one socket share concurrent and cached mint work', async () => {
  let releaseGate: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const { deps, refreshes, urls } = await mint({ hold: () => gate });
  const first = appTokenOrNull({ ...deps }, repo, false, 300_000, 'server-read');
  await vi.waitFor(() => {
    expect(urls.length).toBe(1);
  });
  const second = appTokenOrNull(
    { ...deps, config: { ...deps.config } },
    repo,
    false,
    300_000,
    'server-read',
  );
  releaseGate();
  const tokens = await Promise.all([first, second]);
  expect(tokens.every((token) => token !== null)).toBe(true);
  expect(tokens[0] === tokens[1]).toBe(true);
  expect(
    (await appTokenOrNull({ ...deps }, repo, false, 300_000, 'server-read')) === tokens[0],
  ).toBe(true);
  expect(refreshes).toEqual([false]);
});

test('failed mint is evicted so the next call on the same socket retries', async () => {
  const options = { status: 502 };
  const { deps, refreshes } = await mint(options);
  expect(
    await Promise.all([
      appTokenOrNull({ ...deps }, repo, false, 300_000, 'server-read'),
      appTokenOrNull({ ...deps }, repo, false, 300_000, 'server-read'),
    ]),
  ).toEqual([null, null]);
  options.status = 200;
  expect((await appTokenOrNull({ ...deps }, repo, false, 300_000, 'server-read')) !== null).toBe(
    true,
  );
  expect(refreshes).toEqual([false, false]);
});

test('injected fetch handles App requests with redirects disabled', async () => {
  const { deps, refreshes } = await mint();
  const globalFetch = vi.fn(async () => {
    throw new Error('global fetch must not be used');
  });
  vi.stubGlobal('fetch', globalFetch);
  const fetchImpl = vi.fn(
    async (_input: string | URL, _init?: RequestInit) => new Response(null, { status: 204 }),
  );
  const injected = { ...deps, fetchImpl };
  await expect(
    appGithubFetch(injected, repo, 'https://example.com/steal', {}, 'server-read'),
  ).rejects.toThrow('GitHub API');
  expect(refreshes).toEqual([]);
  expect(fetchImpl).not.toHaveBeenCalled();
  const response = await appGithubFetch(
    injected,
    repo,
    'https://api.github.com/repos/octo/alpha/issues',
    { method: 'POST', headers: { accept: 'application/vnd.github+json' }, redirect: 'follow' },
    'server-write',
  );
  expect(response?.status).toBe(204);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  for (const call of fetchImpl.mock.calls) expect(call[1]).toMatchObject({ redirect: 'error' });
  expect(globalFetch).not.toHaveBeenCalled();
});

test('typed status transport re-mints once on App 401 and never uses a user credential', async () => {
  const { deps, refreshes } = await mint();
  const identities: (string | null)[] = [];
  const upstream = vi.fn<FetchLike>(async (_input, init) => {
    identities.push(new Headers(init?.headers).get('authorization'));
    return Response.json({ message: 'Bad credentials' }, { status: 401 });
  });
  const token = await appTokenOrNull(
    { ...deps, fetchImpl: upstream },
    repo,
    false,
    300_000,
    'server-read',
  );
  expect(token !== null).toBe(true);
  if (token === null) throw new Error('fixture App unavailable');
  const result = await githubCreateCommitStatus(
    upstream,
    token,
    repo.owner,
    repo.repo,
    'a'.repeat(40),
    { state: 'success', context: 'test', description: '' },
    { timeoutMs: 1000 },
  );
  expect(result).toMatchObject({ kind: 'failed', failure: { kind: 'status', status: 401 } });
  expect(identities).toEqual(['Bearer app-1', 'Bearer app-2']);
  expect(refreshes).toEqual([false, true]);
});

test('a re-mint after another repository resolves still pins the first repository', async () => {
  const { deps, urls } = await mint();
  let writes = 0;
  const upstream: FetchLike = async () => {
    writes++;
    return new Response(null, { status: 401 });
  };
  const injected = { ...deps, fetchImpl: upstream };
  const token = await appTokenOrNull(injected, repo, false, 300_000, 'server-read');
  await appTokenOrNull(injected, { owner: 'octo', repo: 'beta' }, false, 300_000, 'server-read');
  if (token === null) throw new Error('fixture App unavailable');
  await githubCreateCommitStatus(
    upstream,
    token,
    repo.owner,
    repo.repo,
    'a'.repeat(40),
    { state: 'success', context: 'test', description: '' },
    { timeoutMs: 1000 },
  );
  expect(urls).toEqual([
    `/token?repository=alpha&owner=octo&${READ_QUERY}`,
    `/token?repository=beta&owner=octo&${READ_QUERY}`,
    `/token?repository=alpha&owner=octo&${READ_QUERY}`,
  ]);
  expect(writes).toBe(2);
});

test('credential caching separates different grants, not policy names', async () => {
  const { deps, urls } = await mint();
  const runner = await appTokenOrNull(deps, repo, false, 300_000, 'runner');
  const serverRead = await appTokenOrNull(deps, repo, false, 300_000, 'server-read');
  const serverWrite = await appTokenOrNull(deps, repo, false, 300_000, 'server-write');
  expect(runner).not.toBeNull();
  expect(serverRead).not.toBeNull();
  expect(serverRead).not.toBe(runner);
  expect(serverWrite).toBe(runner);
  expect(urls.filter((url) => url.includes('repository=alpha'))).toHaveLength(2);
});

test('a runner credential refresh explicitly bypasses the mint cache', async () => {
  const { deps, refreshes } = await mint();
  await appTokenOrNull(deps, repo, false, 300_000, 'runner');
  await appTokenOrNull(deps, repo, true, 300_000, 'runner');
  expect(refreshes).toEqual([false, true]);
});

test('minimum validity forces a re-mint of a near-expiry cached token', async () => {
  const { deps, refreshes } = await mint();
  await appTokenOrNull(deps, repo, false, 300_000, 'server-read');
  const clock = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(clock + 45 * 60000);
  expect(await appTokenOrNull(deps, repo, false, 50 * 60000, 'server-read')).not.toBeNull();
  expect(refreshes).toEqual([false, true]);
});

test('a runner mint request narrows the token to its repository and permissions', async () => {
  const { deps, urls } = await mint();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => installed()),
  );
  const token = await appTokenOrNull(deps, repo, false, 300_000, 'runner');
  expect(token).not.toBeNull();
  const permissions = encodeURIComponent(
    'actions:read,checks:read,contents:write,issues:write,metadata:read,pull_requests:write,statuses:read',
  );
  expect(urls).toEqual([`/token?repository=alpha&owner=octo&permissions=${permissions}`]);
});

test('a server read mint request pins the repository and its read grants', async () => {
  const { deps, urls } = await mint();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => installed()),
  );
  const token = await appTokenOrNull(deps, repo, false, 300_000, 'server-read');
  expect(token).not.toBeNull();
  expect(urls).toEqual([`/token?repository=alpha&owner=octo&${READ_QUERY}`]);
});

test('a server write mint request never asks to write commit statuses', async () => {
  const { deps, urls } = await mint();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => installed()),
  );
  const token = await appTokenOrNull(deps, repo, false, 300_000, 'server-write');
  expect(token).not.toBeNull();
  const permissions = encodeURIComponent(
    'actions:read,checks:read,contents:write,issues:write,metadata:read,pull_requests:write,statuses:read',
  );
  expect(urls).toEqual([`/token?repository=alpha&owner=octo&permissions=${permissions}`]);
});

test('a repository outside the installation reports repo-not-installed and caches briefly', async () => {
  const { deps, reason, urls } = await mint({ status: 422 });
  expect(await appTokenOrNull(deps, repo, false, 300_000, 'server-read')).toBeNull();
  expect(reason).toHaveBeenLastCalledWith({ reason: 'repo-not-installed', ...repo });
  expect(
    await appTokenOrNull(deps, { owner: 'OCTO', repo: 'ALPHA' }, false, 300_000, 'server-read'),
  ).toBeNull();
  expect(
    await appTokenOrNull(deps, { owner: 'octo', repo: 'other' }, false, 300_000, 'server-read'),
  ).toBeNull();
  expect(reason).toHaveBeenLastCalledWith({
    reason: 'repo-not-installed',
    owner: 'octo',
    repo: 'other',
  });
  expect(urls).toEqual([
    `/token?repository=alpha&owner=octo&${READ_QUERY}`,
    `/token?repository=other&owner=octo&${READ_QUERY}`,
  ]);
});

test('a pinned runner respects the repo-not-installed backoff until it expires', async () => {
  const clock = Date.now();
  const now = vi.spyOn(Date, 'now').mockReturnValue(clock);
  const { deps, reason, refreshes } = await mint({
    statusFor: (index) => (index === 1 ? 422 : undefined),
  });
  const pinned = { ...repo, repositoryId: 42 };
  expect(await appTokenOrNull(deps, pinned, false, 300_000, 'runner')).toBeNull();
  now.mockReturnValue(clock + 59_999);
  expect(await appTokenOrNull(deps, pinned, false, 300_000, 'runner')).toBeNull();
  expect(reason).toHaveBeenCalledTimes(2);
  expect(reason).toHaveBeenLastCalledWith({ ...pinned, reason: 'repo-not-installed' });
  expect(refreshes).toEqual([false]);

  now.mockReturnValue(clock + 60_000);
  const token = await appTokenOrNull(deps, pinned, false, 300_000, 'runner');
  expect(token && tokenValue(token)).toBe('app-2');
  expect(refreshes).toEqual([false, false]);
});

test('a 422 that is not repo-not-installed reports unavailable and never caches', async () => {
  const { deps, reason, urls } = await mint({
    statusFor: (index) => (index === 1 ? 422 : undefined),
    errorBody: 'the app is not installed on this account',
  });
  expect(await appTokenOrNull(deps, repo, false, 300_000, 'server-read')).toBeNull();
  expect(reason).toHaveBeenLastCalledWith({ reason: 'app-token-unavailable', ...repo });
  expect(await appTokenOrNull(deps, repo, false, 300_000, 'server-read')).not.toBeNull();
  expect(urls).toEqual([
    `/token?repository=alpha&owner=octo&${READ_QUERY}`,
    `/token?repository=alpha&owner=octo&${READ_QUERY}`,
  ]);
});

test('a token minted for one repository is not returned for another', async () => {
  const { deps, urls } = await mint();
  const alpha = await appTokenOrNull(deps, repo, false, 300_000, 'server-read');
  const beta = await appTokenOrNull(
    deps,
    { owner: 'octo', repo: 'beta' },
    false,
    300_000,
    'server-read',
  );
  if (alpha === null || beta === null) throw new Error('fixture App unavailable');
  expect(tokenValue(alpha)).not.toBe(tokenValue(beta));
  expect(urls.filter((url) => url.includes('repository=')).length).toBe(2);
});

test('the scoped credential cache keeps the socket path case', async () => {
  const probe = join(makeTestTempDir('app-probe-'), 'CaSe');
  writeFileSync(probe, '');
  const caseSensitive = !existsSync(join(dirname(probe), 'case'));
  if (caseSensitive) {
    const dir = makeTestTempDir('app-provider-');
    const first = await mint({ dir, socketName: 'Mint.sock' });
    const second = await mint({ dir, socketName: 'mint.sock' });
    expect(await appTokenOrNull(first.deps, repo, false, 300_000, 'server-read')).not.toBeNull();
    expect(await appTokenOrNull(second.deps, repo, false, 300_000, 'server-read')).not.toBeNull();
    expect(second.urls.filter((url) => url.includes('repository=')).length).toBe(1);
  } else {
    const { deps, urls } = await mint();
    const socketPath = deps.config.githubAppTokenSocket;
    if (socketPath === null) throw new Error('fixture socket missing');
    const variant = {
      ...deps,
      config: { githubAppTokenSocket: join(dirname(socketPath), 'Mint.sock') },
    };
    expect(await appTokenOrNull(deps, repo, false, 300_000, 'server-read')).not.toBeNull();
    expect(await appTokenOrNull(variant, repo, false, 300_000, 'server-read')).not.toBeNull();
    expect(urls.filter((url) => url.includes('repository=')).length).toBe(2);
  }
});

test('a forced scoped refresh mints beside an in-flight refresh instead of joining it', async () => {
  let releaseGate: () => void = () => undefined;
  let gate: Promise<void> | null = null;
  const { deps, urls } = await mint({
    hold: (url) => (gate !== null && url.includes('repository=') ? gate : undefined),
  });
  expect(await appTokenOrNull(deps, repo, false, 300_000, 'server-read')).not.toBeNull();
  const clock = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(clock + 3301_000);
  const scopedUrls = () => urls.filter((url) => url.includes('repository=')).length;
  gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  const slow = appTokenOrNull(deps, repo, false, 300_000, 'server-read');
  slow.catch(() => undefined);
  try {
    await vi.waitFor(() => {
      expect(scopedUrls()).toBe(2);
    });
    const forced = appTokenOrNull(deps, repo, true, 300_000, 'server-read');
    forced.catch(() => undefined);
    await vi.waitFor(() => {
      expect(scopedUrls()).toBe(3);
    });
    releaseGate();
    expect(await forced).not.toBeNull();
    expect(await slow).not.toBeNull();
  } finally {
    releaseGate();
  }
});

test('concurrent forced refreshes for one scope coalesce into a single exchange', async () => {
  const { deps, refreshes, urls } = await mint();
  const tokens = await Promise.all([
    appTokenOrNull(deps, repo, true, 300_000, 'server-read'),
    appTokenOrNull(deps, repo, true, 300_000, 'server-read'),
    appTokenOrNull(deps, repo, true, 300_000, 'server-read'),
  ]);
  expect(tokens.every((token) => token !== null)).toBe(true);
  expect(tokens[0] === tokens[1] && tokens[1] === tokens[2]).toBe(true);
  expect(urls.filter((url) => url.includes('repository=')).length).toBe(1);
  expect(refreshes).toEqual([true]);
});

test('a superseded exchange never overwrites the newer cache entry', async () => {
  let holdScoped = false;
  let release: () => void = () => undefined;
  const { deps, urls } = await mint({
    hold: (url) => {
      if (!holdScoped || !url.includes('repository=')) return undefined;
      holdScoped = false;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  expect(await appTokenOrNull(deps, repo, false, 300_000, 'server-read')).not.toBeNull();
  const clock = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(clock + 3301_000);
  const scopedUrls = () => urls.filter((url) => url.includes('repository=')).length;
  holdScoped = true;
  const slow = appTokenOrNull(deps, repo, false, 300_000, 'server-read');
  slow.catch(() => undefined);
  try {
    await vi.waitFor(() => {
      expect(scopedUrls()).toBe(2);
    });
    const forced = await appTokenOrNull(deps, repo, true, 300_000, 'server-read');
    expect(forced && tokenValue(forced)).toBe('app-3');
    release();
    expect(await slow).not.toBeNull();
    const cached = await appTokenOrNull(deps, repo, false, 300_000, 'server-read');
    expect(cached && tokenValue(cached)).toBe('app-3');
  } finally {
    release();
  }
});

test('a failed forced refresh never lets the older in-flight exchange refill the cache', async () => {
  let holdScoped = false;
  let release: () => void = () => undefined;
  const { deps, urls } = await mint({
    statusFor: (index) => (index === 3 ? 500 : undefined),
    hold: (url) => {
      if (!holdScoped || !url.includes('repository=')) return undefined;
      holdScoped = false;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  expect(await appTokenOrNull(deps, repo, false, 300_000, 'server-read')).not.toBeNull();
  const clock = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(clock + 3301_000);
  const scopedUrls = () => urls.filter((url) => url.includes('repository=')).length;
  holdScoped = true;
  const slow = appTokenOrNull(deps, repo, false, 300_000, 'server-read');
  slow.catch(() => undefined);
  try {
    await vi.waitFor(() => {
      expect(scopedUrls()).toBe(2);
    });
    const forced = await appTokenOrNull(deps, repo, true, 300_000, 'server-read');
    expect(forced).toBeNull();
    release();
    const superseded = await slow;
    expect(superseded && tokenValue(superseded)).toBe('app-2');
    const cached = await appTokenOrNull(deps, repo, false, 300_000, 'server-read');
    expect(cached && tokenValue(cached)).toBe('app-4');
  } finally {
    release();
  }
});

const requestedGrants = () =>
  Object.fromEntries(
    'actions:read,checks:read,contents:write,issues:write,metadata:read,pull_requests:write,statuses:read'
      .split(',')
      .map((entry) => entry.split(':') as [string, string]),
  );

test.each([
  {
    name: 'the exact repository and grants passes',
    scope: { repositories: ['OCTO/ALPHA'], permissions: requestedGrants() },
    ok: true,
  },
  {
    name: 'a narrower permission subset is refused',
    scope: { repositories: ['octo/alpha'], permissions: { contents: 'write' } },
    ok: false,
  },
  {
    name: 'an empty permission map is refused',
    scope: { repositories: ['octo/alpha'], permissions: {} },
    ok: false,
  },
  {
    name: 'a downgraded permission level is refused',
    scope: {
      repositories: ['octo/alpha'],
      permissions: { ...requestedGrants(), contents: 'read' },
    },
    ok: false,
  },
  {
    name: 'a different repository is refused',
    scope: { repositories: ['octo/beta'], permissions: requestedGrants() },
    ok: false,
  },
  {
    name: 'an extra repository is refused',
    scope: { repositories: ['octo/alpha', 'octo/beta'], permissions: requestedGrants() },
    ok: false,
  },
  {
    name: 'an empty repository list is refused',
    scope: { repositories: [], permissions: requestedGrants() },
    ok: false,
  },
  { name: 'missing scope fields is refused', scope: null, ok: false },
  {
    name: 'a broader permission level is refused',
    scope: {
      repositories: ['octo/alpha'],
      permissions: { ...requestedGrants(), contents: 'admin' },
    },
    ok: false,
  },
  {
    name: 'an unrequested permission is refused',
    scope: {
      repositories: ['octo/alpha'],
      permissions: { ...requestedGrants(), members: 'read' },
    },
    ok: false,
  },
  ...Object.getOwnPropertyNames(Object.prototype).map((key) => ({
    name: `an own grant with a built-in object property name (${key}) is refused`,
    scope: { repositories: ['octo/alpha'], permissions: { ...requestedGrants(), [key]: 'read' } },
    ok: false,
  })),
  {
    name: 'a level that only resolves through the prototype chain is refused',
    scope: {
      repositories: ['octo/alpha'],
      permissions: { contents: 'constructor', issues: 'hasOwnProperty' },
    },
    ok: false,
  },
  {
    name: 'an unknown permission level is refused',
    scope: {
      repositories: ['octo/alpha'],
      permissions: { contents: 'owner' },
    },
    ok: false,
  },
])('a runner mint answered with $name', async ({ scope, ok }) => {
  const { deps, reason } = await mint({ scope });
  const token = await appTokenOrNull(deps, repo, false, 300_000, 'runner');
  expect(token !== null).toBe(ok);
  if (!ok) expect(reason).toHaveBeenLastCalledWith({ reason: 'app-token-unavailable', ...repo });
});

test.each([
  {
    name: 'an over-broad grant set is refused',
    scope: { repositories: ['octo/alpha'], permissions: { contents: 'admin', members: 'read' } },
    ok: false,
  },
  {
    name: 'a missing permission list is refused',
    scope: { repositories: ['octo/alpha'] } as { repositories: string[]; permissions?: never },
    ok: false,
  },
  {
    name: 'a wrong repository is refused',
    scope: { repositories: ['octo/beta'], permissions: {} as Record<string, string> },
    ok: false,
  },
  {
    name: 'a narrower permission subset is refused',
    scope: { repositories: ['octo/alpha'], permissions: { contents: 'read' } },
    ok: false,
  },
])('a server read mint answered with $name', async ({ scope, ok }) => {
  const { deps, reason } = await mint({ scope });
  const token = await appTokenOrNull(deps, repo, false, 300_000, 'server-read');
  expect(token !== null).toBe(ok);
  if (!ok) expect(reason).toHaveBeenLastCalledWith({ reason: 'app-token-unavailable', ...repo });
});

test('the App commit identity comes from configuration, never from a minted token', () => {
  vi.stubEnv('CAIRN_AUTH', 'off');
  vi.stubEnv('CAIRN_APP_TOKEN_SOCKET', '');
  vi.stubEnv('CAIRN_GITHUB_APP_SLUG', '');
  vi.stubEnv('CAIRN_GITHUB_APP_BOT_ID', '');
  expect(loadConfig().githubAppIdentity).toBeNull();
  vi.stubEnv('CAIRN_GITHUB_APP_SLUG', 'cairnwright');
  vi.stubEnv('CAIRN_GITHUB_APP_BOT_ID', '347615582');
  const identity = loadConfig().githubAppIdentity;
  expect(identity).toEqual({
    name: 'cairnwright[bot]',
    email: '347615582+cairnwright[bot]@users.noreply.github.com',
  });
  if (identity === null) throw new Error('identity expected');
  const policy = JSON.parse(
    readFileSync(new URL('../../../packages/shared/commit-identity.json', import.meta.url), 'utf8'),
  ) as CommitIdentityPolicy;
  expect(localCommitViolation(policy, identity, identity, {})).toBeNull();
  expect(localCommitViolation(policy, identity, identity, { CAIRN_STEP_ID: 'step' })).toBeNull();
});

test('a half-configured App identity, or a token socket without one, refuses to start', () => {
  vi.stubEnv('CAIRN_AUTH', 'off');
  vi.stubEnv('CAIRN_APP_TOKEN_SOCKET', '');
  vi.stubEnv('CAIRN_GITHUB_APP_SLUG', 'cairnwright');
  vi.stubEnv('CAIRN_GITHUB_APP_BOT_ID', '');
  expect(() => loadConfig()).toThrow(/CAIRN_GITHUB_APP_BOT_ID/);
  vi.stubEnv('CAIRN_GITHUB_APP_SLUG', 'cairnwright');
  vi.stubEnv('CAIRN_GITHUB_APP_BOT_ID', 'not-a-number');
  expect(() => loadConfig()).toThrow();
  vi.stubEnv('CAIRN_GITHUB_APP_SLUG', '');
  vi.stubEnv('CAIRN_GITHUB_APP_BOT_ID', '');
  vi.stubEnv('CAIRN_APP_TOKEN_SOCKET', '/configured/app.sock');
  expect(() => loadConfig()).toThrow(/CAIRN_GITHUB_APP_SLUG/);
});
