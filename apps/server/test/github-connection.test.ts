import { githubReposResponseSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { githubConnection } from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import {
  deleteGithubConnection,
  openGithubToken,
  upsertGithubConnection,
} from '../src/services/github-connection.js';
import { bootServer, req, type TestServer } from './helpers.js';

const TOKEN = 'ghp_super_secret_token_value';

function depsOf(s: TestServer) {
  return { db: s.db, box: s.secretBox };
}

function seedConnection(
  s: TestServer,
  input?: { login?: string; scope?: string; token?: string },
): void {
  upsertGithubConnection(depsOf(s), {
    teamId: s.team.id,
    login: input?.login ?? 'octo',
    accessToken: input?.token ?? TOKEN,
    scope: input?.scope ?? 'repo',
  });
}

interface CapturedCall {
  url: string;
  headers: Record<string, string>;
}

function mockGithub(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  const calls: CapturedCall[] = [];
  const impl: FetchLike = async (input, init) => {
    calls.push({ url: String(input), headers: { ...(init?.headers ?? {}) } });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  };
  return { impl, calls };
}

const REPOS_PAYLOAD = [
  { id: 1, name: 'alpha', full_name: 'octo/alpha', private: false, owner: { login: 'octo' } },
  { id: 2, name: 'beta-app', full_name: 'octo/beta-app', private: true, owner: { login: 'octo' } },
  { id: 'bad-entry', name: 42 },
];

function mockGithubRoutes(routes: (url: URL) => { status?: number; body: unknown } | null) {
  const calls: string[] = [];
  const impl: FetchLike = async (input) => {
    const url = new URL(String(input));
    calls.push(`${url.pathname}${url.search}`);
    const hit = routes(url);
    const status = hit === null ? 404 : (hit.status ?? 200);
    const body = hit?.body ?? { message: 'unmocked path' };
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  return { impl, calls };
}

describe('github_connection DAO (reauth overwrite / disconnect deletes the row)', () => {
  test('create: row persisted, token stored only as a v1: envelope ciphertext, plaintext in no column', () => {
    const s = bootServer();
    try {
      seedConnection(s);
      const row = s.db
        .select()
        .from(githubConnection)
        .where(eq(githubConnection.teamId, s.team.id))
        .get();
      expect(row).toBeDefined();
      expect(row?.accessTokenCipher.startsWith('v1:')).toBe(true);
      expect(row?.accessTokenCipher).not.toContain(TOKEN);
      expect(row?.login).toBe('octo');
      expect(row?.scope).toBe('repo');
      expect(typeof row?.createdAt).toBe('number');
      expect(JSON.stringify(row)).not.toContain(TOKEN);
      expect(openGithubToken(depsOf(s), s.team.id)).toBe(TOKEN);
    } finally {
      s.dispose();
    }
  });

  test('reauth = overwrite: single row per teamId, new token/login/scope take effect', () => {
    const s = bootServer();
    try {
      seedConnection(s);
      seedConnection(s, { login: 'octo2', scope: 'repo read:org', token: 'ghp_second_token' });
      const rows = s.db
        .select()
        .from(githubConnection)
        .where(eq(githubConnection.teamId, s.team.id))
        .all();
      expect(rows).toHaveLength(1);
      expect(openGithubToken(depsOf(s), s.team.id)).toBe('ghp_second_token');
      expect(rows[0]?.login).toBe('octo2');
      expect(rows[0]?.scope).toBe('repo read:org');
    } finally {
      s.dispose();
    }
  });

  test('disconnect = delete row; disconnecting again is idempotent and does not throw', () => {
    const s = bootServer();
    try {
      seedConnection(s);
      expect(deleteGithubConnection(depsOf(s), s.team.id)).toBe(true);
      expect(openGithubToken(depsOf(s), s.team.id)).toBeNull();
      expect(deleteGithubConnection(depsOf(s), s.team.id)).toBe(false);
    } finally {
      s.dispose();
    }
  });

  test('open with no row -> null (not-connected semantics, data surface behind the proxy endpoint 404)', () => {
    const s = bootServer();
    try {
      expect(openGithubToken(depsOf(s), s.team.id)).toBeNull();
    } finally {
      s.dispose();
    }
  });
});

describe('GET /api/github/repos?q= proxy (spec 12 data-contract surface)', () => {
  test('not connected -> 404 {error}', async () => {
    const { impl } = mockGithub(REPOS_PAYLOAD);
    const s = bootServer({ githubFetch: impl });
    try {
      const res = await req(s.app, 'GET', '/api/github/repos');
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error?: string };
      expect(typeof body.error).toBe('string');
    } finally {
      s.dispose();
    }
  });

  test('connected -> {repos:[{id,owner,name,full_name,private}]}, malformed entries skipped', async () => {
    const { impl } = mockGithub(REPOS_PAYLOAD);
    const s = bootServer({ githubFetch: impl });
    try {
      seedConnection(s);
      const res = await req(s.app, 'GET', '/api/github/repos');
      expect(res.status).toBe(200);
      const body = await res.json();
      const parsed = githubReposResponseSchema.parse(body);
      expect(parsed.repos).toEqual([
        { id: 1, owner: 'octo', name: 'alpha', full_name: 'octo/alpha', private: false },
        { id: 2, owner: 'octo', name: 'beta-app', full_name: 'octo/beta-app', private: true },
      ]);
    } finally {
      s.dispose();
    }
  });

  test('outbound discipline: token goes only into the Authorization header, not the URL; accept = github json', async () => {
    const { impl, calls } = mockGithub(REPOS_PAYLOAD);
    const s = bootServer({ githubFetch: impl });
    try {
      seedConnection(s);
      await req(s.app, 'GET', '/api/github/repos');
      expect(calls).toHaveLength(1);
      const call = calls[0];
      expect(call?.url.startsWith('https://api.github.com/user/repos')).toBe(true);
      expect(call?.url).not.toContain(TOKEN);
      expect(call?.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(call?.headers.accept).toContain('application/vnd.github+json');
    } finally {
      s.dispose();
    }
  });

  test('q filter: case-insensitive full_name substring; empty q = all; no hit = empty array', async () => {
    const { impl } = mockGithub(REPOS_PAYLOAD);
    const s = bootServer({ githubFetch: impl });
    try {
      seedConnection(s);
      const filtered = (await req(s.app, 'GET', '/api/github/repos?q=ALPH')).json() as Promise<{
        repos: { full_name: string }[];
      }>;
      expect((await filtered).repos.map((r) => r.full_name)).toEqual(['octo/alpha']);
      const all = (await req(s.app, 'GET', '/api/github/repos?q=')).json() as Promise<{
        repos: unknown[];
      }>;
      expect((await all).repos).toHaveLength(2);
      const none = (await req(s.app, 'GET', '/api/github/repos?q=nope')).json() as Promise<{
        repos: unknown[];
      }>;
      expect((await none).repos).toEqual([]);
    } finally {
      s.dispose();
    }
  });

  test('teamId not the seed team -> 404 (requireTeam gate)', async () => {
    const { impl } = mockGithub(REPOS_PAYLOAD);
    const s = bootServer({ githubFetch: impl });
    try {
      seedConnection(s);
      const res = await req(s.app, 'GET', '/api/github/repos?teamId=nope');
      expect(res.status).toBe(404);
    } finally {
      s.dispose();
    }
  });

  test('upstream 401 (token invalid) -> 502 {error}; 403 + ratelimit remaining 0 -> 429', async () => {
    const unauthorized = mockGithub({}, 401);
    const s1 = bootServer({ githubFetch: unauthorized.impl });
    try {
      seedConnection(s1);
      const res = await req(s1.app, 'GET', '/api/github/repos');
      expect(res.status).toBe(502);
      expect(String(((await res.json()) as { error?: string }).error)).not.toContain(TOKEN);
    } finally {
      s1.dispose();
    }
    const limited = mockGithub({}, 403, { 'x-ratelimit-remaining': '0' });
    const s2 = bootServer({ githubFetch: limited.impl });
    try {
      seedConnection(s2);
      const res = await req(s2.app, 'GET', '/api/github/repos');
      expect(res.status).toBe(429);
    } finally {
      s2.dispose();
    }
  });

  test('upstream response not an array -> 502', async () => {
    const { impl } = mockGithub({ message: 'Bad credentials' }, 200);
    const s = bootServer({ githubFetch: impl });
    try {
      seedConnection(s);
      const res = await req(s.app, 'GET', '/api/github/repos');
      expect(res.status).toBe(502);
    } finally {
      s.dispose();
    }
  });

  test('/user/repos paginates past the first page', async () => {
    const pageOne = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      name: `repo-${i}`,
      full_name: `octo/repo-${i}`,
      private: false,
      owner: { login: 'octo' },
    }));
    const { impl, calls } = mockGithubRoutes((url) => {
      if (url.pathname !== '/user/repos') return null;
      const page = Number(url.searchParams.get('page') ?? '1');
      return {
        body:
          page === 1
            ? pageOne
            : [
                {
                  id: 101,
                  name: 'private-tail',
                  full_name: 'octo/private-tail',
                  private: true,
                  owner: { login: 'octo' },
                },
              ],
      };
    });
    const s = bootServer({ githubFetch: impl });
    try {
      seedConnection(s);
      const res = await req(s.app, 'GET', '/api/github/repos');
      expect(res.status).toBe(200);
      const parsed = githubReposResponseSchema.parse(await res.json());
      expect(parsed.repos).toHaveLength(101);
      expect(parsed.repos.at(-1)?.full_name).toBe('octo/private-tail');
      expect(calls.filter((u) => u.startsWith('/user/repos'))).toHaveLength(2);
    } finally {
      s.dispose();
    }
  });

  test('app user token (ghu_, device grant): lists installation repos incl. private, never calls /user/repos', async () => {
    const { impl, calls } = mockGithubRoutes((url) => {
      if (url.pathname === '/user/installations') {
        return { body: { total_count: 1, installations: [{ id: 7 }] } };
      }
      if (url.pathname === '/user/installations/7/repositories') {
        return {
          body: {
            total_count: 2,
            repository_selection: 'all',
            repositories: [
              {
                id: 1,
                name: 'alpha',
                full_name: 'octo/alpha',
                private: false,
                owner: { login: 'octo' },
                pushed_at: '2026-11-01T00:00:00Z',
              },
              {
                id: 2,
                name: 'beta-private',
                full_name: 'octo/beta-private',
                private: true,
                owner: { login: 'octo' },
                pushed_at: '2026-11-02T00:00:00Z',
              },
            ],
          },
        };
      }
      if (url.pathname === '/user/repos') return { body: [REPOS_PAYLOAD[0]] };
      return null;
    });
    const s = bootServer({ githubFetch: impl });
    try {
      upsertGithubConnection(depsOf(s), {
        teamId: s.team.id,
        login: 'octo',
        accessToken: 'ghu_device_grant_token',
        scope: '',
        device: { clientId: 'Iv23shared', refreshTokenExpiresAt: Date.now() + 86_400_000 },
      });
      const res = await req(s.app, 'GET', '/api/github/repos');
      expect(res.status).toBe(200);
      const parsed = githubReposResponseSchema.parse(await res.json());
      expect(parsed.repos.map((r) => r.full_name)).toEqual(['octo/beta-private', 'octo/alpha']);
      expect(calls.every((u) => !u.startsWith('/user/repos'))).toBe(true);
    } finally {
      s.dispose();
    }
  });
});
