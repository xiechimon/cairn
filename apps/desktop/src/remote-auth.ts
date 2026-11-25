const DEDICATED_OAUTH_ORIGINS = new Set([
  'https://accounts.google.com',
  'https://appleid.apple.com',
  'https://login.microsoftonline.com',
  'https://clerk.shared.lcl.dev',
]);

const GITHUB_AUTH_PATH_PREFIXES = ['/login', '/sessions', '/session', '/signup'];

export function parseHttpsOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.hostname === '') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function parseAppOrigin(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function isOfflineHttpStatus(httpResponseCode: number): boolean {
  return httpResponseCode >= 502 && httpResponseCode <= 504;
}

export function isSameOriginUrl(rawUrl: string, origin: string): boolean {
  try {
    return new URL(rawUrl).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

export function isAllowedRemoteAuthUrl(
  rawUrl: string,
  appOrigin: string,
  clerkIssuer: string | null,
): boolean {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return false;
  }
  const app = parseAppOrigin(appOrigin);
  if (app !== null && target.origin === app) return true;
  if (target.protocol !== 'https:') return false;
  const issuerOrigin = parseHttpsOrigin(clerkIssuer);
  if (issuerOrigin !== null && target.origin === issuerOrigin) return true;
  if (DEDICATED_OAUTH_ORIGINS.has(target.origin)) return true;
  if (target.origin === 'https://github.com') {
    const path = target.pathname.toLowerCase();
    return GITHUB_AUTH_PATH_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    );
  }
  return false;
}
