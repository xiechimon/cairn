// spec 12 / #359 G2-T1：github_connection DAO（增 / 重认证覆盖 / 断开删行）+
// `GET /api/github/repos?q=` 代理（lib/github.ts 缝 → GitHub `GET /user/repos`）。
// token 纪律（#359 AC）：accessToken 只以 SecretBox `v1:` 信封密文落列——
// 明文不进表任何列、不进出站 URL、仅出现在 Authorization 头；repos 封套
// 永不带 token 或密文。失败方式先于实现枚举（仓测试纪律）。

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

/** GitHub 出站 mock（helpers.githubFetch 注入位）：记录调用面 + 定值应答。 */
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
  { id: 'bad-entry', name: 42 }, // 畸形条目：跳过不入封套
];

describe('github_connection DAO（重认证覆盖 / 断开删行）', () => {
  test('增：行落库，token 仅以 v1: 信封密文存，明文不落任何列', () => {
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
      // 整行序列化扫描：明文 token 不落表（plaintext 列不存在）
      expect(JSON.stringify(row)).not.toContain(TOKEN);
      expect(openGithubToken(depsOf(s), s.team.id)).toBe(TOKEN);
    } finally {
      s.dispose();
    }
  });

  test('重认证 = 覆盖：teamId 单行，新 token/login/scope 生效', () => {
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

  test('断开 = 删行；再断幂等不抛', () => {
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

  test('无行时 open → null（未连接语义，代理端点 404 的数据面）', () => {
    const s = bootServer();
    try {
      expect(openGithubToken(depsOf(s), s.team.id)).toBeNull();
    } finally {
      s.dispose();
    }
  });
});

describe('GET /api/github/repos?q= 代理（spec 12 数据契约面）', () => {
  test('未连接 → 404 {error}', async () => {
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

  test('已连接 → {repos:[{id,owner,name,full_name,private}]}，畸形条目跳过', async () => {
    const { impl } = mockGithub(REPOS_PAYLOAD);
    const s = bootServer({ githubFetch: impl });
    try {
      seedConnection(s);
      const res = await req(s.app, 'GET', '/api/github/repos');
      expect(res.status).toBe(200);
      const body = await res.json();
      const parsed = githubReposResponseSchema.parse(body); // 封套单源 = shared
      expect(parsed.repos).toEqual([
        { id: 1, owner: 'octo', name: 'alpha', full_name: 'octo/alpha', private: false },
        { id: 2, owner: 'octo', name: 'beta-app', full_name: 'octo/beta-app', private: true },
      ]);
    } finally {
      s.dispose();
    }
  });

  test('出站纪律：token 仅进 Authorization 头，不进 URL；accept = github json', async () => {
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

  test('q 过滤：大小写不敏感 full_name 子串；空 q = 全量；无命中 = 空数组', async () => {
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

  test('teamId 非 seed 团队 → 404（requireTeam 闸）', async () => {
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

  test('上游 401（token 失效）→ 502 {error}；403 + ratelimit 余量 0 → 429', async () => {
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

  test('上游应答非数组 → 502', async () => {
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
});
