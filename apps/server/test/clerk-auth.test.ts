import { BROWSER_AUTH_HEADER } from '@cairn/shared';
import {
  createLocalJWKSet,
  errors,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
  SignJWT,
} from 'jose';
import pino from 'pino';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createClerkVerifier } from '../src/lib/clerk-auth.js';
import { bootServer, type TestServer } from './helpers.js';

const ISSUER = 'https://example.clerk.accounts.dev';
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const PUBLISHABLE_KEY = 'pk_test_example_key_for_unit_tests';
const OWNER_SUB = 'user_owner_01';
const OWNER_EMAIL = 'owner@example.com';

const CONFIG = {
  publishableKey: PUBLISHABLE_KEY,
  issuer: ISSUER,
  jwksUrl: JWKS_URL,
  ownerSubs: [OWNER_SUB],
  ownerEmails: [OWNER_EMAIL],
};

let signingKey: CryptoKey;
let otherKey: CryptoKey;
let keys: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  const other = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  otherKey = other.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'clerk-k1', alg: 'RS256' };
  keys = createLocalJWKSet({ keys: [jwk] });
});

function mintJwt(
  claims: Record<string, unknown> = { sub: OWNER_SUB, email: OWNER_EMAIL, email_verified: true },
  options: { key?: CryptoKey; iss?: string; exp?: number | null; kid?: string } = {},
): Promise<string> {
  let jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: options.kid ?? 'clerk-k1' })
    .setIssuer(options.iss ?? ISSUER)
    .setIssuedAt();
  if (options.exp !== null) jwt = jwt.setExpirationTime(options.exp ?? '5m');
  return jwt.sign(options.key ?? signingKey);
}

describe('createClerkVerifier', () => {
  test('accepts a valid RS256 token matching ownerSubs without needing email claim', async () => {
    const verify = createClerkVerifier({ ...CONFIG, ownerEmails: [] }, keys);
    const verdict = await verify(await mintJwt({ sub: OWNER_SUB }));
    expect(verdict).toEqual({ kind: 'owner', sub: OWNER_SUB, email: null });
  });

  test('accepts a valid RS256 token matching ownerEmails ignoring case and spaces', async () => {
    const verify = createClerkVerifier(
      { ...CONFIG, ownerSubs: [], ownerEmails: ['  Owner@Example.com '] },
      keys,
    );
    const verdict = await verify(
      await mintJwt({ sub: 'user_other', email: 'OWNER@example.COM', email_verified: true }),
    );
    expect(verdict).toEqual({ kind: 'owner', sub: 'user_other', email: OWNER_EMAIL });
  });

  test('rejects an unverified email claim even when the email matches allowlist', async () => {
    const verify = createClerkVerifier({ ...CONFIG, ownerSubs: [] }, keys);
    const verdict = await verify(
      await mintJwt({ sub: 'user_other', email: OWNER_EMAIL, email_verified: false }),
    );
    expect(verdict).toEqual({ kind: 'not-allowed' });
  });

  test('refuses a valid token whose sub and email are not on the allowlist', async () => {
    const verify = createClerkVerifier(CONFIG, keys);
    const verdict = await verify(
      await mintJwt({ sub: 'user_stranger', email: 'stranger@example.com', email_verified: true }),
    );
    expect(verdict).toEqual({ kind: 'not-allowed' });
  });

  test('rejects bad issuer, expired, missing exp, missing sub, bad key, unknown kid, HS256, or malformed tokens', async () => {
    const verify = createClerkVerifier(CONFIG, keys);
    const past = Math.floor(Date.now() / 1000) - 60;
    const hs = await new SignJWT({ sub: OWNER_SUB, email: OWNER_EMAIL })
      .setProtectedHeader({ alg: 'HS256', kid: 'clerk-k1' })
      .setIssuer(ISSUER)
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('a-shared-secret-of-enough-length-1234'));

    for (const bad of [
      await mintJwt({ sub: OWNER_SUB }, { iss: 'https://evil.clerk.accounts.dev' }),
      await mintJwt({ sub: OWNER_SUB }, { exp: past }),
      await mintJwt({ sub: OWNER_SUB }, { exp: null }),
      await mintJwt({ email: OWNER_EMAIL }),
      await mintJwt({ sub: OWNER_SUB }, { key: otherKey }),
      await mintJwt({ sub: OWNER_SUB }, { kid: 'unknown-kid' }),
      hs,
      'not-a-jwt',
      '',
    ]) {
      expect((await verify(bad)).kind).toBe('invalid');
    }
    expect((await verify(undefined)).kind).toBe('invalid');
  });

  test('returns unavailable when JWKS cannot be fetched or times out', async () => {
    const down: JWTVerifyGetKey = async () => {
      throw new TypeError('fetch failed');
    };
    const slow: JWTVerifyGetKey = async () => {
      throw new errors.JWKSTimeout();
    };
    for (const keySet of [down, slow]) {
      expect(await createClerkVerifier(CONFIG, keySet)(await mintJwt())).toEqual({
        kind: 'unavailable',
      });
    }
  });
});

