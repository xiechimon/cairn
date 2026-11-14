import { createRemoteJWKSet, errors, type JWTVerifyGetKey, jwtVerify } from 'jose';

export interface CloudflareAccessConfig {
  teamDomain: string;
  aud: string;
  ownerEmails: readonly string[];
}

export type AccessVerdict =
  | { kind: 'owner'; email: string; expiresAt: number }
  | { kind: 'not-allowed' }
  | { kind: 'invalid' }
  | { kind: 'unavailable' };

export type AccessVerifier = (assertion: string | undefined) => Promise<AccessVerdict>;

const KEY_FETCH_TIMEOUT_MS = 5_000;
const KEY_CACHE_MS = 10 * 60_000;
const KEY_REFETCH_COOLDOWN_MS = 30_000;

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

function keysFor(teamDomain: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`), {
    timeoutDuration: KEY_FETCH_TIMEOUT_MS,
    cacheMaxAge: KEY_CACHE_MS,
    cooldownDuration: KEY_REFETCH_COOLDOWN_MS,
  });
}

export function createAccessVerifier(
  config: CloudflareAccessConfig,
  keys: JWTVerifyGetKey = keysFor(config.teamDomain),
): AccessVerifier {
  const owners = new Set(config.ownerEmails.map(normalizedEmail));
  return async (assertion) => {
    if (assertion === undefined || assertion === '') return { kind: 'invalid' };
    try {
      const { payload } = await jwtVerify(assertion, keys, {
        issuer: `https://${config.teamDomain}`,
        audience: config.aud,
        algorithms: ['RS256'],
        requiredClaims: ['exp', 'email'],
      });
      const email = typeof payload.email === 'string' ? normalizedEmail(payload.email) : '';
      if (!owners.has(email)) return { kind: 'not-allowed' };
      return { kind: 'owner', email, expiresAt: (payload.exp ?? 0) * 1000 };
    } catch (error) {
      if (error instanceof errors.JWKSTimeout || !(error instanceof errors.JOSEError)) {
        return { kind: 'unavailable' };
      }
      return { kind: 'invalid' };
    }
  };
}
