// GitHub PR 只读探测（#704 / B-C16）：gh → REST（token/匿名）双梯 + 候选
// 选取。失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. gh 命中（stdout JSON）→ open 优先、多 open 取 number 最大
//   2. gh 不可用（未安装/非零退出）→ REST 梯接手；token 只进头
//   3. REST 非数组/非 200/网络错 → null（未知，不抛不重试）
//   4. 全梯失败 → null（面板分支名在、PR 槽留空）
//   5. githubRepoRefOf：github cloneUrl → owner/repo；hosted/local/垃圾 → null；
//      owner 或 repo 为 `.` / `..`（#1466：拼进 repos/{o}/{r} 会被 URL 归一改写）→ null

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { githubRepoRefOf, probeGithubPr } from '../src/github-probe.js';

const disposables: string[] = [];
afterAll(() => {
  for (const d of disposables) rmSync(d, { recursive: true, force: true });
});

/** gh 替身脚本：退出 0 + stdout 固定 JSON（gh pr list --json 响应形）。 */
function fakeGh(stdout: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'pacman-gh-probe-'));
  disposables.push(dir);
  const path = join(dir, 'gh');
  writeFileSync(path, `#!/bin/sh\necho '${stdout.replace(/'/g, "'\\''")}'\n`, {
    mode: 0o755,
  });
  return path;
}

/** 退出 1 的 gh 替身（模拟 gh 未登录/查询失败——真实 gh 对无 PR 分支退出 0
 * 空数组，对错误形态退出 1）。 */
function failingGh(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pacman-gh-probe-'));
  disposables.push(dir);
  const path = join(dir, 'gh');
  writeFileSync(path, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  return path;
}

const fetchJson =
  (rows: unknown, status = 200) =>
  async () => ({ ok: status >= 200 && status < 300, status, json: async () => rows });

const GITHUB_API_ROWS = [
  { number: 12, html_url: 'https://github.com/o/r/pull/12', state: 'closed' },
  { number: 14, html_url: 'https://github.com/o/r/pull/14', state: 'open' },
  { number: 13, html_url: 'https://github.com/o/r/pull/13', state: 'open' },
];

describe('gh 梯（失败方式 1/2）', () => {
  test('gh 命中 → open 优先、多 open 取 number 最大', async () => {
    const gh = fakeGh(
      JSON.stringify([
        { number: 12, url: 'https://github.com/o/r/pull/12', state: 'closed' },
        { number: 14, url: 'https://github.com/o/r/pull/14', state: 'open' },
        { number: 13, url: 'https://github.com/o/r/pull/13', state: 'open' },
      ]),
    );
    const probe = await probeGithubPr({
      owner: 'o',
      repo: 'r',
      branch: 'pacman/conv-x',
      ghPath: gh,
      fetchImpl: fetchJson([{ number: 99, html_url: 'u', state: 'open' }]),
    });
    expect(probe).toEqual({ number: 14, url: 'https://github.com/o/r/pull/14' });
  });

  test('gh 非零退出 → REST 梯接手（无 token = 匿名形态）', async () => {
    const probe = await probeGithubPr({
      owner: 'o',
      repo: 'r',
      branch: 'pacman/conv-x',
      ghPath: failingGh(),
      fetchImpl: fetchJson(GITHUB_API_ROWS),
    });
    expect(probe).toEqual({ number: 14, url: 'https://github.com/o/r/pull/14' });
  });
});

describe('REST 梯（失败方式 2/3/4）', () => {
  test('gh 缺席 + token 在位 → Authorization 头携带 token，只取头不进 URL', async () => {
    const seen: { url?: string; headers?: Record<string, string> } = {};
    const fetchImpl = async (url: string, init?: { headers?: Record<string, string> }) => {
      seen.url = url;
      seen.headers = init?.headers;
      return fetchJson(GITHUB_API_ROWS)();
    };
    const probe = await probeGithubPr({
      owner: 'o',
      repo: 'r',
      branch: 'pacman/conv-x',
      ghPath: failingGh(),
      token: 'ghp_secret',
      fetchImpl,
    });
    expect(probe).toEqual({ number: 14, url: 'https://github.com/o/r/pull/14' });
    expect(seen.url).toBe(
      'https://api.github.com/repos/o/r/pulls?head=o%3Apacman%2Fconv-x&state=all',
    );
    expect(seen.url).not.toContain('ghp_secret');
    expect(seen.headers?.authorization).toBe('Bearer ghp_secret');
  });

  test('REST 404（私仓匿名）→ null 不抛', async () => {
    const probe = await probeGithubPr({
      owner: 'o',
      repo: 'private-r',
      branch: 'b',
      ghPath: failingGh(),
      fetchImpl: fetchJson({ message: 'Not Found' }, 404),
    });
    expect(probe).toBeNull();
  });

  test('REST 网络错 → null（全梯失败 = 未知）', async () => {
    const probe = await probeGithubPr({
      owner: 'o',
      repo: 'r',
      branch: 'b',
      ghPath: failingGh(),
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    expect(probe).toBeNull();
  });

  test('REST 非数组载荷 → null（不假阳）', async () => {
    const probe = await probeGithubPr({
      owner: 'o',
      repo: 'r',
      branch: 'b',
      ghPath: failingGh(),
      fetchImpl: fetchJson({ message: 'rate limited' }, 200),
    });
    expect(probe).toBeNull();
  });
});

describe('githubRepoRefOf（失败方式 5：形态前置闸）', () => {
  test('github cloneUrl → owner/repo（.git 剥离）', () => {
    expect(githubRepoRefOf('https://github.com/octocat/Hello-World.git')).toEqual({
      owner: 'octocat',
      repo: 'Hello-World',
    });
  });
  test('hosted / local / 垃圾形状 → null（探测跳过）', () => {
    expect(githubRepoRefOf('http://server/git/t1/demo')).toBeNull();
    expect(githubRepoRefOf('/Users/me/repo')).toBeNull();
    expect(githubRepoRefOf('not a url')).toBeNull();
    expect(githubRepoRefOf('https://github.com/only-owner/')).toBeNull();
  });
  test('#1466 repo 段为 . / ..（存量 owner/.. 或 owner/. 行派生的 cloneUrl）→ null，不进探测', () => {
    expect(githubRepoRefOf('https://github.com/owner/...git')).toBeNull();
    expect(githubRepoRefOf('https://github.com/owner/..git')).toBeNull();
    expect(githubRepoRefOf('https://github.com/../user.git')).toBeNull();
    // 三点仓名不是 dot segment，照常探测。
    expect(githubRepoRefOf('https://github.com/owner/....git')).toEqual({
      owner: 'owner',
      repo: '...',
    });
  });
});
