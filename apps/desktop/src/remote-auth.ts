const TRUSTED_OAUTH_ORIGINS = new Set([
  'https://accounts.google.com',
  'https://github.com',
  'https://appleid.apple.com',
  'https://login.microsoftonline.com',
]);

function originOf(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function isAllowedRemoteAuthUrl(
  rawUrl: string,
  appOrigin: string,
  clerkIssuer: string | null,
): boolean {
  const targetOrigin = originOf(rawUrl);
  if (targetOrigin === null) return false;
  if (targetOrigin === originOf(appOrigin)) return true;
  if (clerkIssuer !== null && targetOrigin === originOf(clerkIssuer)) return true;
  if (TRUSTED_OAUTH_ORIGINS.has(targetOrigin)) return true;
  const host = new URL(targetOrigin).hostname.toLowerCase();
  return host.endsWith('.clerk.accounts.dev') || host.endsWith('.accounts.dev');
}
