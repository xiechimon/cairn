const GITHUB_COM = 'https://github.com';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

export function githubOauthBaseUrl(): string {
  const raw = process.env.CAIRN_GITHUB_OAUTH_BASE_URL;
  if (raw === undefined || raw === '') return GITHUB_COM;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid CAIRN_GITHUB_OAUTH_BASE_URL');
  }
  if (
    url.protocol !== 'http:' ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('Invalid CAIRN_GITHUB_OAUTH_BASE_URL');
  }
  return url.href.replace(/\/+$/, '');
}

export interface GithubOauthEndpoints {
  verificationUri: string;
  deviceCodeUrl: string;
  authorizeUrl: string;
  tokenUrl: string;
}

export function githubOauthEndpoints(): GithubOauthEndpoints {
  const base = githubOauthBaseUrl();
  return {
    verificationUri: `${base}/login/device`,
    deviceCodeUrl: `${base}/login/device/code`,
    authorizeUrl: `${base}/login/oauth/authorize`,
    tokenUrl: `${base}/login/oauth/access_token`,
  };
}

export function onGithubOauthBase(url: string): string {
  if (!url.startsWith(`${GITHUB_COM}/`)) return url;
  return `${githubOauthBaseUrl()}${url.slice(GITHUB_COM.length)}`;
}
