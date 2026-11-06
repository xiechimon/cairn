import { afterEach, expect, test, vi } from 'vitest';
import { githubOpenIssuesDetail, githubPullPanel, githubUserLogin } from '../src/lib/github.js';
import { githubApiBaseUrl, isGithubApiUrl } from '../src/lib/github-api-base.js';

afterEach(() => vi.unstubAllEnvs());

test('unset or empty API base preserves production URLs', async () => {
  for (const value of [undefined, '']) {
    vi.stubEnv('CAIRN_GITHUB_API_BASE_URL', value);
    expect(githubApiBaseUrl()).toBe('https://api.github.com');
    const fetcher = vi.fn(
      async (_input: string | URL) => new Response(JSON.stringify({ login: 'octo' })),
    );
    expect(await githubUserLogin(fetcher, 'local-token')).toBe('octo');
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.github.com/user');
  }
});

test('local API base preserves an optional path prefix and removes trailing slashes', async () => {
  vi.stubEnv('CAIRN_GITHUB_API_BASE_URL', 'http://127.0.0.1:4001/api/v3/');
  const fetcher = vi.fn(async (_input: string | URL) => new Response('{}'));
  await githubPullPanel(fetcher, 'local-token', 'octo', 'demo', 1);
  expect(fetcher.mock.calls[0]?.[0]).toBe('http://127.0.0.1:4001/api/v3/repos/octo/demo/pulls/1');
});

test.each([
  'invalid',
  'file:///tmp/github',
  'https://user:pass@example.test',
  'https://example.test/?x=1',
  'https://example.test/#x',
])('rejects malformed API base %s', (value) => {
  vi.stubEnv('CAIRN_GITHUB_API_BASE_URL', value);
  expect(() => githubApiBaseUrl()).toThrow('CAIRN_GITHUB_API_BASE_URL');
});

test('pagination allows only URLs under the configured API base', () => {
  vi.stubEnv('CAIRN_GITHUB_API_BASE_URL', 'http://127.0.0.1:4001/api/v3/');
  expect(isGithubApiUrl('http://127.0.0.1:4001/api/v3/repos/o/r/issues?page=2')).toBe(true);
  for (const url of [
    'https://api.github.com/repos/o/r',
    'http://127.0.0.1:4002/api/v3/repos/o/r',
    'http://127.0.0.1:4001/api/v30/repos/o/r',
    'http://evil.test/api/v3/',
  ]) {
    expect(isGithubApiUrl(url)).toBe(false);
  }
});

test('issue pagination returns emulator next links and rejects foreign links', async () => {
  vi.stubEnv('CAIRN_GITHUB_API_BASE_URL', 'http://127.0.0.1:4001');
  for (const origin of ['http://127.0.0.1:4001', 'https://api.github.com']) {
    const next = `${origin}/repos/octo/demo/issues?page=2`;
    const fetcher = async () => new Response('[]', { headers: { link: `<${next}>; rel="next"` } });
    const page = await githubOpenIssuesDetail(fetcher, 'local-token', 'octo', 'demo');
    expect(page).toMatchObject({ data: { next: origin.startsWith('http:') ? next : null } });
  }
});
