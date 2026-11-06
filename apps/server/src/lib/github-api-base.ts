export function githubApiBaseUrl(): string {
  const raw = process.env.CAIRN_GITHUB_API_BASE_URL;
  if (raw === undefined || raw === '') return 'https://api.github.com';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid CAIRN_GITHUB_API_BASE_URL');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('Invalid CAIRN_GITHUB_API_BASE_URL');
  }
  return url.href.replace(/\/+$/, '');
}

export function isGithubApiUrl(value: string): boolean {
  try {
    const base = new URL(`${githubApiBaseUrl()}/`);
    const url = new URL(value);
    return (
      url.origin === base.origin &&
      url.username === '' &&
      url.password === '' &&
      url.pathname.startsWith(base.pathname)
    );
  } catch {
    return false;
  }
}
