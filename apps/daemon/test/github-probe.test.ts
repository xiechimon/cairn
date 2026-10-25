import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { githubRepoRefOf, probeGithubPr } from '../src/github-probe.js';

const disposables: string[] = [];
afterAll(() => {
  for (const d of disposables) rmSync(d, { recursive: true, force: true });
});

function fakeGh(stdout: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-gh-probe-'));
  disposables.push(dir);
  const path = join(dir, 'gh');
  writeFileSync(path, `#!/bin/sh\necho '${stdout.replace(/'/g, "'\\''")}'\n`, {
    mode: 0o755,
  });
  return path;
}

function failingGh(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-gh-probe-'));
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

describe('gh ladder (failure modes 1/2)', () => {
  test('gh hit → open preferred, multiple open take the largest number', async () => {
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
      branch: 'cairn/conv-x',
      ghPath: gh,
      fetchImpl: fetchJson([{ number: 99, html_url: 'u', state: 'open' }]),
    });
    expect(probe).toEqual({ number: 14, url: 'https://github.com/o/r/pull/14' });
  });

  test('gh non-zero exit → REST ladder takes over (no token = anonymous shape)', async () => {
    const probe = await probeGithubPr({
      owner: 'o',
      repo: 'r',
      branch: 'cairn/conv-x',
      ghPath: failingGh(),
      fetchImpl: fetchJson(GITHUB_API_ROWS),
    });
    expect(probe).toEqual({ number: 14, url: 'https://github.com/o/r/pull/14' });
  });
});

describe('REST ladder (failure modes 2/3/4)', () => {
  test('gh absent + token present → Authorization header carries the token, header only, never in the URL', async () => {
    const seen: { url?: string; headers?: Record<string, string> } = {};
    const fetchImpl = async (url: string, init?: { headers?: Record<string, string> }) => {
      seen.url = url;
      seen.headers = init?.headers;
      return fetchJson(GITHUB_API_ROWS)();
    };
    const probe = await probeGithubPr({
      owner: 'o',
      repo: 'r',
      branch: 'cairn/conv-x',
      ghPath: failingGh(),
      token: 'ghp_secret',
      fetchImpl,
    });
    expect(probe).toEqual({ number: 14, url: 'https://github.com/o/r/pull/14' });
    expect(seen.url).toBe(
      'https://api.github.com/repos/o/r/pulls?head=o%3Acairn%2Fconv-x&state=all',
    );
    expect(seen.url).not.toContain('ghp_secret');
    expect(seen.headers?.authorization).toBe('Bearer ghp_secret');
  });

  test('REST 404 (private repo, anonymous) → null, no throw', async () => {
    const probe = await probeGithubPr({
      owner: 'o',
      repo: 'private-r',
      branch: 'b',
      ghPath: failingGh(),
      fetchImpl: fetchJson({ message: 'Not Found' }, 404),
    });
    expect(probe).toBeNull();
  });

  test('REST network error → null (whole ladder failed = unknown)', async () => {
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

  test('REST non-array payload → null (no false positive)', async () => {
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

describe('githubRepoRefOf (failure mode 5: shape pre-gate)', () => {
  test('github cloneUrl → owner/repo (.git stripped)', () => {
    expect(githubRepoRefOf('https://github.com/octocat/Hello-World.git')).toEqual({
      owner: 'octocat',
      repo: 'Hello-World',
    });
  });
  test('hosted / local / garbage shapes → null (probe skipped)', () => {
    expect(githubRepoRefOf('http://server/git/t1/demo')).toBeNull();
    expect(githubRepoRefOf('/Users/me/repo')).toBeNull();
    expect(githubRepoRefOf('not a url')).toBeNull();
    expect(githubRepoRefOf('https://github.com/only-owner/')).toBeNull();
  });
  test('#1466 repo segment is . / .. (cloneUrl derived from a legacy owner/.. or owner/. line) → null, no probe', () => {
    expect(githubRepoRefOf('https://github.com/owner/...git')).toBeNull();
    expect(githubRepoRefOf('https://github.com/owner/..git')).toBeNull();
    expect(githubRepoRefOf('https://github.com/owner/....git')).toEqual({
      owner: 'owner',
      repo: '...',
    });
  });
});
