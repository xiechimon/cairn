import { createRemoteJWKSet, errors, type JWTVerifyGetKey, jwtVerify } from 'jose';

export interface ClerkAuthConfig {
  publishableKey: string;
  issuer: string;
  jwksUrl: string;
  ownerSubs: readonly string[];
  ownerEmails: readonly string[];
}

export type ClerkVerdict =
  | { kind: 'owner'; sub: string; email: string | null }
  | { kind: 'not-allowed' }
  | { kind: 'invalid' }
  | { kind: 'unavailable' };

export type ClerkVerifier = (token: string | undefined) => Promise<ClerkVerdict>;

const KEY_FETCH_TIMEOUT_MS = 5_000;
const KEY_CACHE_MS = 10 * 60_000;
const KEY_REFETCH_COOLDOWN_MS = 30_000;

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

function keysFor(jwksUrl: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(jwksUrl), {
    timeoutDuration: KEY_FETCH_TIMEOUT_MS,
    cacheMaxAge: KEY_CACHE_MS,
    cooldownDuration: KEY_REFETCH_COOLDOWN_MS,
  });
}

export function createClerkVerifier(
  config: ClerkAuthConfig,
  keys: JWTVerifyGetKey = keysFor(config.jwksUrl),
): ClerkVerifier {
  const subs = new Set(config.ownerSubs.map((sub) => sub.trim()).filter((sub) => sub !== ''));
  const emails = new Set(config.ownerEmails.map(normalizedEmail).filter((email) => email !== ''));
  const issuer = config.issuer.replace(/\/+$/, '');

  return async (token) => {
    if (token === undefined || token === '') return { kind: 'invalid' };
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer,
        algorithms: ['RS256'],
        requiredClaims: ['exp', 'sub'],
      });
      const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
      if (sub === '') return { kind: 'invalid' };
      const rawEmail = typeof payload.email === 'string' ? normalizedEmail(payload.email) : null;
      const emailVerified = payload.email_verified !== false;
      const verifiedEmail = rawEmail !== null && emailVerified ? rawEmail : null;
      const subAllowed = subs.has(sub);
      const emailAllowed = verifiedEmail !== null && emails.has(verifiedEmail);
      if (!subAllowed && !emailAllowed) return { kind: 'not-allowed' };
      return { kind: 'owner', sub, email: verifiedEmail };
    } catch (error) {
      if (error instanceof errors.JWKSTimeout || !(error instanceof errors.JOSEError)) {
        return { kind: 'unavailable' };
      }
      return { kind: 'invalid' };
    }
  };
}
