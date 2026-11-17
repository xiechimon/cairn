import { afterEach, expect, test, vi } from 'vitest';
import {
  githubOauthBaseUrl,
  githubOauthEndpoints,
  onGithubOauthBase,
} from '../src/lib/github-oauth-base.js';

afterEach(() => vi.unstubAllEnvs());

test('unset or empty OAuth base keeps production github.com', () => {
  for (const value of [undefined, '']) {
    vi.stubEnv('CAIRN_GITHUB_OAUTH_BASE_URL', value);
    expect(githubOauthBaseUrl()).toBe('https://github.com');
    expect(githubOauthEndpoints()).toEqual({
      verificationUri: 'https://github.com/login/device',
      deviceCodeUrl: 'https://github.com/login/device/code',
      authorizeUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
    });
  }
});

test.each(['http://127.0.0.1:4002', 'http://[::1]:4002', 'http://localhost:4002'])(
  'accepts loopback OAuth base %s and preserves a path prefix',
  (value) => {
    vi.stubEnv('CAIRN_GITHUB_OAUTH_BASE_URL', `${value}/gh/`);
    expect(githubOauthBaseUrl()).toBe(`${value}/gh`);
    expect(githubOauthEndpoints().tokenUrl).toBe(`${value}/gh/login/oauth/access_token`);
  },
);

test.each([
  'invalid',
  'https://127.0.0.1:4002',
  'http://evil.example',
  'https://github.com.evil.example',
  'http://user:pass@127.0.0.1:4002',
  'http://127.0.0.1:4002/?x=1',
  'http://127.0.0.1:4002/#x',
  'file:///tmp/github',
])('rejects non-loopback or malformed OAuth base %s', (value) => {
  vi.stubEnv('CAIRN_GITHUB_OAUTH_BASE_URL', value);
  expect(() => githubOauthBaseUrl()).toThrow('CAIRN_GITHUB_OAUTH_BASE_URL');
});

test('onGithubOauthBase rewrites only github.com URLs', () => {
  vi.stubEnv('CAIRN_GITHUB_OAUTH_BASE_URL', 'http://127.0.0.1:4002');
  expect(onGithubOauthBase('https://github.com/login/oauth/access_token')).toBe(
    'http://127.0.0.1:4002/login/oauth/access_token',
  );
  expect(onGithubOauthBase('https://slack.com/oauth/v2/authorize')).toBe(
    'https://slack.com/oauth/v2/authorize',
  );
  expect(onGithubOauthBase('https://api.github.com/user')).toBe('https://api.github.com/user');
});