describe('Clerk auth HTTP endpoints', () => {
  let server: TestServer | null = null;
  afterEach(() => {
    server?.dispose();
    server = null;
  });

  const boot = (withClerk = true) => {
    server = bootServer({
      authToken: 'owner-token',
      clerkAuth: withClerk
        ? {
            publishableKey: PUBLISHABLE_KEY,
            issuer: ISSUER,
            verify: createClerkVerifier(CONFIG, keys),
          }
        : null,
    });
    return server;
  };

  const cookieOf = (res: Response) =>
    (res.headers.getSetCookie?.() ?? [])
      .map((value) => value.split(';')[0] ?? '')
      .find((value) => value.startsWith('cairn_auth=')) ?? '';

  const exchange = (s: TestServer, headers: Record<string, string>, path = '/api/auth/clerk') =>
    s.app.request(path, {
      method: 'POST',
      headers: {
        'sec-fetch-site': 'same-origin',
        [BROWSER_AUTH_HEADER]: '1',
        ...headers,
      },
    });

  test('GET /api/auth/clerk/config reports enabled status and public fields without auth', async () => {
    const enabled = boot(true);
    const res = await enabled.app.request('/api/auth/clerk/config');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      enabled: true,
      publishableKey: PUBLISHABLE_KEY,
      issuer: ISSUER,
    });

    server?.dispose();
    const disabled = boot(false);
    const resOff = await disabled.app.request('/api/auth/clerk/config');
    expect(resOff.status).toBe(200);
    expect(await resOff.json()).toEqual({
      enabled: false,
      publishableKey: null,
      issuer: null,
    });
  });

  test('POST /api/auth/clerk exchanges valid Bearer JWT for a 30-day owner cookie and signout revokes it', async () => {
    const s = boot(true);
    expect((await s.app.request('/api/teams')).status).toBe(401);

    const res = await exchange(s, { authorization: `Bearer ${await mintJwt()}` });
    expect(res.status).toBe(200);
    const cookie = cookieOf(res);
    expect(cookie).not.toBe('');
    const setCookieHeader =
      (res.headers.getSetCookie?.() ?? []).find((v) => v.startsWith('cairn_auth=')) ?? '';
    const maxAge = Number(/Max-Age=(\d+)/i.exec(setCookieHeader)?.[1]);
    expect(maxAge).toBeGreaterThan(29 * 24 * 60 * 60);

    expect((await s.app.request('/api/teams', { headers: { cookie } })).status).toBe(200);

    const out = await s.app.request('/api/auth/signout', {
      method: 'POST',
      headers: {
        cookie,
        'sec-fetch-site': 'same-origin',
        [BROWSER_AUTH_HEADER]: '1',
      },
    });
    expect(out.status).toBe(204);
    expect((await s.app.request('/api/teams', { headers: { cookie } })).status).toBe(401);
  });

  test('rejects token passed in query string without Bearer header', async () => {
    const s = boot(true);
    const jwt = await mintJwt();
    const res = await exchange(s, {}, `/api/auth/clerk?token=${encodeURIComponent(jwt)}`);
    expect(res.status).toBe(401);
    expect(cookieOf(res)).toBe('');
  });

  test('rejects cross-site requests and requests missing browser auth header', async () => {
    const s = boot(true);
    const jwt = await mintJwt();
    const crossSite = await s.app.request('/api/auth/clerk', {
      method: 'POST',
      headers: {
        'sec-fetch-site': 'cross-site',
        [BROWSER_AUTH_HEADER]: '1',
        authorization: `Bearer ${jwt}`,
      },
    });
    expect(crossSite.status).toBe(403);
    expect(cookieOf(crossSite)).toBe('');

    const noProof = await s.app.request('/api/auth/clerk', {
      method: 'POST',
      headers: {
        'sec-fetch-site': 'same-origin',
        authorization: `Bearer ${jwt}`,
      },
    });
    expect(noProof.status).toBe(403);
    expect(cookieOf(noProof)).toBe('');
  });

  test('logs exchange outcomes without leaking token, email, or sub', async () => {
    const lines: string[] = [];
    const logger = pino({ level: 'info' }, { write: (line: string) => lines.push(line) });
    server = bootServer({
      authToken: 'owner-token',
      clerkAuth: {
        publishableKey: PUBLISHABLE_KEY,
        issuer: ISSUER,
        verify: createClerkVerifier(CONFIG, keys),
      },
      logger,
    });
    const outsider = await mintJwt({ sub: 'user_stranger', email: 'other@example.com' });
    const owner = await mintJwt();
    await exchange(server, { authorization: `Bearer ${outsider}` });
    await exchange(server, {});
    await exchange(server, { authorization: `Bearer ${owner}` });

    const outcomes = lines
      .map((line) => JSON.parse(line) as { msg?: string; outcome?: string; status?: number })
      .filter((entry) => entry.msg === 'clerk auth exchange')
      .map((entry) => [entry.outcome, entry.status]);
    expect(outcomes).toEqual([
      ['not-allowed', 403],
      ['invalid', 401],
      ['owner', 200],
    ]);
    const text = lines.join('\n');
    for (const secret of [
      'other@example.com',
      OWNER_EMAIL,
      OWNER_SUB,
      'user_stranger',
      outsider,
      owner,
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  test('returns 404 when Clerk auth is not configured and old query callback route is removed', async () => {
    const s = boot(false);
    expect((await exchange(s, { authorization: `Bearer ${await mintJwt()}` })).status).toBe(404);
    const oldUnauth = await s.app.request('/api/remote/account/callback?token=x&state=y');
    expect(oldUnauth.status).toBe(401);
    const oldAuthed = await s.app.request('/api/remote/account/callback?token=x&state=y', {
      headers: { authorization: 'Bearer owner-token' },
    });
    expect(oldAuthed.status).toBe(404);
  });
});

describe('Clerk & migration config parsing', () => {
  const ENV = [
    'CAIRN_CLERK_PUBLISHABLE_KEY',
    'CAIRN_CLERK_ISSUER',
    'CAIRN_CLERK_JWKS_URL',
    'CAIRN_CLERK_OWNER_SUBS',
    'CAIRN_CLERK_OWNER_EMAILS',
    'CAIRN_DISABLE_EXTERNAL_CONNECTORS',
  ] as const;

  const withEnv = <T>(values: Partial<Record<(typeof ENV)[number], string>>, run: () => T): T => {
    const saved = ENV.map((name) => [name, process.env[name]] as const);
    for (const name of ENV) delete process.env[name];
    Object.assign(process.env, values);
    try {
      return run();
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  };

  test('is off when unset and migration connector disable defaults to false', () => {
    const cfg = withEnv({}, () => loadConfig());
    expect(cfg.clerkAuth).toBeNull();
    expect(cfg.disableExternalConnectors).toBe(false);
  });

  test('parses valid Clerk config with derived jwksUrl and owner allowlists', () => {
    const cfg = withEnv(
      {
        CAIRN_CLERK_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
        CAIRN_CLERK_ISSUER: `${ISSUER}/`,
        CAIRN_CLERK_OWNER_SUBS: `${OWNER_SUB}, user_2`,
        CAIRN_CLERK_OWNER_EMAILS: `${OWNER_EMAIL}`,
        CAIRN_DISABLE_EXTERNAL_CONNECTORS: '1',
      },
      () => loadConfig(),
    );
    expect(cfg.clerkAuth).toEqual({
      publishableKey: PUBLISHABLE_KEY,
      issuer: ISSUER,
      jwksUrl: JWKS_URL,
      ownerSubs: [OWNER_SUB, 'user_2'],
      ownerEmails: [OWNER_EMAIL],
    });
    expect(cfg.disableExternalConnectors).toBe(true);
  });

  test('refuses partial Clerk config or non-https issuer', () => {
    expect(() => withEnv({ CAIRN_CLERK_ISSUER: ISSUER }, () => loadConfig())).toThrow(
      /CAIRN_CLERK_PUBLISHABLE_KEY/,
    );
    expect(() =>
      withEnv(
        {
          CAIRN_CLERK_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
          CAIRN_CLERK_ISSUER: 'http://insecure.example.com',
          CAIRN_CLERK_OWNER_SUBS: OWNER_SUB,
        },
        () => loadConfig(),
      ),
    ).toThrow();
  });
});
